import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCorpusShadowCandidateGraph,
  CORPUS_SHADOW_ACQUISITION_PURPOSE,
} from './authority/corpus-shadow-graph.mjs'
import {
  corpusShadowFrameSha256,
  loadPrivateCorpusShadowFrame,
} from './authority/corpus-shadow-frame.mjs'
import { loadLocalEnvironment } from './env.mjs'
import { annotateProviderResults } from './lineage.mjs'
import { bookBrainz } from './providers/bookbrainz.mjs'
import { googleBooks } from './providers/google-books.mjs'
import { hardcover } from './providers/hardcover.mjs'
import { inventaire } from './providers/inventaire.mjs'
import { openLibrary } from './providers/openlibrary.mjs'
import { wikidata } from './providers/wikidata.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const adapters = new Map(
  [openLibrary, wikidata, inventaire, bookBrainz, googleBooks, hardcover].map((adapter) => [
    adapter.name,
    adapter,
  ]),
)

const parseArgs = (argv) => {
  const options = {
    input: null,
    providers: 'openlibrary,wikidata,inventaire,bookbrainz,hardcover',
    offset: 0,
    limit: 250,
    out: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--input') options.input = argv[++index]
    else if (value === '--providers') options.providers = argv[++index]
    else if (value === '--offset') options.offset = Number(argv[++index])
    else if (value === '--limit') options.limit = Number(argv[++index])
    else if (value === '--out') options.out = argv[++index]
    else if (value === '--help') options.help = true
    else throw new Error(`Unknown argument ${value}`)
  }
  return options
}

const usage = `Usage: authority:corpus-shadow:acquire --input PRIVATE_FRAME [options]

Options:
  --providers LIST  Fixed-host adapters (default openlibrary,wikidata,inventaire,bookbrainz,hardcover)
  --offset NUMBER   Zero-based identity offset (default 0)
  --limit NUMBER    Batch size from 1 to 250 (default 250)
  --out PATH        New output path under packages/series-source-trial/private-results
`

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  console.log(usage)
  process.exit(0)
}
if (!options.input) throw new Error(usage)
if (!Number.isInteger(options.offset) || options.offset < 0) {
  throw new Error('offset must be a non-negative integer')
}
if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 250) {
  throw new Error('limit must be an integer from 1 to 250')
}

await loadLocalEnvironment(resolve(packageRoot, '.env.local'))
const inputPath = resolve(repositoryRoot, options.input)
const frame = await loadPrivateCorpusShadowFrame(inputPath, packageRoot)
const sourceFrameSha256 = corpusShadowFrameSha256(frame)
const cases = frame.cases.slice(options.offset, options.offset + options.limit)
if (!cases.length) throw new Error('offset is beyond the frozen identity frame')

const providerNames = options.providers
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
if (!providerNames.length || new Set(providerNames).size !== providerNames.length) {
  throw new Error('providers must be a non-empty unique list')
}
for (const provider of providerNames) {
  if (!adapters.has(provider)) throw new Error(`Unknown provider ${provider}`)
}
if (providerNames.includes('hardcover') && !String(process.env.HARDCOVER_TOKEN ?? '').trim()) {
  throw new Error('HARDCOVER_TOKEN is required before starting this batch')
}

const end = options.offset + cases.length
const defaultName = `${sourceFrameSha256.slice(0, 12)}_${options.offset}-${end}_${providerNames.join('-')}.json`
const outputPath = resolve(
  repositoryRoot,
  options.out ??
    `packages/series-source-trial/private-results/corpus-series-shadow-acquisition/${defaultName}`,
)
const outputRelative = relative(privateRoot, outputPath)
if (!outputRelative || outputRelative.startsWith('..') || isAbsolute(outputRelative)) {
  throw new Error('output must remain under packages/series-source-trial/private-results')
}
try {
  await access(outputPath)
  throw new Error(`output already exists: ${outputPath}`)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const runs = []
for (const provider of providerNames) {
  const adapter = adapters.get(provider)
  const startedAt = new Date().toISOString()
  console.log(`Starting ${provider} for ${cases.length} frozen identities.`)
  const results = annotateProviderResults(
    provider,
    await adapter.run(cases, (message) => console.log(message)),
  )
  runs.push({
    schemaVersion: 1,
    provider,
    observedAt: startedAt,
    completedAt: new Date().toISOString(),
    rights: adapter.rights,
    results,
  })
}

const candidateGraph = buildCorpusShadowCandidateGraph(cases, runs)
const report = {
  schemaVersion: 1,
  purpose: CORPUS_SHADOW_ACQUISITION_PURPOSE,
  sourceFrame: {
    project: frame.project,
    sha256: sourceFrameSha256,
    totalWorks: frame.counts.total,
    offset: options.offset,
    end,
  },
  caseSet: {
    schemaVersion: 1,
    purpose: frame.purpose,
    cases,
  },
  providers: providerNames,
  runs,
  candidateGraph,
}

await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
})
console.log(
  JSON.stringify({
    purpose: report.purpose,
    sourceFrameSha256,
    offset: options.offset,
    end,
    providers: providerNames,
    counts: candidateGraph.counts,
    output: outputPath,
  }),
)
