import { getIntakeSourceQualification } from './intakeSourceQualification'
import { normalizeIsbn } from './match'
import { parsePubDate } from './enrich'
import { sourceTitleMatches } from './enrichAdmission'
import { reviewIntakeCreditCollisions } from './intakeCreditReview'
import type { IntakeClaim, IntakeCredit, IntakeFacts, IntakeObservation } from './intakeEvidence'

export type IntakeSource = 'openlibrary' | 'hardcover' | 'penguin_random_house'
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
    contributor: 'contributor',
  }
  // Missing contribution labels do not certify authorship, even if older adapters assumed it.
  return (
    roles[
      String(v ?? '')
        .trim()
        .toLowerCase()
    ] ?? 'unknown'
  )
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
      kind: provider === 'penguin_random_house' ? 'publisher' : 'bibliographic',
      usage: getIntakeSourceQualification(provider, context.retrievedAt).usage,
      method: 'structured',
      url:
        provider === 'openlibrary'
          ? `https://openlibrary.org${/^\/books\/OL\d+M$/.test(recordId) ? recordId : '/developers/api'}`
          : provider === 'hardcover'
            ? 'https://api.hardcover.app/v1/graphql'
            : 'https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Title',
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
function duplicateCredits(
  provider: IntakeSource,
  context: IntakeSourceContext,
  recordId: string,
  credits: IntakeCredit[],
  issues: string[] = [],
): IntakeAdaptation {
  return {
    observations: [
      {
        ...intakeSourceObservation(provider, context, 'failed', recordId),
        withheldCredits: credits,
      },
    ],
    issues: [
      ...new Set([
        ...issues,
        'duplicate_credits',
        ...reviewIntakeCreditCollisions(credits).map((c) => c.kind),
      ]),
    ],
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
    credits.push({ name, role: 'author', scope: 'whole', sourceRole: 'authors', basis: 'edition' })
  }
  if (new Set(credits.map((c) => c.name)).size !== credits.length)
    return duplicateCredits('openlibrary', context, String(b.key), credits)
  const o = intakeSourceObservation('openlibrary', context, 'ok', String(b.key))
  if (b.contributions !== undefined) {
    if (
      !Array.isArray(b.contributions) ||
      b.contributions.length > 32 ||
      !b.contributions.every((x) => text(x))
    )
      return failed('openlibrary', context, 'unusable_credit_statements')
    o.creditStatements = [...b.contributions]
  }
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
  if (o.creditStatements?.length) issues.push('unparsed_credit_statements')
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
    const label = obj(c).contribution
    if (label != null && (typeof label !== 'string' || label.length > 200))
      return failed('hardcover', context, 'invalid_contributor_role')
    credits.push({
      name,
      role: role(label),
      scope: 'whole',
      sourceRole: typeof label === 'string' ? label : null,
      basis: 'work',
    })
  }
  // Match the packet's normalized-credit key. Literal label differences must not let an
  // invalid duplicate through; preserve every credit separately in the withheld review list.
  if (
    new Set(credits.map((c) => JSON.stringify([c.name, c.role, c.scope, c.part]))).size !==
    credits.length
  )
    return duplicateCredits('hardcover', context, String(e.id), credits)
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
  if (formatValues.some((v) => !formats[v])) issues.push('unknown_format')
  editionClaims(
    o,
    {
      pages: e.pages,
      date:
        e.release_date ?? (Number.isInteger(e.release_year) ? String(e.release_year) : undefined),
      publisher: obj(e.publisher).name,
      language: obj(e.language).code2,
      format: [...mapped][0],
    },
    issues,
  )
  return { observations: [o], issues }
}

export interface PenguinRandomHouseIntakeContext extends IntakeSourceContext {
  isbn: string
  /** This pilot is deliberately limited to the US domain; other markets need their own review. */
  domain: 'PRH.US'
  contributorsBasis?: 'edition' | 'work'
}

const prhRoles: Record<string, [IntakeCredit['role'], string, string?]> = {
  A: ['author', 'Author'],
  E: ['editor', 'Editor'],
  T: ['translator', 'Translator'],
  I: ['illustrator', 'Illustrator'],
  '4': ['narrator', 'Read by'],
  Y: ['narrator', 'Narrated by'],
  U: ['foreword', 'Foreword by', 'Foreword'],
  V: ['introduction', 'Introduction by', 'Introduction'],
  '1': ['contributor', 'Preface by', 'Preface'],
  D: ['contributor', 'Afterword by', 'Afterword'],
  Q: ['contributor', 'Epilogue by', 'Epilogue'],
  '2': ['contributor', 'Prologue by', 'Prologue'],
  A1: ['contributor', 'Appendix by', 'Appendix'],
  J: ['contributor', 'Contribution by'],
}

