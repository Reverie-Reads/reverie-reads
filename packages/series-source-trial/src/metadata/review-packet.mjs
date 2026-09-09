import { describeBaselineFields } from './field-evidence.mjs'
import { planSupplement, cleanSupplementRecord, assessSupplement } from './supplement.mjs'

const fields = ['pages', 'editionFormat']
const transportStates = new Set([
  'not_found',
  'authentication',
  'rate_limited',
  'server_error',
  'redirect_refused',
  'http_error',
  'invalid_json',
  'timeout',
  'response_too_large',
  'network_error',
  'invalid_isbn',
  'not_attempted',
  'missing_key',
])

/** No truth/reference argument. This packet may be inspected in memory, never exported or sent to a model. */
export function buildMetadataReviewPacket({ identity, current }, acquired, response) {
  // Also validates all matched records and rejects unknown/missing providers and forged source labels.
  const baselineFields = describeBaselineFields({ identity, current }, acquired)
  const state = baselineFields.pages.state
  const blocked = ['unavailable', 'identity_review', 'identity_unresolved'].includes(state)
  const baseline = blocked
    ? []
    : ['google', 'openlibrary'].flatMap((p) =>
        acquired[p].status === 'matched' ? [acquired[p].record] : [],
      )
  const decision =
    state === 'unavailable'
      ? 'baseline_unavailable'
      : state === 'identity_review'
        ? 'baseline_review'
        : state === 'identity_unresolved'
          ? 'identity_review'
          : state === 'edition_conflict'
            ? 'edition_review'
            : state === 'not_applicable'
              ? 'audio_control'
              : !baseline.some((r) => r.pages != null)
                ? 'no_page_observation'
                : 'lookup'
  const target = { identity, current, baseline }
  const plan = blocked ? null : planSupplement(target)
  let supplement = { status: 'not_requested' },
    proposals = []
  if (decision === 'lookup' && response !== undefined) {
    if (response?.status !== 'ok')
      supplement = {
        status: 'unavailable',
        reason: transportStates.has(response?.status) ? response.status : 'unknown_status',
      }
    else {
      supplement = cleanSupplementRecord(identity, plan.knownFormat, response.body)
      if (supplement.status === 'matched')
        proposals = assessSupplement(target, plan, response.body).proposals
    }
  }
  const records = [
    ...baseline,
    ...(supplement.status === 'matched' ? [{ source: 'isbndb', ...supplement.values }] : []),
  ]
  const knownFormat = current.editionFormat ?? records.find((r) => r.editionFormat)?.editionFormat
  const packet = {
    version: 1,
    retention: 'memory_only',
    automatic: false,
    decision,
    identity: structuredClone(identity),
    supplement: {
      status: supplement.status,
      ...(supplement.reason ? { reason: supplement.reason } : {}),
    },
    fields: Object.fromEntries(
      fields.map((field) => {
        const observations = records
          .filter((r) => r[field] != null)
          .map((r) => ({ source: r.source, value: r[field] }))
        const values = [...new Set(observations.map((o) => o.value))]
        const conflict =
          values.length > 1 || (current[field] != null && values.some((v) => v !== current[field]))
        const joinedState =
          supplement.status !== 'matched'
            ? baselineFields[field].state
            : field === 'pages' && knownFormat === 'audiobook'
              ? 'not_applicable'
              : conflict
                ? 'conflict'
                : !values.length
                  ? 'source_missing'
                  : observations.length === 1
                    ? 'single_source'
                    : 'source_agreement'
        return [
          field,
          {
            state: joinedState,
            observations,
            current: { value: current[field] ?? null, protected: current[field] != null },
            proposedFill: proposals.find((p) => p.field === field) ?? null,
            automatic: false,
          },
        ]
      }),
    ),
  }
  // Fail closed if a caller accidentally passes the packet to JSON output/reporting.
  Object.defineProperty(packet, 'toJSON', {
    value() {
      throw new Error('review_packet_is_memory_only')
    },
  })
  return packet
}
