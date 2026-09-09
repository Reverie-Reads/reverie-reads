import { canonicalIsbn } from './supplement.mjs'
import { createValueStudyLock, studyHash } from './value-study.mjs'

// Owner-authorized September 9 evaluation only; no production/source-use clearance.
// Populated from the reviewed frame before committing the runtime and freezing its lock.
export const APPROVED_EVALUATION_ISBNS_SHA256 =
  'a3a215d08c39d2e951d0c0e96fc8a4feeb84d48054c3492c5111479a6a07771e'

export function assertEvaluationFrame(input, approvedHash = APPROVED_EVALUATION_ISBNS_SHA256) {
  const lock = createValueStudyLock(input, '0'.repeat(64))
  const hash = studyHash(input.cases.map((c) => canonicalIsbn(c.identity.isbn)).sort())
  if (lock.cases !== 100 || lock.distinctWorks !== 100 || hash !== approvedHash)
    throw new Error('live_study_evaluation_scope')
}

export function assertNextEvaluationCohort(progress, index) {
  if (
    progress.failed.length ||
    progress.missing[0] !== index ||
    progress.results.some((r) =>
      Object.values(r.summary.transport).some((s) => s.stopped != null && s.stopped !== 'budget'),
    )
  )
    throw new Error('live_study_stopped_or_out_of_order')
}
