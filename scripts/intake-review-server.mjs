import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  )
const show = (value) => `<pre>${escape(JSON.stringify(value, null, 2) ?? 'Not supplied')}</pre>`
const fieldLabels = {
  title: 'Title',
  contributors: 'Contributors',
  description: 'Description',
  pages: 'Pages',
  publication: 'Publication date',
  publisher: 'Publisher',
  language: 'Language',
  format: 'Format',
  cover: 'Cover',
  series: 'Series',
}
function handoffPreview(handoff) {
  if (!handoff) return '<p>A handoff preview was not supplied.</p>'
  return `<dl>${handoff.fields
    .map(
      (f) =>
        `<div><dt><strong>${escape(fieldLabels[f.field] ?? f.field)}</strong></dt><dd>${
          f.disposition === 'preserve_current'
            ? 'Keep the current value. Conflicting observations remain available for review below.'
            : f.disposition === 'no_observation'
              ? 'No field evidence was returned. Check source failures and identity holds below before treating this as absence.'
              : 'Review the evidence and source-use permissions before preparing a change.'
        }${f.evidence.length ? `<p>Catalog storage, export and Luna input each require permission review. Identity and edition holds still apply.</p><details><summary>Evidence holds and use requirements</summary>${show({ reasons: f.reasons, evidence: f.evidence })}</details>` : ''}</dd></div>`,
    )
    .join('')}</dl>`
}

/** Escaped, script-free local review. No selection, Save, storage, analytics or external assets. */
export function renderIntakeReview(reviews) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Intake evidence review</title><style>body{font-family:system-ui;max-width:75ch;margin:1rem auto;padding:0 1rem;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{border-block-start:1px solid;padding-block:1rem}a:focus-visible{outline:2px solid;outline-offset:3px}</style><main>
  <h1>Intake evidence review</h1><p>Read only. Provider observations are not verified catalog facts. No changes can be saved here.</p>
  <p>The local server expires after five minutes. Browser storage is not used; close this tab to discard displayed observations. Existing values stay unchanged. Source credit lists may be incomplete.</p>
  ${reviews
    .map(
      ({
        id,
        review,
      }) => `<article><h2>${escape(id)}</h2><h3>Requested identity</h3>${show(review.requested)}
  <h3>Current values — preserved</h3>${show(review.current)}
  <p>Work: ${escape(review.work.state)}. Edition: ${escape(review.edition.state)}.</p>
  <h3>Before a reviewed handoff</h3>
  <p>Preserve current values. Inspect the original source and confirm this exact saved edition in the catalog editor. Recheck the current catalog fingerprint before preparing a review. This preview cannot approve a source or send facts to the catalog, an export or Luna.</p>
  ${handoffPreview(review.handoff)}
  ${review.sources
    .map(
      (s) => `<section><h3>${escape(s.source.provider)} — ${escape(s.status)}</h3>
    <p><a href="${escape(s.source.url)}" target="_blank" rel="noopener noreferrer">Source record</a> · ${escape(s.source.recordId)} · retrieved ${escape(s.source.retrievedAt)}</p>
    <p>Use: ${escape(s.source.usage)}. Upstream origin: ${escape(s.source.lineage ?? 'Unknown; independence unverified')}.</p>
    <h4>Source-use review — no permission grant</h4>${show(s.qualification)}
    <h4>Identity comparison</h4>${show(s.identityCheck)}<h4>Observed identity</h4>${show(s.identity)}
    <h4>Why review is required</h4>${show(s.reasons)}
    <h4>Contributor credits in source order</h4>${show(s.credits)}
    <h4>Credit conflicts — no rows merged</h4>${show(s.creditCollisions ?? [])}
    <h4>Edition responsibility statement — requires review</h4>${show(s.responsibilityStatement ?? 'Not supplied')}
    <h4>Unparsed credit statements — roles not inferred</h4>${show(s.creditStatements)}
    <h4>Field evidence and existing values</h4>${show(s.claims)}
  </section>`,
    )
    .join('')}</article>`,
    )
    .join('')}
  </main></html>`
}

/** Random capability path, loopback-only, bounded lifetime, no browser or disk persistence. */
export async function startIntakeReview(reviews, ttlMs = 300000) {
  if (
    !Array.isArray(reviews) ||
    reviews.length > 20 ||
    !Number.isInteger(ttlMs) ||
    ttlMs < 1 ||
    ttlMs > 300000
  )
    throw new Error('Invalid review lifetime or size')
  let html = renderIntakeReview(reviews)
  const path = `/review/${randomBytes(32).toString('hex')}`
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    )
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    if (
      req.method !== 'GET' ||
      req.url !== path ||
      req.headers.host !== `127.0.0.1:${server.address().port}` ||
      req.headers.origin
    ) {
      res.writeHead(404).end('Not available')
      return
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(html)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const closed = new Promise((resolve) => server.once('close', resolve))
  const close = () => {
    html = ''
    server.close()
    server.closeAllConnections()
  }
  const timer = setTimeout(close, ttlMs)
  server.once('close', () => clearTimeout(timer))
  return { url: `http://127.0.0.1:${server.address().port}${path}`, close, closed }
}
