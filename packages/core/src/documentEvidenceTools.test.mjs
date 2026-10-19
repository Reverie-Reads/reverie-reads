import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, stat, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { get } from 'node:http'
import { documentPng, documentPngCrc } from '../../../scripts/document-evidence-image.mjs'
import {
  documentHash,
  prepareDocumentEvidence,
  writeDocumentJson,
  readDocumentPacket,
  readDocumentFile,
  privateDocumentDirectory,
  main,
} from '../../../scripts/document-evidence.mjs'
import { documentEvidenceFingerprint } from '../../../scripts/document-evidence-handoff.mjs'
import {
  startDocumentEvidenceReview,
  renderDocumentEvidenceReview,
} from '../../../scripts/document-evidence-review.mjs'
import { writeFile } from 'node:fs/promises'

const chunk = (type, data) => {
  const b = Buffer.alloc(data.length + 12)
  b.writeUInt32BE(data.length)
  b.write(type, 4)
  data.copy(b, 8)
  b.writeUInt32BE(documentPngCrc(b.subarray(4, b.length - 4)), b.length - 4)
  return b
}
function png(extra = null) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(100, 0)
  ihdr.writeUInt32BE(100, 4)
  ihdr[8] = 8
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    ...(extra ? [chunk(extra, Buffer.alloc(8))] : []),
    chunk('IDAT', deflateSync(Buffer.alloc(10100))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const bytes = png()
const source = {
  url: 'https://example.org/synthetic-pages',
  retrievedAt: '2026-01-01T00:00:00.000Z',
  label: 'Synthetic operator-owned test',
  permissions: { localReview: true, catalogStorage: false, modelInput: false, export: false },
  permissionBasis: 'Self-authored synthetic fixture; no external book content',
}
const lines = ['Quiet Gardens', 'By Jane Mira Vale', 'ISBN 9780306406157'].map((text, i) => ({
  id: `line_${i}`,
  text,
  bbox: { x: 1, y: 10 + i * 20, width: 90, height: 10 },
  confidence: 99,
}))
const packet = () => ({
  version: 1,
  mode: 'review_only',
  targetFingerprint: 'a'.repeat(64),
  source: structuredClone(source),
  pages: [
    {
      id: 'title',
      label: 'Synthetic title page',
      imageSha256: documentHash(bytes),
      width: 100,
      height: 100,
      method: 'ocr_sidecar',
      status: 'complete',
      lines: structuredClone(lines),
      errors: [],
    },
  ],
  corrections: [],
})
const assets = () => new Map([['title', documentPng(bytes)]])
const manifest = () => ({
  version: 1,
  targetFingerprint: 'a'.repeat(64),
  source: structuredClone(source),
  pages: [
    {
      id: 'title',
      label: 'Synthetic title page',
      image: 'page.png',
      ocr: { kind: 'manual_transcription', lines: structuredClone(lines) },
    },
  ],
})
const clean = []
afterEach(async () => {
  for (const f of clean.splice(0)) await f()
})
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'midniht-document-'))
  clean.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}
async function viewer(options = {}) {
  const v = await startDocumentEvidenceReview(packet(), assets(), {
    saveRevision: async () => {},
    ...options,
  })
  clean.push(async () => {
    v.close()
    await v.closed
  })
  return v
}
const correction = (p, line = lines[0], extra = {}) =>
  new URLSearchParams({
    revision: documentEvidenceFingerprint(p),
    pageId: 'title',
    lineId: line.id,
    text: line.text,
    ...Object.fromEntries(Object.entries(line.bbox).map(([k, v]) => [k, String(v)])),
    reason: 'Compared image text and box',
    ...extra,
  })
const post = (v, body, extra = {}) =>
  fetch(`${v.url}/correction`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Origin: new URL(v.url).origin,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extra,
    },
    body,
  })

