import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import qualificationPlan from '../data/authority-qualification-plan.json' with { type: 'json' }
import { auditQualificationPool } from './authority/qualification.mjs'
import { loadTrialCases } from './cases.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results/authority-qualification')

export function parseQualificationMergeArgs(argv) {
  const options = { inputs: [], out: null, requireMinimum: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--input') options.inputs.push(argv[++index])
    else if (value === '--out') options.out = argv[++index]
    else if (value === '--require-minimum') options.requireMinimum = true
    else throw new Error(`Unknown argument ${value}`)
  }
  if (!options.inputs.length) throw new Error('Qualification merge requires at least one --input')
  if (!options.out) throw new Error('Qualification merge requires --out')
  return options
}

const assertPrivatePath = (path, label) => {
  const nested = relative(privateRoot, path)
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(`${label} must remain under private-results/authority-qualification`)
  }
}

export function mergeQualificationFrames(frames) {
  return {
    schemaVersion: 1,
    sharedSources: Object.assign({}, ...frames.map(({ sharedSources }) => sharedSources ?? {})),
    selectionFrames: frames.flatMap(({ selectionFrames }) => selectionFrames ?? []),
    cases: frames.flatMap(({ cases }) => cases ?? []),
  }
}

export async function runQualificationMerge(argv = process.argv.slice(2)) {
  const options = parseQualificationMergeArgs(argv)
  const inputPaths = options.inputs.map((path) => resolve(repositoryRoot, path))
  const outputPath = resolve(repositoryRoot, options.out)
  for (const inputPath of inputPaths) assertPrivatePath(inputPath, 'Qualification merge input')
  assertPrivatePath(outputPath, 'Qualification merge output')

  const [frames, development] = await Promise.all([
    Promise.all(inputPaths.map((path) => readFile(path, 'utf8').then(JSON.parse))),
    loadTrialCases(),
  ])
  const pool = mergeQualificationFrames(frames)
  const audit = auditQualificationPool(pool, qualificationPlan, {
    developmentCases: development.cases,
    requirePoolMinimum: options.requireMinimum,
    requireFrameReconciliation: true,
  })
  if (!audit.valid) {
    throw new Error(`Qualification review pool is not ready: ${audit.errors.join('; ')}`)
  }
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(pool, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  console.log(
    `Merged ${frames.length} reviewed frames into ${audit.counts.cases} private cases (${audit.counts.series} series, ${audit.counts.standalone} standalone).`,
  )
  console.log(`Pool: ${outputPath}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runQualificationMerge()
}
