import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTrialCases } from './cases.mjs'
import {
  renderAuthorityDiscoveryMarkdown,
  scoreAuthorityDiscovery,
} from './authority/discovery-benchmark.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const [runPath, outputPath] = process.argv.slice(2).filter((value) => value !== '--')

if (!runPath) {
  throw new Error('Usage: authority:discovery:score <acquisition-run.json> [output.md]')
}

const [caseSet, benchmark, authorityGoldText, run] = await Promise.all([
  loadTrialCases(),
  readFile(resolve(packageRoot, 'data/authority-discovery-holdout.json'), 'utf8').then(JSON.parse),
  readFile(resolve(packageRoot, 'data/authority-gold.json'), 'utf8'),
  readFile(resolve(repositoryRoot, runPath), 'utf8').then(JSON.parse),
])

const score = scoreAuthorityDiscovery(caseSet, benchmark, run, { authorityGoldText })
const report = renderAuthorityDiscoveryMarkdown(score)
if (outputPath) await writeFile(resolve(repositoryRoot, outputPath), report)
console.log(report)
if (!score.valid) process.exitCode = 1
