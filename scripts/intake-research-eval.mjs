import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assessResearchResponse, validResearchBody } from './intake-research-contract.mjs'

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const exact = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k))
const requireThat = (value) => {
  if (!value) throw new Error('Invalid or changed research evaluation')
}
async function systemHash() {
  const files = ['intake-research-contract.mjs', 'intake-research-eval.mjs', 'intake-budget.mjs']
  return hash(
    await Promise.all(files.map((name) => readFile(new URL(name, import.meta.url), 'utf8'))),
  )
}
function validate(frame) {
  requireThat(
    exact(frame, ['version', 'basis', 'cases']) &&
      [1, 2].includes(frame.version) &&
      ['synthetic_contract', 'reviewed_model_responses'].includes(frame.basis) &&
      Array.isArray(frame.cases) &&
      frame.cases.length > 0 &&
      frame.cases.length <= 20,
  )
  const ids = new Set()
  for (const c of frame.cases) {
    requireThat(
      exact(c, ['id', 'body', 'reference']) &&
        /^case-\d{2}$/.test(c.id) &&
        !ids.has(c.id) &&
        validResearchBody(c.body) &&
        exact(c.reference, ['expectedState', 'basis']) &&
        ['held', 'citation_checked'].includes(c.reference.expectedState) &&
        typeof c.reference.basis === 'string' &&
        !!c.reference.basis.trim() &&
        c.reference.basis.length <= 2000,
    )
    ids.add(c.id)
  }
}

/** Freeze expected outcomes and code before collecting responses. Reference labels stay outside
 * the request body. This evaluator never sends requests or consumes/replays acquisition markers. */
export async function freezeResearchFrame(input) {
  const frame = structuredClone(input)
  validate(frame)
  return {
    version: frame.version,
    frameHash: hash(frame),
    systemHash: await systemHash(),
    basis: frame.basis,
    cases: frame.cases.length,
  }
}

export async function scoreResearchFrame(frameInput, lockInput, outputsInput) {
  const frame = structuredClone(frameInput)
  const lock = structuredClone(lockInput)
  const outputs = structuredClone(outputsInput)
  requireThat(JSON.stringify(lock) === JSON.stringify(await freezeResearchFrame(frame)))
  requireThat(
    exact(
      outputs,
      frame.cases.map((c) => c.id),
    ),
  )
  const cases = frame.cases.map((c) => {
    const output = outputs[c.id]
    if (exact(output, ['status', 'reason']) && output.status === 'unobserved') {
      requireThat(['not_run', 'request_failed', 'response_missing'].includes(output.reason))
      return { id: c.id, state: 'unobserved', reason: output.reason }
    }
    requireThat(
      (exact(output, ['status', 'response']) ||
        (frame.version === 2 && exact(output, ['status', 'response', 'humanReview']))) &&
        output.status === 'observed',
    )
    const assessment = assessResearchResponse(output.response, c.body)
    return {
      id: c.id,
      expectedState: c.reference.expectedState,
      ...assessment,
      agrees: assessment.state === c.reference.expectedState,
      ...(frame.version === 2
        ? {
            humanReview: assessHumanReview(
              output.humanReview,
              output.response,
              c.body,
              c.reference,
              assessment,
            ),
          }
        : {}),
    }
  })
  const observed = cases.filter((c) => c.state !== 'unobserved')
  return {
    version: frame.version,
    basis: frame.basis,
    lock,
    summary: {
      cases: cases.length,
      observed: observed.length,
      unobserved: cases.length - observed.length,
      contractAgreement: observed.filter((c) => c.agrees).length,
      citationCheckedExpectedHeld: observed.filter(
        (c) => c.state === 'citation_checked' && c.expectedState === 'held',
      ).length,
      heldExpectedCitationChecked: observed.filter(
        (c) => c.state === 'held' && c.expectedState === 'citation_checked',
      ).length,
      syntheticResponses: frame.basis === 'synthetic_contract',
      accuracyEstablished: false,
      semanticSupportCertified: false,
      saveAllowed: false,
      modelCalls: 0,
      catalogWrites: 0,
      ...(frame.version === 2 ? { humanReviewed: summarizeHumanReview(cases) } : {}),
    },
    cases,
  }
}

