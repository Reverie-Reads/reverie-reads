import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, chmod } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  documentHash,
  readDocumentFile,
  readDocumentJson,
  privateDocumentDirectory,
  writeDocumentJson,
  prepareDocumentEvidence,
  validateDocumentManifest,
} from './document-evidence.mjs'
import { documentPng, documentPngCrc } from './document-evidence-image.mjs'
import { renderPhotoIntakeReview } from './photo-intake-review.mjs'
import { bookBarcode } from '../packages/core/src/barcodeBatch.ts'
import {
  validPhotoBox,
  orientedPhotoSize,
  orientPhotoPoint,
  photoCropToNormalized,
  PHOTO_MAX_BYTES,
} from '../packages/core/src/photoEvidence.ts'

const exec = promisify(execFile)
/** ImageIO may emit fresh default eXIf chunks even after a metadata-free redraw. */
async function stripGeneratedPngMetadata(path) {
  const bytes = await readDocumentFile(path)
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    throw new Error('Invalid normalized PNG')
  const chunks = [bytes.subarray(0, 8)]
  for (let offset = 8; offset < bytes.length; ) {
    if (offset + 12 > bytes.length) throw new Error('Truncated normalized PNG')
    const end = offset + 12 + bytes.readUInt32BE(offset)
    if (
      end > bytes.length ||
      bytes.readUInt32BE(end - 4) !== documentPngCrc(bytes.subarray(offset + 4, end - 4))
    )
      throw new Error('Invalid normalized PNG chunk')
    const kind = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    if (['IHDR', 'IDAT', 'IEND'].includes(kind)) chunks.push(bytes.subarray(offset, end))
    else if (kind[0] === kind[0].toUpperCase())
      throw new Error('Unexpected normalized PNG structure')
    offset = end
  }
  const clean = Buffer.concat(chunks)
  documentPng(clean)
  await writeFile(path, clean, { mode: 0o600 })
}
const exact = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k))
export function validatePhotoManifest(value) {
  if (
    !exact(value, ['version', 'targetFingerprint', 'source', 'photos']) ||
    value.version !== 1 ||
    !Array.isArray(value.photos) ||
    !value.photos.length ||
    value.photos.length > 8
  )
    throw new Error('Invalid photo manifest')
  const ids = new Set()
  for (const p of value.photos) {
    if (
      !exact(p, ['id', 'kind', 'image', 'crop', 'ocr']) ||
      typeof p.id !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,59}$/.test(p.id) ||
      ids.has(p.id) ||
      !['cover', 'title', 'copyright', 'group'].includes(p.kind) ||
      typeof p.image !== 'string' ||
      !p.image.length ||
      p.image.length > 2000 ||
      (p.crop !== null &&
        (!exact(p.crop, ['x', 'y', 'width', 'height']) ||
          !validPhotoBox(p.crop, {
            width: p.crop.x + p.crop.width,
            height: p.crop.y + p.crop.height,
          })))
    )
      throw new Error('Invalid photo input or crop')
    ids.add(p.id)
  }
  // Reuse the existing strict source permission, OCR and target validator before touching photos.
  validateDocumentManifest({
    version: 1,
    targetFingerprint: value.targetFingerprint,
    source: value.source,
    pages: value.photos.map((p) => ({ id: p.id, label: p.kind, image: p.image, ocr: p.ocr })),
  })
  return structuredClone(value)
}

export async function normalizeLocalPhoto(inputPath, fullPath, cropPath, crop = null) {
  if (process.platform !== 'darwin')
    throw new Error('Phone photo normalization currently requires local macOS ImageIO')
  // Pre-created private output files keep even interrupted decoder output owner-only.
  await writeFile(fullPath, '', { flag: 'wx', mode: 0o600 })
  if (crop) await writeFile(cropPath, '', { flag: 'wx', mode: 0o600 })
  const { stdout } = await exec(
    '/usr/bin/swift',
    [
      fileURLToPath(new URL('./photo-intake-image.swift', import.meta.url)),
      inputPath,
      fullPath,
      ...(crop ? [JSON.stringify(crop), cropPath] : []),
    ],
    { timeout: 60000, maxBuffer: 1_000_000 },
  )
  const receipt = JSON.parse(stdout)
  // ImageIO replaces its destination while encoding; restore owner-only file permissions.
  await chmod(fullPath, 0o600)
  if (crop) await chmod(cropPath, 0o600)
  await stripGeneratedPngMetadata(fullPath)
  if (crop) await stripGeneratedPngMetadata(cropPath)
  const expected = orientedPhotoSize(
    { width: receipt.encodedWidth, height: receipt.encodedHeight },
    receipt.orientation,
  )
  const full = documentPng(await readDocumentFile(fullPath))
  if (
    expected.width !== full.width ||
    expected.height !== full.height ||
    receipt.width !== full.width ||
    receipt.height !== full.height ||
    !Array.isArray(receipt.regions) ||
    receipt.regions.length > 12 ||
    receipt.regions.some((r) => !validPhotoBox(r.bbox, full)) ||
    !Array.isArray(receipt.barcodes) ||
    receipt.barcodes.some((r) => !validPhotoBox(r.bbox, full))
  )
    throw new Error('Photo dimensions or detector coordinates did not validate')
  const selected = crop ?? { x: 0, y: 0, width: full.width, height: full.height }
  if (!validPhotoBox(selected, full)) throw new Error('Crop leaves normalized photo')
  const image = crop ? documentPng(await readDocumentFile(cropPath)) : full
  if (image.width !== selected.width || image.height !== selected.height)
    throw new Error('Crop dimensions changed')
  return {
    ...receipt,
    normalizedSha256: full.sha256,
    cropSha256: image.sha256,
    crop: selected,
    coordinateSpace: 'orientation-normalized top-left pixels; no scaling',
    cropExtentInNormalized: photoCropToNormalized(
      { x: 0, y: 0, width: selected.width, height: selected.height },
      selected,
    ),
    encodedCornersInNormalized: [
      [0, 0],
      [receipt.encodedWidth, 0],
      [0, receipt.encodedHeight],
      [receipt.encodedWidth, receipt.encodedHeight],
    ].map(([x, y]) =>
      orientPhotoPoint(
        x,
        y,
        { width: receipt.encodedWidth, height: receipt.encodedHeight },
        receipt.orientation,
      ),
    ),
    barcodes: receipt.barcodes.map((b) => ({ ...b, isbn: bookBarcode(b.value) || null })),
  }
}