/** PRH envelope success is transport-qualified by the caller. Missing status alone is not an
 * error; explicit provider failure/error is. Empty/malformed JSON cannot establish a title. */
function prhResponseOk(body: Obj): boolean {
  return (
    (body.status === undefined || body.status === 'ok') && body.error == null && body.errors == null
  )
}

/** Shared exact-title envelope guard used before contributor acquisition and during adaptation.
 * The observed title endpoint wraps one record in data.titles; never choose among multiple rows. */
export function prhIntakeTitleRecord(raw: unknown): Obj | null {
  const body = obj(raw),
    data = obj(body.data)
  if (!prhResponseOk(body) || (body.recordCount !== undefined && body.recordCount !== 1))
    return null
  let record: Obj
  if (Object.hasOwn(data, 'titles')) {
    if (!Array.isArray(data.titles) || data.titles.length !== 1 || Object.hasOwn(data, 'title'))
      return null
    record = obj(data.titles[0])
  } else if (typeof data.title === 'object') record = obj(data.title)
  else record = data
  return text(record.title) ? record : null
}

export function prhIntakeIsbnMatches(record: Obj, requested: string): boolean {
  if (
    typeof record.isbn !== 'string' &&
    !(typeof record.isbn === 'number' && Number.isSafeInteger(record.isbn) && record.isbn > 0)
  )
    return false
  const isbn = normalizeIsbn(requested)
  return (
    !!isbn &&
    normalizeIsbn(String(record.isbn ?? '')) === isbn &&
    (record.isbnStr === undefined ||
      (typeof record.isbnStr === 'string' && normalizeIsbn(record.isbnStr) === isbn))
  )
}

/** Title and title-scoped authors responses fetched from fixed exact-ISBN endpoints.
 * No display-string author fallback, work-credit promotion or completeness assertion.
 * Role mapping: official Enhanced PRH API /concepts/Contributor_role documentation. */
