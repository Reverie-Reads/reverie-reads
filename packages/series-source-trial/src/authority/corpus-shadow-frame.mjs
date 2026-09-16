import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

export const CORPUS_SHADOW_PURPOSE = 'corpus-series-shadow-rebuild'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROJECT_RE = /^[a-z0-9]{20}$/
const MD5_RE = /^[a-f0-9]{32}$/
const FORBIDDEN_CASE_KEYS = new Set([
  'candidateSeries',
  'currentSeries',
  'evidence',
  'memberships',
  'position',
  'proposedSeries',
  'series',
  'seriesCheckState',
  'seriesCount',
  'sourceUrl',
  'truth',
])

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const fail = (message) => {
  throw new Error(`Invalid corpus shadow frame: ${message}`)
}

export function validateCorpusShadowFrame(frame) {
  if (!isObject(frame)) fail('expected an object')
  if (frame.schemaVersion !== 1) fail('schemaVersion must be 1')
  if (frame.purpose !== CORPUS_SHADOW_PURPOSE) fail('purpose is not permitted')
  if (!PROJECT_RE.test(frame.project ?? '')) fail('project is invalid')
  if (!Number.isFinite(Date.parse(frame.frozenAt ?? ''))) fail('frozenAt is invalid')
  if (!Array.isArray(frame.cases) || frame.cases.length < 1 || frame.cases.length > 10_000) {
    fail('cases must contain 1 to 10000 works')
  }

  const seen = new Set()
  for (const item of frame.cases) {
    if (!isObject(item)) fail('every case must be an object')
    for (const key of Object.keys(item)) {
      if (FORBIDDEN_CASE_KEYS.has(key)) fail(`case ${item.id ?? '(unknown)'} contains ${key}`)
    }
    if (!UUID_RE.test(item.id ?? '')) fail('case id is invalid')
    if (seen.has(item.id)) fail(`duplicate case ${item.id}`)
    seen.add(item.id)
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500) {
      fail(`case ${item.id} has an invalid title`)
    }
    if (
      !Array.isArray(item.authors) ||
      item.authors.length < 1 ||
      item.authors.length > 20 ||
      item.authors.some(
        (author) => typeof author !== 'string' || !author.trim() || author.length > 300,
      ) ||
      new Set(item.authors.map((author) => author.trim())).size !== item.authors.length
    ) {
      fail(`case ${item.id} has invalid full authors`)
    }
    if (
      item.publicationYear !== null &&
      (!Number.isInteger(item.publicationYear) ||
        item.publicationYear < 1 ||
        item.publicationYear > 2100)
    ) {
      fail(`case ${item.id} has an invalid publication year`)
    }
    if (!MD5_RE.test(item.identityFingerprint ?? '')) {
      fail(`case ${item.id} has an invalid identity fingerprint`)
    }
  }

  if (!isObject(frame.counts) || frame.counts.total !== frame.cases.length) {
    fail('total count does not reconcile')
  }
  return frame
}

export async function loadPrivateCorpusShadowFrame(inputPath, packageRoot) {
  const privateRoot = resolve(packageRoot, 'private-results')
  const absolute = resolve(inputPath)
  const rel = relative(privateRoot, absolute)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Corpus shadow input must remain under private-results')
  }
  return validateCorpusShadowFrame(JSON.parse(await readFile(absolute, 'utf8')))
}

export const corpusShadowFrameSha256 = (frame) =>
  createHash('sha256').update(JSON.stringify(frame)).digest('hex')
