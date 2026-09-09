import { open } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnvironment } from './env.mjs'
import { createBaselineClient } from './metadata/baseline-client.mjs'
import { createIsbndbClient } from './metadata/isbndb-client.mjs'
import { validateBenchmark, runMetadataBenchmark } from './metadata/benchmark.mjs'
import { validatePageReview, runMetadataPageReview } from './metadata/page-review.mjs'
import { validateSubscriptionValue, runSubscriptionValue } from './metadata/subscription-value.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export async function main(args = process.argv.slice(2), write = console.log, mode = 'gap') {
  if (!['gap', 'page-review', 'subscription-value'].includes(mode)) throw new Error('invalid_mode')
  const validate =
    mode === 'gap'
      ? validateBenchmark
      : mode === 'page-review'
        ? validatePageReview
        : validateSubscriptionValue
  const run =
    mode === 'gap'
      ? runMetadataBenchmark
      : mode === 'page-review'
        ? runMetadataPageReview
        : runSubscriptionValue
  const options = {
    live: false,
    maxIsbndb: 10,
    maxOpenLibrary: 80,
    env: resolve(packageRoot, '.env.local'),
  }
  const seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--') continue
    if (flag === '--help') {
      write(
        `metadata:${mode === 'gap' ? 'benchmark' : mode === 'page-review' ? 'review' : 'value'} --input <reviewed-development-frame.json> [--live] [--max-isbndb-requests 1..20] [--max-openlibrary-requests 1..200] [--env <local-env-file>]\nDry-run default. Live acquires providers in memory. Only aggregate metrics are emitted. Value mode requires an explicit ISBNdb budget covering every case; it does not depend on free-source admission.`,
      )
      return
    }
    if (
      seen.has(flag) ||
      ![
        '--input',
        '--live',
        '--max-isbndb-requests',
        '--max-openlibrary-requests',
        '--env',
      ].includes(flag)
    )
      throw new Error('invalid_arguments')
    seen.add(flag)
    if (flag === '--live') {
      options.live = true
      continue
    }
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error('invalid_arguments')
    if (flag === '--input') options.input = resolve(value)
    if (flag === '--env') options.env = resolve(value)
    if (flag === '--max-isbndb-requests') options.maxIsbndb = Number(value)
    if (flag === '--max-openlibrary-requests') options.maxOpenLibrary = Number(value)
  }
  if (
    !options.input ||
    !Number.isInteger(options.maxIsbndb) ||
    options.maxIsbndb < 1 ||
    options.maxIsbndb > 20 ||
    !Number.isInteger(options.maxOpenLibrary) ||
    options.maxOpenLibrary < 1 ||
    options.maxOpenLibrary > 200
  )
    throw new Error('invalid_arguments')
  const handle = await open(options.input, 'r')
  let input
  try {
    if (!(await handle.stat()).isFile()) throw new Error('invalid_input')
    const buffer = Buffer.alloc(262145)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > 262144) throw new Error('input_too_large')
    input = validate(JSON.parse(buffer.subarray(0, size).toString('utf8')))
  } finally {
    await handle.close()
  }
  if (
    options.live &&
    mode === 'subscription-value' &&
    (!seen.has('--max-isbndb-requests') || options.maxIsbndb < input.cases.length)
  )
    throw new Error('incomplete_value_budget')
  if (
    options.live &&
    mode === 'subscription-value' &&
    input.cases.some((c) => new URL(c.reference.source).hostname.endsWith('.example'))
  )
    throw new Error('synthetic_frame_not_live')
  if (options.live) await loadLocalEnvironment(options.env)
  const baselineClient = options.live
    ? createBaselineClient({
        googleKey: process.env.GOOGLE_BOOKS_API_KEY ?? process.env.GOOGLE_BOOKS_KEY,
        googleReferrer: process.env.GOOGLE_BOOKS_REFERRER,
        maxGoogleRequests: input.cases.length,
        maxOpenLibraryRequests: options.maxOpenLibrary,
        includeValueMetadata: mode === 'subscription-value',
      })
    : undefined
  const isbndbClient = options.live
    ? createIsbndbClient({
        key: process.env.ISBNDB_API_KEY ?? process.env.ISBNDB_KEY,
        maxRequests: options.maxIsbndb,
      })
    : undefined
  write(
    JSON.stringify(await run(input, { live: options.live, baselineClient, isbndbClient }), null, 2),
  )
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(
      'Metadata benchmark stopped. Check arguments, local input, and credential-file access; details are redacted.',
    )
    process.exitCode = 1
  })
}
