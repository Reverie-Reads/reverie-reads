import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeCorpusShadowReports } from './authority/corpus-shadow-merge.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')

const parseArgs = (argv) => {
  const options = { inputs: [], out: null }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--input') options.inputs.push(argv[++index])
    else if (value === '--out') options.out = argv[++index]
    else if (value === '--help') options.help = true
    else throw new Error(`Unknown argument ${value}`)
  }
  return options
}

const usage = `Usage: authority:corpus-shadow:merge --input BATCH.json [...] --out MERGED.json`
const assertPrivate = (path, label) => {
  const nested = relative(privateRoot, path)
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(`${label} must remain under packages/series-source-trial/private-results`)
  }
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  console.log(usage)
  process.exit(0)
}
if (!options.inputs.length || !options.out) throw new Error(usage)

const inputPaths = options.inputs.map((path) => resolve(repositoryRoot, path))
const outputPath = resolve(repositoryRoot, options.out)
for (const input of inputPaths) assertPrivate(input, 'input')
assertPrivate(outputPath, 'output')
const reports = await Promise.all(inputPaths.map((path) => readFile(path, 'utf8').then(JSON.parse)))
const merged = mergeCorpusShadowReports(reports)
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
})
console.log(
  JSON.stringify({
    purpose: merged.purpose,
    sourceFrameSha256: merged.sourceFrame.sha256,
    batches: merged.inputBatches.length,
    providers: merged.providers,
    counts: merged.candidateGraph.counts,
    output: outputPath,
  }),
)
