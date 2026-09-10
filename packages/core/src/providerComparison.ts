import { normalizeIsbn } from './match'

/** Draft display boundary, not an identity matcher or permission to acquire/store provider data.
 * Only a future authenticated, independently reviewed adapter may attest the checks below.
 * Structural validation cannot prove that a source is truthful or that a hash is authentic.
 */
export interface ProviderComparisonContext {
  workId: string
  isbn: string
  fingerprint: string
  revision: number
}

type Provider = 'google' | 'openlibrary'
type Binding = 'paperback' | 'hardcover' | 'ebook' | 'audiobook' | null
type Checks = {
  isbn: true
  title: true
  fullAuthors: true
  uniqueEdition: true
  language: 'matched' | 'unknown'
}
const REASONS = {
  title_mismatch: 'Title differs. This result cannot explain the cause.',
  author_mismatch: 'Full author identity differs.',
  isbn_mismatch: 'ISBN does not match the selected edition.',
  language_mismatch: 'Language differs.',
  ambiguous_records: 'More than one edition candidate needs review.',
  malformed_record: 'Source evidence could not be validated.',
  incomplete_authors: 'Full author identity could not be checked.',
  unavailable: 'Source unavailable. No conclusion can be drawn.',
  no_exact_edition: 'No exact edition was returned.',
} as const
type Reason = keyof typeof REASONS
type Admitted = {
  provider: Provider
  endpoint: 'volume_detail' | 'isbn_edition'
  status: 'matched'
  sourceId: string
  targetIsbn: string
  observedAt: string
  checks: Checks
  pages: number | null
  binding: Binding
}
type Withheld = {
  provider: Provider
  endpoint: 'volume_detail' | 'isbn_edition'
  status: 'identity_review' | 'unavailable' | 'not_found'
  reason: Reason
  observedAt: string
}
type ProviderResult = Admitted | Withheld
type Joint =
  | 'identity_review'
  | 'incomplete'
  | 'no_observations'
  | 'one_source'
  | 'agreement'
  | 'pages_differ'
  | 'format_review'
  | 'audio'
  | 'missing_pages'

export interface ProviderComparisonDTO extends ProviderComparisonContext {
  version: 1
  snapshotHash: string
  acquiredAt: string
  expiresAt: string
  joint: Joint
  results: ProviderResult[]
}

export const PROVIDER_COMPARISON_MESSAGES: Record<Joint, string> = {
  identity_review: 'Identity review needed. No changes made.',
  incomplete: 'Comparison incomplete. No changes made.',
  no_observations: 'No admitted observations. No changes made.',
  one_source: 'One source only. No changes made.',
  agreement: 'Sources agree; independence and edition format may still be unconfirmed.',
  pages_differ: 'Page counts differ. No source has been preferred.',
  format_review: 'Edition format needs review. Page counts are not comparable.',
  audio: 'Pages do not apply to this audio edition.',
  missing_pages: 'Page counts are unknown. No changes made.',
}

export interface ProviderComparisonView {
  isbn: string
  expiresAt: string
  joint: Joint
  cards: Array<{
    provider: Provider
    name: string
    status: string
    observedAt: string
    sourceUrl: string | null
    pages: number | null
    pageState: 'observed' | 'unknown' | 'not_comparable' | 'not_applicable' | 'withheld'
    binding: Binding
    language: 'matched' | 'unknown' | null
  }>
}

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v))
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).length === expected.length && expected.every((k) => Object.hasOwn(v, k))
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const time = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v
const pages = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 20000)

export function validProviderComparisonContext(v: ProviderComparisonContext): boolean {
  return (
    typeof v.workId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.workId) &&
    typeof v.isbn === 'string' &&
    /^97[89]\d{10}$/.test(v.isbn) &&
    normalizeIsbn(v.isbn) === v.isbn &&
    sha(v.fingerprint) &&
    Number.isSafeInteger(v.revision) &&
    v.revision >= 0
  )
}

function readResult(
  v: unknown,
  provider: Provider,
  dto: Record<string, unknown>,
): ProviderResult | null {
  if (
    !object(v) ||
    v.provider !== provider ||
    v.endpoint !== (provider === 'google' ? 'volume_detail' : 'isbn_edition') ||
    !time(v.observedAt) ||
    Date.parse(v.observedAt) > Date.parse(dto.acquiredAt as string) ||
    Date.parse(dto.acquiredAt as string) - Date.parse(v.observedAt) > 30000
  )
    return null
  if (v.status !== 'matched') {
    if (!keys(v, ['provider', 'endpoint', 'status', 'reason', 'observedAt'])) return null
    const allowed =
      v.status === 'identity_review'
        ? [
            'title_mismatch',
            'author_mismatch',
            'isbn_mismatch',
            'language_mismatch',
            'ambiguous_records',
            'malformed_record',
          ]
        : v.status === 'unavailable'
          ? ['incomplete_authors', 'unavailable']
          : v.status === 'not_found'
            ? ['no_exact_edition']
            : []
    if (typeof v.reason !== 'string' || !allowed.includes(v.reason)) return null
    return {
      provider,
      endpoint: provider === 'google' ? 'volume_detail' : 'isbn_edition',
      status: v.status as Withheld['status'],
      reason: v.reason as Reason,
      observedAt: v.observedAt,
    }
  }
  if (
    !keys(v, [
      'provider',
      'endpoint',
      'status',
      'sourceId',
      'targetIsbn',
      'observedAt',
      'checks',
      'pages',
      'binding',
    ]) ||
    v.targetIsbn !== dto.isbn ||
    typeof v.sourceId !== 'string' ||
    (provider === 'google'
      ? !/^[A-Za-z0-9_-]{1,100}$/.test(v.sourceId)
      : v.sourceId !== dto.isbn) ||
    !pages(v.pages) ||
    ![null, 'paperback', 'hardcover', 'ebook', 'audiobook'].includes(v.binding as Binding) ||
    !object(v.checks) ||
    !keys(v.checks, ['isbn', 'title', 'fullAuthors', 'uniqueEdition', 'language']) ||
    v.checks.isbn !== true ||
    v.checks.title !== true ||
    v.checks.fullAuthors !== true ||
    v.checks.uniqueEdition !== true ||
    !['matched', 'unknown'].includes(v.checks.language as string)
  )
    return null
  return {
    provider,
    endpoint: provider === 'google' ? 'volume_detail' : 'isbn_edition',
    status: 'matched',
    sourceId: v.sourceId,
    targetIsbn: v.targetIsbn as string,
    observedAt: v.observedAt,
    checks: {
      isbn: true,
      title: true,
      fullAuthors: true,
      uniqueEdition: true,
      language: v.checks.language as Checks['language'],
    },
    pages: v.pages,
    binding: v.binding as Binding,
  }
}

