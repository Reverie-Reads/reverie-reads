import { createServer } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  parseDocumentEvidence,
  documentEvidenceLines,
} from '../packages/core/src/documentEvidence.ts'
import { documentPng } from './document-evidence-image.mjs'
import { documentEvidenceFingerprint } from './document-evidence-handoff.mjs'

const hash = (value) => createHash('sha256').update(value).digest('hex')
const fingerprint = documentEvidenceFingerprint
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
const show = (value) => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`
export function renderDocumentEvidenceReview(packet, base, notice = '') {
  const revision = fingerprint(packet),
    lines = documentEvidenceLines(packet)
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Document evidence review</title><style>
    :root{color-scheme:light dark}body{font-family:system-ui;max-width:85ch;margin:1rem auto;padding:0 1rem;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}figure{position:relative;margin:0}figure img{width:100%;height:auto;display:block}.box{position:absolute;border:2px solid currentColor;box-sizing:border-box;color:CanvasText;background:transparent}.box:focus-visible,.box:hover{outline:3px solid Highlight}.box span{background:Canvas;color:CanvasText}section,article{border-block-start:1px solid;padding-block:1rem}article:target{outline:3px solid Highlight;outline-offset:3px}label{display:block;margin-block:.7rem}input,textarea,button{font:inherit;max-width:100%;box-sizing:border-box}textarea{width:100%;min-height:5rem}input[type=number]{width:7rem}button,a,input,textarea{scroll-margin-block:2rem}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid Highlight;outline-offset:3px}.coordinates{display:flex;flex-wrap:wrap;gap:1rem}details{margin-block:1rem}</style><main>
    <h1>Document evidence review</h1><p>Private, local transcription review. This screen cannot approve book identity, source use, contributor roles or catalog changes. Stop the command or wait for expiry to stop serving; closing the browser tab alone does not stop the server. Private revision files remain on disk.</p>
    <p>The server expires after five minutes. Images stay local. Source URLs are not fetched. Corrections record a new revision and retain the original text and image coordinates. A transcription confirmation is not verification of a bibliographic fact.</p>
    ${notice ? `<p role="status">${escape(notice)}</p>` : ''}
    <details><summary>Frozen target and source-use attestations</summary>${show({ targetFingerprint: packet.targetFingerprint, revision, source: packet.source })}<p>These attestations do not qualify a provider or authorize a catalog save. Export and model input require separate review. No model request is made here.</p></details>
    ${packet.pages
      .map(
        (
          p,
        ) => `<section><h2>${escape(p.label)}</h2><p>Page ${escape(p.id)} · ${escape(p.status)} · ${escape(p.method)} · ${p.width} × ${p.height} pixels</p><p>Image SHA-256: ${escape(p.imageSha256)}</p>${p.errors?.length ? show(p.errors) : ''}
    <figure aria-label="${escape(p.label)} with text locations"><img src="${base}/image/${p.id}" alt="${escape(p.label)}; transcribed text follows">${lines
      .filter((l) => l.pageId === p.id)
      .map(
        (l, i) =>
          `<a class="box" href="#${p.id}-${l.lineId}" aria-label="Review line ${i + 1}: ${escape(l.text)}" style="left:${(100 * l.bbox.x) / p.width}%;top:${(100 * l.bbox.y) / p.height}%;width:${(100 * l.bbox.width) / p.width}%;height:${(100 * l.bbox.height) / p.height}%"><span>${i + 1}</span></a>`,
      )
      .join('')}</figure>
    ${lines
      .filter((l) => l.pageId === p.id)
      .map(
        (
          l,
          i,
        ) => `<article id="${p.id}-${l.lineId}"><h3>Line ${i + 1}</h3><p>${l.needsReview ? 'Transcription needs review.' : 'Transcription explicitly confirmed or corrected; bibliographic facts still need review.'} OCR recognition score: ${l.confidence === null ? 'unknown' : escape(l.confidence.toFixed(1))}. This score does not measure factual accuracy.</p><p>Original transcription: ${escape(l.rawText)}</p><p>Current transcription: ${escape(l.text)}</p>
    <form method="post" action="${base}/correction"><input type="hidden" name="revision" value="${revision}"><input type="hidden" name="pageId" value="${p.id}"><input type="hidden" name="lineId" value="${l.lineId}"><label>Checked transcription<textarea name="text" maxlength="2000" required>${escape(l.text)}</textarea></label><div class="coordinates">${['x', 'y', 'width', 'height'].map((k) => `<label>${k}<input type="number" name="${k}" value="${l.bbox[k]}" min="${k === 'x' || k === 'y' ? 0 : 1}" max="${k === 'x' || k === 'width' ? p.width : p.height}" required></label>`).join('')}</div><label>What you checked or corrected<input name="reason" maxlength="1000" required></label><button type="submit">Record transcription review</button></form>
    <details><summary>Correction history</summary>${show(packet.corrections.filter((c) => c.pageId === p.id && c.lineId === l.lineId))}</details></article>`,
      )
      .join('')}
    </section>`,
      )
      .join(
        '',
      )}<p>Use the reviewed citation handoff command for a separate identity and contributor review. No existing catalog or personal values have changed.</p></main></html>`
}
/** Captured image bytes only; append-only revisions through a required private file writer. */
export async function startDocumentEvidenceReview(
  input,
  assets,
  { saveRevision, ttlMs = 300000 } = {},
) {
  let packet = parseDocumentEvidence(input)
  if (
    !packet ||
    !packet.source.permissions.localReview ||
    !(assets instanceof Map) ||
    typeof saveRevision !== 'function' ||
    !Number.isInteger(ttlMs) ||
    ttlMs < 1 ||
    ttlMs > 300000 ||
    assets.size !== packet.pages.length
  )
    throw new Error('Invalid document review or local review permission')
  const images = new Map()
  for (const p of packet.pages) {
    const a = assets.get(p.id)
    const image = a && documentPng(a.bytes)
    if (
      !a ||
      !Buffer.isBuffer(a.bytes) ||
      a.bytes.length > 8_000_000 ||
      a.mime !== 'image/png' ||
      image.width !== p.width ||
      image.height !== p.height ||
      hash(a.bytes) !== p.imageSha256
    )
      throw new Error('Page image does not match frozen citation')
    images.set(p.id, Buffer.from(a.bytes))
  }
  const base = `/review/${randomBytes(32).toString('hex')}`
  let busy = false,
    expired = false
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private, max-age=0')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    )
    // no-referrer makes Chromium serialize a native form's Origin as null. Keep same-origin
    // form provenance while still suppressing any cross-origin referrer disclosure.
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    const origin = `http://127.0.0.1:${server.address()?.port}`
    if (
      expired ||
      req.headers.host !== `127.0.0.1:${server.address()?.port}` ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      return res.writeHead(404).end('Not available')
    if (req.method === 'GET' && !req.headers.origin) {
      if (req.url === base) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return res.end(renderDocumentEvidenceReview(packet, base))
      }
      const pageId = req.url?.startsWith(`${base}/image/`) && req.url.slice(`${base}/image/`.length)
      if (images.has(pageId)) {
        res.setHeader('Content-Type', 'image/png')
        return res.end(images.get(pageId))
      }
    }
    if (
      req.method !== 'POST' ||
      req.url !== `${base}/correction` ||
      req.headers.origin !== origin ||
      req.headers['content-type'] !== 'application/x-www-form-urlencoded' ||
      busy
    )
      return res.writeHead(404).end('Not available')
    busy = true
    req.setTimeout(3000, () => req.destroy())
    try {
      let body = ''
      for await (const chunk of req) {
        body += chunk.toString('utf8')
        if (Buffer.byteLength(body) > 20000) throw new Error('Correction form too large')
      }
      const form = new URLSearchParams(body),
        fields = ['revision', 'pageId', 'lineId', 'text', 'x', 'y', 'width', 'height', 'reason']
      if (
        [...form.keys()].length !== fields.length ||
        fields.some((k) => form.getAll(k).length !== 1) ||
        fields.some((k) => !form.has(k))
      )
        throw new Error('Invalid correction form')
      if (form.get('revision') !== fingerprint(packet) || expired) {
        res
          .writeHead(409)
          .end('This review changed or expired. Reload the current review before correcting it.')
        return
      }
      const line = documentEvidenceLines(packet).find(
        (l) => l.pageId === form.get('pageId') && l.lineId === form.get('lineId'),
      )
      if (!line) throw new Error('Unknown line')
      const next = structuredClone(packet),
        page = packet.pages.find((p) => p.id === line.pageId)
      const bbox = Object.fromEntries(
        ['x', 'y', 'width', 'height'].map((k) => {
          const value = form.get(k)
          if (!/^\d+$/.test(value)) throw new Error('Invalid coordinates')
          return [k, Number(value)]
        }),
      )
      next.corrections.push({
        id: randomUUID(),
        pageId: line.pageId,
        lineId: line.lineId,
        imageSha256: page.imageSha256,
        previousText: line.text,
        text: form.get('text'),
        bbox,
        reason: form.get('reason'),
        reviewedAt: new Date().toISOString(),
      })
      const validated = parseDocumentEvidence(next)
      if (!validated) throw new Error('Invalid correction; check coordinates and text')
      // The original packet remains current if durable storage fails. Do not acknowledge an unsaved correction.
      await saveRevision(validated, fingerprint(packet))
      packet = validated
      res.writeHead(303, { Location: `${base}#${line.pageId}-${line.lineId}` }).end()
    } catch {
      if (!res.destroyed)
        res
          .writeHead(400)
          .end(
            'Correction was not confirmed. Check the current revision and retry explicitly; private failure artifacts are retained.',
          )
    } finally {
      busy = false
    }
  })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const closed = new Promise((resolve) => server.once('close', resolve))
  const close = () => {
    expired = true
    server.close()
    server.closeAllConnections()
    images.clear()
  }
  const timer = setTimeout(close, ttlMs)
  server.once('close', () => clearTimeout(timer))
  return { url: `http://127.0.0.1:${server.address().port}${base}`, close, closed }
}
