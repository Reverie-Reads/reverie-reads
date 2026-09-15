const seriesKey = (value) =>
  typeof value === 'string'
    ? value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
        .trim()
    : ''

const positivePosition = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** This comparison is prioritization, not authorization. A policy-safe independent relationship
 * may corroborate the pending tuple, but the existing administrator RPC remains the only writer. */
export function compareAuthorityResultToSuggestion(result, suggestion) {
  if (result?.status !== 'completed' || result?.validation?.valid !== true) {
    return { disposition: 'invalid_or_failed_model_result' }
  }
  if (result.validation.policySafe !== true) return { disposition: 'policy_quarantined' }
  if (result.output?.classification !== 'series') return { disposition: 'unresolved' }
  if (!Array.isArray(result.output.memberships) || result.output.memberships.length !== 1) {
    return { disposition: 'multiple_or_missing_memberships' }
  }

  const membership = result.output.memberships[0]
  if (
    !seriesKey(membership?.series) ||
    seriesKey(membership.series) !== seriesKey(suggestion?.proposed_series)
  ) {
    return { disposition: 'series_conflict' }
  }

  const proposedPosition = positivePosition(suggestion.proposed_position)
  const observedPosition = positivePosition(membership.position)
  if (proposedPosition !== null && observedPosition === null) {
    return { disposition: 'membership_only_position_unconfirmed' }
  }
  if (proposedPosition !== null && observedPosition !== proposedPosition) {
    return { disposition: 'position_conflict' }
  }
  if (proposedPosition === null && observedPosition !== null) {
    return { disposition: 'membership_corroborated_position_additional' }
  }
  if (suggestion.proposed_count !== null) {
    return { disposition: 'membership_only_count_unconfirmed' }
  }
  return { disposition: 'corroborated_exact_tuple' }
}

/** Deferred recovery items have no pending suggestion to accept. Comparing a safe authority result
 * with the preserved work tuple can prioritize manual review, but it must never promote that tuple
 * or manufacture a suggestion. */
export function compareAuthorityResultToDeferredWork(result, work) {
  const currentSeries = seriesKey(work?.current_series)
  const comparison = compareAuthorityResultToSuggestion(result, {
    proposed_series: currentSeries ? work.current_series : '__missing_current_series__',
    proposed_position: work?.current_position ?? null,
    proposed_count: null,
  })

  if (!currentSeries) {
    return comparison.disposition === 'series_conflict'
      ? { disposition: 'authority_candidate_requires_review' }
      : comparison
  }
  if (comparison.disposition === 'corroborated_exact_tuple') {
    return { disposition: 'deferred_current_tuple_corroborated' }
  }
  if (comparison.disposition === 'membership_corroborated_position_additional') {
    return { disposition: 'deferred_current_series_corroborated_position_candidate' }
  }
  return comparison
}
