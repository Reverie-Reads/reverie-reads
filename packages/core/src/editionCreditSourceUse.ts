/** Administrator-inspected permission reference, frozen with one manual edition review.
 * It covers retaining edition identity and literal credit facts only. It is not an API-source
 * qualification, a legal determination, or permission for prose/images/export/model input. */
export interface EditionCreditSourceUseReview {
  version: 1
  basis: 'public_terms' | 'written_permission'
  url: string
  note: string
  checkedAt: string
  scope: 'edition_identity_and_credit_facts'
  confirmed: true
}

const keys = ['version', 'basis', 'url', 'note', 'checkedAt', 'scope', 'confirmed']
const timestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))
    return false
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return false
  const expected = value.includes('.')
    ? value.replace(/\.(\d+)Z$/, (_, digits: string) => `.${digits.padEnd(3, '0')}Z`)
    : value.replace('Z', '.000Z')
  return new Date(time).toISOString() === expected
}
const referenceUrl = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    value.length > 2000 ||
    value.trim() !== value ||
    /\s/u.test(value) ||
    value.includes('\\') ||
    value.split('#', 1)[0]!.includes('?')
  )
    return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.search
    )
  } catch {
    return false
  }
}

export function parseEditionCreditSourceUseReview(input: unknown): EditionCreditSourceUseReview {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    throw new Error('Record the inspected source-use basis before preparing this review.')
  const value = input as Record<string, unknown>
  if (
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key)) ||
    value.version !== 1 ||
    (value.basis !== 'public_terms' && value.basis !== 'written_permission') ||
    !referenceUrl(value.url) ||
    typeof value.note !== 'string' ||
    !value.note.trim() ||
    value.note.length > 1000 ||
    !timestamp(value.checkedAt) ||
    value.scope !== 'edition_identity_and_credit_facts' ||
    value.confirmed !== true
  )
    throw new Error(
      'Use a confirmed, dated permission basis and an HTTPS reference without credentials or query parameters.',
    )
  return structuredClone(input) as EditionCreditSourceUseReview
}

/** A local preview of the human attestation, not independent verification of its entailment.
 * The server repeats these bounds before retention and before appending selected credits. */
export function reviewEditionCreditSourceUse(input: unknown, now: string) {
  let review: EditionCreditSourceUseReview
  try {
    review = parseEditionCreditSourceUseReview(input)
  } catch {
    return { ready: false, reasons: ['source_use_review_required'] as const }
  }
  const age = Date.parse(now) - Date.parse(review.checkedAt)
  if (!timestamp(now) || age < 0 || age > 30 * 86400000)
    return { ready: false, reasons: ['source_use_stale'] as const }
  return { ready: true, reasons: [] as const }
}
