import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildCorpusShadowReviewManifest,
  validateCorpusShadowReviewManifest,
} from './authority/corpus-shadow-review-manifest.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const options = { comparison: '', reconciliation: '', out: '', dryRun: false }

const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 1) {
  const value = argv[index]
  if (value === '--') continue
  if (value === '--comparison') options.comparison = argv[++index] ?? ''
  else if (value === '--reconciliation') options.reconciliation = argv[++index] ?? ''
  else if (value === '--out') options.out = argv[++index] ?? ''
  else if (value === '--dry-run') options.dryRun = true
  else throw new Error(`Unknown argument ${value}`)
}
if (!options.comparison || !options.reconciliation || !options.out) {
  throw new Error(
    'Required: --comparison PRIVATE.json --reconciliation PRIVATE.json --out PRIVATE.json',
  )
}

const paths = Object.fromEntries(
  ['comparison', 'reconciliation', 'out'].map((name) => [
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

const [comparisonText, reconciliationText] = await Promise.all([
  readFile(paths.comparison, 'utf8'),
  readFile(paths.reconciliation, 'utf8'),
])
const manifest = validateCorpusShadowReviewManifest(
  buildCorpusShadowReviewManifest({
    comparison: JSON.parse(comparisonText),
    comparisonSha256: sha256(comparisonText),
    reconciliation: JSON.parse(reconciliationText),
    reconciliationSha256: sha256(reconciliationText),
  }),
)

if (!options.dryRun) {
  await mkdir(dirname(paths.out), { recursive: true, mode: 0o700 })
  await writeFile(paths.out, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}
console.log(
  JSON.stringify({
    purpose: manifest.purpose,
    manifestSha256: manifest.manifestSha256,
    counts: manifest.counts,
    output: options.dryRun ? null : paths.out,
    dryRun: options.dryRun,
  }),
)
