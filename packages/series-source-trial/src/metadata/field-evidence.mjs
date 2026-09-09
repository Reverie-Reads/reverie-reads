import { exactIdentity, validateInput } from './supplement.mjs'

const providers = ['google', 'openlibrary']
const complete = new Set([
  'matched',
  'not_found',
  'no_exact_isbn',
  'identity_review',
  'edition_review',
])
const reasons = new Set([
  'isbn_mismatch',
  'invalid_isbn',
  'title_mismatch',
  'contributors_mismatch',
  'language_mismatch',
  'malformed_record',
  'malformed_subtitle',
  'malformed_language',
  'ambiguous_records',
  'missing_contributors',
  'too_many_contributors',
  'invalid_author_reference',
  'author_record_mismatch',
  'author_lookup_unavailable',
  'unknown_binding',
])

/** Only finite first-failing-guard codes may enter the aggregate report. */
export const baselineReasonCode = (reason) => (reasons.has(reason) ? reason : 'unspecified_reason')

/** Descriptive evidence only. No reference truth, values, probability, patch, or write authority. */
export function describeBaselineFields({ identity, current }, acquired) {
  validateInput({
    version: 1,
    purpose: 'development',
    cases: [{ identity, current, baseline: [] }],
  })
  const records = []
  let blocked = null
  if (
    !acquired ||
    Object.keys(acquired).some((p) => !providers.includes(p)) ||
    providers.some((p) => !complete.has(acquired[p]?.status))
  )
    blocked = 'unavailable'
  else if (
    providers.some((p) => ['identity_review', 'edition_review'].includes(acquired[p].status))
  )
    blocked = 'identity_review'
  else {
    for (const provider of providers) {
      const result = acquired[provider]
      if (result.status !== 'matched') continue
      try {
        validateInput({
          version: 1,
          purpose: 'development',
          cases: [{ identity, current, baseline: [result.record] }],
        })
        if (result.record.source !== provider || !exactIdentity(result.record, identity))
          throw new Error('invalid_match')
        records.push(result.record)
      } catch {
        blocked = 'identity_review'
      }
    }
    if (!blocked && !records.length) blocked = 'identity_unresolved'
  }
  const values = (field) => [...new Set(records.map((r) => r[field]).filter((v) => v != null))]
  const conflicts = (field) =>
    values(field).length > 1 ||
    (current[field] != null && values(field).some((v) => v !== current[field]))
  const knownFormat = current.editionFormat ?? values('editionFormat')[0]
  return Object.fromEntries(
    ['pages', 'editionFormat'].map((field) => {
      const sources = blocked ? [] : records.filter((r) => r[field] != null).map((r) => r.source)
      const state =
        blocked ??
        (field === 'pages' && conflicts('editionFormat')
          ? 'edition_conflict'
          : field === 'pages' && knownFormat === 'audiobook'
            ? 'not_applicable'
            : conflicts(field)
              ? 'conflict'
              : !sources.length
                ? 'source_missing'
                : sources.length === 1
                  ? 'single_source'
                  : 'source_agreement')
      return [field, { state, sources, currentProtected: current[field] != null, automatic: false }]
    }),
  )
}
