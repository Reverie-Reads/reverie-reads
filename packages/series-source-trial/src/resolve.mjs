import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTrialCases, refreshRecordedCaseSet } from './cases.mjs'
import { loadLocalEnvironment } from './env.mjs'
import { annotateProviderResults } from './lineage.mjs'
import { authorityProviderRuns } from './authority/provider-runs.mjs'
import {
  buildEvidencePacket,
  canonicalizeResolutionDecision,
  scoreResolutionRun,
  validateResolution,
} from './resolver/evidence.mjs'
import { resolveEvidencePacket } from './resolver/openai.mjs'
import { decisionPacketCacheKey, legacyPacketCacheKey } from './resolver/cache.mjs'
import { RESOLVER_PROMPT_VERSION } from './resolver/schema.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')

const parseArgs = (argv) => {
  const options = { input: null, authority: null, out: null, scope: 'all', max: null, ids: null }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--input') options.input = argv[++index]
    else if (value === '--authority') options.authority = argv[++index]
    else if (value === '--out') options.out = argv[++index]
    else if (value === '--scope') options.scope = argv[++index]
    else if (value === '--max') options.max = Number(argv[++index])
    else if (value === '--ids') options.ids = argv[++index].split(',').filter(Boolean)
    else throw new Error(`Unknown argument ${value}`)
  }
  if (!options.input) throw new Error('Usage: pnpm resolver -- --input TRIAL_REPORT.json')
  if (!['all', 'gold', 'candidate'].includes(options.scope)) {
    throw new Error('Resolver scope must be all, gold, or candidate')
  }
  if (options.max !== null && (!Number.isInteger(options.max) || options.max < 1)) {
    throw new Error('Resolver max must be a positive integer')
  }
  return options
}

const resolveExisting = async (path) => {
  for (const candidate of [resolve(path), resolve(repositoryRoot, path)]) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next supported invocation root.
    }
  }
  throw new Error(`Trial report not found: ${path}`)
}

const timestamp = () =>
  new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)

