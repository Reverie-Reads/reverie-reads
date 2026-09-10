// Fixed-vocabulary aggregates only. Never use provider text, IDs, URLs or reasons as object keys.
const reasons = new Set([
  'malformed_record',
  'malformed_subtitle',
  'invalid_isbn',
  'isbn_mismatch',
  'title_mismatch',
  'contributors_mismatch',
  'identity_mismatch',
  'malformed_language',
  'language_mismatch',
  'truncated_results',
  'ambiguous_records',
  'detail_identity_changed',
  'missing_contributors',
  'too_many_contributors',
  'invalid_author_reference',
  'author_lookup_unavailable',
  'author_record_mismatch',
  'unknown_binding',
])
const stages = new Set(['preflight', 'search', 'detail'])
const formats = new Set([
  'paperback',
  'hardcover',
  'ebook',
  'audiobook',
  'unknown',
  'conflicting',
  'unavailable',
])
const bump = (t, key) => {
  t[key] = (t[key] ?? 0) + 1
}

export const createEditionDiagnostics = () => ({
  version: 1,
  providerReasons: { google: {}, openlibrary: {} },
  googleTerminalStage: {},
  packetFormat: {},
  candidateSource: {},
  candidateFormat: {},
})

/** Diagnostics cannot choose a candidate or observe reference truth. */
export function countEditionDiagnostics(target, acquired, packet) {
  for (const provider of ['google', 'openlibrary']) {
    const reason = acquired?.[provider]?.reason
    bump(
      target.providerReasons[provider],
      reason == null ? 'none' : reasons.has(reason) ? reason : 'other',
    )
  }
  const stage = acquired?.google?.stage
  bump(target.googleTerminalStage, stages.has(stage) ? stage : 'unknown')
  const format = formats.has(packet.formatEvidence) ? packet.formatEvidence : 'unavailable'
  bump(target.packetFormat, format)
  if (packet.candidateValue != null) {
    const sources = new Set(packet.observations.map((o) => o.source))
    const source =
      sources.size === 2 && sources.has('google') && sources.has('openlibrary')
        ? 'both'
        : sources.size === 1 && sources.has('google')
          ? 'google'
          : sources.size === 1 && sources.has('openlibrary')
            ? 'openlibrary'
            : 'unknown'
    bump(target.candidateSource, source)
    bump(target.candidateFormat, format)
  }
}
