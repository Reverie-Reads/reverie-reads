const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
/** Private static inspection artifact. No script, remote assets, forms, or book writer. */
export function renderPhotoIntakeReview(photos, packet) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Private photo evidence</title><style>
  :root{color-scheme:light dark}body{font-family:system-ui;margin:1rem auto;padding:0 1rem;max-width:100ch;overflow-wrap:anywhere}img{display:block;width:100%}figure{position:relative;margin:0}.region{position:absolute;box-sizing:border-box;border:2px solid Highlight;outline:1px solid Canvas}.region span{background:Canvas;color:CanvasText}.columns{display:grid;grid-template-columns:minmax(0,1fr);gap:1rem}@media(min-width:55rem){.columns{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}}pre{white-space:pre-wrap}section{border-block-start:1px solid;padding-block:1rem}a:focus-visible{outline:3px solid Highlight}</style><main>
  <h1>Private photo evidence</h1><p>Frozen local inspection only. This file contains no Save, Accept or catalog action. Originals remain separate and private. Source: ${escape(packet.source.label)}. ${escape(packet.source.permissionBasis)}</p>
  <p>Inspect the whole photo for missed, overlapping or incorrectly cropped books. Rectangles are unresolved suggestions, not a count of books or copies. A cover match cannot establish identity, edition, possession, authenticity, rarity or value. Transcriptions may be wrong. No model calls were made.</p>
  ${photos
    .map((p) => {
      const page = packet.pages.find((page) => page.id === p.id)
      return `<section><h2>${escape(p.kind)} · ${escape(p.id)}</h2><p>Original SHA-256: ${escape(p.originalSha256)}<br>Normalized SHA-256: ${escape(p.normalizedSha256)}</p>
    <div class="columns"><div><figure aria-label="Full normalized photo and unresolved region suggestions"><img src="${p.id}.normalized.png" alt="${escape(p.kind)} source pixels">${p.regions.map((r, i) => `<a href="#${p.id}-regions" class="region" aria-label="Unresolved region ${i + 1}" style="left:${(100 * r.bbox.x) / p.width}%;top:${(100 * r.bbox.y) / p.height}%;width:${(100 * r.bbox.width) / p.width}%;height:${(100 * r.bbox.height) / p.height}%"><span>${i + 1}</span></a>`).join('')}</figure>
    <p>Selected evidence crop in top-left normalized pixels: ${escape(JSON.stringify(p.crop))}. Orientation ${p.orientation}; no scaling. OCR coordinates below belong to this crop, not to the full photo.</p>
    <img src="evidence/${p.id}.png" alt="Selected ${escape(p.kind)} evidence crop"></div><div>
    <h3>Raw observations · ${escape(page.status)}</h3>${(page.errors ?? []).map((e) => `<p>${escape(e)}</p>`).join('')}
    <p>Barcode recognition: ${escape(p.barcodeStatus)}. Rectangle recognition: ${escape(p.rectangleStatus)}.</p><pre>${escape(JSON.stringify(p.barcodes, null, 2))}</pre>
    <ol>${page.lines.map((l) => `<li><p>${escape(l.text)}</p><pre>${escape(JSON.stringify(l.bbox))}</pre></li>`).join('')}</ol>
    <h3 id="${p.id}-regions">Unresolved region queue</h3><p>Missed books: unknown until a reviewer checks the entire image. To correct or add a region, supply its explicit normalized-pixel crop in a new preparation manifest; keep this acquisition and its corrections intact. Never infer separate copies from repeated photos.</p><pre>${escape(JSON.stringify(p.queue, null, 2))}</pre></div></div></section>`
    })
    .join('')}
  <p>Use the existing document review command to confirm or correct transcriptions in append-only revisions, then its separate reviewed-citation resolver handoff. This static snapshot does not update after later corrections. Normal Add still requires its own explicit review and confirmation. Cover Studio remains a separate choice after saving a book.</p></main></html>`
}
