import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import qualificationPlan from '../data/authority-qualification-plan.json' with { type: 'json' }
import { loadTrialCases } from './cases.mjs'
import {
  auditQualificationLock,
  buildQualificationSystemManifest,
  createQualificationLock,
  qualificationDataset,
  selectQualificationCases,
} from './authority/qualification.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')

const parseArgs = (argv) => {
  const options = { input: null, setOut: null, lockOut: null, reportOut: null }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--input') options.input = argv[++index]
    else if (value === '--set-out') options.setOut = argv[++index]
    else if (value === '--lock-out') options.lockOut = argv[++index]
    else if (value === '--report-out') options.reportOut = argv[++index]
    else throw new Error(`Unknown argument ${value}`)
  }
  if (!options.input) throw new Error('Qualification freeze requires --input <reviewed-pool.json>')
  return options
}

const renderMarkdown = (lock, poolCount) =>
  `${[
    '# Reverie authority qualification lock',
    '',
    `Status: ${lock.status}.`,
    `Qualification id: ${lock.id}.`,
    `Reviewed candidate pool: ${poolCount}; locked cases: ${lock.dataset.cases}.`,
    `Class mix: ${lock.dataset.series} series-positive; ${lock.dataset.standalone} affirmative standalone.`,
    `Dataset SHA-256: ${lock.dataset.sha256}.`,
    `System SHA-256: ${lock.system.sha256}.`,
    `Lock SHA-256: ${lock.sha256}.`,
    '',
    'The case identities, truth labels, and authority citations remain in the private set file. Normal development commands do not load that file. The lock can be used only when the current acquisition system and runtime settings reproduce the frozen hashes.',
    '',
    `Failure policy: ${lock.runPolicy.failedQualificationDisposition}.`,
  ].join('\n')}\n`

const options = parseArgs(process.argv.slice(2))
const inputPath = resolve(repositoryRoot, options.input)
const setPath = resolve(
  repositoryRoot,
  options.setOut ??
    `packages/series-source-trial/private-results/authority-qualification/${qualificationPlan.id}.set.json`,
)
const lockPath = resolve(
  repositoryRoot,
  options.lockOut ?? 'packages/series-source-trial/data/authority-qualification-lock.json',
)
const reportPath = resolve(
  repositoryRoot,
  options.reportOut ??
    'packages/series-source-trial/reports/authority-qualification-lock-2026-09-07.md',
)
const privateSetRoot = resolve(packageRoot, 'private-results/authority-qualification')
const relativeInputPath = relative(privateSetRoot, inputPath)
const relativeSetPath = relative(privateSetRoot, setPath)
if (!relativeInputPath || relativeInputPath.startsWith('..') || isAbsolute(relativeInputPath)) {
  throw new Error('Qualification candidate pool must remain under private-results')
}
if (!relativeSetPath || relativeSetPath.startsWith('..') || isAbsolute(relativeSetPath)) {
  throw new Error('Qualification identities and truth must remain under private-results')
}

const [pool, development] = await Promise.all([
  readFile(inputPath, 'utf8').then(JSON.parse),
  loadTrialCases(),
])
const selected = selectQualificationCases(pool, qualificationPlan, {
  developmentCases: development.cases,
})
const dataset = qualificationDataset(pool, qualificationPlan, selected)
const systemManifest = await buildQualificationSystemManifest(
  packageRoot,
  qualificationPlan.frozenSystem,
)
const lock = createQualificationLock({
  plan: qualificationPlan,
  dataset,
  systemManifest,
  datasetFile: relative(repositoryRoot, setPath),
})
const audit = auditQualificationLock({
  lock,
  dataset,
  plan: qualificationPlan,
  systemManifest,
  developmentCases: development.cases,
})
if (!audit.valid) throw new Error(`Invalid qualification lock: ${audit.errors.join('; ')}`)

await Promise.all([
  mkdir(dirname(setPath), { recursive: true }),
  mkdir(dirname(lockPath), { recursive: true }),
  mkdir(dirname(reportPath), { recursive: true }),
])
await Promise.all([
  writeFile(setPath, `${JSON.stringify(dataset, null, 2)}\n`, { flag: 'wx', mode: 0o600 }),
  writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx' }),
  writeFile(reportPath, renderMarkdown(lock, pool.cases.length), { flag: 'wx' }),
])

console.log(renderMarkdown(lock, pool.cases.length))
console.log(`Wrote ${setPath}, ${lockPath}, and ${reportPath}`)
