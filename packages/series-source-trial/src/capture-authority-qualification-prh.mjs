import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTrialCases } from './cases.mjs'
import { loadLocalEnvironment } from './env.mjs'
import { authorityWorkKey } from './authority-sample.mjs'
import {
  buildPrhCapture,
  buildPrhFrameSpec,
  buildPrhQualificationCandidate,
  prhCollection,
  prhMembershipProposal,
  prhRecordCount,
  prhRequestUrl,
  prhUrl,
  sanitizePrhUrl,
} from './authority/prh-qualification.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results/authority-qualification')
const sleep = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const parseInteger = (value, label, { minimum, maximum }) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`)
  }
  return parsed
}

export function parsePrhCaptureArgs(argv) {
  const options = {
    frameId: null,
    from: null,
    to: null,
    domain: 'PRH.US',
    rows: 100,
    concurrency: 2,
    delayMs: 150,
    numberedSeriesOnly: false,
    out: null,
    dryRun: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--frame-id') options.frameId = argv[++index]
    else if (value === '--from') options.from = argv[++index]
    else if (value === '--to') options.to = argv[++index]
    else if (value === '--domain') options.domain = argv[++index]
    else if (value === '--rows') {
      options.rows = parseInteger(argv[++index], 'rows', { minimum: 1, maximum: 250 })
    } else if (value === '--concurrency') {
      options.concurrency = parseInteger(argv[++index], 'concurrency', {
        minimum: 1,
        maximum: 4,
      })
    } else if (value === '--delay-ms') {
      options.delayMs = parseInteger(argv[++index], 'delay-ms', {
        minimum: 0,
        maximum: 10_000,
      })
    } else if (value === '--numbered-series-only') options.numberedSeriesOnly = true
    else if (value === '--out') options.out = argv[++index]
    else if (value === '--dry-run') options.dryRun = true
    else throw new Error(`Unknown argument ${value}`)
  }
  if (!options.frameId || !options.from || !options.to) {
    throw new Error('PRH capture requires --frame-id, --from, and --to')
  }
  return options
}

const insidePrivateRoot = (path) => {
  const nested = relative(privateRoot, path)
  return Boolean(nested) && !nested.startsWith('..') && !isAbsolute(nested)
}

const atomicPrivateWrite = async (path, value) => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

const readState = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

const retryAfterMilliseconds = (response, attempt) => {
  const seconds = Number(response.headers.get('retry-after'))
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000)
  return Math.min(500 * 2 ** attempt, 8_000)
}

export async function fetchPrhJson(url, { apiKey, fetchImpl = fetch, delayMs = 150 }) {
  const safeUrl = sanitizePrhUrl(url)
  let lastError
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (delayMs) await sleep(delayMs)
    try {
      const response = await fetchImpl(prhRequestUrl(url, apiKey), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      })
      if (response.ok) {
        const text = await response.text()
        return { payload: JSON.parse(text), sha256: sha256(text), url: safeUrl }
      }
      if (![429, 500, 502, 503, 504].includes(response.status)) {
        const error = new Error(`PRH request failed with HTTP ${response.status}: ${safeUrl}`)
        error.nonRetryable = true
        throw error
      }
      lastError = new Error(`PRH request failed with HTTP ${response.status}: ${safeUrl}`)
      await sleep(retryAfterMilliseconds(response, attempt))
    } catch (error) {
      if (error?.nonRetryable) throw error
      lastError = new Error(
        `PRH request failed after a ${error?.name ?? 'network'} error: ${safeUrl}`,
      )
      if (attempt < 3) await sleep(Math.min(500 * 2 ** attempt, 8_000))
    }
  }
  throw lastError
}

const listedWork = (work) => ({
  workId: Number(work?.workId),
  title: String(work?.title ?? '').trim(),
  author: String(work?.author ?? '').trim(),
  onsale: String(work?.onsale ?? work?.earliestOnSaleDate ?? '').trim(),
  language: String(work?.language ?? '').trim(),
  seoFriendlyUrl: String(work?.seoFriendlyUrl ?? '').trim(),
})

const seriesRecord = (series) => ({
  seriesCode: String(series?.seriesCode ?? '').trim(),
  seriesName: String(series?.seriesName ?? series?.name ?? '').trim(),
  seriesCount: Number.isFinite(Number(series?.seriesCount)) ? Number(series.seriesCount) : null,
  isNumbered: typeof series?.isNumbered === 'boolean' ? series.isNumbered : null,
  isKids: typeof series?.isKids === 'boolean' ? series.isKids : null,
  seoFriendlyUrl: String(series?.seoFriendlyUrl ?? '').trim(),
})

const authorRecord = (author) => ({
  display: String(author?.display ?? author?.name ?? '').trim(),
  contribRoleCode: String(author?.contribRoleCode ?? '').trim(),
  contribRoleDesc: String(author?.contribRoleDesc ?? author?.roleVerb ?? '').trim(),
})

const categoryRecord = (category) => ({
  description: String(category?.description ?? category?.name ?? category?.label ?? '').trim(),
  catUri: String(category?.catUri ?? category?.uri ?? '').trim(),
})

const stateFor = (frameSpec) => ({
  schemaVersion: 1,
  frameSpec,
  frameSpecSha256: sha256(JSON.stringify(frameSpec)),
  recordCount: null,
  works: [],
  listingDigests: [],
  details: {},
  seriesPositions: {},
  completed: false,
})

const loadOrCreateState = async (statePath, frameSpec) => {
  const current = await readState(statePath)
  if (!current) return stateFor(frameSpec)
  if (current.frameSpecSha256 !== sha256(JSON.stringify(frameSpec))) {
    throw new Error('Existing PRH capture state belongs to a different frame specification')
  }
  if (current.completed) throw new Error('Existing PRH capture state is already complete')
  return current
}

async function captureListing(state, statePath, apiKey, options) {
  let start = state.works.length
  while (state.recordCount === null || start < state.recordCount) {
    const url = prhUrl(`/domains/${state.frameSpec.domain}/works`, {
      ...state.frameSpec.parameters,
      rows: state.frameSpec.rows,
      start,
    })
    const result = await fetchPrhJson(url, {
      apiKey,
      delayMs: options.delayMs,
    })
    const recordCount = prhRecordCount(result.payload)
    if (state.recordCount !== null && state.recordCount !== recordCount) {
      throw new Error(
        `PRH frame changed during capture: ${state.recordCount} became ${recordCount}`,
      )
    }
    state.recordCount = recordCount
    const page = prhCollection(result.payload, 'works').map(listedWork)
    if (!page.length && start < recordCount) {
      throw new Error(`PRH listing stopped at ${start} of ${recordCount}`)
    }
    state.works.push(...page)
    state.listingDigests.push({ start, count: page.length, sha256: result.sha256 })
    start += page.length
    await atomicPrivateWrite(statePath, state)
    console.log(`Captured ${Math.min(start, recordCount)} of ${recordCount} PRH work identities`)
  }
  const unique = new Set(state.works.map(({ workId }) => workId))
  if (state.works.length !== state.recordCount || unique.size !== state.recordCount) {
    throw new Error(
      `PRH frame did not reconcile: ${state.recordCount} records, ${state.works.length} rows, ${unique.size} unique work ids`,
    )
  }
}

const detailUrl = (domain, workId, resource) =>
  prhUrl(`/domains/${domain}/works/${workId}/${resource}`, {
    rows: 0,
    suppressLinks: true,
    returnEmptyLists: true,
  })

async function captureWorkDetail(work, frameSpec, apiKey, options) {
  const resources = ['authors', 'categories', 'series']
  const results = []
  for (const resource of resources) {
    results.push(
      await fetchPrhJson(detailUrl(frameSpec.domain, work.workId, resource), {
        apiKey,
        delayMs: options.delayMs,
      }),
    )
  }
  return {
    authors: prhCollection(results[0].payload, 'authors').map(authorRecord),
    categories: prhCollection(results[1].payload, 'categories').map(categoryRecord),
    series: prhCollection(results[2].payload, 'series').map(seriesRecord),
    evidenceDigests: Object.fromEntries(
      resources.map((resource, index) => [
        resource,
        { url: results[index].url, sha256: results[index].sha256 },
      ]),
    ),
  }
}

async function captureDetails(state, statePath, apiKey, options) {
  const pending = state.works.filter(({ workId }) => !state.details[String(workId)])
  for (let offset = 0; offset < pending.length; offset += options.concurrency) {
    const batch = pending.slice(offset, offset + options.concurrency)
    const details = await Promise.all(
      batch.map((work) => captureWorkDetail(work, state.frameSpec, apiKey, options)),
    )
    for (let index = 0; index < batch.length; index += 1) {
      state.details[String(batch[index].workId)] = details[index]
    }
    await atomicPrivateWrite(statePath, state)
    const completed = Object.keys(state.details).length
    if (completed % 25 < options.concurrency || completed === state.works.length) {
      console.log(`Captured authority metadata for ${completed} of ${state.works.length} works`)
    }
  }
}

async function captureSeriesPositions(state, statePath, apiKey, options) {
  const numberedCodes = [
    ...new Set(
      Object.values(state.details)
        .flatMap(({ series }) => series)
        .filter(({ seriesCode, isNumbered }) => seriesCode && isNumbered)
        .map(({ seriesCode }) => seriesCode),
    ),
  ].sort()
  const pending = numberedCodes.filter((code) => !state.seriesPositions[code])
  for (let offset = 0; offset < pending.length; offset += options.concurrency) {
    const batch = pending.slice(offset, offset + options.concurrency)
    const results = await Promise.all(
      batch.map((code) =>
        fetchPrhJson(
          prhUrl(`/domains/${state.frameSpec.domain}/series/${encodeURIComponent(code)}/works`, {
            sort: 'seriesNumber',
            dir: 'asc',
            rows: 0,
            suppressLinks: true,
            returnEmptyLists: true,
          }),
          { apiKey, delayMs: options.delayMs },
        ),
      ),
    )
    for (let index = 0; index < batch.length; index += 1) {
      const works = prhCollection(results[index].payload, 'works')
      state.seriesPositions[batch[index]] = {
        positions: Object.fromEntries(
          works
            .filter((work) => Number.isInteger(Number(work?.workId)))
            .map((work) => [String(work.workId), Number(work?.seriesNumber)]),
        ),
        evidenceDigest: { url: results[index].url, sha256: results[index].sha256 },
      }
    }
    await atomicPrivateWrite(statePath, state)
  }
}

const exclusionSummary = (reasons) =>
  [...reasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => left.reason.localeCompare(right.reason))

async function buildCaptureFromState(state) {
  const development = await loadTrialCases()
  const developmentKeys = new Set(development.cases.map(authorityWorkKey))
  const exclusions = new Map()
  const candidates = []
  for (const work of state.works) {
    const detail = state.details[String(work.workId)]
    const relation = prhMembershipProposal(detail.series)
    const positionBySeriesCode = Object.fromEntries(
      relation.memberships.map(({ providerSeriesCode }) => [
        providerSeriesCode,
        state.seriesPositions[providerSeriesCode]?.positions?.[String(work.workId)],
      ]),
    )
    const built = buildPrhQualificationCandidate({
      work,
      authors: detail.authors,
      categories: detail.categories,
      series: detail.series,
      positionBySeriesCode,
      frame: state.frameSpec,
      evidenceDigests: {
        ...detail.evidenceDigests,
        seriesPositions: Object.fromEntries(
          relation.memberships
            .filter(({ providerSeriesCode }) => state.seriesPositions[providerSeriesCode])
            .map(({ providerSeriesCode }) => [
              providerSeriesCode,
              state.seriesPositions[providerSeriesCode].evidenceDigest,
            ]),
        ),
      },
    })
    if (!built.eligible) {
      exclusions.set(built.reason, (exclusions.get(built.reason) ?? 0) + 1)
      continue
    }
    if (developmentKeys.has(authorityWorkKey(built.case))) {
      const reason = 'work already exists in the development partition'
      exclusions.set(reason, (exclusions.get(reason) ?? 0) + 1)
      continue
    }
    candidates.push(built.case)
  }
  return buildPrhCapture({
    frameSpec: state.frameSpec,
    capturedAt: new Date().toISOString(),
    populationCases: state.recordCount,
    candidates,
    exclusions: exclusionSummary(exclusions),
  })
}

export async function runPrhCapture(argv = process.argv.slice(2)) {
  const options = parsePrhCaptureArgs(argv)
  const frameSpec = buildPrhFrameSpec(options)
  const outputPath = resolve(
    repositoryRoot,
    options.out ??
      `packages/series-source-trial/private-results/authority-qualification/${frameSpec.frameId}.review.json`,
  )
  if (!insidePrivateRoot(outputPath)) {
    throw new Error(
      'PRH qualification output must remain under private-results/authority-qualification',
    )
  }
  const statePath = `${outputPath}.state.json`
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          frameSpec,
          outputPath,
          statePath,
          requests:
            'one complete paged work listing, three detail requests per work, and one position request per numbered series',
          truthBoundary:
            'All relationships remain candidate proposals. Missing series is unresolved, never standalone.',
        },
        null,
        2,
      ),
    )
    return
  }

  await loadLocalEnvironment(resolve(packageRoot, '.env.local'))
  const apiKey = process.env.PRH_API_KEY
  if (!apiKey) {
    throw new Error(
      'PRH_API_KEY is missing. Add it to packages/series-source-trial/.env.local or the process environment.',
    )
  }
  try {
    await readFile(outputPath, 'utf8')
    throw new Error(`Refusing to overwrite completed capture ${outputPath}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const state = await loadOrCreateState(statePath, frameSpec)
  await captureListing(state, statePath, apiKey, options)
  await captureDetails(state, statePath, apiKey, options)
  await captureSeriesPositions(state, statePath, apiKey, options)
  const capture = await buildCaptureFromState(state)
  await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  state.completed = true
  state.outputSha256 = sha256(JSON.stringify(capture))
  await atomicPrivateWrite(statePath, state)
  console.log(
    `Captured complete frame ${frameSpec.frameId}: ${state.recordCount} works, ${capture.cases.length} review candidates, ${capture.selectionFrames[0].exclusions.reduce((total, item) => total + item.count, 0)} exclusions.`,
  )
  console.log(`Review file: ${outputPath}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runPrhCapture()
}
