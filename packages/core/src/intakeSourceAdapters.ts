import { parsePubDate } from './enrich'
import { sourceTitleMatches } from './enrichAdmission'
import type { IntakeClaim, IntakeCredit, IntakeFacts, IntakeObservation } from './intakeEvidence'

export type IntakeSource = 'openlibrary' | 'hardcover'
export interface IntakeSourceContext {
  targetFingerprint: string
  retrievedAt: string
}
export interface IntakeAdaptation {
  observations: IntakeObservation[]
  issues: string[]
}
type Obj = Record<string, unknown>
const obj = (v: unknown): Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}
const text = (v: unknown, max = 1000): string | undefined =>
  typeof v === 'string' && !!v.trim() && v.length <= max ? v.trim() : undefined
const strings = (v: unknown): string[] | null =>
  v === undefined ? [] : Array.isArray(v) && v.every((x) => text(x, 100)) ? v : null
const formats: Record<string, IntakeFacts['format']> = {
  paperback: 'paperback',
  'mass market paperback': 'paperback',
  'trade paperback': 'paperback',
  hardcover: 'hardcover',
  hardback: 'hardcover',
  ebook: 'ebook',
  'e-book': 'ebook',
  audiobook: 'audiobook',
  audio: 'audiobook',
}
const role = (v: unknown): IntakeCredit['role'] => {
  const roles: Record<string, IntakeCredit['role']> = {
    author: 'author',
    'co-author': 'author',
    editor: 'editor',
    translator: 'translator',
    illustrator: 'illustrator',
    narrator: 'narrator',
    foreword: 'foreword',
    introduction: 'introduction',
    playwright: 'playwright',
    'original story': 'original_story',
  }
  // Missing contribution labels do not certify authorship, even if older adapters assumed it.
  return roles[String(v ?? '').toLowerCase()] ?? 'unknown'
}

/** Qualification is code-owned. Neither the response nor a CLI caller can grant authority.
 * Upstream lineage is unknown: two different APIs are not two independent origins. */
export function intakeSourceObservation(
  provider: IntakeSource,
  context: IntakeSourceContext,
  status: IntakeObservation['status'],
  recordId = 'lookup',
): IntakeObservation {
  return {
    id: `${provider}:${recordId}`,
    targetFingerprint: context.targetFingerprint,
    status,
    source: {
      provider,
      recordId,
      retrievedAt: context.retrievedAt,
      lineage: null,
      kind: 'bibliographic',
      usage: 'review_only',
      method: 'structured',
      url:
        provider === 'openlibrary'
          ? `https://openlibrary.org${/^\/books\/OL\d+M$/.test(recordId) ? recordId : '/developers/api'}`
          : 'https://api.hardcover.app/v1/graphql',
    },
    claims: [],
  }
}
function failed(
  provider: IntakeSource,
  c: IntakeSourceContext,
  issue: string,
  capped = false,
): IntakeAdaptation {
  return {
    observations: [intakeSourceObservation(provider, c, capped ? 'capped' : 'failed')],
    issues: [issue],
  }
}
function editionClaims(
  o: IntakeObservation,
  values: {
    pages?: unknown
    date?: unknown
    publisher?: unknown
    format?: unknown
    language?: unknown
  },
  issues: string[],
) {
  const add = (c: IntakeClaim) => o.claims.push(c)
  const fmt = text(values.format)?.toLowerCase()
  const format = fmt ? formats[fmt] : undefined
  if (fmt && !format) issues.push('unknown_format')
  if (format)
    add({
      id: 'format',
      field: 'format',
      value: format,
      scope: 'edition',
      locator: 'edition format',
    })
  if (values.pages != null) {
    if (
      typeof values.pages === 'number' &&
      Number.isInteger(values.pages) &&
      values.pages > 0 &&
      values.pages <= 20000 &&
      format !== 'audiobook'
    )
      add({
        id: 'pages',
        field: 'pages',
        value: values.pages,
        scope: 'edition',
        locator: 'edition page count',
      })
    else issues.push('unusable_page_count')
  }
  const date = parsePubDate(text(values.date) ?? '')
  if (date.pubY !== null)
    add({
      id: 'publication',
      field: 'publication',
      value: { y: date.pubY, m: date.pubM, d: date.pubD },
      scope: 'edition',
      locator: 'edition publication date',
    })
  else if (values.date) issues.push('unparsed_publication_date')
  const publisher = text(values.publisher)
  if (publisher)
    add({
      id: 'publisher',
      field: 'publisher',
      value: publisher,
      scope: 'edition',
      locator: 'edition publisher',
    })
  const language = text(values.language, 100)
  // Do not silently equate different language vocabularies. Preserve the source literal for review.
  if (language)
    add({
      id: 'language',
      field: 'language',
      value: language,
      scope: 'edition',
      locator: 'edition language code',
    })
}

