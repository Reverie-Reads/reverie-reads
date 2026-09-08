// Independent from the series resolver and the production enrichment adapter.
const FIELDS = ['pages', 'editionFormat']
const FORMATS = ['paperback', 'hardcover', 'ebook', 'audiobook']
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v) => typeof v === 'string' && v.length <= 500 && v.trim().length > 0
const fold = (v) =>
  v
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
const keys = (v, allowed) => object(v) && Object.keys(v).every((k) => allowed.includes(k))
const names = (v) => Array.isArray(v) && v.length > 0 && v.length <= 8 && v.every(text)
const pages = (v) => Number.isInteger(v) && v >= 1 && v <= 20000

// Same checksum arithmetic as core/match.ts; stricter input alphabet for this Node-only CLI.
export function canonicalIsbn(value) {
  const s = typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : ''
  if (/^97[89]\d{10}$/.test(s))
    return [...s].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0) % 10 === 0 ? s : null
  if (
    !/^\d{9}[\dX]$/.test(s) ||
    [...s].reduce((n, d, i) => n + (d === 'X' ? 10 : Number(d)) * (10 - i), 0) % 11
  )
    return null
  const p = '978' + s.slice(0, 9)
  return p + ((10 - ([...p].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10)
}

const validFields = (v) =>
  keys(v, FIELDS) &&
  (v.pages == null || pages(v.pages)) &&
  (v.editionFormat == null || FORMATS.includes(v.editionFormat))

export function validateInput(input) {
  if (
    !keys(input, ['version', 'purpose', 'cases']) ||
    input.version !== 1 ||
    input.purpose !== 'development' ||
    !Array.isArray(input.cases) ||
    input.cases.length < 1 ||
    input.cases.length > 20
  )
    throw new Error('invalid_input')
  const seen = new Set()
  for (const c of input.cases) {
    if (
      !keys(c, ['identity', 'current', 'baseline']) ||
      !keys(c.identity, ['isbn', 'title', 'authors', 'language']) ||
      !canonicalIsbn(c.identity.isbn) ||
      !text(c.identity.title) ||
      !fold(c.identity.title) ||
      !names(c.identity.authors) ||
      c.identity.authors.some((n) => !fold(n)) ||
      (c.identity.language != null &&
        !['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'].includes(c.identity.language)) ||
      !validFields(c.current) ||
      !Array.isArray(c.baseline) ||
      c.baseline.length > 2
    )
      throw new Error('invalid_case')
    const isbn = canonicalIsbn(c.identity.isbn)
    if (seen.has(isbn)) throw new Error('duplicate_isbn')
    seen.add(isbn)
    const sources = new Set()
    for (const b of c.baseline) {
      if (
        !keys(b, ['source', 'isbns', 'title', 'authors', 'pages', 'editionFormat']) ||
        !['google', 'openlibrary'].includes(b.source) ||
        sources.has(b.source) ||
        !Array.isArray(b.isbns) ||
        b.isbns.length < 1 ||
        b.isbns.length > 10 ||
        !b.isbns.every(canonicalIsbn) ||
        !text(b.title) ||
        !names(b.authors) ||
        !validFields({ pages: b.pages, editionFormat: b.editionFormat })
      )
        throw new Error('invalid_baseline')
      sources.add(b.source)
    }
  }
  return input
}

const nameMatches = (actual, expected) =>
  [actual, ...(actual.split(',').length === 2 ? [actual.split(',').reverse().join(' ')] : [])].some(
    (n) => fold(n) === fold(expected),
  )
const sameAuthors = (actual, expected) =>
  names(actual) &&
  actual.length === expected.length &&
  actual.every((a) => expected.some((e) => nameMatches(a, e))) &&
  expected.every((e) => actual.some((a) => nameMatches(a, e)))
const exactIdentity = (record, identity) =>
  record.isbns.length > 0 &&
  record.isbns.every((i) => canonicalIsbn(i) === canonicalIsbn(identity.isbn)) &&
  fold(record.title) === fold(identity.title) &&
  sameAuthors(record.authors, identity.authors)

export function planSupplement(c) {
  // Caller-supplied baseline observations must be tied to returned edition ISBNs, not a rank.
  if (!c.baseline.length || c.baseline.some((b) => !exactIdentity(b, c.identity)))
    return { status: 'identity_review', fields: {} }
  const fields = {}
  for (const field of FIELDS) {
    const available = [...new Set(c.baseline.map((b) => b[field]).filter((v) => v != null))]
    fields[field] =
      available.length > 1 ||
      (c.current[field] != null && available.some((v) => v !== c.current[field]))
        ? 'baseline_conflict'
        : c.current[field] != null
          ? 'keep_current'
          : available.length
            ? 'baseline_available'
            : 'gap'
  }
  if (fields.editionFormat === 'baseline_conflict') return { status: 'edition_review', fields }
  const knownFormat =
    c.current.editionFormat ?? c.baseline.find((b) => b.editionFormat)?.editionFormat
  if (knownFormat === 'audiobook' && fields.pages === 'gap') fields.pages = 'not_applicable'
  return { status: Object.values(fields).includes('gap') ? 'lookup' : 'skip', fields, knownFormat }
}

function binding(value) {
  if (typeof value !== 'string') return null
  const n = fold(value)
  if (
    ['paperback', 'trade paperback', 'mass market paperback', 'softcover', 'soft cover'].includes(n)
  )
    return 'paperback'
  if (['hardcover', 'hardback', 'hard cover'].includes(n)) return 'hardcover'
  if (['ebook', 'e book', 'epub', 'kindle edition'].includes(n)) return 'ebook'
  if (
    [
      'audiobook',
      'audio book',
      'audio cd',
      'audio cassette',
      'audio download',
      'audible audio',
    ].includes(n)
  )
    return 'audiobook'
  return null
}
const language = (v) =>
  typeof v === 'string'
    ? ({
        eng: 'en',
        english: 'en',
        spa: 'es',
        spanish: 'es',
        fra: 'fr',
        fre: 'fr',
        deu: 'de',
        ger: 'de',
        ita: 'it',
        por: 'pt',
        jpn: 'ja',
        kor: 'ko',
        zho: 'zh',
        chi: 'zh',
      }[v.toLowerCase()] ?? v.toLowerCase())
    : null

/** Values are ephemeral subscriber-only review candidates, never automatic updates. */
export function assessSupplement(c, plan, body) {
  const b = body?.book
  const review = (reason) => ({ status: 'review', reason, proposals: [], conflicts: [] })
  if (!object(b) || !text(b.title) || !names(b.authors)) return review('malformed_identity')
  const isbns = [b.isbn13, b.isbn10, b.isbn].filter((v) => v != null && v !== '')
  if (!exactIdentity({ isbns, title: b.title, authors: b.authors }, c.identity))
    return review('identity_mismatch')
  // Do not hide adaptation, abridgement, or other qualifiers in the provider's longer title.
  if (
    b.title_long != null &&
    b.title_long !== '' &&
    (!text(b.title_long) || fold(b.title_long) !== fold(c.identity.title))
  )
    return review('qualified_title_review')
  const format = binding(b.binding)
  if (
    (b.binding != null && b.binding !== '' && !format) ||
    (plan.knownFormat && format && plan.knownFormat !== format)
  )
    return review('edition_format_review')
  if (c.identity.language && b.language && language(b.language) !== c.identity.language)
    return review('edition_language_review')
  const values = {
    pages: pages(b.pages) && format !== 'audiobook' ? b.pages : null,
    editionFormat: format,
  }
  const proposals = [],
    conflicts = []
  for (const field of FIELDS) {
    if (plan.fields[field] === 'baseline_conflict') {
      conflicts.push(field)
      continue
    }
    if (values[field] == null) continue
    const existing = c.current[field] ?? c.baseline.find((v) => v[field] != null)?.[field]
    if (existing != null && existing !== values[field]) conflicts.push(field)
    else if (plan.fields[field] === 'gap')
      proposals.push({
        field,
        value: values[field],
        source: 'isbndb',
        reviewOnly: true,
        retention: 'memory_only',
        observedAt: new Date().toISOString(),
      })
  }
  return {
    status: conflicts.length ? 'review' : proposals.length ? 'candidate' : 'no_usable_gap',
    proposals,
    conflicts,
  }
}

/** Only aggregates leave the runner. No identity, ISBNdb values, or raw errors in reports. */
export async function runSupplement(input, { live = false, client } = {}) {
  validateInput(input)
  const summary = {
    version: 1,
    mode: live ? 'live' : 'dry_run',
    cases: input.cases.length,
    plans: {},
    outcomes: {},
    fields: { pages: { candidate: 0, conflict: 0 }, editionFormat: { candidate: 0, conflict: 0 } },
    requests: 0,
    stopped: null,
    productionWrites: 0,
    modelCalls: 0,
    retention: 'aggregate_only',
  }
  const count = (into, key) => {
    into[key] = (into[key] ?? 0) + 1
  }
  for (const c of input.cases) {
    const plan = planSupplement(c)
    count(summary.plans, plan.status)
    for (const field of FIELDS)
      if (plan.fields[field] === 'baseline_conflict') summary.fields[field].conflict++
    if (plan.status !== 'lookup' || !live) continue
    const response = await client.lookup(canonicalIsbn(c.identity.isbn))
    if (response.status !== 'ok') {
      count(summary.outcomes, response.status)
      continue
    }
    const assessment = assessSupplement(c, plan, response.body)
    count(summary.outcomes, assessment.status)
    for (const p of assessment.proposals) summary.fields[p.field].candidate++
    for (const f of assessment.conflicts)
      if (plan.fields[f] !== 'baseline_conflict') summary.fields[f].conflict++
  }
  if (live) {
    summary.requests = client.stats.requests
    summary.stopped = client.stats.stopped
  }
  return summary
}
