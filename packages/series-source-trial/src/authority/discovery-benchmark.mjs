import { createHash } from 'node:crypto'

const sourceChannels = new Map([
  ['author', 'author'],
  ['publisher', 'publisher'],
  ['publisher_catalog', 'publisher'],
])

const asArray = (value) => (Array.isArray(value) ? value : [])
const rate = (numerator, denominator) => (denominator ? numerator / denominator : null)

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export const normalizeAuthorityOrigin = (value) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

export const normalizeAuthorityUrl = (value) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    url.hash = ''
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return null
  }
}

const caseSources = (testCase, sharedSources) => [
  ...asArray(testCase?.truth?.sources),
  ...asArray(testCase?.truth?.sourceGroups).flatMap((group) => asArray(sharedSources?.[group])),
]

export const expectedAuthoritySources = (testCase, sharedSources, benchmark) => {
  const excludedOrigins = new Set(asArray(benchmark?.selection?.excludedHostedPlatforms))
  return caseSources(testCase, sharedSources)
    .map((source) => ({
      channel: sourceChannels.get(source?.kind),
      kind: source?.kind,
      url: source?.url,
      origin: normalizeAuthorityOrigin(source?.url),
      normalizedUrl: normalizeAuthorityUrl(source?.url),
    }))
    .filter(
      (source) =>
        source.channel &&
        source.origin &&
        source.normalizedUrl &&
        !excludedOrigins.has(source.origin),
    )
}

export function auditAuthorityDiscoveryHoldout(
  caseSet,
  benchmark,
  { authorityGoldText = null } = {},
) {
  const errors = []
  const casesById = new Map(asArray(caseSet?.cases).map((testCase) => [testCase.id, testCase]))
  const cellsById = new Map(asArray(benchmark?.cells).map((cell) => [cell.id, cell]))
  const seenCases = new Set()
  const seenAuthors = new Set()
  const counts = new Map(asArray(benchmark?.cells).map((cell) => [cell.id, 0]))

  if (benchmark?.schemaVersion !== 1) errors.push('benchmark schemaVersion must be 1')
  if (!benchmark?.id) errors.push('benchmark id is required')
  if (!benchmark?.promptVersion) errors.push('benchmark promptVersion is required')
  if (!asArray(benchmark?.cases).length) errors.push('benchmark must select at least one case')

  if (
    authorityGoldText !== null &&
    sha256(authorityGoldText) !== benchmark?.sourceDataset?.sha256
  ) {
    errors.push('authority gold file does not match the frozen sourceDataset sha256')
  }

  for (const selected of asArray(benchmark?.cases)) {
    if (seenCases.has(selected?.id)) {
      errors.push(`${selected?.id ?? '<missing id>'}: duplicate benchmark case`)
      continue
    }
    seenCases.add(selected?.id)

    const cell = cellsById.get(selected?.cell)
    if (!cell) {
      errors.push(`${selected?.id ?? '<missing id>'}: unknown benchmark cell ${selected?.cell}`)
      continue
    }
    if (!['author', 'publisher'].includes(cell.channel)) {
      errors.push(`${cell.id}: channel must be author or publisher`)
    }
    if (!['series', 'standalone'].includes(cell.classification)) {
      errors.push(`${cell.id}: classification must be series or standalone`)
    }

    const testCase = casesById.get(selected?.id)
    if (!testCase || testCase.truth?.status !== 'reviewed') {
      errors.push(`${selected?.id ?? '<missing id>'}: benchmark case must be reviewed`)
      continue
    }
    const classification = testCase.truth.standalone ? 'standalone' : 'series'
    if (classification !== cell.classification) {
      errors.push(`${selected.id}: truth classification does not match cell ${cell.id}`)
    }

    const authorKey = asArray(testCase.authors)
      .map((author) => author.trim().toLocaleLowerCase('en-US'))
      .sort()
      .join('|')
    if (seenAuthors.has(authorKey))
      errors.push(`${selected.id}: benchmark authors must be distinct`)
    seenAuthors.add(authorKey)

    const expected = expectedAuthoritySources(testCase, caseSet.sharedSources, benchmark)
    if (!expected.length) errors.push(`${selected.id}: no direct authority origin is available`)
    if (!expected.some((source) => source.channel === cell.channel)) {
      errors.push(`${selected.id}: no ${cell.channel} authority origin is available`)
    }
    counts.set(cell.id, (counts.get(cell.id) ?? 0) + 1)
  }

  for (const cell of asArray(benchmark?.cells)) {
    if (!Number.isInteger(cell.target) || cell.target < 1) {
      errors.push(`${cell.id}: target must be a positive integer`)
    } else if ((counts.get(cell.id) ?? 0) !== cell.target) {
      errors.push(
        `${cell.id}: expected ${cell.target} selected cases; found ${counts.get(cell.id) ?? 0}`,
      )
    }
  }

  return {
    valid: errors.length === 0,
    id: benchmark?.id ?? null,
    promptVersion: benchmark?.promptVersion ?? null,
    caseCount: asArray(benchmark?.cases).length,
    distinctAuthors: seenAuthors.size,
    cells: asArray(benchmark?.cells).map((cell) => ({
      ...cell,
      selected: counts.get(cell.id) ?? 0,
    })),
    errors,
  }
}