/** Exact edition JSON plus key-bound author responses, not work-search summaries. */
export function adaptOpenLibraryIntake(
  raw: unknown,
  authors: Record<string, unknown>,
  context: IntakeSourceContext,
): IntakeAdaptation {
  const b = obj(raw),
    isbns13 = strings(b.isbn_13),
    isbns10 = strings(b.isbn_10)
  if (
    !text(b.title) ||
    !/^\/books\/OL\d+M$/.test(String(b.key)) ||
    !isbns13 ||
    !isbns10 ||
    isbns13.length + isbns10.length > 20 ||
    !Array.isArray(b.authors) ||
    !b.authors.length
  )
    return failed('openlibrary', context, 'malformed_edition_identity')
  if (b.authors.length > 8) return failed('openlibrary', context, 'contributor_cap', true)
  const credits: IntakeCredit[] = []
  for (const ref of b.authors) {
    const key = obj(ref).key
    if (typeof key !== 'string' || !/^\/authors\/OL\d+A$/.test(key))
      return failed('openlibrary', context, 'invalid_author_reference')
    const a = obj(authors[key]),
      name = text(a.name)
    if (a.key !== key || !name) return failed('openlibrary', context, 'incomplete_author_lookup')
    credits.push({ name, role: 'author', scope: 'whole' })
  }
  if (new Set(credits.map((c) => c.name)).size !== credits.length)
    return failed('openlibrary', context, 'duplicate_credits')
  const o = intakeSourceObservation('openlibrary', context, 'ok', String(b.key))
  o.identity = {
    title: text(b.title)!,
    contributors: credits,
    scope: 'edition',
    isbns: [...isbns13, ...isbns10],
    ...(text(b.subtitle) ? { subtitle: text(b.subtitle) } : {}),
  }
  // Edition contributors remain edition-scoped. The API's author relationship is an observation,
  // not proof of a complete or correctly role-labelled credit list.
  o.claims.push({
    id: 'contributors',
    field: 'contributors',
    value: credits,
    scope: 'edition',
    locator: 'authors[] -> key-bound author.name',
  })
  const issues: string[] = []
  const publishers = strings(b.publishers)
  const languages = Array.isArray(b.languages) ? b.languages : []
  editionClaims(
    o,
    {
      pages: b.number_of_pages,
      date: b.publish_date,
      publisher: publishers?.length === 1 ? publishers[0] : undefined,
      format: b.physical_format,
      language:
        languages.length === 1 && /^\/languages\/[a-z]{3}$/.test(String(obj(languages[0]).key))
          ? String(obj(languages[0]).key).slice(-3)
          : undefined,
    },
    issues,
  )
  if ((publishers?.length ?? 0) > 1) issues.push('multiple_publishers')
  // Description/cover/series are deliberately not harvested in this limited retention pilot.
  return { observations: [o], issues }
}

/** Bounded exact-edition GraphQL result; no first-result choice, work-level ISBN or median pages. */
export function adaptHardcoverIntake(raw: unknown, context: IntakeSourceContext): IntakeAdaptation {
  const body = obj(raw),
    rows = obj(body.data).editions
  if (body.errors || !Array.isArray(rows))
    return failed('hardcover', context, 'invalid_graphql_response')
  if (!rows.length)
    return { observations: [intakeSourceObservation('hardcover', context, 'empty')], issues: [] }
  if (rows.length >= 2) return failed('hardcover', context, 'competing_or_capped_editions', true)
  const e = obj(rows[0]),
    b = obj(e.book),
    credits: IntakeCredit[] = []
  const cs = b.contributions
  if (
    !Number.isSafeInteger(e.id) ||
    !Number.isSafeInteger(b.id) ||
    !text(b.title) ||
    !Array.isArray(cs) ||
    !cs.length ||
    e.compilation !== false
  )
    return failed('hardcover', context, 'incomplete_or_compilation_identity')
  if (cs.length >= 33) return failed('hardcover', context, 'contributor_cap', true)
  for (const c of cs) {
    const name = text(obj(obj(c).author).name)
    if (!name) return failed('hardcover', context, 'incomplete_contributors')
    credits.push({ name, role: role(obj(c).contribution), scope: 'whole' })
  }
  if (new Set(credits.map((c) => JSON.stringify(c))).size !== credits.length)
    return failed('hardcover', context, 'duplicate_credits')
  const isbns = [e.isbn_13, e.isbn_10].filter((x) => x !== null && x !== undefined && x !== '')
  if (isbns.some((x) => !text(x, 100))) return failed('hardcover', context, 'malformed_isbn')
  // Do not use parent title as proof for an edition with an absent title.
  if (!text(e.title)) return failed('hardcover', context, 'missing_edition_title')
  if (!sourceTitleMatches(text(e.title)!, { title: text(b.title)! }, false))
    return failed('hardcover', context, 'edition_parent_title_conflict')
  const o = intakeSourceObservation('hardcover', context, 'ok', String(e.id))
  o.identity = {
    title: text(e.title)!,
    contributors: credits,
    scope: 'edition',
    isbns: isbns as string[],
    ...(text(e.subtitle) ? { subtitle: text(e.subtitle) } : {}),
  }
  o.claims.push({
    id: 'contributors',
    field: 'contributors',
    value: credits,
    scope: 'edition',
    locator: 'book.contributions[] (work-level credit observation, completeness unverified)',
  })
  const issues = credits.some((c) => c.role === 'unknown') ? ['unqualified_contributor_role'] : []
  const formatValues = [e.physical_format, e.edition_format, obj(e.reading_format).format]
    .map((v) => text(v)?.toLowerCase())
    .filter((v): v is string => !!v)
  const mapped = new Set(formatValues.map((v) => formats[v]).filter(Boolean))
  if (mapped.size > 1) return failed('hardcover', context, 'conflicting_edition_formats')
  editionClaims(
    o,
    {
      pages: e.pages,
      date:
        e.release_date ?? (Number.isInteger(e.release_year) ? String(e.release_year) : undefined),
      publisher: obj(e.publisher).name,
      language: obj(e.language).code2,
      format: formatValues[0],
    },
    issues,
  )
  return { observations: [o], issues }
}
