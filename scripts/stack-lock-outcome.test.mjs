import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const wrapper = fileURLToPath(new URL('./stack-lock.sh', import.meta.url))

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'stack-lock-outcome-'))
  const children = []
  const env = {
    ...process.env,
    RV_STACK_LOCK_FILE: join(directory, 'private.lock'),
    RV_STACK_LOCK_TIMEOUT: '1',
    RV_STACK_LOCK_NOTIFY: '1',
  }
  for (const key of ['CI', 'RV_STACK_LOCK_HELD', 'RV_STACK_LOCK_DISABLE', 'STACK_LOCK_BIN'])
    delete env[key]
  t.after(async () => {
    for (const child of children) {
      child.process.stdin.end()
      if (child.process.exitCode === null && child.process.signalCode === null) {
        // Only this fixture's detached process group; never search other sessions by name.
        try {
          process.kill(-child.process.pid, 'SIGTERM')
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
      await child.done
    }
    rmSync(directory, { recursive: true, force: true })
  })
  return (source, overrides = {}) => {
    const child = spawn('bash', [wrapper, process.execPath, '-e', source], {
      env: { ...env, ...overrides },
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const result = { process: child, stdout: '', stderr: '' }
    child.stdout.on('data', (data) => (result.stdout += data))
    child.stderr.on('data', (data) => (result.stderr += data))
    result.done = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    children.push(result)
    return result
  }
}

async function observed(child, text) {
  const deadline = Date.now() + 10_000
  while (!child.stdout.includes(text)) {
    assert.equal(child.process.exitCode, null, child.stderr)
    assert.ok(Date.now() < deadline, `Did not observe ${text}: ${child.stderr}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('preserves a command exit of 75 without falsely reporting no execution', async (t) => {
  const run = fixture(t)
  const child = run('console.log("COMMAND_RAN"); process.exit(75)')
  assert.equal((await child.done).code, 75)
  assert.match(child.stdout, /COMMAND_RAN/)
  assert.doesNotMatch(child.stderr, /TIMED OUT|did NOT run/)
})

test('a command failure after the acquisition timeout remains a command failure', async (t) => {
  const run = fixture(t)
  const child = run('console.log("COMMAND_RAN"); setTimeout(() => process.exit(1), 1500)')
  assert.equal((await child.done).code, 1)
  assert.match(child.stdout, /COMMAND_RAN/)
  assert.doesNotMatch(child.stderr, /TIMED OUT|did NOT run/)
})

test('genuine contention times out without executing the waiting command', async (t) => {
  const run = fixture(t)
  const holder = run('console.log("HELD"); process.stdin.resume()')
  await observed(holder, 'HELD')
  const waiter = run('console.log("MUST_NOT_RUN")')
  assert.equal((await waiter.done).code, 75)
  assert.equal(waiter.stdout, '')
  assert.match(waiter.stderr, /TIMED OUT/)
  assert.match(waiter.stderr, /did NOT run/)
  holder.process.stdin.end()
  assert.equal((await holder.done).code, 0)
})

test('waiting heartbeat stops once the command acquires the lock', async (t) => {
  const run = fixture(t)
  const holder = run('console.log("HELD"); process.stdin.resume()')
  await observed(holder, 'HELD')
  const waiter = run('console.log("WAITER_STARTED"); process.stdin.resume()', {
    RV_STACK_LOCK_TIMEOUT: '10',
  })
  // Wait for actual contention, not a timing guess about kernel acquisition.
  const deadline = Date.now() + 10_000
  while (!waiter.stderr.includes('the stack is held')) {
    assert.ok(Date.now() < deadline, waiter.stderr)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  holder.process.stdin.end()
  assert.equal((await holder.done).code, 0)
  await observed(waiter, 'WAITER_STARTED')
  const before = waiter.stderr
  await new Promise((resolve) => setTimeout(resolve, 2200))
  assert.equal(waiter.stderr, before)
  waiter.process.stdin.end()
  assert.equal((await waiter.done).code, 0)
})