const resultClassification = (result) =>
  ['series', 'standalone'].includes(result?.output?.classification)
    ? result.output.classification
    : 'unresolved'

const policyResolved = (result) =>
  result?.status === 'completed' &&
  result?.validation?.valid === true &&
  result?.validation?.policySafe === true &&
  resultClassification(result) !== 'unresolved'

export function scoreAuthorityDiscovery(caseSet, benchmark, run, options = {}) {
  const audit = auditAuthorityDiscoveryHoldout(caseSet, benchmark, options)
  const errors = [...audit.errors]
  const casesById = new Map(asArray(caseSet?.cases).map((testCase) => [testCase.id, testCase]))
  const resultsById = new Map(asArray(run?.results).map((result) => [result.caseId, result]))
  const cellsById = new Map(asArray(benchmark?.cells).map((cell) => [cell.id, cell]))
  const selectedIds = asArray(benchmark?.cases).map((selected) => selected.id)
  const targetIds = asArray(run?.targets).map((target) => target.caseId)
  const resultIds = asArray(run?.results).map((result) => result.caseId)

  if (run?.promptVersion !== benchmark?.promptVersion) {
    errors.push(
      `run promptVersion ${run?.promptVersion ?? '<missing>'} does not match ${benchmark?.promptVersion}`,
    )
  }
  if (run?.holdoutId && run.holdoutId !== benchmark?.id) {
    errors.push(`run holdoutId ${run.holdoutId} does not match ${benchmark.id}`)
  }
  if (new Set(targetIds).size !== targetIds.length) errors.push('run contains duplicate targets')
  if (new Set(resultIds).size !== resultIds.length) errors.push('run contains duplicate results')
  if (
    targetIds.length !== selectedIds.length ||
    targetIds.some((id, index) => id !== selectedIds[index])
  ) {
    errors.push('run targets do not exactly match the frozen benchmark order')
  }
  if (
    resultIds.length !== selectedIds.length ||
    resultIds.some((id, index) => id !== selectedIds[index])
  ) {
    errors.push('run results do not exactly match the frozen benchmark order')
  }

  const details = asArray(benchmark?.cases).map((selected) => {
    const testCase = casesById.get(selected.id)
    const result = resultsById.get(selected.id)
    const cell = cellsById.get(selected.cell)
    const expected = expectedAuthoritySources(testCase, caseSet.sharedSources, benchmark)
    const expectedOrigins = new Set(expected.map((source) => source.origin))
    const channelOrigins = new Set(
      expected.filter((source) => source.channel === cell?.channel).map((source) => source.origin),
    )
    const expectedUrls = new Set(expected.map((source) => source.normalizedUrl))
    const consultedUrls = asArray(result?.consultedUrls)
    const consultedOrigins = new Set(consultedUrls.map(normalizeAuthorityOrigin).filter(Boolean))
    const normalizedConsultedUrls = new Set(
      consultedUrls.map(normalizeAuthorityUrl).filter(Boolean),
    )
    const citedUrls = asArray(result?.output?.authoritySources).map((source) => source?.url)
    const citedOrigins = new Set(citedUrls.map(normalizeAuthorityOrigin).filter(Boolean))
    const discoveredOrigins = [...expectedOrigins].filter((origin) => consultedOrigins.has(origin))
    const discoveredChannelOrigins = [...channelOrigins].filter((origin) =>
      consultedOrigins.has(origin),
    )
    const exactPages = [...expectedUrls].filter((url) => normalizedConsultedUrls.has(url))
    const citedExpectedOrigins = [...expectedOrigins].filter((origin) => citedOrigins.has(origin))

    return {
      caseId: selected.id,
      title: testCase?.title ?? null,
      author: asArray(testCase?.authors).join(', '),
      cell: selected.cell,
      classification: cell?.classification ?? null,
      channel: cell?.channel ?? null,
      completed: result?.status === 'completed',
      expectedOrigins: [...expectedOrigins],
      expectedChannelOrigins: [...channelOrigins],
      discoveredOrigins,
      discoveredChannelOrigins,
      exactPages,
      citedExpectedOrigins,
      originDiscovered: discoveredOrigins.length > 0,
      channelOriginDiscovered: discoveredChannelOrigins.length > 0,
      exactPageDiscovered: exactPages.length > 0,
      expectedOriginCited: citedExpectedOrigins.length > 0,
      policySafe: result?.validation?.policySafe === true,
      resolved: policyResolved(result),
      proposedClassification: resultClassification(result),
      retrievalStatus: result?.retrieval?.status ?? 'not_enabled',
      retrievalReason: result?.retrieval?.reason ?? null,
    }
  })

  const summarize = (rows) => {
    const count = rows.length
    const total = (field) => rows.filter((row) => row[field]).length
    return {
      cases: count,
      completed: total('completed'),
      originDiscovered: total('originDiscovered'),
      originDiscoveryRate: rate(total('originDiscovered'), count),
      channelOriginDiscovered: total('channelOriginDiscovered'),
      channelOriginDiscoveryRate: rate(total('channelOriginDiscovered'), count),
      exactPageDiscovered: total('exactPageDiscovered'),
      exactPageDiscoveryRate: rate(total('exactPageDiscovered'), count),
      expectedOriginCited: total('expectedOriginCited'),
      expectedOriginCitationRate: rate(total('expectedOriginCited'), count),
      resolved: total('resolved'),
      resolutionRate: rate(total('resolved'), count),
    }
  }

  return {
    schemaVersion: 1,
    valid: errors.length === 0,
    benchmarkId: benchmark?.id ?? null,
    promptVersion: run?.promptVersion ?? null,
    model: run?.model ?? null,
    retrievalEnabled: run?.retrievalEnabled === true,
    summary: summarize(details),
    cells: asArray(benchmark?.cells).map((cell) => ({
      id: cell.id,
      classification: cell.classification,
      channel: cell.channel,
      ...summarize(details.filter((detail) => detail.cell === cell.id)),
    })),
    acquisitionScore: run?.score ?? null,
    details,
    errors,
  }
}

