import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mergeCorpusShadowHistoricalReports } from './authority/corpus-shadow-historical-merge.mjs'
import { loadPrivateCorpusShadowReviewManifest } from './authority/corpus-shadow-review-manifest.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const options = { manifest: '', inputs: [], out: '' }

const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 1) {
  const value = argv[index]
  if (value === '--') continue
  if (value === '--manifest') options.manifest = argv[++index] ?? ''
  else if (value === '--input') options.inputs.push(argv[++index] ?? '')
  else if (value === '--out') options.out = argv[++index] ?? ''
  else throw new Error(`Unknown argument ${value}`)
}
if (!options.manifest || !options.inputs.length || !options.out) {
  throw new Error('Required: --manifest PRIVATE.json --input RANGE.json [...] --out PRIVATE.json')
}

const assertPrivate = (input, label) => {
  const absolute = resolve(repositoryRoot, input)
  const nested = relative(privateRoot, absolute)
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(`${label} must remain under packages/series-source-trial/private-results`)
  }
  return absolute
}
const manifestPath = assertPrivate(options.manifest, 'manifest')
const inputPaths = options.inputs.map((input) => assertPrivate(input, 'input'))
const outputPath = assertPrivate(options.out, 'output')
const manifest = await loadPrivateCorpusShadowReviewManifest(manifestPath, packageRoot)
const reports = await Promise.all(
  inputPaths.map(async (path) => {
    const text = await readFile(path, 'utf8')
    return { report: JSON.parse(text), sha256: sha256(text) }
  }),
)
const merged = mergeCorpusShadowHistoricalReports({ manifest, reports })
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ purpose: merged.purpose, counts: merged.counts, output: outputPath }))
