import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const configPath = new URL('../supabase/config.toml', import.meta.url)

export function stackConfig(text) {
  const project = text.match(/^project_id\s*=\s*"([\w-]+)"/m)?.[1]
  const port = (section) => {
    const block = text.split(new RegExp(`^\\[${section}\\]\\s*$`, 'm'))[1]?.split(/^\[/m)[0]
    return block?.match(/^port\s*=\s*(\d+)/m)?.[1]
  }
  const apiPort = port('api')
  const dbPort = port('db')
  if (!project || !apiPort || !dbPort) throw new Error('Cannot read local stack identity and ports')
  return { project, apiPort, dbPort }
}

// Resolve once, then pass the same socket to Docker AND Supabase. DOCKER_CONTEXT overrides
// DOCKER_HOST in Docker, while other clients may only use DOCKER_HOST. Removing the context
// after resolution also prevents a later context edit from redirecting part of a running suite.
export function pinStack(env, config, docker, realpath = realpathSync) {
  const pinned = { ...env }
  let host = env.DOCKER_HOST
  if (env.DOCKER_CONTEXT || !host) {
    const context = env.DOCKER_CONTEXT || docker(['context', 'show'], env).trim()
    host = docker(
      ['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}'],
      env,
    ).trim()
  }
  if (!host?.startsWith('unix:///')) {
    throw new Error('Browser checks require a local Unix Docker socket; remote engines are refused')
  }
  host = `unix://${realpath(host.slice('unix://'.length))}`
  if (env.RV_STACK_DOCKER_HOST && env.RV_STACK_DOCKER_HOST !== host) {
    throw new Error('Docker endpoint changed inside the locked process tree')
  }
  pinned.DOCKER_HOST = host
  delete pinned.DOCKER_CONTEXT
  const engine = docker(['info', '--format', '{{.ID}}'], pinned).trim()
  if (!engine || (env.RV_STACK_DOCKER_ID && env.RV_STACK_DOCKER_ID !== engine)) {
    throw new Error('Docker engine changed inside the locked process tree')
  }
  for (const [service, internalPort, expectedPort] of [
    ['db', '5432/tcp', config.dbPort],
    ['kong', '8000/tcp', config.apiPort],
  ]) {
    const name = `supabase_${service}_${config.project}`
    const state = JSON.parse(
      docker(
        [
          'inspect',
          '--format',
          '{"state":{{json .State}},"ports":{{json .NetworkSettings.Ports}}}',
          name,
        ],
        pinned,
      ),
    )
    if (!state.state.Running || state.state.Health?.Status !== 'healthy') {
      throw new Error(`${name} is not healthy on the selected engine`)
    }
    const bindings = state.ports[internalPort] ?? []
    if (
      !bindings.some(
        (binding) =>
          binding.HostPort === expectedPort && ['127.0.0.1', '0.0.0.0'].includes(binding.HostIp),
      )
    ) {
      throw new Error(`${name} does not expose the configured local port ${expectedPort}`)
    }
  }
  pinned.RV_STACK_DOCKER_HOST = host
  pinned.RV_STACK_DOCKER_ID = engine
  return pinned
}

function main() {
  if (process.env.RV_STACK_LOCK_HELD !== '1' && !process.env.CI) {
    throw new Error('Run stack-engine inside scripts/stack-lock.sh')
  }
  const [command, ...args] = process.argv.slice(2)
  if (!command) throw new Error('Usage: node scripts/stack-engine.mjs <command...>')
  const config = stackConfig(readFileSync(configPath, 'utf8'))
  const env = pinStack(process.env, config, (args, env) =>
    execFileSync('docker', args, {
      env,
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
  console.error(`stack-engine: pinned healthy ${config.project} stack for this process tree`)
  const child = spawn(command, args, { env, stdio: 'inherit' })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal))
  }
  child.on('error', () => {
    console.error('stack-engine: could not start requested command')
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    // Do not dump a child-process error object: CLI output can contain configuration secrets.
    console.error(
      `stack-engine: ${error.code || typeof error.status === 'number' ? 'Docker preflight failed; check the selected local engine' : error.message}`,
    )
    process.exitCode = 1
  }
}