const percent = (value) => (value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`)

export function renderAuthorityDiscoveryMarkdown(score) {
  const operations = score.acquisitionScore?.operations ?? {}
  const lines = [
    '# Reverie first-party discovery recall holdout',
    '',
    `Benchmark: ${score.benchmarkId}.`,
    `Model: ${score.model ?? 'unknown'}; prompt: ${score.promptVersion ?? 'unknown'}.`,
    `Status: ${score.valid ? 'valid frozen run' : 'invalid run'}.`,
    '',
    '| Cases | Completed | Any known origin | Targeted channel | Exact known page | Known origin cited | Resolved |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${score.summary.cases} | ${score.summary.completed} | ${percent(score.summary.originDiscoveryRate)} | ${percent(score.summary.channelOriginDiscoveryRate)} | ${percent(score.summary.exactPageDiscoveryRate)} | ${percent(score.summary.expectedOriginCitationRate)} | ${percent(score.summary.resolutionRate)} |`,
    '',
    '## Discovery cells',
    '',
    '| Cell | Cases | Any known origin | Targeted channel | Exact known page | Known origin cited | Resolved |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...score.cells.map(
      (cell) =>
        `| ${cell.id} | ${cell.cases} | ${percent(cell.originDiscoveryRate)} | ${percent(cell.channelOriginDiscoveryRate)} | ${percent(cell.exactPageDiscoveryRate)} | ${percent(cell.expectedOriginCitationRate)} | ${percent(cell.resolutionRate)} |`,
    ),
    '',
    '## Per-case evidence reach',
    '',
    '| Work | Cell | Expected origin found | Targeted origin found | Exact page found | Proposal | Retrieval |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...score.details.map(
      (detail) =>
        `| ${detail.title} — ${detail.author} | ${detail.cell} | ${detail.discoveredOrigins.join(', ') || 'no'} | ${detail.discoveredChannelOrigins.join(', ') || 'no'} | ${detail.exactPageDiscovered ? 'yes' : 'no'} | ${detail.resolved ? detail.proposedClassification : 'unresolved'} | ${detail.retrievalReason ?? detail.retrievalStatus} |`,
    ),
    '',
    `Operations: ${operations.modelCalls ?? 0} model calls; ${operations.webSearchCalls ?? 0} hosted searches; ${operations.inputTokens ?? 0}/${operations.outputTokens ?? 0} input/output tokens; ${operations.errors ?? 0} errors.`,
    '',
    'The scout received only title, author, and optional publication year. Known origins, exact authority URLs, gold classifications, source channels, and prior outputs were used only after the run for scoring.',
    'Origin discovery measures whether hosted search consulted a known direct author or publisher hostname. It is intentionally separate from exact-page discovery, source citation, retrieval, and classification accuracy.',
  ]

  if (score.errors.length) {
    lines.push('', '## Validation errors', '', ...score.errors.map((error) => `- ${error}`))
  }

  return `${lines.join('\n').trimEnd()}\n`
}