/** Capture originals first, then derive local evidence. Never overwrite a previous run/correction. */
export async function preparePhotoIntake(input, manifestPath, output) {
  const manifest = validatePhotoManifest(input)
  await privateDocumentDirectory(output)
  const photos = [],
    pages = []
  for (const p of manifest.photos) {
    const bytes = await readDocumentFile(resolve(dirname(manifestPath), p.image), PHOTO_MAX_BYTES)
    const originalPath = resolve(output, `${p.id}.original`)
    await writeFile(originalPath, bytes, { flag: 'wx', mode: 0o600 })
    const fullPath = resolve(output, `${p.id}.normalized.png`),
      cropPath = resolve(output, `${p.id}.crop.png`)
    let receipt
    try {
      receipt = await normalizeLocalPhoto(originalPath, fullPath, cropPath, p.crop)
    } catch {
      await writeDocumentJson(resolve(output, `${p.id}.failure.json`), {
        version: 1,
        status: 'failed',
        originalSha256: documentHash(bytes),
        paidModelCalls: 0,
      })
      throw new Error(
        'Photo preparation failed; original and failure receipt retained. No automatic retry or model fallback.',
      )
    }
    photos.push({
      id: p.id,
      kind: p.kind,
      originalSha256: documentHash(bytes),
      ...receipt,
      // Proposals are regions to inspect, never a book count, identity, or copy quantity.
      queue: receipt.regions.map((r, i) => ({
        id: `${p.id}-${i + 1}`,
        bbox: r.bbox,
        state: 'unresolved',
      })),
      coverage: 'unmeasured; missed and overlapping books require full-photo review',
    })
    pages.push({
      id: p.id,
      label: p.kind,
      image: p.crop ? cropPath : fullPath,
      ocr:
        p.ocr.kind === 'tesseract_tsv'
          ? { ...p.ocr, path: resolve(dirname(manifestPath), p.ocr.path) }
          : p.ocr,
    })
  }
  const documentManifest = {
    version: 1,
    targetFingerprint: manifest.targetFingerprint,
    source: manifest.source,
    pages,
  }
  await writeDocumentJson(resolve(output, 'photos.json'), {
    version: 1,
    mode: 'review_only',
    photos,
    capturedAt: new Date().toISOString(),
    paidModelCalls: 0,
  })
  const evidence = await prepareDocumentEvidence(
    documentManifest,
    resolve(output, 'document-input.json'),
    resolve(output, 'evidence'),
  )
  await writeDocumentJson(resolve(output, 'evidence-binding.json'), {
    version: 1,
    targetFingerprint: manifest.targetFingerprint,
    sourceSha256: documentHash(JSON.stringify(manifest.source)),
    photosSha256: documentHash(JSON.stringify(photos)),
    packetSha256: documentHash(JSON.stringify(evidence.packet)),
  })
  await writeFile(
    resolve(output, 'review.html'),
    renderPhotoIntakeReview(photos, evidence.packet),
    { flag: 'wx', mode: 0o600 },
  )
  return {
    pages: photos.length,
    statuses: photos.map((p) => ({
      id: p.id,
      barcodeStatus: p.barcodeStatus,
      rectangleStatus: p.rectangleStatus,
    })),
    extractionStatuses: evidence.packet.pages.map((p) => ({ id: p.id, status: p.status })),
    paidModelCalls: 0,
  }
}

export async function main(args) {
  if (args.length === 1 && ['--help', 'help'].includes(args[0])) {
    console.log(
      'Usage: pnpm intake:photo prepare <manifest.json> <new-private-dir>\nLocal PNG/JPEG/HEIC, 20 MB/source, 16 million pixels; normalized PNG and crops must fit the document 8 MB cap. Originals stay private. Crops use orientation-normalized pixels. No book/copy/catalog writer, model fallback or automatic intake. Review with intake:document using evidence/manifest.json and evidence/packet.json; handoff reuses its existing resolver. Group proposals remain unresolved and may miss books.',
    )
    return
  }
  if (args.length !== 3 || args[0] !== 'prepare') throw new Error('Use intake:photo --help')
  console.log(
    JSON.stringify(
      await preparePhotoIntake(await readDocumentJson(args[1]), resolve(args[1]), resolve(args[2])),
    ),
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2).filter((arg, i) => i !== 0 || arg !== '--')).catch(() => {
    console.error(
      'Private photo operation failed. Inputs and partial receipts retained; use intake:photo --help. No automatic retry.',
    )
    process.exitCode = 1
  })
