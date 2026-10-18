import type { IntakeCredit } from './intakeEvidence'

export type IntakeCreditCollision = {
  kind:
    | 'repeated_credit'
    | 'role_normalization_collision'
    | 'person_identifier_conflict'
    | 'person_name_conflict'
  positions: [number, number]
}
// Match the resolver's comparison-only name equivalence. This only detects ambiguity;
// it never changes retained names, merges people or removes non-Latin identity marks.
const nameKey = (s: string) => {
  const parts = s.split(',').map((p) => p.trim())
  const ordered = parts.length === 2 ? `${parts[1]} ${parts[0]}` : s
  return (
    ordered
      .replace(/['’]/g, '')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
      .match(/[\p{L}\p{N}\p{M}]+/gu) ?? []
  ).join('|')
}

/** Diagnostic pairs only: never deduplicate, infer aliases, assign roles or grant identity support.
 * Provider IDs are comparable only within this one source record, never across providers.
 * Repeated credit means repeated retained credit fields, not byte-identical provider JSON. */
export function reviewIntakeCreditCollisions(credits: IntakeCredit[]): IntakeCreditCollision[] {
  const pairs: IntakeCreditCollision[] = []
  for (let i = 0; i < credits.length; i++) {
    for (let j = i + 1; j < credits.length; j++) {
      const a = credits[i]!,
        b = credits[j]!
      const sameName = nameKey(a.name) === nameKey(b.name)
      const ids = !!a.sourceContributorId && !!b.sourceContributorId
      let kind: IntakeCreditCollision['kind'] | undefined
      if (ids && a.sourceContributorId === b.sourceContributorId && !sameName)
        kind = 'person_name_conflict'
      else if (sameName && ids && a.sourceContributorId !== b.sourceContributorId)
        kind = 'person_identifier_conflict'
      else if (sameName && a.role === b.role && a.scope === b.scope && a.part === b.part) {
        kind =
          a.sourceRoleCode === b.sourceRoleCode &&
          a.sourceRole === b.sourceRole &&
          a.basis === b.basis
            ? 'repeated_credit'
            : 'role_normalization_collision'
      }
      if (kind) pairs.push({ kind, positions: [i, j] })
    }
  }
  return pairs
}
