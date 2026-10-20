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
      frame.version === 1 &&
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
    version: 1,
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
    requireThat(exact(output, ['status', 'response']) && output.status === 'observed')
    const assessment = assessResearchResponse(output.response, c.body)
    return {
      id: c.id,
      expectedState: c.reference.expectedState,
      ...assessment,
      agrees: assessment.state === c.reference.expectedState,
    }
  })
  const observed = cases.filter((c) => c.state !== 'unobserved')
  return {
    version: 1,
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
    },
    cases,
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
