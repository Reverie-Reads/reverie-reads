import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildCorpusShadowSuggestionPacket,
  validateCorpusShadowSuggestionPacket,
} from './authority/corpus-shadow-suggestion-packet.mjs'
import { loadPrivateCorpusShadowReviewManifest } from './authority/corpus-shadow-review-manifest.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const options = { manifest: '', historical: '', out: '' }
for (let index = 0; index < process.argv.slice(2).length; index += 1) {
  const argv = process.argv.slice(2)
  const value = argv[index]
  if (value === '--') continue
  if (value === '--manifest') options.manifest = argv[++index] ?? ''
  else if (value === '--historical') options.historical = argv[++index] ?? ''
  else if (value === '--out') options.out = argv[++index] ?? ''
  else throw new Error(`Unknown argument ${value}`)
}
if (!options.manifest || !options.historical || !options.out) {
  throw new Error('Required: --manifest PRIVATE.json --historical PRIVATE.json --out PRIVATE.json')
}
const privatePath = (input, label) => {
  const absolute = resolve(repositoryRoot, input)
  const nested = relative(privateRoot, absolute)
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(`${label} must remain under packages/series-source-trial/private-results`)
  }
  return absolute
}
const manifestPath = privatePath(options.manifest, 'manifest')
const historicalPath = privatePath(options.historical, 'historical snapshot')
const outputPath = privatePath(options.out, 'output')
const manifest = await loadPrivateCorpusShadowReviewManifest(manifestPath, packageRoot)
const historicalText = await readFile(historicalPath, 'utf8')
const packet = validateCorpusShadowSuggestionPacket(
  buildCorpusShadowSuggestionPacket({
    manifest,
    historical: JSON.parse(historicalText),
    historicalSha256: createHash('sha256').update(historicalText).digest('hex'),
  }),
)
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ output: outputPath, counts: packet.counts }))
