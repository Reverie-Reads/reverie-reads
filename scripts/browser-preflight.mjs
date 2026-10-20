import { loadavg, availableParallelism } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Operational admission guard, not proof of spare capacity. The retained failed run reached
// load 318 on eight CPUs. Refuse an already queued CPU backlog before reset or browser startup;
// do not compensate with weaker deadlines, workers or retries. Dedicated CI is separate.
export function browserCapacity(cpus, loads) {
  if (
    !Number.isInteger(cpus) ||
    cpus < 1 ||
    loads.length < 2 ||
    loads.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    return { admitted: false, reason: 'invalid host capacity observation' }
  }
  const limit = cpus * 2
  return { admitted: loads[0] <= limit && loads[1] <= limit, cpus, loads, limit }
}

function main() {
  const observation = browserCapacity(availableParallelism(), loadavg())
  if (!process.env.CI && !observation.admitted) {
    console.error(
      `browser-preflight: local host is overloaded; no browser command started: ${JSON.stringify(observation)}`,
    )
    process.exitCode = 75
    return
  }
  console.error(
    `browser-preflight: ${process.env.CI ? 'dedicated CI runner' : 'local admission passed'} ${JSON.stringify(observation)}`,
  )
  const [command, ...args] = process.argv.slice(2)
  if (!command) return
  const child = spawn(command, args, { stdio: 'inherit' })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('error', () => {
    console.error('browser-preflight: command could not start')
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143)
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main()
