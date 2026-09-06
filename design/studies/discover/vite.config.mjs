import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const web = resolve(here, '../../../apps/web')
const fromWeb = createRequire(resolve(web, 'package.json'))
const { default: react } = await import(fromWeb.resolve('@vitejs/plugin-react'))
const { default: tailwind } = await import(fromWeb.resolve('@tailwindcss/vite'))

// Standalone design review. No application router, authentication, service worker, or API client.
export default {
  root: here,
  publicDir: resolve(web, 'public'),
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      { find: '@reverie/core', replacement: resolve(here, '../../../packages/core/src/index.ts') },
      { find: /^react-dom(\/.*)?$/, replacement: resolve(web, 'node_modules/react-dom') + '$1' },
      { find: /^react(\/.*)?$/, replacement: resolve(web, 'node_modules/react') + '$1' },
      { find: 'tailwindcss', replacement: resolve(web, 'node_modules/tailwindcss') },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 4346,
    strictPort: true,
    fs: { allow: [resolve(here, '../../..')] },
  },
  build: { outDir: resolve(here, '../../../output/discover-study'), emptyOutDir: true },
}
