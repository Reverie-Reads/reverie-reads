import {
  admitSourceRecord,
  normalizeIsbn,
  sourceTitleMatches,
  type EnrichmentIdentity,
} from './admission.ts'
import { parsePubDate, type SourceRecord } from './merge.ts'
import { SourceBodyError } from '../_shared/httpClassify.ts'

const fields = `id title subtitle isbn_13 isbn_10 pages compilation
  physical_format edition_format release_date release_year
  publisher { name } language { code2 } reading_format { format }
  image { url } cached_image
  book { id title slug description cached_tags
    contributions(order_by: [{ id: asc }], limit: 33) { contribution author { name } }
  }`
export const exactEditionQuery = `query IntakeEdition($isbn: String!, $isbn10: String!) {
  editions(where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn10 } }] }, limit: 2) { ${fields} }
}`
export const workEditionsQuery = `query IntakeEditions($title: String!, $author: String!) {
  editions(where: { book: { title: { _eq: $title }, contributions: { author: { name: { _eq: $author } } } } }, order_by: [{ id: asc }], limit: 51) { ${fields} }
}`

/** ISBN-10 equivalent for exact provider fields; 979 ISBNs have no ISBN-10 equivalent. */
export function equivalentIsbn10(isbn: string): string {
  if (!isbn.startsWith('978') || !normalizeIsbn(isbn)) return ''
  const base = isbn.slice(3, 12)
  const sum = [...base].reduce((n, c, i) => n + Number(c) * (10 - i), 0)
  const check = (11 - (sum % 11)) % 11
  return base + (check === 10 ? 'X' : String(check))
}

type Edition = {
  id?: number
  title?: string
  subtitle?: string
  isbn_13?: string
  isbn_10?: string
  pages?: number
  compilation?: boolean
  physical_format?: string
  edition_format?: string
  release_date?: string
  release_year?: number
  publisher?: { name?: string }
  language?: { code2?: string }
  reading_format?: { format?: string }
  image?: { url?: string }
  cached_image?: { url?: string }
  book?: {
    id?: number
    title?: string
    slug?: string
    description?: string
    cached_tags?: { Genre?: { tag?: string }[] }
    contributions?: { contribution?: string | null; author?: { name?: string } }[]
  }
}

/** Only an exact edition's fields. A parent work confirms identity, never pages/date/binding. */
export function hardcoverEditionRecord(
  raw: unknown,
  target: EnrichmentIdentity,
): SourceRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Edition
  const book = e.book
  const contributions = book?.contributions
  if (
    !Number.isSafeInteger(e.id) ||
    !Number.isSafeInteger(book?.id) ||
    e.compilation !== false ||
    !book?.title ||
    !Array.isArray(contributions) ||
    !contributions.length ||
    contributions.length >= 33 ||
    contributions.some((c) => !c?.author?.name?.trim())
  )
    return null
  const authors = contributions
    .filter((c) => !c.contribution || /^(author|co-author)$/i.test(c.contribution))
    .map((c) => c.author!.name!)
  if (!authors.length) return null
  // A translated/different edition title must not inherit the parent identity silently.
  const title = e.title?.trim() || book.title
  if (
    target.title?.trim() &&
    !sourceTitleMatches(target.title, { title, subtitle: e.subtitle }, !!target.author?.trim())
  )
    return null
  const isbns = [e.isbn_13, e.isbn_10].filter(
    (v): v is string => typeof v === 'string' && !!v.trim(),
  )
  const isbn = normalizeIsbn(target.isbn || isbns[0] || '')
  if (!isbn || isbns.some((v) => normalizeIsbn(v) !== isbn)) return null
  const date = parsePubDate(e.release_date || (e.release_year ? String(e.release_year) : ''))
  const categories = Array.isArray(book.cached_tags?.Genre)
    ? book.cached_tags.Genre.flatMap((t) => (typeof t?.tag === 'string' ? [t.tag] : []))
    : []
  return admitSourceRecord(
    { ...target, isbn },
    {
      scope: 'edition',
      title,
      subtitle: e.subtitle,
      authors,
      isbn13: isbn,
      isbns,
      pageCount: Number.isInteger(e.pages) && e.pages! > 0 && e.pages! <= 20000 ? e.pages : null,
      ...date,
      publisher: e.publisher?.name || '',
      language: e.language?.code2 || '',
      binding: e.physical_format || e.edition_format || e.reading_format?.format || '',
      cover: e.image?.url || e.cached_image?.url || '',
      description: book.description || '',
      categories,
      ids: {
        work: String(book.id),
        edition: String(e.id),
        ...(book.slug ? { slug: book.slug } : {}),
      },
    },
  )
}

export function editionRows(body: unknown): unknown[] {
  const value = body as { errors?: unknown[]; data?: { editions?: unknown[] } }
  if (value?.errors?.length || !Array.isArray(value?.data?.editions))
    throw new SourceBodyError(200, 'https://api.hardcover.app/v1/graphql')
  return value.data.editions
}

export const exactWorkQuery = `query IntakeWork($title: String!, $author: String!) {
  books(where: { title: { _eq: $title }, contributions: { author: { name: { _eq: $author } } } }, limit: 2) {
    id title description cached_tags image { url }
    contributions(order_by: [{ id: asc }], limit: 33) { contribution author { name } }
  }
}`

export function hardcoverWorkRecord(
  body: unknown,
  target: EnrichmentIdentity,
): SourceRecord | null {
  const value = body as {
    errors?: unknown[]
    data?: { books?: (NonNullable<Edition['book']> & { image?: { url?: string } })[] }
  }
  if (value?.errors?.length || !Array.isArray(value?.data?.books))
    throw new SourceBodyError(200, 'https://api.hardcover.app/v1/graphql')
  if (!value.data.books.length) return null
  if (value.data.books.length !== 1) throw new Error('Competing full work identities')
  const b = value.data.books[0]
  if (
    !b?.title ||
    !Number.isSafeInteger(b.id) ||
    !b.contributions?.length ||
    b.contributions.length >= 33 ||
    b.contributions.some((c) => !c?.author?.name)
  )
    throw new Error('Incomplete work identity')
  const authors = b.contributions
    .filter((c) => !c.contribution || /^(author|co-author)$/i.test(c.contribution))
    .map((c) => c.author!.name!)
  // This independent lane resolves WORK facts only. A missing ISBN edition cannot donate pages,
  // publication date, language or binding from some other edition of the matched work.
  return admitSourceRecord(
    { title: target.title, author: target.author },
    {
      scope: 'work',
      title: b.title,
      authors,
      description: b.description || '',
      cover: b.image?.url || '',
      categories: Array.isArray(b.cached_tags?.Genre)
        ? b.cached_tags.Genre.flatMap((t) => (typeof t?.tag === 'string' ? [t.tag] : []))
        : [],
      ids: { work: String(b.id) },
    },
  )
}
