import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build, loadEnv, preview } from 'vite'
import { stackConfig } from '../../../scripts/stack-engine.mjs'

if (!process.env.CI && process.env.RV_STACK_LOCK_HELD !== '1') {
  throw new Error('Start the browser test server through the shared stack lock')
}

// Always rebuild: a leftover artifact from another revision is never test evidence.
const port = Number(process.argv[2])
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Explicit browser port required')
const root = fileURLToPath(new URL('../', import.meta.url))
const mode = 'browser-test'
const env = { ...loadEnv(mode, root, 'VITE_'), ...process.env }
const config = stackConfig(
  readFileSync(new URL('../../../supabase/config.toml', import.meta.url), 'utf8'),
)
let endpoint
try {
  endpoint = new URL(env.VITE_SUPABASE_URL)
} catch {
  throw new Error('Invalid local browser backend')
}
if (
  endpoint.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(endpoint.hostname) ||
  endpoint.port !== config.apiPort ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash ||
  endpoint.pathname !== '/'
)
  throw new Error('Browser bundle requires the configured local Supabase endpoint')

const options = { root, mode, build: { outDir: '.browser-test-dist' } }
await build(options)
const server = await preview({
  ...options,
  preview: { host: 'localhost', port, strictPort: true },
})
server.printUrls()
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.httpServer.close(() => process.exit(0)))
}
