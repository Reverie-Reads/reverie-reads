import { beforeAll, afterAll, expect, it } from 'vitest'
import { mkdtemp, readFile, stat, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  preparePhotoIntake,
  normalizeLocalPhoto,
  validatePhotoManifest,
} from '../../../scripts/photo-intake.mjs'
import {
  documentHash,
  privateDocumentDirectory,
  readDocumentPacket,
} from '../../../scripts/document-evidence.mjs'
import { documentPng } from '../../../scripts/document-evidence-image.mjs'
import { renderPhotoIntakeReview } from '../../../scripts/photo-intake-review.mjs'
import { comparePhotos } from '../../../scripts/photo-intake-comparison.mjs'
const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url))
const { PNG } = require('pngjs')
let root
const manifest = () => ({
  version: 1,
  targetFingerprint: 'a'.repeat(64),
  source: {
    url: 'https://example.org/self-authored-photo',
    retrievedAt: '2026-10-19T18:00:00.000Z',
    label: 'Self-authored geometry',
    permissions: { localReview: true, catalogStorage: false, modelInput: false, export: false },
    permissionBasis: 'Self-authored synthetic test only',
  },
  photos: [
    {
      id: 'title',
      kind: 'title',
      image: 'o1.jpg',
      crop: null,
      ocr: { kind: 'manual_transcription', lines: [] },
    },
  ],
})
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'midniht-photo-test-'))
  if (process.platform === 'darwin')
    execFileSync('/usr/bin/swift', ['scripts/fixtures/photo-intake.swift', root], {
      cwd: new URL('../../../', import.meta.url),
      timeout: 60000,
    })
}, 70000)
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})
it('validates permission, unique IDs, kind, bounds and unexpected keys before reading photos', () => {
  expect(validatePhotoManifest(manifest()).photos).toHaveLength(1)
  for (const mutate of [
    (m) => (m.source.permissions.localReview = false),
    (m) => m.photos.push(m.photos[0]),
    (m) => (m.photos[0].kind = 'signature'),
    (m) => (m.photos[0].crop = { x: -1, y: 0, width: 10, height: 10 }),
    (m) => (m.photos[0].extra = true),
    (m) => (m.photos[0].id = '../escape'),
  ]) {
    const m = manifest()
    mutate(m)
    expect(() => validatePhotoManifest(m)).toThrow()
  }
})
it.skipIf(process.platform !== 'darwin')(
  'normalizes all EXIF orientations and strips location metadata with independently specified corner geometry',
  async () => {
    const corners = [
      ['red', 'green', 'blue', 'yellow'],
      ['green', 'red', 'yellow', 'blue'],
      ['yellow', 'blue', 'green', 'red'],
      ['blue', 'yellow', 'red', 'green'],
      ['red', 'blue', 'green', 'yellow'],
      ['blue', 'red', 'yellow', 'green'],
      ['yellow', 'green', 'blue', 'red'],
      ['green', 'yellow', 'red', 'blue'],
    ]
    const color = ([r, g, b]) =>
      r > 180 && g < 80 && b < 80
        ? 'red'
        : r < 80 && g > 180 && b < 80
          ? 'green'
          : r < 80 && g < 80 && b > 180
            ? 'blue'
            : r > 180 && g > 180 && b < 80
              ? 'yellow'
              : 'unexpected'
    for (let o = 1; o <= 8; o++) {
      const out = join(root, `normalized-${o}.png`)
      const receipt = await normalizeLocalPhoto(join(root, `o${o}.jpg`), out, null)
      expect(receipt.orientation).toBe(o)
      expect([receipt.width, receipt.height]).toEqual(o >= 5 ? [800, 1200] : [1200, 800])
      const data = await readFile(out),
        png = PNG.sync.read(data)
      const observed = [
        [30, 30],
        [png.width - 30, 30],
        [30, png.height - 30],
        [png.width - 30, png.height - 30],
      ].map(([x, y]) =>
        color([...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)]),
      )
      expect(observed).toEqual(corners[o - 1])
      expect(data.includes(Buffer.from('eXIf'))).toBe(false)
      expect((await stat(out)).mode & 0o077).toBe(0)
    }
  },
  180000,
)
it.skipIf(process.platform !== 'darwin')(
  'captures source bytes separately, freezes crop transforms and reuses the no-write document review packet',
  async () => {
    const m = manifest()
    m.photos[0].crop = { x: 100, y: 150, width: 1000, height: 450 }
    const out = join(root, 'prepared')
    await preparePhotoIntake(m, join(root, 'input.json'), out)
    const receipt = JSON.parse(await readFile(join(out, 'photos.json'), 'utf8'))
    expect(await readFile(join(out, 'title.original'))).toEqual(
      await readFile(join(root, 'o1.jpg')),
    )
    expect(receipt.photos[0].originalSha256).toBe(
      documentHash(await readFile(join(root, 'o1.jpg'))),
    )
    expect(receipt.photos[0].cropExtentInNormalized).toEqual(m.photos[0].crop)
    const packet = await readDocumentPacket(join(out, 'evidence/packet.json'))
    expect(packet.pages[0]).toMatchObject({ width: 1000, height: 450, status: 'failed', lines: [] })
    expect(packet.pages[0].imageSha256).toBe(receipt.photos[0].cropSha256)
    expect(receipt.paidModelCalls).toBe(0)
    const html = await readFile(join(out, 'review.html'), 'utf8')
    expect(html).toContain('title.normalized.png')
    expect(html).toContain('Unresolved region queue')
    expect(html).not.toContain('<script')
    const hostile = structuredClone(packet)
    hostile.source.permissionBasis = '<script>alert(1)</script>'
    expect(renderPhotoIntakeReview(receipt.photos, hostile)).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(receipt.photos[0].queue.every((r) => r.state === 'unresolved')).toBe(true)
    for (const name of [
      'title.original',
      'title.normalized.png',
      'title.crop.png',
      'photos.json',
      'evidence/packet.json',
    ])
      expect((await stat(join(out, name))).mode & 0o077).toBe(0)
    await expect(preparePhotoIntake(m, join(root, 'input.json'), out)).rejects.toThrow()
    expect(documentPng(await readFile(join(out, 'title.crop.png')))).toMatchObject({
      width: 1000,
      height: 450,
    })
  },
  60000,
)
it.skipIf(process.platform !== 'darwin')(
  'freezes references separately, withholds expected text from OCR, and retains failed cases',
  async () => {
    const bytes = await readFile(join(root, 'o1.jpg'))
    const m = manifest()
    m.photos[0].ocr = { kind: 'apple_vision' }
    const c = {
      id: 'positive',
      kind: 'synthetic',
      originalSha256: documentHash(bytes),
      expectedIdentity: 'hold',
      expectedSize: { width: 1200, height: 800 },
      expectedLines: [
        {
          text: 'NEVER SUPPLY THE REFERENCE AS OCR INPUT',
          bbox: { x: 1, y: 1, width: 100, height: 20 },
        },
      ],
      expectedRegions: [],
      manifest: m,
    }
    const badBytes = Buffer.from('not a JPEG')
    await writeFile(join(root, 'compare-bad.jpg'), badBytes)
    const bad = structuredClone(c)
    bad.id = 'bad'
    bad.originalSha256 = documentHash(badBytes)
    bad.manifest.photos[0].image = 'compare-bad.jpg'
    const frame = {
      version: 1,
      referenceBasis:
        'Synthetic source and intentionally absent literal control, fixed before acquisition',
      cases: [c, bad],
    }
    const output = join(root, 'comparison')
    const report = await comparePhotos(frame, join(root, 'frame.json'), output)
    expect(report.cases).toHaveLength(2)
    expect(report.cases[0].lines[0].observed).toBe(false)
    expect(report.cases[0].rawLineCount).toBeGreaterThan(0)
    expect(report.cases[1].status).toBe('failed')
    expect(report.cases.every((c) => c.identityDecision === 'unobserved')).toBe(true)
    expect(JSON.parse(await readFile(join(output, 'lock.json'), 'utf8')).frame).toEqual(frame)
    expect(await readFile(join(output, 'bad.original'))).toEqual(badBytes)
  },
  60000,
)
it.skipIf(process.platform !== 'darwin')(
  'decodes local PNG and HEIC, and preserves failures without replay or symlink input',
  async () => {
    for (const name of ['page.png', 'page.heic']) {
      const out = join(root, `${name}.normalized.png`)
      expect(await normalizeLocalPhoto(join(root, name), out, null)).toMatchObject({
        width: 1200,
        height: 800,
      })
    }
    await writeFile(join(root, 'bad.jpg'), 'invalid')
    const m = manifest()
    m.photos[0].image = 'bad.jpg'
    await expect(
      preparePhotoIntake(m, join(root, 'input.json'), join(root, 'bad-run')),
    ).rejects.toThrow('retained')
    expect(
      JSON.parse(await readFile(join(root, 'bad-run/title.failure.json'), 'utf8')).status,
    ).toBe('failed')
    await symlink(join(root, 'o1.jpg'), join(root, 'link.jpg'))
    m.photos[0].image = 'link.jpg'
    await expect(
      preparePhotoIntake(m, join(root, 'input.json'), join(root, 'link-run')),
    ).rejects.toThrow()
    await expect(privateDocumentDirectory(process.cwd())).rejects.toThrow()
  },
  60000,
)
