import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

export const POST_RECOVERY_AUTHORITY_PURPOSE = 'post-recovery-authority-review'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROJECT_RE = /^[a-z0-9]{20}$/
const MD5_RE = /^[a-f0-9]{32}$/
const FORBIDDEN_CASE_KEYS = new Set([
  'candidateSeries',
  'currentSeries',
  'evidence',
  'memberships',
  'position',
  'proposedSeries',
  'series',
  'sourceUrl',
  'truth',
])

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const fail = (message) => {
  throw new Error(`Invalid post-recovery authority frame: ${message}`)
}

export function validatePostRecoveryAuthorityFrame(frame) {
  if (!isObject(frame)) fail('expected an object')
  if (frame.schemaVersion !== 1) fail('schemaVersion must be 1')
  if (frame.purpose !== POST_RECOVERY_AUTHORITY_PURPOSE) fail('purpose is not permitted')
  if (!PROJECT_RE.test(frame.project ?? '')) fail('project is invalid')
  if (!UUID_RE.test(frame.sourceRunId ?? '')) fail('sourceRunId is invalid')
  if (!Number.isFinite(Date.parse(frame.frozenAt ?? ''))) fail('frozenAt is invalid')
  if (!isObject(frame.run) || frame.run.status !== 'completed' || frame.run.phase !== 'complete') {
    fail('source run is not complete')
  }
  if (frame.run.uncertain !== 0) fail('source run has uncertain writes')
  if (!Array.isArray(frame.cases) || frame.cases.length < 1 || frame.cases.length > 1000) {
    fail('cases must contain 1 to 1000 works')
  }

  const seen = new Set()
  let review = 0
  let deferred = 0
  for (const item of frame.cases) {
    if (!isObject(item)) fail('every case must be an object')
    for (const key of Object.keys(item)) {
      if (FORBIDDEN_CASE_KEYS.has(key)) fail(`case ${item.id ?? '(unknown)'} contains ${key}`)
    }
    if (!UUID_RE.test(item.id ?? '')) fail('case id is invalid')
    if (seen.has(item.id)) fail(`duplicate case ${item.id}`)
    seen.add(item.id)
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500) {
      fail(`case ${item.id} has an invalid title`)
    }
    if (
      !Array.isArray(item.authors) ||
      item.authors.length < 1 ||
      item.authors.length > 20 ||
      item.authors.some(
        (author) => typeof author !== 'string' || !author.trim() || author.length > 300,
      ) ||
      new Set(item.authors.map((author) => author.trim())).size !== item.authors.length
    ) {
      fail(`case ${item.id} has invalid full authors`)
    }
    if (
      item.publicationYear !== null &&
      (!Number.isInteger(item.publicationYear) ||
        item.publicationYear < 1000 ||
        item.publicationYear > 2100)
    ) {
      fail(`case ${item.id} has an invalid publication year`)
    }
    if (!['review', 'deferred'].includes(item.queue)) fail(`case ${item.id} has an invalid queue`)
    if (typeof item.reasonCode !== 'string' || !/^[a-z0-9_]{1,120}$/.test(item.reasonCode)) {
      fail(`case ${item.id} has an invalid reason code`)
    }
    if (!MD5_RE.test(item.identityFingerprint ?? '')) {
      fail(`case ${item.id} has an invalid identity fingerprint`)
    }
    if (item.queue === 'review') review += 1
    else deferred += 1
  }

  if (
    !isObject(frame.counts) ||
    frame.counts.review !== review ||
    frame.counts.deferred !== deferred
  ) {
    fail('queue counts do not reconcile')
  }
  if (frame.counts.total !== frame.cases.length) fail('total count does not reconcile')
  return frame
}

export function postRecoveryTrialCaseSet(frame) {
  validatePostRecoveryAuthorityFrame(frame)
  return {
    schemaVersion: 1,
    methodology: {
      reviewedCases: 0,
      candidateCases: frame.cases.length,
      note: 'Post-recovery cases are a truth-blind review backlog, not ground truth. Model output remains review-only.',
    },
    sharedSources: {},
    cases: frame.cases.map((item) => ({
      id: item.id,
      title: item.title.trim(),
      authors: item.authors.map((author) => author.trim()),
      publicationYear: item.publicationYear,
      evaluationPartition: 'post_recovery_review',
      sampleOrigin: 'production_shared_catalog_review',
      stratum: item.queue,
      reviewQueue: item.queue,
      reviewReasonCode: item.reasonCode,
      identityFingerprint: item.identityFingerprint,
      truth: { status: 'candidate', standalone: null, memberships: [], sources: [] },
    })),
  }
}

export async function loadPrivatePostRecoveryAuthorityFrame(inputPath, packageRoot) {
  const privateRoot = resolve(packageRoot, 'private-results')
  const absolute = resolve(inputPath)
  const rel = relative(privateRoot, absolute)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Post-recovery authority input must remain under private-results')
  }
  return validatePostRecoveryAuthorityFrame(JSON.parse(await readFile(absolute, 'utf8')))
}

export const postRecoveryFrameSha256 = (frame) =>
  createHash('sha256').update(JSON.stringify(frame)).digest('hex')
