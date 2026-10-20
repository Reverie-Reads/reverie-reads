import { expect, it } from 'vitest'
import { get } from 'node:http'
import { startIntakeReview, renderIntakeReview } from '../../../scripts/intake-review-server.mjs'
import { buildIntakeReview } from './intakeReview'

it('serves escaped review-only evidence with no remote assets, scripts or save form', () => {
  const html = renderIntakeReview([
    {
      id: '<script>bad</script>',
      review: {
        requested: { title: '<img src=x onerror=alert(1)>' },
        current: {},
        work: { state: 'review' },
        edition: { state: 'unknown' },
        sources: [],
      },
    },
  ])
  expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;')
  expect(html).not.toMatch(/<script|<img|<form|<input/)
  expect(html).toContain('Read only')
  expect(html).toContain('white-space:pre-wrap')
})
it('requires the loopback capability URL, rejects origins and writes, disables caching and closes', async () => {
  const viewer = await startIntakeReview([], 10000)
  try {
    const response = await fetch(viewer.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect((await fetch(viewer.url, { method: 'POST' })).status).toBe(404)
    expect((await fetch(viewer.url, { headers: { Origin: 'https://evil.example' } })).status).toBe(
      404,
    )
    // Node fetch rewrites Host; use a raw HTTP request to actually exercise DNS-rebinding defense.
    const status = await new Promise((resolve, reject) => {
      get(viewer.url, { headers: { Host: 'evil.example' } }, (res) => {
        res.resume()
        resolve(res.statusCode)
      }).on('error', reject)
    })
    expect(status).toBe(404)
    expect((await fetch(new URL('/review/wrong', viewer.url))).status).toBe(404)
  } finally {
    viewer.close()
    await viewer.closed
  }
  await expect(fetch(viewer.url)).rejects.toThrow()
})
it('expires without a reviewer action and bounds its lifetime', async () => {
  await expect(startIntakeReview([], 300001)).rejects.toThrow()
  const viewer = await startIntakeReview([], 10)
  await viewer.closed
  await expect(fetch(viewer.url)).rejects.toThrow()
})

it('renders the real handoff preview with preserved values and separate use holds, without a writer', () => {
  const review = buildIntakeReview({
    version: 1,
    targetFingerprint: 'a'.repeat(64),
    asOf: '2026-10-18T12:00:00.000Z',
    target: { title: 'Quiet Gardens', contributors: ['Jane Smith'], isbn: '9780306406157' },
    existing: { pages: 300 },
    observations: [
      {
        id: 'one',
        targetFingerprint: 'a'.repeat(64),
        status: 'ok',
        responsibilityStatement: 'Edited by <script>Anne Brown</script>.',
        source: {
          provider: 'hardcover',
          recordId: 'one',
          url: 'https://hardcover.app/books/one',
          retrievedAt: '2026-10-18T12:00:00.000Z',
          lineage: null,
          kind: 'bibliographic',
          usage: 'review_only',
          method: 'structured',
        },
        identity: {
          title: 'Quiet Gardens',
          contributors: [{ name: 'Jane Smith', role: 'author', scope: 'whole' }],
          scope: 'edition',
          isbns: ['9780306406157'],
        },
        claims: [
          {
            id: 'pages',
            field: 'pages',
            value: 240,
            scope: 'edition',
            locator: '<script>source</script>',
          },
        ],
      },
    ],
  })
  const html = renderIntakeReview([{ id: 'one', review }])
  expect(html).toContain('Edition responsibility statement — requires review')
  expect(html).toContain('Edited by &lt;script&gt;Anne Brown&lt;/script&gt;.')
  expect(html).toContain('responsibility_unreviewed')
  expect(html).not.toContain('<script>Anne Brown</script>')
  expect(html).toContain('Keep the current value')
  expect(html).toContain('Catalog storage, export and Luna input each require permission review')
  expect(html).toContain('No field evidence was returned')
  expect(html).toContain('current catalog fingerprint')
  expect(html).toContain('source_use_durableFacts_unverified')
  expect(html).toContain('source_use_modelInput_unverified')
  expect(html).toContain('&lt;script&gt;source&lt;/script&gt;')
  expect(html).not.toMatch(/<script|<form|<input|<button/)
})