const verdicts = ['supported', 'unsupported', 'uncertain', 'not_applicable']
const dimensions = ['identity', 'edition', 'contributorRoles']
const boundedText = (v, max) => typeof v === 'string' && !!v.trim() && v.length <= max

// Human judgements are attestations bound to these exact bytes, not model truth or permission.
// Reference material remains in the private frame, never injected into a request body.
function assessHumanReview(review, response, body, reference, assessment) {
  if (review === undefined) return { status: 'not_reviewed' }
  requireThat(
    exact(review, [
      'version',
      'requestHash',
      'responseHash',
      'referenceHash',
      'reviewer',
      'reviewedAt',
      'originalSourcesInspected',
      'referenceIndependent',
      'basis',
      'dimensions',
      'claims',
    ]) &&
      review.version === 1 &&
      review.requestHash === hash(body) &&
      review.responseHash === hash(response) &&
      review.referenceHash === hash(reference) &&
      boundedText(review.reviewer, 200) &&
      boundedText(review.basis, 2000) &&
      typeof review.reviewedAt === 'string' &&
      Number.isFinite(Date.parse(review.reviewedAt)) &&
      Date.parse(review.reviewedAt) <= Date.now() &&
      review.originalSourcesInspected === true &&
      review.referenceIndependent === true &&
      exact(review.dimensions, dimensions) &&
      dimensions.every((d) => verdicts.includes(review.dimensions[d])) &&
      Array.isArray(review.claims) &&
      review.claims.length === assessment.counts.claims,
  )
  const seen = new Set()
  for (const claim of review.claims) {
    requireThat(
      exact(claim, ['index', 'verdict', 'basis']) &&
        Number.isSafeInteger(claim.index) &&
        claim.index >= 0 &&
        claim.index < assessment.counts.claims &&
        !seen.has(claim.index) &&
        ['supported', 'unsupported', 'uncertain'].includes(claim.verdict) &&
        boundedText(claim.basis, 2000),
    )
    seen.add(claim.index)
  }
  return {
    status: 'reviewed',
    dimensions: review.dimensions,
    claims: review.claims.map(({ index, verdict }) => ({ index, verdict })),
  }
}
function summarizeHumanReview(cases) {
  const reviewed = cases.filter((c) => c.humanReview?.status === 'reviewed')
  const tally = (values) =>
    Object.fromEntries(verdicts.map((v) => [v, values.filter((x) => x === v).length]))
  return {
    cases: reviewed.length,
    notReviewed: cases.length - reviewed.length,
    dimensions: Object.fromEntries(
      dimensions.map((d) => [d, tally(reviewed.map((c) => c.humanReview.dimensions[d]))]),
    ),
    semanticSupport: tally(
      reviewed.flatMap((c) => c.humanReview.claims.map((claim) => claim.verdict)),
    ),
    attestedOnly: true,
  }
}

async function json(path) {
  const bytes = await readFile(resolve(path))
  requireThat(bytes.length <= 8 * 1024 * 1024)
  return JSON.parse(bytes)
}
export async function main(args) {
  const [command, ...paths] = args
  let result, output
  if (command === 'freeze' && paths.length === 2) {
    result = await freezeResearchFrame(await json(paths[0]))
    output = paths[1]
  } else if (command === 'score' && paths.length === 4) {
    result = await scoreResearchFrame(
      await json(paths[0]),
      await json(paths[1]),
      await json(paths[2]),
    )
    output = paths[3]
  } else throw new Error('Usage: freeze FRAME LOCK | score FRAME LOCK RESPONSES REPORT')
  await writeFile(resolve(output), `${JSON.stringify(result, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  return result.summary ?? { cases: result.cases, frozen: true, modelCalls: 0 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => {
      process.stderr.write('Research evaluation refused; preserve original frame and outputs.\n')
      process.exitCode = 1
    })
