import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { workflow } from 'workflow/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// One id per deploy: Vercel's commit SHA in CI, the local git SHA otherwise. Baked into the bundle
// (VITE_BUILD_ID — the update watcher compares against it)
// and emitted as /version.json so live clients can detect that a newer deploy replaced theirs.
function resolveBuildId(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  if (sha) return sha.slice(0, 12)
  try {
    return `local-${execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()}`
  } catch {
    return `local-${Date.now().toString(36)}`
  }
}
const buildId = resolveBuildId()
// The Vercel integration creates Sentry releases using the full commit SHA.
const sentryRelease = process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE || buildId
const uploadSourcemaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
)

const emitVersion: Plugin = {
  name: 'reverie:emit-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ build: buildId }),
    })
  },
}

export default defineConfig(({ command, mode }) => {
  // Fail loudly at BUILD time, never fall back: a bundle without VITE_SUPABASE_URL can't reach the
  // backend, and on a Vercel deploy a local Supabase URL means the wrong env is about to ship to
  // reveriereads.app (the launch registration failure). Local prod builds legitimately bake the
  // local stack URL from the committed .env (or a .env.local override) for e2e/preview, so the
  // localhost check is deploy-only.
  if (command === 'build') {
    const env = { ...loadEnv(mode, __dirname, 'VITE_'), ...process.env }
    const sbUrl = env.VITE_SUPABASE_URL
    if (!sbUrl) {
      throw new Error(
        'VITE_SUPABASE_URL is missing — refusing to build. Set it in the environment (Vercel); dev reads the committed apps/web/.env (is it missing?).',
      )
    }
    if (process.env.VERCEL && /\b(localhost|127\.0\.0\.1)\b/.test(sbUrl)) {
      throw new Error(
        `VITE_SUPABASE_URL points at a local Supabase (${sbUrl}) in a Vercel build — fix the Vercel env before deploying.`,
      )
    }
  }

  return {
    // Vitest imports the workflow module as ordinary TypeScript for the fast orchestration unit
    // suite. Starting Nitro and the production Workflow builder there creates file watchers that
    // are unrelated to the test and can exhaust macOS's per-process descriptor limit. The separate
    // compiler-backed Workflow suite owns its purpose-built transform and backend.
    plugins: [
      ...(mode === 'test' ? [] : [nitro(), workflow({ runtime: 'nodejs22.x' })]),
      react(),
      tailwindcss(),
      emitVersion,
      ...(command === 'build' && uploadSourcemaps
        ? [
            sentryVitePlugin({
              org: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
              authToken: process.env.SENTRY_AUTH_TOKEN,
              telemetry: false,
              // Deployment status is recorded after Vercel succeeds, not during the build.
              release: { name: sentryRelease, deploy: false },
              sourcemaps: {
                filesToDeleteAfterUpload: [
                  './dist/**/*.map',
                  './.output/public/**/*.map',
                  './.vercel/output/static/**/*.map',
                ],
              },
            }),
          ]
        : []),
    ],
    nitro: {
      // Keep the existing Vite SPA at the project root while adding Nitro's file-based `api/`
      // routes. Workflow scans the sibling `workflows/` directory by default.
      serverDir: './',
      routeRules: {
        '/fonts/files/**': {
          headers: { 'cache-control': 'public, max-age=31536000, immutable' },
        },
      },
    },
    define: {
      'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
      'import.meta.env.VITE_RELEASE': JSON.stringify(sentryRelease),
      'import.meta.env.VITE_SENTRY_ENVIRONMENT': JSON.stringify(
        process.env.VERCEL_ENV || 'development',
      ),
    },
    server: { port: 5173 },
    build: {
      sourcemap: uploadSourcemaps ? 'hidden' : false,
      rollupOptions: {
        output: {
          // Split big, stable vendors into their own cacheable chunks.
          manualChunks: {
            react: ['react', 'react-dom'],
            router: ['@tanstack/react-router'],
            query: ['@tanstack/react-query', '@tanstack/react-query-persist-client'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  }
})