it('validates actual PNG data and rejects truncated, corrupt, animated and rotated inputs', () => {
  expect(documentPng(bytes).width).toBe(100)
  expect(() => documentPng(bytes.subarray(0, 33))).toThrow()
  for (const type of ['eXIf', 'acTL', 'fcTL', 'fdAT'])
    expect(() => documentPng(png(type))).toThrow()
  const corrupt = Buffer.from(bytes)
  corrupt[corrupt.length - 1] ^= 1
  expect(() => documentPng(corrupt)).toThrow()
  expect(() => documentPng(Buffer.concat([bytes, Buffer.from('extra')]))).toThrow()
})
it('captures immutable private inputs and replays corrections only over unchanged evidence', async () => {
  const dir = await directory(),
    input = join(dir, 'input.json'),
    output = join(dir, 'acquired')
  await writeFile(join(dir, 'page.png'), bytes)
  const result = await prepareDocumentEvidence(manifest(), input, output)
  expect(result.packet.pages[0].method).toBe('manual_transcription')
  expect((await stat(output)).mode & 0o077).toBe(0)
  expect((await stat(join(output, 'packet.json'))).mode & 0o077).toBe(0)
  expect(await readFile(join(output, 'title.png'))).toEqual(bytes)
  expect(JSON.parse(await readFile(join(output, 'acquisition.json'), 'utf8')).paidModelCalls).toBe(
    0,
  )
  await expect(prepareDocumentEvidence(manifest(), input, output)).rejects.toThrow()
  const prior = result.packet
  prior.corrections.push({
    id: 'review_1',
    pageId: 'title',
    lineId: 'line_0',
    imageSha256: prior.pages[0].imageSha256,
    previousText: lines[0].text,
    text: lines[0].text,
    bbox: lines[0].bbox,
    reason: 'Read image',
    reviewedAt: '2026-01-02T00:00:00.000Z',
  })
  expect(
    (await prepareDocumentEvidence(manifest(), input, join(dir, 'replay'), prior)).packet
      .corrections,
  ).toHaveLength(1)
  const changed = manifest()
  changed.pages[0].ocr.lines[0].text = 'Different book'
  await expect(
    prepareDocumentEvidence(changed, input, join(dir, 'changed'), prior),
  ).rejects.toThrow()
})
it('refuses denied local permission, symlinks, oversized files and reused output', async () => {
  const dir = await directory(),
    denied = manifest()
  denied.source.permissions.localReview = false
  await expect(
    prepareDocumentEvidence(denied, join(dir, 'input.json'), join(dir, 'denied')),
  ).rejects.toThrow('permission')
  await writeFile(join(dir, 'real'), 'private text')
  await symlink(join(dir, 'real'), join(dir, 'alias'))
  await expect(readDocumentFile(join(dir, 'alias'))).rejects.toThrow()
  await expect(readDocumentFile(join(dir, 'real'), 1)).rejects.toThrow()
  await expect(privateDocumentDirectory(dir)).rejects.toThrow()
})
it('renders inert text, bounded image routes, accessible forms and no external assets', () => {
  const p = packet()
  p.pages[0].lines[0].text = '<script>do not execute</script>'
  const html = renderDocumentEvidenceReview(p, '/review/token')
  expect(html).toContain('&lt;script&gt;do not execute&lt;/script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).toContain('Record transcription review')
  expect(html).toContain('not verification of a bibliographic fact')
  expect(html).not.toMatch(/src="https?:/)
  expect(html).toContain('focus-visible')
})
it('enforces capability, host, origin, image allowlist and no-cache browser boundaries', async () => {
  const v = await viewer(),
    response = await fetch(v.url)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(response.headers.get('referrer-policy')).toBe('same-origin')
  expect(response.headers.get('content-security-policy')).toContain("form-action 'self'")
  expect((await fetch(`${v.url}/image/title`)).headers.get('content-type')).toBe('image/png')
  expect((await fetch(`${v.url}/image/unknown`)).status).toBe(404)
  expect((await fetch(new URL('/review/wrong', v.url))).status).toBe(404)
  expect((await post(v, correction(packet()), { Origin: 'https://evil.example' })).status).toBe(404)
  expect(
    (await fetch(`${v.url}/correction`, { method: 'POST', body: correction(packet()) })).status,
  ).toBe(404)
  const hostStatus = await new Promise((resolve, reject) =>
    get(v.url, { headers: { Host: 'evil.example' } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    }).on('error', reject),
  )
  expect(hostStatus).toBe(404)
})
it('rejects stale/racing revisions, malformed boxes and duplicate form values without saves', async () => {
  const writes = [],
    v = await viewer({
      saveRevision: async (next) => {
        writes.push(next)
      },
    })
  expect((await post(v, correction(packet(), lines[0], { width: '1000' }))).status).toBe(400)
  const duplicate = correction(packet())
  duplicate.append('text', 'other')
  expect((await post(v, duplicate)).status).toBe(400)
  expect(writes).toHaveLength(0)
  expect((await post(v, correction(packet()))).status).toBe(303)
  expect((await post(v, correction(packet()))).status).toBe(409)
  expect(writes).toHaveLength(1)
  expect(writes[0].pages[0].lines).toEqual(lines)
})
it('does not acknowledge a correction when its private revision write fails', async () => {
  const v = await viewer({
    saveRevision: async () => {
      throw new Error('disk full')
    },
  })
  expect((await post(v, correction(packet()))).status).toBe(400)
  expect(await (await fetch(v.url)).text()).toContain(documentEvidenceFingerprint(packet()))
})
it('round-trips actual saved review envelopes into CLI handoff with a single canonical revision', async () => {
  const dir = await directory()
  let current = packet(),
    lastPath
  const v = await viewer({
    saveRevision: async (next, parentFingerprint) => {
      lastPath = join(dir, `revision-${next.corrections.length}.json`)
      await writeDocumentJson(lastPath, {
        version: 1,
        parentFingerprint,
        fingerprint: documentEvidenceFingerprint(next),
        packet: next,
      })
      current = next
    },
  })
  for (const line of lines) expect((await post(v, correction(current, line))).status).toBe(303)
  const loaded = await readDocumentPacket(lastPath)
  expect(loaded).toEqual(current)
  const quote = (i) => ({ pageId: 'title', lineIds: [lines[i].id], text: lines[i].text })
  await writeDocumentJson(join(dir, 'selection.json'), {
    version: 1,
    documentFingerprint: documentEvidenceFingerprint(loaded),
    targetFingerprint: loaded.targetFingerprint,
    identity: {
      title: quote(0),
      contributors: [
        {
          name: 'Jane Mira Vale',
          role: 'author',
          scope: 'whole',
          basis: 'edition',
          quote: quote(1),
        },
      ],
      isbns: [quote(2)],
    },
  })
  await writeDocumentJson(join(dir, 'context.json'), {
    targetFingerprint: loaded.targetFingerprint,
    asOf: new Date().toISOString(),
    target: { title: 'Quiet Gardens', contributors: ['Jane Mira Vale'], isbn: '9780306406157' },
    existing: { pages: 123 },
  })
  await main([
    'handoff',
    lastPath,
    join(dir, 'selection.json'),
    join(dir, 'context.json'),
    join(dir, 'handoff'),
  ])
  const result = JSON.parse(await readFile(join(dir, 'handoff', 'handoff.json'), 'utf8'))
  expect(result.request.existing.pages).toBe(123)
  expect(result.request.observations[0].source.usage).toBe('review_only')
  expect(result.resolution.fields.some((f) => f.state === 'proposed')).toBe(false)
  const corrupt = JSON.parse(await readFile(lastPath, 'utf8'))
  corrupt.fingerprint = 'f'.repeat(64)
  await writeDocumentJson(join(dir, 'corrupt.json'), corrupt)
  await expect(readDocumentPacket(join(dir, 'corrupt.json'))).rejects.toThrow('Corrupt')
  corrupt.fingerprint = documentEvidenceFingerprint(loaded)
  corrupt.parentFingerprint = 'f'.repeat(64)
  await writeDocumentJson(join(dir, 'wrong-parent.json'), corrupt)
  await expect(readDocumentPacket(join(dir, 'wrong-parent.json'))).rejects.toThrow('Corrupt')
})
it('expires and refuses image mismatches, excessive lifetimes and denied review permissions', async () => {
  const v = await viewer({ ttlMs: 10 })
  await v.closed
  await expect(fetch(v.url)).rejects.toThrow()
  await expect(viewer({ ttlMs: 300001 })).rejects.toThrow()
  const changed = packet()
  changed.pages[0].imageSha256 = '0'.repeat(64)
  await expect(
    startDocumentEvidenceReview(changed, assets(), { saveRevision: async () => {} }),
  ).rejects.toThrow()
  changed.source.permissions.localReview = false
  await expect(
    startDocumentEvidenceReview(changed, assets(), { saveRevision: async () => {} }),
  ).rejects.toThrow()
})