export function adaptPenguinRandomHouseIntake(
  titlePayload: unknown,
  contributorsPayload: unknown,
  context: PenguinRandomHouseIntakeContext,
): IntakeAdaptation {
  const provider = 'penguin_random_house',
    isbn = normalizeIsbn(context.isbn),
    creditBody = obj(contributorsPayload)
  if (!isbn || context.domain !== 'PRH.US') return failed(provider, context, 'invalid_prh_scope')
  if (!prhResponseOk(creditBody)) return failed(provider, context, 'invalid_prh_response')
  const b = prhIntakeTitleRecord(titlePayload),
    rows = Array.isArray(creditBody.data) ? creditBody.data : obj(creditBody.data).authors
  if (!b) return failed(provider, context, 'invalid_prh_title_response')
  if (!prhIntakeIsbnMatches(b, isbn))
    return failed(provider, context, 'prh_edition_identity_mismatch')
  if (b.domain !== undefined && b.domain !== context.domain)
    return failed(provider, context, 'territory_conflict')
  // Returned self links, when present, must corroborate the endpoint chosen by trusted code.
  // Never follow them, retain their query strings, or accept a work endpoint as edition evidence.
  for (const [record, suffix] of [
    [b, ''],
    [obj(titlePayload), ''],
    [obj(obj(titlePayload).data), ''],
    [creditBody, '/authors'],
    [obj(creditBody.data), '/authors'],
  ] as const) {
    if (record._links === undefined || record._links === null) continue
    if (!Array.isArray(record._links) || record._links.length > 100)
      return failed(provider, context, 'invalid_prh_links')
    for (const link of record._links.map(obj).filter((l) => l.rel === 'self')) {
      try {
        const url = new URL(String(link.href))
        if (
          url.origin !== 'https://api.penguinrandomhouse.com' ||
          !url.pathname.endsWith(`/domains/${context.domain}/titles/${isbn}${suffix}`)
        )
          return failed(provider, context, 'prh_endpoint_scope_conflict')
      } catch {
        return failed(provider, context, 'invalid_prh_links')
      }
    }
  }

  if (
    !Array.isArray(rows) ||
    !rows.length ||
    (creditBody.recordCount !== undefined &&
      (!Number.isSafeInteger(creditBody.recordCount) || (creditBody.recordCount as number) < 0))
  )
    return failed(provider, context, 'incomplete_contributors')
  if (rows.length > 32) return failed(provider, context, 'contributor_cap', true)
  const credits: IntakeCredit[] = [],
    issues = ['partial_contributor_roster', 'territory_specific_edition'],
    ids = new Set<number>()
  // Observed title-scoped responses can count the envelope differently from its authors array.
  // The count's semantics remain unqualified; it never certifies a complete roster.
  if (creditBody.recordCount !== rows.length) issues.push('contributor_count_unqualified')

  for (const raw of rows) {
    const c = obj(raw),
      name = text(c.display),
      code = c.contribRoleCode,
      label = c.contribRoleDesc
    if (!name || !Number.isSafeInteger(c.authorId) || (c.authorId as number) <= 0)
      return failed(provider, context, 'incomplete_contributors')
    if (
      (code != null && (typeof code !== 'string' || code.length > 40)) ||
      (label != null && (typeof label !== 'string' || label.length > 200))
    )
      return failed(provider, context, 'invalid_contributor_role')
    ids.add(c.authorId as number)
    const mapped =
      typeof code === 'string' && Object.hasOwn(prhRoles, code) ? prhRoles[code] : undefined
    const compatible =
      mapped &&
      (label == null ||
        label === '' ||
        (typeof label === 'string' &&
          (label.trim().toLowerCase() === mapped[1].toLowerCase() ||
            (code === 'A' && label.trim().toLowerCase() === 'written by'))))
    if (mapped && !compatible) issues.push('conflicting_contributor_role')
    if (!mapped) issues.push('unqualified_contributor_role')
    credits.push({
      name,
      role: compatible ? mapped[0] : 'unknown',
      scope: mapped?.[2] ? 'part' : 'whole',
      ...(mapped?.[2] ? { part: mapped[2] } : {}),
      sourceRole: typeof label === 'string' ? label : null,
      sourceRoleCode: typeof code === 'string' ? code : null,
      sourceContributorId: String(c.authorId),
      basis: context.contributorsBasis ?? 'edition',
    })
  }
  if (ids.size > 5) return failed(provider, context, 'contributor_cap', true)
  const recordId = `${context.domain}:${isbn}`
  if (reviewIntakeCreditCollisions(credits).length)
    return duplicateCredits(provider, context, recordId, credits, issues)
  const o = intakeSourceObservation(provider, context, 'ok', recordId)
  o.source.url = `https://api.penguinrandomhouse.com/resources/v2/title/domains/${context.domain}/titles/${isbn}`
  if (context.contributorsBasis === 'work') {
    o.status = 'failed'
    o.withheldCredits = credits
    return { observations: [o], issues: [...issues, 'work_contributors_not_edition_evidence'] }
  }
  o.identity = {
    title: text(b.title)!,
    contributors: credits,
    scope: 'edition',
    isbns: [isbn],
    ...(text(b.subtitle) ? { subtitle: text(b.subtitle) } : {}),
  }
  o.claims.push({
    id: 'contributors',
    field: 'contributors',
    value: credits,
    scope: 'edition',
    locator: `${context.domain} titles/${isbn}/authors (partial roster; order as returned)`,
  })
  const formatValues = [obj(b.format).description, b.formatFamily, b.consumerFormat]
    .map((v) => text(v)?.toLowerCase())
    .filter((v): v is string => !!v)
  const mappedFormats = new Set(
    formatValues.filter((v) => Object.hasOwn(formats, v)).map((v) => formats[v]),
  )
  // TR is verified in the official title representation; other codes remain uninterpreted.
  if (obj(b.format).code === 'TR') mappedFormats.add('paperback')
  else if (obj(b.format).code != null) issues.push('unmapped_format_code')

  if (mappedFormats.size > 1) return failed(provider, context, 'conflicting_edition_formats')
  if (formatValues.some((v) => !Object.hasOwn(formats, v))) issues.push('unknown_format')
  // Only the title's territory-specific on-sale date is an edition observation. Never earliest work date.
  const date = text(b.onsale)
  const validDate =
    date &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  if (b.onsale != null && !validDate) issues.push('unparsed_publication_date')
  editionClaims(
    o,
    {
      pages: b.pages,
      date: validDate ? date : undefined,
      publisher: obj(b.imprint).description,
      language: b.language,
      format: [...mappedFormats][0],
    },
    issues,
  )
  for (const claim of o.claims)
    if (claim.field !== 'contributors')
      claim.locator = `${context.domain} titles/${isbn}: ${claim.locator}`
  return { observations: [o], issues: [...new Set(issues)] }
}
