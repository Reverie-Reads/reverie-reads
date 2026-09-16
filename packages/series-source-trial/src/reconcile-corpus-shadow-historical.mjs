import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { reconcileCorpusShadowHistoricalAuthority } from './authority/corpus-shadow-historical-reconcile.mjs'
import { loadPrivateCorpusShadowReviewManifest } from './authority/corpus-shadow-review-manifest.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const options = { manifest: '', reconciliation: '', historicalAuthority: '', out: '' }
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 1) {
  const value = argv[index]
  if (value === '--') continue
  if (value === '--manifest') options.manifest = argv[++index] ?? ''
  else if (value === '--reconciliation') options.reconciliation = argv[++index] ?? ''
  else if (value === '--historical-authority') options.historicalAuthority = argv[++index] ?? ''
  else if (value === '--out') options.out = argv[++index] ?? ''
  else throw new Error(`Unknown argument ${value}`)
}
if (!options.manifest || !options.reconciliation || !options.historicalAuthority || !options.out) {
  throw new Error(
    'Required: --manifest PRIVATE.json --reconciliation PRIVATE.json --historical-authority PRIVATE.json --out PRIVATE.json',
  )
}
const privatePath = (input, label) => {
  const absolute = resolve(repositoryRoot, input)
  const nested = relative(privateRoot, absolute)
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(`${label} must remain under packages/series-source-trial/private-results`)
  }
  return absolute
}
const manifest = await loadPrivateCorpusShadowReviewManifest(
  privatePath(options.manifest, 'manifest'),
  packageRoot,
)
const reconciliationPath = privatePath(options.reconciliation, 'reconciliation')
const historicalAuthorityPath = privatePath(options.historicalAuthority, 'historical authority')
const outputPath = privatePath(options.out, 'output')
const [reconciliationText, historicalAuthorityText] = await Promise.all([
  readFile(reconciliationPath, 'utf8'),
  readFile(historicalAuthorityPath, 'utf8'),
])
const reconciled = reconcileCorpusShadowHistoricalAuthority({
  manifest,
  reconciliation: JSON.parse(reconciliationText),
  reconciliationSha256: sha256(reconciliationText),
  historicalAuthority: JSON.parse(historicalAuthorityText),
  historicalAuthoritySha256: sha256(historicalAuthorityText),
})
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(reconciled, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ output: outputPath, counts: reconciled.counts }))
