import type { IntakeCredit, IntakeEvidenceRequest } from './intakeEvidence'
import { intakeIdentityDiagnostics, resolveIntakeEvidence } from './intakeResolver'

/** In-memory operator view. Do not serialize this view into a provider-retaining report. */
export function buildIntakeReview(input: unknown) {
  const result = resolveIntakeEvidence(input)
  const request = result.request
  return {
    mode: 'review_only' as const,
    targetFingerprint: request.targetFingerprint,
    requested: request.target,
    current: request.existing,
    work: result.work,
    edition: result.edition,
    acquisition: result.acquisition,
    sources: request.observations.map((o) => ({
      id: o.id,
      source: o.source,
      status: o.status,
      identity: o.identity,
      creditStatements: o.creditStatements ?? [],
      identityCheck: intakeIdentityDiagnostics(request, o),
      reasons: result.observations.find((d) => d.id === o.id)!.reasons,
      credits: (o.identity?.contributors ?? o.withheldCredits ?? []).map((credit, position) => ({
        ...credit,
        position,
        withheld: o.status !== 'ok',
        completeness: 'unverified' as const,
        editionSupport: o.status === 'ok' && credit.basis === 'edition' ? 'observed' : 'unverified',
        storage:
          credit.scope === 'part' ||
          !['author', 'editor', 'translator', 'illustrator', 'narrator'].includes(credit.role)
            ? 'requires_lossless_storage'
            : 'requires_review',
      })),
      claims: o.claims.map((c) => ({
        ...c,
        current: request.existing[c.field],
        decision: result.claims.find((d) => d.observationId === o.id && d.claimId === c.id)!,
      })),
    })),
    fields: result.fields,
  }
}

const nameKey = (s: string) => {
  const parts = s.split(',').map((p) => p.trim())
  return (parts.length === 2 ? `${parts[1]} ${parts[0]}` : s)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .replace(/['’]/g, '')
    .match(/[\p{L}\p{N}\p{M}]+/gu)
    ?.join('|')
}

/** Score only independently listed credits, not an inferred complete roster. No reference enters routing. */
export function compareIntakeCredits(expected: IntakeCredit[], observed: IntakeCredit[]) {
  return expected.map((credit) => {
    const sameName = observed.filter((c) => nameKey(c.name) === nameKey(credit.name))
    const same = sameName.filter(
      (c) => c.role === credit.role && c.scope === credit.scope && c.part === credit.part,
    )
    if (same.some((c) => c.basis === 'edition')) return 'edition_observed'
    if (same.length) return 'scope_unverified'
    if (sameName.some((c) => c.role === 'unknown')) return 'unknown_role'
    return sameName.length ? 'role_or_part_conflict' : 'missing'
  })
}

/** Durable diagnostics have no provider names, values, URLs, identifiers or source-role literals. */
export function intakeReviewDiagnostics(input: IntakeEvidenceRequest) {
  const review = buildIntakeReview(input)
  return review.sources.map((s) => ({
    identity: s.identityCheck,
    reasons: s.reasons,
    credits: {
      total: s.credits.length,
      unparsedStatements: s.creditStatements.length,
      unknownRole: s.credits.filter((c) => c.role === 'unknown').length,
      editionScopeUnverified: s.credits.filter((c) => c.editionSupport === 'unverified').length,
      needsLosslessStorage: s.credits.filter((c) => c.storage === 'requires_lossless_storage')
        .length,
      completeness: 'unverified',
    },
  }))
}
