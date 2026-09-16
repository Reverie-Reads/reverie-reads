import { createHash } from 'node:crypto'
import { lineageKey } from '../lineage.mjs'
import { normalize } from '../normalize.mjs'
import { buildEvidencePacket } from '../resolver/evidence.mjs'

export const CORPUS_SHADOW_ACQUISITION_PURPOSE = 'corpus-series-shadow-source-acquisition'

const relationshipKinds = new Set(['relational_membership', 'singleton_relation'])
const authorsKey = (authors) => authors.map(normalize).join('\u001f')
const groupId = (seriesKey, authorScopeKey) =>
  createHash('sha256').update(`${seriesKey}\u001e${authorScopeKey}`).digest('hex').slice(0, 24)
const evidenceOrigin = (entry) =>
  entry.sourceLineage
    ? lineageKey(entry.sourceLineage)
    : `${entry.provider}:${entry.providerSeriesId ?? entry.sourceRef ?? entry.evidenceId}`
const uniqueSorted = (values) => [...new Set(values)].sort()
const numericSorted = (values) =>
  [...new Set(values.filter((value) => value !== null).map(Number))].sort(
    (left, right) => left - right,
  )

const assertCompleteRuns = (cases, runs) => {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('Candidate graph needs cases')
  if (!Array.isArray(runs) || runs.length === 0)
    throw new Error('Candidate graph needs provider runs')
  const expected = new Set(cases.map((entry) => entry.id))
  for (const run of runs) {
    if (typeof run?.provider !== 'string' || !Array.isArray(run.results)) {
      throw new Error('Every provider run needs a provider and results')
    }
    const ids = run.results.map((entry) => entry.caseId)
    if (new Set(ids).size !== ids.length)
      throw new Error(`${run.provider} has duplicate case results`)
    const missing = [...expected].filter((id) => !ids.includes(id))
    const foreign = ids.filter((id) => !expected.has(id))
    if (missing.length || foreign.length) {
      throw new Error(`${run.provider} does not exactly cover the selected identity batch`)
    }
  }
}

const workCandidates = (testCase, runs) => {
  const packet = buildEvidencePacket(testCase, runs)
  const claims = packet.membershipEvidence.filter((entry) =>
    relationshipKinds.has(entry.evidenceKind),
  )
  const bySeries = new Map()
  for (const claim of claims) {
    const key = normalize(claim.series)
    if (!key) continue
    const group = bySeries.get(key) ?? []
    group.push(claim)
    bySeries.set(key, group)
  }

  const competing = bySeries.size > 1
  const candidates = [...bySeries.entries()]
    .map(([seriesKey, evidence]) => {
      const observedPositions = numericSorted(evidence.map((entry) => entry.position))
      const eligiblePositions = numericSorted(
        evidence.filter((entry) => entry.quality?.positionEligible).map((entry) => entry.position),
      )
      const preferred = [...evidence].sort((left, right) =>
        String(left.series).localeCompare(String(right.series)),
      )[0]

      return {
        seriesKey,
        series: preferred.series,
        observedPositions,
        proposedPosition: eligiblePositions.length === 1 ? eligiblePositions[0] : null,
        membershipEligible: evidence.some((entry) => entry.quality?.membershipEligible),
        positionEligible: eligiblePositions.length === 1,
        riskFlags: uniqueSorted([
          ...evidence.flatMap((entry) => entry.quality?.riskFlags ?? []),
          ...(competing ? ['competing_series_names'] : []),
        ]),
        supportingProviders: uniqueSorted(evidence.map((entry) => entry.provider)),
        independentOrigins: uniqueSorted(evidence.map(evidenceOrigin)),
        evidence: evidence.map((entry) => ({
          evidenceId: entry.evidenceId,
          provider: entry.provider,
          providerSeriesId: entry.providerSeriesId,
          series: entry.series,
          position: entry.position,
          memberCount: entry.memberCount,
          sourceRef: entry.sourceRef,
          sourceLineage: entry.sourceLineage,
          quality: entry.quality,
        })),
      }
    })
    .sort((left, right) => left.seriesKey.localeCompare(right.seriesKey))

  return {
    workId: testCase.id,
    title: testCase.title,
    authors: testCase.authors,
    publicationYear: testCase.publicationYear,
    identityFingerprint: testCase.identityFingerprint,
    identityMatched: packet.identityEvidence.some((entry) =>
      ['high', 'medium'].includes(entry.confidence),
    ),
    providerErrors: packet.providerErrors,
    candidates,
  }
}

export function buildCorpusShadowCandidateGraph(cases, runs) {
  assertCompleteRuns(cases, runs)
  const works = cases.map((testCase) => workCandidates(testCase, runs))
  const groups = new Map()

  for (const work of works) {
    const authorScopeKey = authorsKey(work.authors)
    for (const candidate of work.candidates) {
      const key = `${candidate.seriesKey}\u001e${authorScopeKey}`
      const group = groups.get(key) ?? {
        groupId: groupId(candidate.seriesKey, authorScopeKey),
        seriesKey: candidate.seriesKey,
        series: candidate.series,
        authorScope: work.authors,
        members: [],
      }
      group.members.push({
        workId: work.workId,
        title: work.title,
        publicationYear: work.publicationYear,
        identityFingerprint: work.identityFingerprint,
        proposedPosition: candidate.proposedPosition,
        observedPositions: candidate.observedPositions,
        membershipEligible: candidate.membershipEligible,
        positionEligible: candidate.positionEligible,
        riskFlags: candidate.riskFlags,
        supportingProviders: candidate.supportingProviders,
        independentOrigins: candidate.independentOrigins,
        evidence: candidate.evidence,
      })
      groups.set(key, group)
    }
  }

  const candidateGroups = [...groups.values()]
    .map((group) => {
      const members = [...group.members].sort(
        (left, right) =>
          (left.proposedPosition ?? Number.MAX_SAFE_INTEGER) -
            (right.proposedPosition ?? Number.MAX_SAFE_INTEGER) ||
          left.title.localeCompare(right.title) ||
          left.workId.localeCompare(right.workId),
      )
      return {
        ...group,
        members,
        riskFlags: uniqueSorted([
          ...members.flatMap((member) => member.riskFlags),
          ...(members.length === 1 ? ['single_work_group'] : []),
        ]),
        deterministicMembershipEligible: members.every((member) => member.membershipEligible),
        modelReview: 'required',
      }
    })
    .sort(
      (left, right) =>
        left.seriesKey.localeCompare(right.seriesKey) ||
        authorsKey(left.authorScope).localeCompare(authorsKey(right.authorScope)),
    )

  const unresolvedWorks = works
    .filter((work) => work.candidates.length === 0)
    .map((work) => ({
      workId: work.workId,
      title: work.title,
      authors: work.authors,
      identityFingerprint: work.identityFingerprint,
      reason: work.identityMatched ? 'no_exact_relationship' : 'identity_unresolved',
      providerErrors: work.providerErrors,
      standalone: null,
    }))

  return {
    schemaVersion: 1,
    purpose: CORPUS_SHADOW_ACQUISITION_PURPOSE,
    counts: {
      works: works.length,
      worksWithCandidates: works.length - unresolvedWorks.length,
      unresolvedWorks: unresolvedWorks.length,
      candidateGroups: candidateGroups.length,
      candidateMemberships: candidateGroups.reduce(
        (total, group) => total + group.members.length,
        0,
      ),
      groupsRequiringModelReview: candidateGroups.length,
      affirmativeStandaloneClaims: 0,
    },
    candidateGroups,
    unresolvedWorks,
  }
}
