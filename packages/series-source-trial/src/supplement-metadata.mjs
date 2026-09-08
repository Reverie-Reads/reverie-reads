import { open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnvironment } from './env.mjs'
import { createIsbndbClient } from './metadata/isbndb-client.mjs'
import { runSupplement, validateInput } from './metadata/supplement.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function main(args = process.argv.slice(2), write = console.log) {
  let inputPath,
    envPath = resolve(packageRoot, '.env.local'),
    live = false,
    maxRequests = 10
  const seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--') continue
    if (flag === '--help') {
      write(
        'metadata:supplement --input <development.json> [--live] [--max-requests 1..20] [--env <local-env-file>]\nDry-run by default. Outputs aggregate counts only; never writes book data.',
      )
      return
    }
    if (seen.has(flag) || !['--input', '--env', '--live', '--max-requests'].includes(flag))
      throw new Error('invalid_arguments')
    seen.add(flag)
    if (flag === '--live') {
      live = true
      continue
    }
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error('invalid_arguments')
    if (flag === '--input') inputPath = resolve(value)
    if (flag === '--env') envPath = resolve(value)
    if (flag === '--max-requests') maxRequests = Number(value)
  }
  if (!inputPath || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 20)
    throw new Error('invalid_arguments')
  const file = await open(inputPath, 'r')
  let input
  try {
    if (!(await file.stat()).isFile()) throw new Error('invalid_input')
    const buffer = Buffer.alloc(262145)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > 262144) throw new Error('input_too_large')
    input = validateInput(JSON.parse(buffer.subarray(0, size).toString('utf8')))
  } finally {
    await file.close()
  }
  // No credentials are loaded in a dry run. The live runner only sends canonical ISBNs.
  if (live) await loadLocalEnvironment(envPath)
  const client = live
    ? createIsbndbClient({ key: process.env.ISBNDB_API_KEY ?? process.env.ISBNDB_KEY, maxRequests })
    : undefined
  write(JSON.stringify(await runSupplement(input, { live, client }), null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(
      'Metadata supplement failed. Check the input schema, arguments, and local file access; details are redacted.',
    )
    process.exitCode = 1
  })
}