const renderMarkdown = (score) => {
  const percent = (value) => (value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`)
  const accuracy = score.autoFillAccuracy
  return `${[
    '# Reverie evidence resolver shadow score',
    '',
    `Model: ${score.model}`,
    `Cases: ${score.cases}; completed: ${score.completed}; structurally valid: ${score.validResponses}.`,
    `Policy-safe proposals: ${score.policySafeProposals}; review: ${score.reviewDecisions}; abstain: ${score.abstentions}.`,
    '',
    '| Citation faithfulness | Unsupported fields | Policy violations | Membership precision | Membership recall | False standalone |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${percent(score.citationFaithfulness)} | ${score.unsupportedMembershipCount} | ${score.policyViolationCount} | ${percent(accuracy.accuracy.membershipPrecision)} | ${percent(accuracy.accuracy.membershipRecall)} | ${percent(accuracy.accuracy.falseStandaloneRate)} |`,
    '',
    'Only policy-safe proposals contribute to auto-fill accuracy. Review and abstain decisions are not treated as series claims.',
    'This shadow run does not write Supabase or Reverie corpus data.',
  ].join('\n')}\n`
}

await loadLocalEnvironment(resolve(packageRoot, '.env.local'))
const options = parseArgs(process.argv.slice(2))
const inputPath = await resolveExisting(options.input)
const authorityPath = options.authority ? await resolveExisting(options.authority) : null
const [trial, currentCaseSet, policy] = await Promise.all([
  readFile(inputPath, 'utf8').then(JSON.parse),
  loadTrialCases(),
  readFile(resolve(packageRoot, 'data/evaluation-policy.json'), 'utf8').then(JSON.parse),
])
if (!trial.caseSet?.cases || !Array.isArray(trial.runs)) {
  throw new Error('Input must be a complete series trial JSON report with caseSet and runs')
}
const authorityReport = authorityPath
  ? await readFile(authorityPath, 'utf8').then(JSON.parse)
  : null

const model = process.env.BOOK_RESOLVER_MODEL ?? 'gpt-5.6-luna'
const refreshedCaseSet = refreshRecordedCaseSet(trial.caseSet, currentCaseSet)
let cases = refreshedCaseSet.cases.filter((entry) => {
  if (options.scope === 'gold') return entry.truth?.status === 'reviewed'
  if (options.scope === 'candidate') return entry.truth?.status === 'candidate'
  return true
})
if (options.ids) {
  const eligibleById = new Map(cases.map((entry) => [entry.id, entry]))
  const missing = options.ids.filter((id) => !eligibleById.has(id))
  if (missing.length) throw new Error(`Unknown or out-of-scope case ids: ${missing.join(', ')}`)
  const ids = new Set(options.ids)
  cases = cases.filter((entry) => ids.has(entry.id))
}
cases = cases.slice(0, options.max ?? undefined)
const selectedIds = new Set(cases.map((entry) => entry.id))
const caseSet = {
  ...refreshedCaseSet,
  cases,
  methodology: {
    ...refreshedCaseSet.methodology,
    reviewedCases: cases.filter((entry) => entry.truth?.status === 'reviewed').length,
    candidateCases: cases.filter((entry) => entry.truth?.status === 'candidate').length,
  },
}
const runs = [
  ...trial.runs,
  ...(authorityReport ? authorityProviderRuns(authorityReport) : []),
].map((run) => ({
  ...run,
  results: annotateProviderResults(
    run.provider,
    run.results.filter((entry) => selectedIds.has(entry.caseId)),
  ),
}))
const packets = cases.map((testCase) => buildEvidencePacket(testCase, runs))
const cacheRoot = resolve(packageRoot, 'private-results/resolver-cache')
await mkdir(cacheRoot, { recursive: true })

const cachePath = (key) => resolve(cacheRoot, `${key}.json`)

const semanticCachePath = (packet) =>
  cachePath(decisionPacketCacheKey({ model, promptVersion: RESOLVER_PROMPT_VERSION, packet }))

const legacyCachePath = (packet) =>
  cachePath(legacyPacketCacheKey({ model, promptVersion: RESOLVER_PROMPT_VERSION, packet }))

const runOne = async (packet) => {
  const semanticPath = semanticCachePath(packet)
  for (const path of [semanticPath, legacyCachePath(packet)]) {
    try {
      const cached = JSON.parse(await readFile(path, 'utf8'))
      const output = canonicalizeResolutionDecision(packet, cached.output)
      const canonical = { ...cached, output }
      if (path !== semanticPath) {
        await writeFile(semanticPath, `${JSON.stringify(canonical, null, 2)}\n`)
      }
      return {
        caseId: packet.caseId,
        status: 'completed',
        ...canonical,
        cached: true,
        validation: validateResolution(packet, output),
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  try {
    const resolved = await resolveEvidencePacket(packet, { model })
    const output = canonicalizeResolutionDecision(packet, resolved.output)
    const canonical = { ...resolved, output }
    await writeFile(semanticPath, `${JSON.stringify(canonical, null, 2)}\n`)
    return {
      caseId: packet.caseId,
      status: 'completed',
      ...canonical,
      cached: false,
      validation: validateResolution(packet, output),
    }
  } catch (error) {
    return {
      caseId: packet.caseId,
      status: 'error',
      error: String(error),
      latencyMs: null,
      cached: false,
    }
  }
}

const concurrency = Math.max(1, Math.min(4, Number(process.env.BOOK_RESOLVER_CONCURRENCY ?? 2)))
const resolutions = Array(packets.length)
let nextIndex = 0
let completed = 0
async function worker() {
  while (nextIndex < packets.length) {
    const index = nextIndex
    nextIndex += 1
    resolutions[index] = await runOne(packets[index])
    completed += 1
    console.log(`resolver ${completed}/${packets.length}`)
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()))

const score = scoreResolutionRun(caseSet, packets, resolutions, policy, model)
const basePath = resolve(
  packageRoot,
  options.out ?? `reports/resolver-shadow_${options.scope}_${timestamp()}`,
)
await mkdir(dirname(basePath), { recursive: true })
await Promise.all([
  writeFile(
    `${basePath}.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceTrial: inputPath,
        authorityEvidence: authorityPath,
        model,
        promptVersion: RESOLVER_PROMPT_VERSION,
        packets,
        resolutions,
        score,
      },
      null,
      2,
    )}\n`,
  ),
  writeFile(`${basePath}.md`, renderMarkdown(score)),
])

console.log(renderMarkdown(score))
console.log(`Wrote ${basePath}.json and ${basePath}.md`)
