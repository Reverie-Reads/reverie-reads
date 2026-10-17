import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinStack, stackConfig } from './stack-engine.mjs'

const config = stackConfig(
  readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
)
function fixture(options = {}) {
  const calls = []
  let current = 'original'
  const docker = (args, env) => {
    calls.push({ args, env })
    if (args[0] === 'context') {
      if (args[1] === 'show') return current
      return `unix:///engines/${args[2]}.sock`
    }
    if (args[0] === 'info') return options.engine ?? 'original-engine'
    if (options.missing) throw new Error('No such container')
    const database = args.at(-1).startsWith('supabase_db_')
    return JSON.stringify({
      state: { Running: true, Health: { Status: options.health ?? 'healthy' } },
      ports: {
        [database ? '5432/tcp' : '8000/tcp']: [
          {
            HostIp: '0.0.0.0',
            HostPort: database ? config.dbPort : (options.apiPort ?? config.apiPort),
          },
        ],
      },
    })
  }
  return {
    calls,
    docker,
    drift: () => {
      current = 'other'
    },
  }
}
const resolve = (env, f) => pinStack(env, config, f.docker, (path) => path)

test('reads the actual project and ports without confusing nested sections', () => {
  assert.deepEqual(config, { project: 'book-corpus', apiPort: '55321', dbPort: '55322' })
  assert.throws(() => stackConfig('[api]\nport=123'), /Cannot read/)
})
test('freezes the selected engine across a context switch and nested invocation', () => {
  const f = fixture()
  const env = resolve({}, f)
  f.drift()
  assert.deepEqual(resolve(env, f), env)
  assert.equal(env.DOCKER_HOST, 'unix:///engines/original.sock')
  assert.equal(env.DOCKER_CONTEXT, undefined)
  assert.equal(f.calls.filter(({ args }) => args[0] === 'context').length, 2)
})
test('explicit context wins over a conflicting host, then both clients receive only that host', () => {
  const f = fixture()
  const env = resolve({ DOCKER_CONTEXT: 'chosen', DOCKER_HOST: 'unix:///wrong.sock' }, f)
  assert.equal(env.DOCKER_HOST, 'unix:///engines/chosen.sock')
  assert.equal(env.DOCKER_CONTEXT, undefined)
  assert.ok(
    f.calls
      .filter(({ args }) => args[0] !== 'context')
      .every(({ env: child }) => child.DOCKER_HOST === env.DOCKER_HOST && !child.DOCKER_CONTEXT),
  )
})
test('explicit host does not consult the changing default context', () => {
  const f = fixture()
  assert.equal(
    resolve({ DOCKER_HOST: 'unix:///chosen.sock' }, f).DOCKER_HOST,
    'unix:///chosen.sock',
  )
  assert.ok(f.calls.every(({ args }) => args[0] !== 'context'))
})
test('resolves socket symlinks before passing the endpoint to children', () => {
  const f = fixture()
  assert.equal(
    pinStack({ DOCKER_HOST: 'unix:///alias.sock' }, config, f.docker, () => '/actual.sock')
      .DOCKER_HOST,
    'unix:///actual.sock',
  )
})
test('refuses a different endpoint or replacement engine within a locked run', () => {
  const env = resolve({}, fixture())
  assert.throws(() => resolve({ ...env, DOCKER_CONTEXT: 'other' }, fixture()), /endpoint changed/)
  assert.throws(() => resolve(env, fixture({ engine: 'replacement' })), /engine changed/)
})
for (const [label, options, message] of [
  ['missing stack', { missing: true }, /No such container/],
  ['unhealthy stack', { health: 'unhealthy' }, /not healthy/],
  ['wrong browser port', { apiPort: '9999' }, /configured local port/],
]) {
  test(`refuses ${label} before returning an environment for execution`, () => {
    assert.throws(() => resolve({}, fixture(options)), message)
  })
}
test('refuses remote engines instead of testing an unrelated localhost service', () => {
  assert.throws(() => resolve({ DOCKER_HOST: 'tcp://remote:2375' }, fixture()), /local Unix/)
})

test('CLI never starts the command on preflight failure and preserves child arguments and exit code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stack-engine-test-'))
  try {
    const socket = join(dir, 'docker.sock')
    const marker = join(dir, 'command.json')
    writeFileSync(socket, '')
    writeFileSync(
      join(dir, 'docker'),
      `#!${process.execPath}
if (process.env.FAIL_PREFLIGHT) process.exit(1)
if (process.argv[2] === 'info') console.log('fixture-engine')
else console.log(JSON.stringify({state:{Running:true,Health:{Status:'healthy'}},ports:{
 '5432/tcp':[{HostIp:'127.0.0.1',HostPort:'55322'}],
 '8000/tcp':[{HostIp:'127.0.0.1',HostPort:'55321'}]
}}))
`,
      { mode: 0o700 },
    )
    const script = fileURLToPath(new URL('./stack-engine.mjs', import.meta.url))
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      DOCKER_HOST: `unix://${socket}`,
      RV_STACK_LOCK_HELD: '1',
    }
    for (const key of ['DOCKER_CONTEXT', 'RV_STACK_DOCKER_HOST', 'RV_STACK_DOCKER_ID'])
      delete env[key]
    const args = [
      script,
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(process.argv[1], JSON.stringify({arg:process.argv[2],host:process.env.DOCKER_HOST,context:process.env.DOCKER_CONTEXT})); process.exit(42)`,
      marker,
      'literal argument with spaces',
    ]
    const unlocked = spawnSync(process.execPath, args, {
      env: { ...env, CI: '', RV_STACK_LOCK_HELD: '0' },
      encoding: 'utf8',
    })
    assert.equal(unlocked.status, 1)
    assert.match(unlocked.stderr, /inside scripts\/stack-lock/)
    assert.equal(existsSync(marker), false)
    const failed = spawnSync(process.execPath, args, {
      env: { ...env, FAIL_PREFLIGHT: '1' },
      encoding: 'utf8',
    })
    assert.equal(failed.status, 1)
    assert.match(failed.stderr, /preflight failed/)
    assert.equal(existsSync(marker), false)
    const passed = spawnSync(process.execPath, args, { env, encoding: 'utf8' })
    assert.equal(passed.status, 42, passed.stderr)
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), {
      arg: 'literal argument with spaces',
      host: `unix://${realpathSync(socket)}`,
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
