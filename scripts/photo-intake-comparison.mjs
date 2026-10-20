import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  documentHash,
  privateDocumentDirectory,
  readDocumentFile,
  readDocumentJson,
  writeDocumentJson,
  readDocumentPacket,
} from './document-evidence.mjs'
import { preparePhotoIntake, validatePhotoManifest } from './photo-intake.mjs'
import { validPhotoBox } from '../packages/core/src/photoEvidence.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const normalize = (text) => text.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()
const iou = (a, b) => {
  const area =
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return area / (a.width * a.height + b.width * b.height - area)
}
/** Read-only scoring; frozen expected text/regions never enter extraction or resolver input. */
export async function comparePhotos(frame, framePath, output) {
  if (
    frame?.version !== 1 ||
    !Array.isArray(frame.cases) ||
    !frame.cases.length ||
    frame.cases.length > 20 ||
    typeof frame.referenceBasis !== 'string' ||
    !frame.referenceBasis.trim()
  )
    throw new Error('Invalid photo comparison frame')
  const ids = new Set()
  for (const c of frame.cases) {
    if (
      !/^[a-z][a-z0-9_-]{0,59}$/.test(c.id) ||
      ids.has(c.id) ||
      !['photograph', 'digital_page', 'synthetic'].includes(c.kind) ||
      !/^[a-f0-9]{64}$/.test(c.originalSha256) ||
      !Array.isArray(c.expectedLines) ||
      !Array.isArray(c.expectedRegions) ||
      c.expectedLines.length > 100 ||
      c.expectedRegions.length > 100 ||
      !['hold', 'unobserved'].includes(c.expectedIdentity)
    )
      throw new Error('Invalid frozen photo case')
    ids.add(c.id)
    validatePhotoManifest(c.manifest)
    if (c.manifest.photos.length !== 1 || c.manifest.photos[0].ocr.kind !== 'apple_vision')
      throw new Error('One local Vision photo per comparison case')
    const size = c.expectedSize
    if (
      !validPhotoBox({ x: 0, y: 0, ...size }, size) ||
      c.expectedLines.some(
        (l) =>
          typeof l.text !== 'string' ||
          !l.text.trim() ||
          l.text.length > 2000 ||
          !validPhotoBox(l.bbox, size),
      ) ||
      c.expectedRegions.some((b) => !validPhotoBox(b, size))
    )
      throw new Error('Invalid reference pixels')
  }
  await privateDocumentDirectory(output)
  const code = {}
  for (const path of [
    'scripts/photo-intake.mjs',
    'scripts/photo-intake-image.swift',
    'scripts/photo-intake-comparison.mjs',
    'scripts/document-evidence.mjs',
    'scripts/document-evidence-vision.swift',
    'scripts/document-evidence-image.mjs',
    'packages/core/src/photoEvidence.ts',
  ])
    code[path] = documentHash(await readFile(join(root, path)))
  // Freeze complete selected inputs, failed acquisition records, references and code before OCR.
  const captured = []
  for (const c of frame.cases) {
    const bytes = await readDocumentFile(
      resolve(dirname(framePath), c.manifest.photos[0].image),
      20_000_000,
    )
    if (documentHash(bytes) !== c.originalSha256)
      throw new Error('Source photo changed before freeze')
    const path = join(output, `${c.id}.original`)
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
    captured.push({
      ...c,
      manifest: { ...c.manifest, photos: [{ ...c.manifest.photos[0], image: path }] },
    })
  }
  await writeDocumentJson(join(output, 'lock.json'), {
    version: 1,
    mode: 'development_only',
    frozenAt: new Date().toISOString(),
    frameSha256: documentHash(JSON.stringify(frame)),
    frame,
    code,
    paidModelCalls: 0,
  })
  const results = []
  for (const c of captured) {
    const started = performance.now()
    try {
      const destination = join(output, c.id)
      await preparePhotoIntake(c.manifest, framePath, destination)
      const packet = await readDocumentPacket(join(destination, 'evidence/packet.json'))
      const photos = await readDocumentJson(join(destination, 'photos.json')),
        photo = photos.photos[0],
        page = packet.pages[0]
      const crop = photo.crop
      const matches = c.expectedLines.map((reference) => {
        const line = page.lines.find((l) => normalize(l.text) === normalize(reference.text))
        const box = line ? { ...line.bbox, x: line.bbox.x + crop.x, y: line.bbox.y + crop.y } : null
        return {
          text: reference.text,
          observed: !!line,
          coordinateIoU: box ? iou(reference.bbox, box) : null,
        }
      })
      const available = new Set(photo.regions.map((_, i) => i)),
        regions = []
      for (const reference of c.expectedRegions) {
        const ordered = [...available]
          .map((i) => ({ i, score: iou(reference, photo.regions[i].bbox) }))
          .sort((a, b) => b.score - a.score)
        const best = ordered[0]
        const matched = !!best && best.score >= 0.5
        if (matched) available.delete(best.i)
        regions.push({ matched, iou: best?.score ?? null })
      }
      results.push({
        id: c.id,
        kind: c.kind,
        status: page.status,
        originalPreserved: photo.originalSha256 === c.originalSha256,
        dimensionAgreement:
          photo.width === c.expectedSize.width && photo.height === c.expectedSize.height,
        lines: matches,
        rawLineCount: page.lines.length,
        barcodeStatus: photo.barcodeStatus,
        observedBarcodes: photo.barcodes.length,
        rectangleStatus: photo.rectangleStatus,
        proposedRegions: photo.regions.length,
        regions,
        missedBooks: c.expectedRegions.length ? regions.filter((r) => !r.matched).length : null,
        unmatchedProposals: c.expectedRegions.length ? available.size : null,
        // No automatic book identity decision exists. Never count a missing decision as correct.
        expectedIdentity: c.expectedIdentity,
        identityDecision: 'unobserved',
        incorrectAcceptedIdentities: null,
        manualCorrectionEffort: 'unobserved',
        editionCreditDecision: 'held_for_deliberate_review',
        elapsedMs: Math.round(performance.now() - started),
      })
    } catch {
      results.push({
        id: c.id,
        kind: c.kind,
        status: 'failed',
        identityDecision: 'unobserved',
        missedBooks: c.expectedRegions.length || null,
        manualCorrectionEffort: 'unobserved',
        elapsedMs: Math.round(performance.now() - started),
      })
    }
  }
  const report = {
    version: 1,
    mode: 'development_only',
    frameSha256: documentHash(JSON.stringify(frame)),
    cases: results,
    paidModelCalls: 0,
    productionQualified: false,
    limits: [
      'Selected convenience sample; no independent human reviewer. Reference read before OCR by implementation agent.',
      'Photographs, digital pages and synthetic cases have separate denominators.',
      'Identity correctness, human correction time, phone capture and collector observations are unobserved.',
      'Every failed/unobserved case remains; rectangle proposals never become book counts or copies.',
    ],
  }
  await writeDocumentJson(join(output, 'comparison.json'), report)
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [framePath, output] = process.argv.slice(2).filter((arg, i) => i !== 0 || arg !== '--')
  if (!framePath || !output)
    throw new Error('Usage: pnpm intake:photo:compare <frozen-frame.json> <new-private-dir>')
  comparePhotos(await readDocumentJson(framePath), resolve(framePath), resolve(output))
    .then((report) =>
      console.log(
        JSON.stringify({
          cases: report.cases.length,
          failed: report.cases.filter((c) => c.status === 'failed').length,
          paidModelCalls: 0,
        }),
      ),
    )
    .catch(() => {
      console.error('Private photo comparison failed; preserve its lock and partial receipts.')
      process.exitCode = 1
    })
}