function jointFor(results: ProviderResult[]): Joint {
  if (results.some((r) => r.status === 'identity_review')) return 'identity_review'
  if (results.some((r) => r.status === 'unavailable')) return 'incomplete'
  const admitted = results.filter((r): r is Admitted => r.status === 'matched')
  if (!admitted.length) return 'no_observations'
  const formats = new Set(admitted.map((r) => r.binding).filter(Boolean))
  if (formats.size > 1) return 'format_review'
  if (formats.has('audiobook')) return 'audio'
  const values = admitted.filter((r) => r.pages !== null)
  if (!values.length) return 'missing_pages'
  if (values.length === 1) return 'one_source'
  return values[0]!.pages === values[1]!.pages ? 'agreement' : 'pages_differ'
}

/** Parse only the new DTO, never raw trial packets. Failures return finite states, not exceptions
 * carrying source values. A malformed known source loses its fields without hiding its valid peer.
 */
export function projectProviderComparison(
  input: unknown,
  context: ProviderComparisonContext,
  now: number,
): ProviderComparisonView | null {
  try {
    if (
      !validProviderComparisonContext(context) ||
      !Number.isFinite(now) ||
      !object(input) ||
      !keys(input, [
        'version',
        'workId',
        'isbn',
        'fingerprint',
        'revision',
        'snapshotHash',
        'acquiredAt',
        'expiresAt',
        'joint',
        'results',
      ]) ||
      input.version !== 1 ||
      !sha(input.snapshotHash) ||
      input.workId !== context.workId ||
      input.isbn !== context.isbn ||
      input.fingerprint !== context.fingerprint ||
      input.revision !== context.revision ||
      !time(input.acquiredAt) ||
      !time(input.expiresAt) ||
      Date.parse(input.acquiredAt) > now ||
      Date.parse(input.expiresAt) <= now ||
      Date.parse(input.expiresAt) - Date.parse(input.acquiredAt) > 300000 ||
      !Array.isArray(input.results) ||
      input.results.length !== 2 ||
      typeof input.joint !== 'string' ||
      !Object.hasOwn(PROVIDER_COMPARISON_MESSAGES, input.joint)
    )
      return null
    const providers = ['google', 'openlibrary'] as const
    // Fixed order and exact provider count defeat duplicate/unknown-source corroboration.
    if (input.results.some((r, i) => !object(r) || r.provider !== providers[i])) return null
    let malformed = false
    const results = providers.map((provider, i): ProviderResult => {
      const result = readResult((input.results as unknown[])[i], provider, input)
      if (result) return result
      malformed = true
      return {
        provider,
        endpoint: provider === 'google' ? 'volume_detail' : 'isbn_edition',
        status: 'identity_review',
        reason: 'malformed_record',
        observedAt: input.acquiredAt as string,
      }
    })
    const joint = jointFor(results)
    // Never silently upgrade a server-withheld decision. Disagreement is an invalid envelope.
    if (!malformed && input.joint !== joint) return null
    const admitted = results.filter((r): r is Admitted => r.status === 'matched')
    const bindings = new Set(admitted.map((r) => r.binding).filter(Boolean))
    const notComparable = bindings.size > 1 || bindings.has('audiobook')
    return {
      isbn: context.isbn,
      expiresAt: input.expiresAt,
      joint,
      cards: results.map((r) => ({
        provider: r.provider,
        name: r.provider === 'google' ? 'Google Books' : 'Open Library',
        status:
          r.status === 'matched'
            ? 'Exact identity checks passed; not certified truth.'
            : REASONS[r.reason],
        observedAt: r.observedAt,
        sourceUrl:
          r.status !== 'matched'
            ? null
            : r.provider === 'google'
              ? `https://books.google.com/books?id=${r.sourceId}`
              : `https://openlibrary.org/isbn/${r.sourceId}`,
        pages: r.status === 'matched' && !notComparable ? r.pages : null,
        pageState:
          r.status !== 'matched'
            ? 'withheld'
            : r.binding === 'audiobook'
              ? 'not_applicable'
              : notComparable
                ? 'not_comparable'
                : r.pages === null
                  ? 'unknown'
                  : 'observed',
        binding: r.status === 'matched' ? r.binding : null,
        language: r.status === 'matched' ? r.checks.language : null,
      })),
    }
  } catch {
    return null
  }
}
