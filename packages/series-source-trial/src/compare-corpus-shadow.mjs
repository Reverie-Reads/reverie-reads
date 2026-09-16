import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCorpusShadowHistoricalComparison } from './authority/corpus-shadow-history.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const options = { reconciliation: '', historical: '', out: '', dryRun: false }
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 1) {
  const value = argv[index]
  if (value === '--') continue
  if (value === '--reconciliation') options.reconciliation = argv[++index] ?? ''
  else if (value === '--historical') options.historical = argv[++index] ?? ''
  else if (value === '--out') options.out = argv[++index] ?? ''
  else if (value === '--dry-run') options.dryRun = true
  else throw new Error(`Unknown argument ${value}`)
}
if (!options.reconciliation || !options.historical || !options.out) {
  throw new Error(
    'Required: --reconciliation PRIVATE.json --historical PRIVATE.json --out PRIVATE.json',
  )
}
const paths = Object.fromEntries(
  ['reconciliation', 'historical', 'out'].map((name) => [
    name,
    resolve(repositoryRoot, options[name]),
  ]),
)
for (const [name, path] of Object.entries(paths)) {
  const nested = relative(privateRoot, path)
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(`${name} must remain under packages/series-source-trial/private-results`)
  }
}
const [reconciliationText, historicalText] = await Promise.all([
  readFile(paths.reconciliation, 'utf8'),
  readFile(paths.historical, 'utf8'),
])
const report = buildCorpusShadowHistoricalComparison({
  reconciliation: JSON.parse(reconciliationText),
  reconciliationSha256: sha256(reconciliationText),
  historical: JSON.parse(historicalText),
  historicalSha256: sha256(historicalText),
})
if (!options.dryRun) {
  await mkdir(dirname(paths.out), { recursive: true, mode: 0o700 })
  await writeFile(paths.out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}
console.log(
  JSON.stringify({
    purpose: report.purpose,
    counts: report.counts,
    output: options.dryRun ? null : paths.out,
    dryRun: options.dryRun,
  }),
)
