import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTrialCases } from './cases.mjs'
import { loadLocalEnvironment } from './env.mjs'
import { buildAuthorityTarget } from './authority/evidence.mjs'
import { EXA_AUTHORITY_LOCATOR_VERSION, runExaAuthorityLocator } from './authority/exa-locator.mjs'
import {
  auditAuthorityLocatorBenchmark,
  authorityLocatorDryRun,
  renderAuthorityLocatorMarkdown,
  scoreAuthorityLocator,
} from './authority/locator-benchmark.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const defaultBenchmark = 'packages/series-source-trial/data/authority-locator-development.json'

const parseArgs = (argv) => {
  const options = { benchmark: defaultBenchmark, baseline: null, out: null, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--benchmark') options.benchmark = argv[++index]
    else if (value === '--baseline') options.baseline = argv[++index]
    else if (value === '--out') options.out = argv[++index]
    else if (value === '--dry-run') options.dryRun = true
    else throw new Error(`Unknown argument ${value}`)
  }
  if (!options.benchmark) throw new Error('Authority locator benchmark path is required')
  if (options.dryRun && options.baseline) {
    throw new Error('Authority locator --dry-run cannot be combined with --baseline')
  }
  return options
}

const resolveRepositoryPath = (path) => resolve(repositoryRoot, path)

await loadLocalEnvironment(resolve(packageRoot, '.env.local'))
const options = parseArgs(process.argv.slice(2))
const [caseSet, benchmark, authorityGoldText] = await Promise.all([
  loadTrialCases(),
  readFile(resolveRepositoryPath(options.benchmark), 'utf8').then(JSON.parse),
  readFile(resolve(packageRoot, 'data/authority-gold.json'), 'utf8'),
])
const audit = auditAuthorityLocatorBenchmark(caseSet, benchmark, { authorityGoldText })
if (!audit.valid) throw new Error(`Invalid authority locator benchmark: ${audit.errors.join('; ')}`)

if (options.dryRun) {
  console.log(`${JSON.stringify(authorityLocatorDryRun(audit), null, 2)}\n`)
  process.exit(0)
}

const apiKey = process.env.EXA_API_KEY?.trim()
if (!apiKey) {
  throw new Error('EXA_API_KEY is required in packages/series-source-trial/.env.local')
}

const casesById = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))
const results = []
for (const [index, selected] of benchmark.cases.entries()) {
  const target = buildAuthorityTarget(casesById.get(selected.id))
  const result = await runExaAuthorityLocator(target, { apiKey })
  results.push(result)
  console.error(`Exa locator ${index + 1}/${benchmark.cases.length}: ${result.status}`)
}

const baselineRun = options.baseline
  ? JSON.parse(await readFile(resolveRepositoryPath(options.baseline), 'utf8'))
  : null
const score = scoreAuthorityLocator(
  caseSet,
  benchmark,
  {
    locatorVersion: EXA_AUTHORITY_LOCATOR_VERSION,
    results,
  },
  { authorityGoldText, baselineRun },
)
if (!score.valid) throw new Error(`Invalid authority locator run: ${score.errors.join('; ')}`)

const report = { ...score, generatedAt: new Date().toISOString() }
const markdown = renderAuthorityLocatorMarkdown(report)
if (options.out) {
  const outputPath = resolveRepositoryPath(options.out)
  const extension = extname(outputPath).toLowerCase()
  if (!['.json', '.md'].includes(extension)) {
    throw new Error('Authority locator output must end in .json or .md')
  }
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    extension === '.json' ? `${JSON.stringify(report, null, 2)}\n` : markdown,
  )
}
console.log(markdown)
