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

// Mirror the frozen identity normalizer without changing the consumed study module.
// This observes representation only; it must never participate in admission.
const foldTitle = (value) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

export function hasRepeatedGoogleSubtitle(title, subtitle, expectedTitle) {
  if ([title, subtitle, expectedTitle].some((v) => typeof v !== 'string' || v.length > 500))
    return false
  const full = foldTitle(title)
  const suffix = foldTitle(subtitle)
  return Boolean(suffix && full === foldTitle(expectedTitle) && full.endsWith(` ${suffix}`))
}

export const createEditionDiagnostics = () => ({
  version: 2,
  providerReasons: { google: {}, openlibrary: {} },
  googleTerminalStage: {},
  googleTitleMismatch: {},
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
  const stageKey = stages.has(stage) ? stage : 'unknown'
  bump(target.googleTerminalStage, stageKey)
  if (
    acquired?.google?.status === 'identity_review' &&
    acquired.google.reason === 'title_mismatch'
  ) {
    const bucket = (target.googleTitleMismatch[stageKey] ??= {})
    bump(
      bucket,
      acquired.google.titleDiagnostic === 'repeated_subtitle' ? 'repeated_subtitle' : 'other',
    )
  }
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
