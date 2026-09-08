import { normalize, slug } from '../normalize.mjs'
import { sha256Json } from './qualification.mjs'

export const PRH_API_ORIGIN = 'https://api.penguinrandomhouse.com'
export const PRH_API_ROOT = `${PRH_API_ORIGIN}/title/client/Public`
export const PRH_PUBLIC_ORIGIN = 'https://www.penguinrandomhouse.com'

const asArray = (value) => (Array.isArray(value) ? value : [])
const clean = (value) => String(value ?? '').trim()

const yyyyMmDd = /^\d{4}-\d{2}-\d{2}$/

export function assertPrhDate(value, label) {
  if (!yyyyMmDd.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} must use YYYY-MM-DD`)
  }
  return value
}

const apiDate = (value) => {
  const [year, month, day] = value.split('-')
  return `${month}/${day}/${year}`
}

export function prhUrl(path, parameters = {}) {
  const url = new URL(`${PRH_API_ROOT}${path}`)
  for (const [name, value] of Object.entries(parameters)) {
    for (const item of asArray(value).length ? value : [value]) {
      if (item !== null && item !== undefined && item !== '') {
        url.searchParams.append(name, String(item))
      }
    }
  }
  return url
}

export function prhRequestUrl(url, apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('PRH_API_KEY is required')
  const request = new URL(url)
  request.searchParams.set('api_key', apiKey)
  return request
}

export function sanitizePrhUrl(value) {
  const url = new URL(value)
  url.searchParams.delete('api_key')
  return url.toString()
}

export function buildPrhFrameSpec({ frameId, from, to, domain = 'PRH.US', rows = 100 }) {
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(frameId ?? '')) {
    throw new Error('frameId must be a 3-81 character lowercase slug')
  }
  assertPrhDate(from, 'from')
  assertPrhDate(to, 'to')
  if (from > to) throw new Error('from must not be later than to')
  if (!/^[A-Z0-9.]+$/.test(domain)) throw new Error('domain is invalid')
  if (!Number.isInteger(rows) || rows < 1 || rows > 250) {
    throw new Error('rows must be an integer from 1 through 250')
  }
  const parameters = {
    language: 'E',
    workOnSaleFrom: apiDate(from),
    workOnSaleTo: apiDate(to),
    sort: 'id',
    dir: 'asc',
    suppressLinks: true,
    returnEmptyLists: true,
  }
  const url = prhUrl(`/domains/${domain}/works`, { ...parameters, rows: 0 })
  return {
    schemaVersion: 1,
    provider: 'penguin_random_house',
    frameId,
    domain,
    from,
    to,
    rows,
    parameters,
    url: sanitizePrhUrl(url),
  }
}

export function prhCollection(payload, name) {
  const collection = payload?.data?.[name] ?? payload?.[name]
  if (!Array.isArray(collection)) {
    throw new Error(`PRH response does not contain data.${name}`)
  }
  return collection
}

export function prhRecordCount(payload) {
  const count = Number(payload?.recordCount)
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('PRH response does not contain a non-negative recordCount')
  }
  return count
}

const primaryAuthor = (author) => {
  const code = clean(author?.contribRoleCode).toUpperCase()
  const description = clean(author?.contribRoleDesc ?? author?.roleVerb ?? author?.roleNoun)
  return code === 'A' || /(^|\b)(author|written by)(\b|$)/i.test(description)
}

export function prhAuthorNames(authors, fallback) {
  const candidates = asArray(authors)
    .map((author) => ({
      name: clean(author?.display ?? author?.name),
      primary: primaryAuthor(author),
    }))
    .filter(({ name }) => name)
  const preferred = candidates.some(({ primary }) => primary)
    ? candidates.filter(({ primary }) => primary)
    : candidates
  const names = [...new Set(preferred.map(({ name }) => name))]
  return names.length ? names : [clean(fallback)].filter(Boolean)
}

const categoryText = (category) =>
  [category?.description, category?.name, category?.label, category?.catUri, category?.uri]
    .map(clean)
    .filter(Boolean)
    .join(' | ')
    .toLocaleLowerCase('en-US')

export function prhQualificationStrata(categories) {
  const text = asArray(categories).map(categoryText).join(' | ')
  const strata = new Set()
  if (/romance/.test(text)) strata.add('tryst')
  if (/fantasy|fairy tales|folklore|mythology/.test(text)) strata.add('grimoire')
  if (/science fiction|space opera|dystopi|cyberpunk/.test(text)) strata.add('aphelion')
  if (/horror|ghost|occult|supernatural/.test(text)) strata.add('marrow')
  if (/mystery|thriller|suspense|crime|detective/.test(text)) strata.add('umbra')
  if (/cozy/.test(text)) strata.add('hearth')
  if (/juvenile|young adult|children|middle grade/.test(text)) strata.add('bloom')
  if (/fiction.*(literary|general)|literary fiction|fiction \/ general/.test(text)) {
    strata.add('folio')
  }
  if (
    /biography|autobiography|business|economics|history|political science|social science|science|technology|self-help|health|travel|cooking|religion|philosophy|psychology|education|law|nature|sports|true crime|nonfiction/.test(
      text,
    )
  ) {
    strata.add('almanac')
  }
  return [...strata].sort()
}

const genericSeriesName = /^(a |the )?(series|trilogy|duology|saga|collection|books?)$/i
const merchandisingSeriesName =
  /\b(classics|collector'?s editions?|gift editions?|boxed sets?|library|readers?|essentials|coloring books?|activity books?)\b/i

export function prhMembershipProposal(series, positionBySeriesCode = {}) {
  const memberships = []
  const flags = new Set()
  for (const relation of asArray(series)) {
    const code = clean(relation?.seriesCode)
    const name = clean(relation?.seriesName ?? relation?.name)
    if (!code || !name) {
      flags.add('incomplete_series_relation')
      continue
    }
    if (genericSeriesName.test(name)) flags.add('generic_series_name')
    if (merchandisingSeriesName.test(name)) flags.add('possible_marketing_collection')
    if (relation?.isNumbered === false) flags.add('unnumbered_series')
    const rawPosition = Number(positionBySeriesCode[code])
    if (Number.isFinite(rawPosition) && !Number.isInteger(rawPosition)) {
      flags.add('fractional_position')
    }
    memberships.push({
      series: name,
      aliases: [],
      role: 'unknown',
      positions:
        Number.isFinite(rawPosition) && rawPosition > 0
          ? [{ value: rawPosition, orderType: 'publication' }]
          : [],
      providerSeriesCode: code,
    })
  }
  memberships.sort((left, right) => left.series.localeCompare(right.series))
  if (memberships.length > 1) flags.add('multi_series')
  return { memberships, reviewFlags: [...flags].sort() }
}

const publicBookUrl = (work) => {
  const path = clean(work?.seoFriendlyUrl)
  if (!path.startsWith('/')) return null
  return new URL(path, PRH_PUBLIC_ORIGIN).toString()
}

const publicationYear = (work) => {
  const match = clean(work?.onsale ?? work?.earliestOnSaleDate).match(/^(\d{4})-/)
  return match ? Number(match[1]) : null
}

const sanitizeEvidenceDigests = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeEvidenceDigests)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      key === 'url' && typeof nested === 'string'
        ? sanitizePrhUrl(nested)
        : sanitizeEvidenceDigests(nested),
    ]),
  )
}

export function buildPrhQualificationCandidate({
  work,
  authors,
  categories,
  series,
  positionBySeriesCode,
  frame,
  evidenceDigests = {},
}) {
  const workId = Number(work?.workId)
  const title = clean(work?.title)
  const authorNames = prhAuthorNames(authors, work?.author)
  const year = publicationYear(work)
  if (!Number.isInteger(workId) || !title || !authorNames.length || !Number.isInteger(year)) {
    return {
      eligible: false,
      reason: 'missing work id, title, author, or publication year',
    }
  }

  const proposed = prhMembershipProposal(series, positionBySeriesCode)
  const reviewFlags = new Set(proposed.reviewFlags)
  if (proposed.memberships.some(({ series: name }) => normalize(name) === normalize(title))) {
    reviewFlags.add('self_titled_series')
  }
  const relationUrl = sanitizePrhUrl(
    prhUrl(`/domains/${frame.domain}/works/${workId}/series`, { returnEmptyLists: true }),
  )
  const pageUrl = publicBookUrl(work)
  const qualificationStrata = prhQualificationStrata(categories)
  const riskFeatures = proposed.memberships.length > 1 ? ['multi_series'] : []
  const truthSources = proposed.memberships.length
    ? [relationUrl, ...Object.values(evidenceDigests?.seriesPositions ?? {}).map(({ url }) => url)]
        .filter(Boolean)
        .filter((url, index, urls) => urls.indexOf(url) === index)
        .map((url) => ({ kind: 'publisher', url: sanitizePrhUrl(url) }))
    : []

  return {
    eligible: true,
    case: {
      id: `qualification-prh-${workId}-${slug(title)}`,
      title,
      authors: authorNames,
      evaluationPartition: 'qualification',
      publicationYear: year,
      publicationPath: 'traditional',
      selectionFrameIds: [frame.frameId],
      selectionSources: [
        {
          frameId: frame.frameId,
          kind: 'publisher_catalog',
          url: frame.url,
        },
      ],
      qualificationStrata,
      riskFeatures,
      truth: {
        status: 'candidate',
        standalone: proposed.memberships.length ? false : null,
        memberships: proposed.memberships.map(({ series: name, aliases, role, positions }) => ({
          series: name,
          aliases,
          role,
          positions,
        })),
        sources: truthSources,
        ...(riskFeatures.length ? { membershipsComplete: false } : {}),
        reviewNote: proposed.memberships.length
          ? 'Pending human review of first-party structured series relationships.'
          : 'No PRH series relation was returned. This is unresolved, not standalone evidence; add an affirmative author or publisher source before review approval.',
      },
      reviewMetadata: {
        provider: 'penguin_random_house',
        providerWorkId: workId,
        publisherPageUrl: pageUrl,
        relationshipUrl: relationUrl,
        reviewFlags: [...reviewFlags].sort(),
        evidenceDigests: sanitizeEvidenceDigests(evidenceDigests),
        contentRetention: 'structured_metadata_only_no_descriptions',
      },
    },
  }
}

export function buildPrhCapture({
  frameSpec,
  capturedAt,
  populationCases,
  candidates,
  exclusions,
}) {
  const normalizedExclusions = asArray(exclusions).filter(({ count }) => count > 0)
  const excluded = normalizedExclusions.reduce((total, item) => total + item.count, 0)
  if (populationCases !== candidates.length + excluded) {
    throw new Error('PRH capture population does not reconcile with candidates and exclusions')
  }
  const selectionFrame = {
    id: frameSpec.frameId,
    kind: 'publisher_catalog',
    url: frameSpec.url,
    capturedAt,
    complete: true,
    populationCases,
    eligibleReviewedCases: candidates.length,
    exclusions: normalizedExclusions,
  }
  return {
    schemaVersion: 1,
    selectionFrames: [selectionFrame],
    cases: candidates,
    captureManifest: {
      schemaVersion: 1,
      provider: frameSpec.provider,
      frameSpec,
      populationCases,
      candidateCases: candidates.length,
      exclusions: normalizedExclusions,
      identitySha256: sha256Json(
        candidates.map(({ id, title, authors, publicationYear }) => ({
          id,
          title,
          authors,
          publicationYear,
        })),
      ),
      reviewBoundary:
        'Series relationships are proposals until human review. An empty relationship is unresolved and cannot establish standalone truth.',
      contentRetention: 'structured_metadata_only_no_descriptions',
    },
  }
}
