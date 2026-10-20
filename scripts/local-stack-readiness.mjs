import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stackConfig } from './stack-engine.mjs'

export async function inspectLocalApi(url, key, timeoutMs = 5000) {
  let endpoint
  try {
    endpoint = new URL(url)
  } catch {
    throw new Error('Invalid local readiness endpoint')
  }
  if (
    endpoint.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/'
  ) {
    throw new Error('Readiness requires a plain local API endpoint')
  }
  const probes = [
    ['auth', '/auth/v1/health', 200],
    ['rest', '/rest/v1/', 200],
    ['private-books-control', '/rest/v1/books?select=id&limit=0', 401],
    ['missing-table-control', '/rest/v1/intake_missing_probe_control?select=id&limit=0', 404],
  ]
  const checks = await Promise.all(
    probes.map(async ([name, path, expected]) => {
      try {
        const response = await fetch(new URL(path, endpoint), {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(timeoutMs),
        })
        const body = await response.json()
        const shape =
          name === 'rest'
            ? body?.swagger === '2.0'
            : name === 'private-books-control'
              ? body?.code === '42501'
              : name === 'missing-table-control'
                ? body?.code === 'PGRST205'
                : body?.name === 'GoTrue'
        return { name, status: response.status, pass: response.status === expected && shape }
      } catch (error) {
        return { name, pass: false, error: error.name }
      }
    }),
  )
  return { allPass: checks.every((check) => check.pass), checks }
}

async function main() {
  if (process.env.RV_STACK_LOCK_HELD !== '1' || !process.env.RV_STACK_DOCKER_HOST) {
    throw new Error('Run readiness inside stack-lock.sh and stack-engine.mjs')
  }
  const { apiPort } = stackConfig(
    readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
  )
  // Only the committed public local demo key; never load administrator or hosted credentials.
  const text = readFileSync(new URL('../apps/web/.env', import.meta.url), 'utf8')
  const key = text.match(/^VITE_SUPABASE_ANON_KEY=(\S+)$/m)?.[1]
  if (!key) throw new Error('Committed local anonymous key missing')
  const result = await inspectLocalApi(`http://127.0.0.1:${apiPort}`, key)
  console.log(JSON.stringify(result))
  if (!result.allPass) process.exitCode = 1
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('local-stack-readiness: preflight failed')
    process.exitCode = 1
  })
}
