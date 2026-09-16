import { CORPUS_SHADOW_RECONCILIATION_PURPOSE } from './corpus-shadow-reconcile.mjs'
import { CORPUS_SHADOW_HISTORICAL_MERGE_PURPOSE } from './corpus-shadow-historical-merge.mjs'
import { validateCorpusShadowReviewManifest } from './corpus-shadow-review-manifest.mjs'
import { normalize } from '../normalize.mjs'

const fail = (message) => {
  throw new Error(`Invalid corpus shadow historical reconciliation: ${message}`)
}

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const countsFor = (works) => ({
  works: works.length,
  resolvedSeries: works.filter(({ status }) => status === 'resolved_series').length,
  resolvedStandalone: works.filter(({ status }) => status === 'resolved_standalone').length,
  manualReview: works.filter(({ status }) => status === 'manual_review').length,
  unresolved: works.filter(({ status }) => status === 'unresolved').length,
  exaSelected: works.filter(({ selectedPass }) => selectedPass === 'exa_fallback').length,
})

export function reconcileCorpusShadowHistoricalAuthority({
  manifest,
  reconciliation,
  reconciliationSha256,
  historicalAuthority,
  historicalAuthoritySha256,
}) {
  validateCorpusShadowReviewManifest(manifest)
  if (
    reconciliation?.schemaVersion !== 1 ||
    reconciliation?.purpose !== CORPUS_SHADOW_RECONCILIATION_PURPOSE ||
    reconciliationSha256 !== manifest.inputs.reconciliationSha256 ||
    reconciliation.sourceFrame?.sha256 !== manifest.sourceFrame.sha256 ||
    reconciliation.counts?.works !== manifest.counts.works ||
    !Array.isArray(reconciliation.works) ||
    reconciliation.works.length !== manifest.counts.works
  ) {
    fail('base reconciliation does not match the manifest')
  }
  if (
    historicalAuthority?.schemaVersion !== 1 ||
    historicalAuthority?.purpose !== CORPUS_SHADOW_HISTORICAL_MERGE_PURPOSE ||
    historicalAuthority.sourceManifest?.sha256 !== manifest.manifestSha256 ||
    historicalAuthority.counts?.works !== manifest.counts.historicalVerification ||
    !/^[a-f0-9]{64}$/.test(historicalAuthoritySha256 ?? '') ||
    !Array.isArray(historicalAuthority.works) ||
    historicalAuthority.works.length !== manifest.counts.historicalVerification
  ) {
    fail('historical authority result does not match the manifest')
  }
  const expectedHistorical = new Map(
    manifest.lanes.historicalVerification.map((item) => [item.id, item]),
  )
  const historicalById = new Map()
  for (const work of historicalAuthority.works) {
    const expected = expectedHistorical.get(work.workId)
    if (
      !expected ||
      historicalById.has(work.workId) ||
      work.identityFingerprint !== expected.identityFingerprint ||
      work.title !== expected.title ||
      !equal(work.authors, expected.authors) ||
      work.publicationYear !== expected.publicationYear ||
      !['resolved_series', 'resolved_standalone', 'manual_review', 'unresolved'].includes(
        work.status,
      ) ||
      !/^[a-f0-9]{64}$/.test(work.provenance?.reportSha256 ?? '') ||
      !/^[a-f0-9]{64}$/.test(work.provenance?.outputSha256 ?? '') ||
      (work.status === 'resolved_series' &&
        (work.classification !== 'series' || !work.memberships?.length)) ||
      (work.status !== 'resolved_series' && work.memberships?.length)
    ) {
      fail(`historical identity drifted for ${work.workId}`)
    }
    historicalById.set(work.workId, work)
  }
  if (historicalById.size !== expectedHistorical.size) fail('historical authority omits works')
  if (!equal(countsFor(historicalAuthority.works), historicalAuthority.counts)) {
    fail('historical authority counts do not reconcile')
  }

  const works = reconciliation.works.map((work) => {
    const authority = historicalById.get(work.workId)
    if (!authority) return work
    const provenance = [
      {
        stage: 'historical_authority',
        reportSha256: authority.provenance.reportSha256,
        outputSha256: authority.provenance.outputSha256,
      },
    ]
    if (authority.status === 'resolved_series') {
      const memberships = [...authority.memberships].sort((left, right) =>
        normalize(left.series).localeCompare(normalize(right.series)),
      )
      return {
        ...work,
        status: 'resolved_series',
        classification: 'series',
        memberships,
        provenance,
      }
    }
    if (authority.status === 'resolved_standalone') {
      return {
        ...work,
        status: 'resolved_standalone',
        classification: 'standalone',
        memberships: [],
        provenance,
      }
    }
    return {
      ...work,
      status: 'historical_review_complete_unresolved',
      classification: 'unresolved',
      memberships: [],
      provenance,
    }
  })
  const counts = {
    works: works.length,
    resolvedSeries: works.filter(({ status }) => status === 'resolved_series').length,
    resolvedStandalone: works.filter(({ status }) => status === 'resolved_standalone').length,
    manualReview: works.filter(({ status }) => status === 'manual_review').length,
    unresolved: works.filter(({ status }) => status === 'unresolved').length,
    historicalReviewCompleteUnresolved: works.filter(
      ({ status }) => status === 'historical_review_complete_unresolved',
    ).length,
    exaSelected:
      Number(reconciliation.counts.exaSelected ?? 0) + historicalAuthority.counts.exaSelected,
  }
  return {
    ...reconciliation,
    inputs: { ...reconciliation.inputs, historicalAuthoritySha256 },
    counts,
    works,
    mutationBoundary: 'review_only_no_supabase_or_corpus_writer',
  }
}
