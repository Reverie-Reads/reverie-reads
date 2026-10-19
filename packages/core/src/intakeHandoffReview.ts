import type { IntakeResolution } from './intakeEvidence'
import { reviewIntakeSourceUse } from './intakeSourceQualification'

/** Consumed only by the transient review built from a validated resolver snapshot.
 * Deliberately contains no proposed values, selected indices, Book patch or save capability.
 * The saved-edition editor still requires independent first-party inspection and server checks. */
export function buildIntakeHandoffReview(result: IntakeResolution) {
  return {
    mode: 'review_only' as const,
    targetFingerprint: result.targetFingerprint,
    targetRecheck: 'required_before_prepare' as const,
    fields: result.fields.map((field) => ({
      field: field.field,
      disposition:
        field.current !== undefined
          ? ('preserve_current' as const)
          : field.evidence.length
            ? ('review_required' as const)
            : ('no_observation' as const),
      reasons: [...field.reasons],
      evidence: field.evidence.map(({ observationId, claimId }) => {
        const observation = result.request.observations.find((o) => o.id === observationId)!
        const decision = result.claims.find(
          (c) => c.observationId === observationId && c.claimId === claimId,
        )!
        return {
          observationId,
          claimId,
          evidenceReasons: [...decision.reasons],
          upstreamLineage: observation.source.lineage === null ? 'unverified' : 'reported_only',
          uses: (['catalog', 'export', 'modelInput'] as const).map((use) =>
            reviewIntakeSourceUse(observation.source.provider, result.request.asOf, use),
          ),
        }
      }),
    })),
  }
}
