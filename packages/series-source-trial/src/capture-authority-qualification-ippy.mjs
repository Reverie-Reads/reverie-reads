import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorityWorkKey } from './authority-sample.mjs'
import {
  buildIppyCapture,
  extractIppyArchiveMedalistRecords,
  extractIppyMedalistRecords,
  IPPY_QUALIFICATION_PAGES,
  IPPY_ORIGIN,
} from './authority/ippy-qualification.mjs'
import { loadTrialCases } from './cases.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results/authority-qualification')
const robotsUrl = `${IPPY_ORIGIN}/robots.txt`
const userAgent = 'ReverieQualificationResearch/1.0'
const maximumBytes = 5_000_000
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const sleep = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

export function parseIppyCaptureArgs(argv) {
  const options = { out: null, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--out') options.out = argv[++index]
    else if (value === '--dry-run') options.dryRun = true
    else throw new Error(`Unknown argument ${value}`)
  }
  return options
}

export function ippyRobotsPolicy(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  let applies = false
  let sawUserAgent = false
  let preambleCrawlDelaySeconds = null
  let crawlDelaySeconds = null
  const disallows = []
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const name = line.slice(0, separator).trim().toLocaleLowerCase('en-US')
    const value = line.slice(separator + 1).trim()
    if (name === 'user-agent') {
      sawUserAgent = true
      applies = value === '*'
    } else if (applies && name === 'disallow' && value) disallows.push(value)
    else if ((applies || !sawUserAgent) && name === 'crawl-delay') {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed >= 0) {
        if (applies) crawlDelaySeconds = parsed
        else preambleCrawlDelaySeconds = parsed
      }
    }
  }
  return {
    crawlDelaySeconds: crawlDelaySeconds ?? preambleCrawlDelaySeconds,
    disallows,
  }
}

const robotsAllows = (policy, url) =>
  !policy.disallows.some((path) => path === '/' || new URL(url).pathname.startsWith(path))

async function boundedTextFetch(url, { fetchImpl = fetch, expectedType }) {
  const parsed = new URL(url)
  if (parsed.origin !== IPPY_ORIGIN || parsed.username || parsed.password) {
    throw new Error(`IPPY capture refused an unexpected origin: ${url}`)
  }
  const response = await fetchImpl(url, {
    redirect: 'manual',
    headers: { Accept: expectedType, 'User-Agent': userAgent },
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`IPPY capture refuses redirects: ${url}`)
  }
  if (!response.ok) throw new Error(`IPPY request failed with HTTP ${response.status}: ${url}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLocaleLowerCase('en-US').includes(expectedType)) {
    throw new Error(`IPPY response has unexpected content type ${contentType}: ${url}`)
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error(`IPPY response exceeds ${maximumBytes} bytes: ${url}`)
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > maximumBytes) {
    throw new Error(`IPPY response exceeds ${maximumBytes} bytes: ${url}`)
  }
  return text
}

export async function captureIppyPages({ fetchImpl = fetch, wait = sleep } = {}) {
  const robots = await boundedTextFetch(robotsUrl, { fetchImpl, expectedType: 'text/plain' })
  const policy = ippyRobotsPolicy(robots)
  if (!IPPY_QUALIFICATION_PAGES.every(({ url }) => robotsAllows(policy, url))) {
    throw new Error('IPPY robots policy does not allow every fixed qualification page')
  }
  if (!Number.isFinite(policy.crawlDelaySeconds)) {
    throw new Error('IPPY robots policy does not declare a crawl delay')
  }
  const delayMilliseconds = Math.max(10_000, policy.crawlDelaySeconds * 1000)
  const pages = []
  for (const page of IPPY_QUALIFICATION_PAGES) {
    await wait(delayMilliseconds)
    const html = await boundedTextFetch(page.url, { fetchImpl, expectedType: 'text/html' })
    const records =
      page.format === 'archive-card'
        ? extractIppyArchiveMedalistRecords(html)
        : extractIppyMedalistRecords(html)
    if (records.length < page.minimumRecords) {
      throw new Error(`IPPY page structure is incomplete or changed: ${page.url}`)
    }
    pages.push({ ...page, records, responseSha256: sha256(html) })
    console.log(`Captured ${records.length} medalist records from ${page.id}`)
  }
  return pages
}

export async function runIppyCapture(argv = process.argv.slice(2)) {
  const options = parseIppyCaptureArgs(argv)
  const outputPath = resolve(
    repositoryRoot,
    options.out ??
      'packages/series-source-trial/private-results/authority-qualification/ippy-2023-2025.review.json',
  )
  const nested = relative(privateRoot, outputPath)
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(
      'IPPY qualification output must remain under private-results/authority-qualification',
    )
  }
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          pages: IPPY_QUALIFICATION_PAGES,
          robotsUrl,
          outputPath,
          requests: 'one robots request and six fixed official result pages, sequentially paced',
          truthBoundary:
            'Medalist identity and category are selection metadata only; every classification remains pending.',
        },
        null,
        2,
      ),
    )
    return
  }
  try {
    await readFile(outputPath, 'utf8')
    throw new Error(`Refusing to overwrite completed capture ${outputPath}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const [pages, development] = await Promise.all([captureIppyPages(), loadTrialCases()])
  const capture = buildIppyCapture({
    pages,
    capturedAt: new Date().toISOString(),
    developmentWorkKeys: new Set(development.cases.map(authorityWorkKey)),
  })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  console.log(
    `Captured ${capture.cases.length} unique IPPY review candidates across ${capture.selectionFrames.length} complete frames.`,
  )
  console.log(`Review file: ${outputPath}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runIppyCapture()
}
