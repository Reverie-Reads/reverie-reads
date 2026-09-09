import { open } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnvironment } from './env.mjs'
import { createEditionPageClient } from './metadata/edition-page-client.mjs'
import { validateEditionPages, runEditionPages } from './metadata/edition-pages.mjs'
import { canonicalIsbn } from './metadata/supplement.mjs'
import { createValueStudyLock } from './metadata/value-study.mjs'
import consumedLock from '../reports/isbndb-value-study-lock-2026-09-09.json' with { type: 'json' }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const titleKey = (v) =>
  v
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[:–—]/)[0]
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Read-only exclusion: authenticate the complete consumed frame; do not load/reset attempt state. */
export function assertFreshEditionFrame(
  input,
  consumed,
  expectedFrameHash = consumedLock.frameSha256,
) {
  const actual = createValueStudyLock(consumed, consumedLock.systemSha256)
  if (actual.frameSha256 !== expectedFrameHash) throw new Error('wrong_consumed_frame')
  for (const c of input.cases) {
    if (
      consumed.cases.some(
        (old) =>
          canonicalIsbn(old.identity.isbn) === canonicalIsbn(c.identity.isbn) ||
          titleKey(old.identity.title) === titleKey(c.identity.title),
      )
    )
      throw new Error('consumed_work_overlap')
  }
}

async function readJson(path) {
  const file = await open(path, 'r')
  try {
    if (!(await file.stat()).isFile()) throw new Error('invalid_input')
    const buffer = Buffer.alloc(1048577)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > 1048576) throw new Error('input_too_large')
    return JSON.parse(buffer.subarray(0, size).toString('utf8'))
  } finally {
    await file.close()
  }
}

export async function main(args = process.argv.slice(2), write = console.log) {
  const options = { live: false, env: resolve(root, '.env.local'), maxOpenLibrary: 80 }
  const seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--') continue
    if (flag === '--help') {
      write(
        'metadata:pages --input <fresh-reviewed-frame.json> [--live --consumed-frame <original-100-work-frame.json>] [--max-openlibrary-requests 1..200] [--env <local-env-file>]\nDry-run default; 1..20 editions; at most two Google calls per edition. Memory-only evidence, aggregate-only output. No ISBNdb, LLM, cache or production writer. Live requires the hash-authenticated consumed frame solely to reject overlap before credential loading.',
      )
      return
    }
    if (
      seen.has(flag) ||
      !['--input', '--live', '--consumed-frame', '--max-openlibrary-requests', '--env'].includes(
        flag,
      )
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
    if (flag === '--consumed-frame') options.consumed = resolve(value)
    if (flag === '--env') options.env = resolve(value)
    if (flag === '--max-openlibrary-requests') options.maxOpenLibrary = Number(value)
  }
  if (
    !options.input ||
    !Number.isInteger(options.maxOpenLibrary) ||
    options.maxOpenLibrary < 1 ||
    options.maxOpenLibrary > 200
  )
    throw new Error('invalid_arguments')
  const input = validateEditionPages(await readJson(options.input))
  let client
  if (options.live) {
    if (input.cases.some((c) => new URL(c.reference.source).hostname.endsWith('.example')))
      throw new Error('synthetic_frame_not_live')
    if (!options.consumed) throw new Error('consumed_frame_required')
    assertFreshEditionFrame(input, await readJson(options.consumed))
    await loadLocalEnvironment(options.env)
    client = createEditionPageClient({
      googleKey: process.env.GOOGLE_BOOKS_API_KEY ?? process.env.GOOGLE_BOOKS_KEY,
      googleReferrer: process.env.GOOGLE_BOOKS_REFERRER,
      maxGoogleRequests: input.cases.length * 2,
      maxOpenLibraryRequests: options.maxOpenLibrary,
    })
  }
  write(JSON.stringify(await runEditionPages(input, { client }), null, 2))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(
      'Edition-page evaluation stopped. Check arguments, reviewed input, consumed-frame exclusion and local environment; details are redacted.',
    )
    process.exitCode = 1
  })
}
