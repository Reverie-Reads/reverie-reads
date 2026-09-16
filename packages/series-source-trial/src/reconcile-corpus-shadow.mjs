import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCorpusShadowReconciliation } from './authority/corpus-shadow-reconcile.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const options = { graph: null, review: null, exa: null, out: null, dryRun: false }
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 1) {
  const value = argv[index]
  if (value === '--') continue
  if (value === '--graph') options.graph = argv[++index]
  else if (value === '--review') options.review = argv[++index]
  else if (value === '--exa') options.exa = argv[++index]
  else if (value === '--out') options.out = argv[++index]
  else if (value === '--dry-run') options.dryRun = true
  else if (value === '--help') options.help = true
  else throw new Error(`Unknown argument ${value}`)
}

const usage =
  'Usage: authority:corpus-shadow:reconcile --graph GRAPH.json --review REVIEW.json --exa EXA.json --out RESULT.json [--dry-run]'
if (options.help) {
  console.log(usage)
  process.exit(0)
}
if (!options.graph || !options.review || !options.exa || !options.out) throw new Error(usage)

const assertPrivate = (path, label) => {
  const nested = relative(privateRoot, path)
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(`${label} must remain under packages/series-source-trial/private-results`)
  }
}
const paths = Object.fromEntries(
  ['graph', 'review', 'exa', 'out'].map((name) => [name, resolve(repositoryRoot, options[name])]),
)
for (const name of ['graph', 'review', 'exa', 'out']) assertPrivate(paths[name], name)

const [graphText, reviewText, exaText] = await Promise.all(
  [paths.graph, paths.review, paths.exa].map((path) => readFile(path, 'utf8')),
)
const report = buildCorpusShadowReconciliation({
  graph: JSON.parse(graphText),
  graphSha256: sha256(graphText),
  review: JSON.parse(reviewText),
  reviewSha256: sha256(reviewText),
  exa: JSON.parse(exaText),
  exaSha256: sha256(exaText),
})

if (!options.dryRun) {
  await mkdir(dirname(paths.out), { recursive: true, mode: 0o700 })
  await writeFile(paths.out, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })
}
console.log(
  JSON.stringify({
    purpose: report.purpose,
    sourceFrameSha256: report.sourceFrame.sha256,
    counts: report.counts,
    output: options.dryRun ? null : paths.out,
    dryRun: options.dryRun,
  }),
)
