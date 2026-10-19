/** Documentary findings, not a license grant or an intake promotion decision. */
export type IntakeSourceUseStatus = 'documented' | 'conditional' | 'unverified'
export type IntakeSourceUseOperation =
  | 'lookup'
  | 'transientReview'
  | 'cache'
  | 'durableFacts'
  | 'export'
  | 'modelInput'

export interface IntakeSourceUseFinding {
  readonly status: IntakeSourceUseStatus
  readonly scope: string
  readonly primaryUrls: readonly string[]
}

export interface IntakeSourceQualification {
  readonly schemaVersion: 1
  readonly policyVersion: 'intake-source-use-2026-10-18-v1'
  readonly provider: 'openlibrary' | 'hardcover' | 'penguin_random_house' | null
  readonly usage: 'review_only'
  readonly reviewedAt: string | null
  /** A local review freshness bound, not a provider's contractual expiration. */
  readonly reviewValidUntil: string | null
  readonly reviewReference: string
  readonly reviewState: 'current' | 'stale' | 'predates_review' | 'invalid_as_of' | 'unknown_source'
  readonly upstreamLineage: 'unverified'
  readonly operations: Readonly<Record<IntakeSourceUseOperation, IntakeSourceUseFinding>>
  readonly promotionBlockers: readonly string[]
}

const REVIEWED_AT = '2026-10-18T00:00:00.000Z'
const REVIEW_VALID_UNTIL = '2026-11-17T00:00:00.000Z'
const REVIEW_REFERENCE = 'docs/tasks/intake-source-qualification-2026-10-18.md'
const operationNames: readonly IntakeSourceUseOperation[] = [
  'lookup',
  'transientReview',
  'cache',
  'durableFacts',
  'export',
  'modelInput',
]
const olApi = 'https://openlibrary.org/developers/api'
const olLicense = 'https://openlibrary.org/developers/licensing'
const prhApi = 'https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api'
const hcApi = 'https://api.hardcover.app/'

function finding(
  status: IntakeSourceUseStatus,
  scope: string,
  ...primaryUrls: string[]
): IntakeSourceUseFinding {
  return { status, scope, primaryUrls }
}

const manifest: Readonly<
  Record<
    NonNullable<IntakeSourceQualification['provider']>,
    IntakeSourceQualification['operations']
  >
