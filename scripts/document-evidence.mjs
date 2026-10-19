import { constants } from 'node:fs'
import { open, mkdir, writeFile, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseDocumentEvidence, parseDocumentTsv } from '../packages/core/src/documentEvidence.ts'
import { startDocumentEvidenceReview } from './document-evidence-review.mjs'
import {
  buildDocumentEvidenceHandoff,
  documentEvidenceFingerprint,
} from './document-evidence-handoff.mjs'
import { documentPng } from './document-evidence-image.mjs'
export { documentPng } from './document-evidence-image.mjs'

const exec = promisify(execFile)
export const documentHash = (value) => createHash('sha256').update(value).digest('hex')
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((k) => Object.hasOwn(value, k))
const checked = (value) => {
  const packet = parseDocumentEvidence(value)
  if (!packet) throw new Error('Invalid document evidence or stale correction chain')
  return packet
}
export async function readDocumentFile(path, limit = 8_000_000) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > limit) throw new Error('Invalid or oversized document input')
    const bytes = await handle.readFile()
    if (bytes.length > limit) throw new Error('Document input grew beyond limit')
    return bytes
  } finally {
    await handle.close()
  }
}
export async function readDocumentJson(path) {
  const bytes = await readDocumentFile(path)
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('Invalid document JSON; private input text was not logged')
  }
}
export async function readDocumentPacket(path) {
  const value = await readDocumentJson(path)
  if (exact(value, ['version', 'parentFingerprint', 'fingerprint', 'packet'])) {
    const packet = checked(value.packet),
      parent = structuredClone(packet)
    const lastCorrection = parent.corrections.pop()
    if (
      value.version !== 1 ||
      !lastCorrection ||
      value.parentFingerprint !== documentEvidenceFingerprint(parent) ||
      value.fingerprint !== documentEvidenceFingerprint(packet)
    )
      throw new Error('Corrupt document revision receipt')
    return packet
  }
  return checked(value)
}
/** The operator names local files explicitly. Source URLs are references, never fetched. */
export function validateDocumentManifest(manifest) {
  if (
    !exact(manifest, ['version', 'targetFingerprint', 'source', 'pages']) ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.pages) ||
    !manifest.pages.length ||
    manifest.pages.length > 8
  )
    throw new Error('Invalid document manifest')
  for (const p of manifest.pages) {
    if (
      !exact(p, ['id', 'label', 'image', 'ocr']) ||
      typeof p.image !== 'string' ||
      !p.image ||
      p.image.length > 2000 ||
      !p.ocr ||
      !(
        (exact(p.ocr, ['kind', 'path']) &&
          p.ocr.kind === 'tesseract_tsv' &&
          typeof p.ocr.path === 'string' &&
          p.ocr.path.length > 0 &&
          p.ocr.path.length <= 2000) ||
        (exact(p.ocr, ['kind']) && p.ocr.kind === 'apple_vision') ||
        (exact(p.ocr, ['kind', 'lines']) &&
          p.ocr.kind === 'manual_transcription' &&
          Array.isArray(p.ocr.lines))
      )
    )
      throw new Error('Invalid document page input')
  }
  // Validate all source permissions before reading any document or invoking OCR.
  checked({
    version: 1,
    mode: 'review_only',
    targetFingerprint: manifest.targetFingerprint,
    source: manifest.source,
    pages: manifest.pages.map((p) => ({
      id: p.id,
      label: p.label,
      imageSha256: '0'.repeat(64),
      width: 1,
      height: 1,
      method: 'ocr_sidecar',
      status: 'failed',
      lines: [],
    })),
    corrections: [],
  })
  if (!manifest.source.permissions.localReview)
    throw new Error('Local document review permission is required')
  return structuredClone(manifest)
}
export async function loadDocumentImages(manifest, manifestPath) {
  validateDocumentManifest(manifest)
  const images = new Map()
  for (const p of manifest.pages)
    images.set(p.id, documentPng(await readDocumentFile(resolve(dirname(manifestPath), p.image))))
  return images
}
export async function privateDocumentDirectory(path) {
  // Never replace an earlier acquisition or review receipt.
  await mkdir(path, { mode: 0o700 })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw new Error('Review directory must be private')
  // Document images and literal source text must never become tracked repository artifacts.
  try {
    await exec('git', ['-C', path, 'rev-parse', '--show-toplevel'], { timeout: 5000 })
  } catch (error) {
    if (error.code === 128) return
    throw new Error('Could not verify a private output location')
  }
  throw new Error('Document evidence output must be outside Git checkouts')
}
export async function writeDocumentJson(path, data) {
  const text = JSON.stringify(data, null, 2) + '\n'
  if (Buffer.byteLength(text) > 8_000_000)
    throw new Error('Document receipt exceeds the 8 MB local file limit')
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await handle.writeFile(text)
    await handle.sync()
  } finally {
    await handle.close()
  }
}
export async function prepareDocumentEvidence(manifest, manifestPath, output, prior = null) {
  manifest = validateDocumentManifest(manifest)
  await privateDocumentDirectory(output)
  const images = await loadDocumentImages(manifest, manifestPath),
    pages = [],
    acquisition = []
  for (const p of manifest.pages) {
    const image = images.get(p.id)
    const imagePath = resolve(output, `${p.id}.png`)
    await writeFile(imagePath, image.bytes, { mode: 0o600, flag: 'wx' })
    let result, receipt
    if (p.ocr.kind === 'tesseract_tsv') {
      const bytes = await readDocumentFile(resolve(dirname(manifestPath), p.ocr.path), 4_000_000)
      result = parseDocumentTsv(bytes.toString('utf8'), image.width, image.height)
      receipt = { engine: 'tesseract_tsv', inputSha256: documentHash(bytes) }
      await writeFile(resolve(output, `${p.id}.source.tsv`), bytes, { mode: 0o600, flag: 'wx' })
    } else if (p.ocr.kind === 'manual_transcription') {
      result = {
        status: p.ocr.lines.length ? 'complete' : 'failed',
        lines: p.ocr.lines,
        errors: p.ocr.lines.length ? [] : ['No transcription supplied'],
      }
      receipt = {
        engine: 'manual_transcription',
        inputSha256: documentHash(JSON.stringify(p.ocr.lines)),
      }
    } else {
      try {
        if (process.platform !== 'darwin') throw new Error('Apple Vision requires macOS')
        const { stdout } = await exec(
          '/usr/bin/swift',
          [fileURLToPath(new URL('./document-evidence-vision.swift', import.meta.url)), imagePath],
          { timeout: 60000, maxBuffer: 4_000_000 },
        )
        await writeFile(resolve(output, `${p.id}.vision.json`), stdout, { mode: 0o600, flag: 'wx' })
        const ocr = JSON.parse(stdout)
        result = {
          status: ocr.lines.length ? 'complete' : 'failed',
          lines: ocr.lines,
          errors: ocr.lines.length
            ? []
            : ['OCR returned no text; absence is not proof of an empty page'],
        }
        receipt = { ...ocr, lines: undefined, outputSha256: documentHash(stdout) }
      } catch {
        result = {
          status: 'failed',
          lines: [],
          errors: [
            'Local OCR unavailable or failed; supply a checked OCR sidecar or transcription',
          ],
        }
        receipt = { engine: 'apple_vision', status: 'failed' }
      }
    }
    pages.push({
      id: p.id,
      label: p.label,
      imageSha256: image.sha256,
      width: image.width,
      height: image.height,
      method: p.ocr.kind === 'manual_transcription' ? 'manual_transcription' : 'ocr_sidecar',
      ...result,
    })
    acquisition.push({ pageId: p.id, imageSha256: image.sha256, ...receipt })
  }
  const packet = checked({
    version: 1,
    mode: 'review_only',
    targetFingerprint: manifest.targetFingerprint,
    source: manifest.source,
    pages,
    corrections: prior ? checked(prior).corrections : [],
  })
  if (
    prior &&
    (prior.targetFingerprint !== packet.targetFingerprint ||
      JSON.stringify(prior.source) !== JSON.stringify(packet.source) ||
      JSON.stringify(prior.pages) !== JSON.stringify(packet.pages))
  )
    throw new Error(
      'Source, image or transcription changed; prior corrections need a separate review',
    )
  await writeDocumentJson(resolve(output, 'packet.json'), packet)
  await writeDocumentJson(resolve(output, 'manifest.json'), {
    ...manifest,
    pages: manifest.pages.map((p) => ({
      ...p,
      image: `${p.id}.png`,
      ocr:
        p.ocr.kind === 'tesseract_tsv'
          ? { kind: 'tesseract_tsv', path: `${p.id}.source.tsv` }
          : p.ocr,
    })),
  })
  await writeDocumentJson(resolve(output, 'acquisition.json'), {
    version: 1,
    mode: 'review_only',
    packetSha256: documentEvidenceFingerprint(packet),
    parentPacketSha256: prior ? documentEvidenceFingerprint(prior) : null,
    acquiredAt: new Date().toISOString(),
    pages: acquisition,
    paidModelCalls: 0,
  })
  return { packet, images }
}
export async function main(args) {
  if (!args.length || (args.length === 1 && ['--help', 'help'].includes(args[0]))) {
    console.log(
      'Usage: pnpm intake:document prepare <manifest.json> <new-dir> [prior-packet-or-revision.json] | review <manifest.json> <packet-or-revision.json> <new-review-dir> | handoff <packet-or-revision.json> <selection.json> <context.json> <new-dir>\nLocal PNG pages only; 8 pages, 8 MB/image, 16 million pixels/page, 12,000 px/axis, 4 MB TSV, 6,000 total lines/corrections and 2,000,000 text code units. Output must be a new private directory outside Git. Apple Vision is optional, local, macOS-only and English-only; otherwise supply Tesseract TSV or explicit line transcription. No source URL fetch, paid model request, catalog write or intake switch. Unsupported evidence stays under review.',
    )
    return
  }
  const [command, ...paths] = args
  if (command === 'prepare' && (paths.length === 2 || paths.length === 3)) {
    const [manifestPath, output, priorPath] = paths
    const { packet } = await prepareDocumentEvidence(
      await readDocumentJson(manifestPath),
      resolve(manifestPath),
      resolve(output),
      priorPath ? await readDocumentPacket(priorPath) : null,
    )
    console.log(
      JSON.stringify({
        packet: resolve(output, 'packet.json'),
        statuses: packet.pages.map((p) => ({ pageId: p.id, status: p.status })),
        paidModelCalls: 0,
      }),
    )
  } else if (command === 'review' && paths.length === 3) {
    const [manifestPath, packetPath, output] = paths,
      manifest = validateDocumentManifest(await readDocumentJson(manifestPath))
    const packet = await readDocumentPacket(packetPath),
      images = await loadDocumentImages(manifest, resolve(manifestPath))
    if (
      packet.targetFingerprint !== manifest.targetFingerprint ||
      JSON.stringify(packet.source) !== JSON.stringify(manifest.source) ||
      packet.pages.length !== images.size ||
      packet.pages.some((p) => !images.has(p.id))
    )
      throw new Error('Manifest does not match frozen packet')
    await privateDocumentDirectory(output)
    let sequence = 0
    const viewer = await startDocumentEvidenceReview(packet, images, {
      saveRevision: async (next, parentFingerprint) => {
        const fingerprint = documentEvidenceFingerprint(next)
        await writeDocumentJson(
          resolve(output, `revision-${String(++sequence).padStart(4, '0')}-${fingerprint}.json`),
          { version: 1, parentFingerprint, fingerprint, packet: next },
        )
      },
    })
    console.log(viewer.url)
    const stop = () => viewer.close()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    await viewer.closed
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  } else if (command === 'handoff' && paths.length === 4) {
    const [packetPath, selectionPath, contextPath, output] = paths
    const result = buildDocumentEvidenceHandoff(
      await readDocumentPacket(packetPath),
      await readDocumentJson(selectionPath),
      await readDocumentJson(contextPath),
    )
    await privateDocumentDirectory(output)
    await writeDocumentJson(resolve(output, 'handoff.json'), result)
    console.log('Private review handoff written. No catalog or personal data changed.')
  } else
    throw new Error(
      'Usage: pnpm intake:document prepare <manifest.json> <new-dir> [prior-packet.json] | review <manifest.json> <packet.json> <new-review-dir> | handoff <packet.json> <selection.json> <context.json> <new-dir>',
    )
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2).filter((arg, i) => i !== 0 || arg !== '--')).catch((error) => {
    console.error(
      error.code
        ? 'Local document operation failed; private inputs and any partial receipts were preserved.'
        : error.message,
    )
    process.exitCode = 1
  })
}