> = {
  openlibrary: {
    lookup: finding(
      'conditional',
      'Public guidance supports bounded human-facing lookup within use and rate limits; not bulk acquisition or a high-traffic commercial backend. Application qualification remains separate.',
      olApi,
    ),
    transientReview: finding(
      'conditional',
      'Human-facing lookup is documented; contributed content may retain pre-existing rights. No blanket display grant for prose or images.',
      olApi,
      olLicense,
    ),
    cache: finding(
      'documented',
      'API guidance requests response caching. This does not clear contributed-content rights or grant durable catalog storage, export, or model input.',
      olApi,
      olLicense,
    ),
    durableFacts: finding(
      'unverified',
      'No new database rights are asserted, but existing contribution rights may remain; field-specific durable corpus use is not qualified.',
      olLicense,
    ),
    export: finding(
      'unverified',
      'Redistribution of mixed provider content is not qualified by the database-rights statement.',
      olLicense,
    ),
    modelInput: finding(
      'unverified',
      'No applicable grant for third-party model input was established; AI tool examples are not a content license.',
      olApi,
      olLicense,
    ),
  },
  penguin_random_house: {
    lookup: finding(
      'conditional',
      'A keyed metadata API is documented. Existing bounded account/trial access is not production approval; applicable API use terms remain unverified.',
      prhApi,
    ),
    transientReview: finding(
      'unverified',
      'API-specific display rights were not established. Retail website terms cannot be assumed to license the separate API.',
      prhApi,
      'https://www.penguinrandomhouse.com/terms/',
    ),
    cache: finding(
      'unverified',
      'API response-cache rights were not established; a retail page-caching exception is not catalog retention permission.',
      prhApi,
      'https://www.penguinrandomhouse.com/terms/',
    ),
    durableFacts: finding(
      'unverified',
      'Publisher-controlled metadata access does not establish durable storage rights. Prose and covers remain outside this adapter.',
      prhApi,
    ),
    export: finding(
      'unverified',
      'No applicable API metadata redistribution grant was established.',
      prhApi,
    ),
    modelInput: finding(
      'unverified',
      'No applicable API grant for third-party model input was established; silence is not permission.',
      prhApi,
    ),
  },
  hardcover: {
    lookup: finding(
      'conditional',
      'The official entry documents authenticated GraphQL access. Existing bounded account/trial access is not production approval; applicable application terms remain unverified.',
      hcApi,
    ),
    transientReview: finding(
      'unverified',
      'Public terms/documentation were unavailable to this review tool; authenticated access is not a display license.',
      hcApi,
    ),
    cache: finding(
      'unverified',
      'No applicable response-caching permission was established.',
      hcApi,
    ),
    durableFacts: finding(
      'unverified',
      'No applicable durable metadata or contributor-credit retention grant was established.',
      hcApi,
    ),
    export: finding(
      'unverified',
      'No applicable metadata redistribution grant was established.',
      hcApi,
    ),
    modelInput: finding(
      'unverified',
      'No applicable third-party model-input grant was established.',
      hcApi,
    ),
  },
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

function asOfTime(asOf: string): number | null {
  // Accept a real ISO calendar date or UTC timestamp, never Date.parse's rollover/coercion.
  if (
    typeof asOf !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(asOf)
  ) {
    return null
  }
  const time = Date.parse(asOf)
  if (!Number.isFinite(time)) return null
  const canonical = new Date(time).toISOString()
  const expected =
    asOf.length === 10 ? `${asOf}T00:00:00.000Z` : asOf.replace(/(?<=:\d{2})Z$/, '.000Z')
  return canonical === expected ? time : null
}

/**
 * Code-owned read-only findings. Neither the caller nor a provider packet can override them.
 * A current review still cannot promote a source. Stale records retain dated findings plus a hold.
 */
export function getIntakeSourceQualification(
  provider: string,
  asOf: string,
): IntakeSourceQualification {
  const knownProvider =
    provider === 'openlibrary' || provider === 'hardcover' || provider === 'penguin_random_house'
      ? provider
      : null
  const time = asOfTime(asOf)
  const reviewState: IntakeSourceQualification['reviewState'] = !knownProvider
    ? 'unknown_source'
    : time === null
      ? 'invalid_as_of'
      : time < Date.parse(REVIEWED_AT)
        ? 'predates_review'
        : time >= Date.parse(REVIEW_VALID_UNTIL)
          ? 'stale'
          : 'current'
  const copyFinding = (operation: IntakeSourceUseOperation): IntakeSourceUseFinding => {
    const source = knownProvider
      ? manifest[knownProvider][operation]
      : finding('unverified', 'No code-owned source-use review exists for this provider.')
    return { ...source, primaryUrls: [...source.primaryUrls] }
  }
  const operations = {
    lookup: copyFinding('lookup'),
    transientReview: copyFinding('transientReview'),
    cache: copyFinding('cache'),
    durableFacts: copyFinding('durableFacts'),
    export: copyFinding('export'),
    modelInput: copyFinding('modelInput'),
  }
  const promotionBlockers = ['source_review_only', 'upstream_lineage_unverified']
  if (reviewState !== 'current') promotionBlockers.push(`source_review_${reviewState}`)
  for (const operation of operationNames) {
    const status = operations[operation].status
    if (status !== 'documented') promotionBlockers.push(`source_use_${operation}_${status}`)
  }
  return freeze({
    schemaVersion: 1,
    policyVersion: 'intake-source-use-2026-10-18-v1',
    provider: knownProvider,
    usage: 'review_only',
    reviewedAt: knownProvider ? REVIEWED_AT : null,
    reviewValidUntil: knownProvider ? REVIEW_VALID_UNTIL : null,
    reviewReference: REVIEW_REFERENCE,
    reviewState,
    upstreamLineage: 'unverified',
    operations,
    promotionBlockers,
  })
}
