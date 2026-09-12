// Mirror of core/enrichAdmission.ts; parity and actual-handler tests cover this runtime copy.
import type { SourceRecord } from './merge.ts'
import { workIdentityPart } from '../_shared/workIdentity.ts'
export const cleanIsbn = (raw: string): string => (raw || '').replace(/[^0-9Xx]/g, '').toUpperCase()

function validIsbn10(c: string): boolean {
  if (!/^\d{9}[\dX]$/.test(c)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const digit = c[i] === 'X' ? 10 : Number(c[i])
    sum += digit * (10 - i)
  }
  return sum % 11 === 0
}

function validIsbn13(c: string): boolean {
  if (!/^97[89]\d{10}$/.test(c)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(c[i]) * (i % 2 === 0 ? 1 : 3)
  return Number(c[12]) === (10 - (sum % 10)) % 10
}

export function isbn10to13(isbn10: string): string {
  const c = cleanIsbn(isbn10)
  if (!validIsbn10(c)) return ''
  const core = '978' + c.slice(0, 9)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3)
  return core + ((10 - (sum % 10)) % 10)
}

/** Canonical ISBN-13 for matching (ISBN-10 promoted), or '' if not a usable ISBN. */
export function normalizeIsbn(raw: string): string {
  const c = cleanIsbn(raw)
  if (validIsbn13(c)) return c
  if (validIsbn10(c)) return isbn10to13(c)
  return ''
}

export interface EnrichmentIdentity {
  title?: string
  author?: string
  isbn?: string
}

/** Match only the source's declared title or declared title plus subtitle. */
export function sourceTitleMatches(title: string, record: SourceRecord): boolean {
  const key = workIdentityPart(title)
  return (
    !!key &&
    (key === workIdentityPart(record.title ?? '') ||
      (!!record.subtitle && key === workIdentityPart(`${record.title ?? ''} ${record.subtitle}`)))
  )
}

/** Search rank never admits metadata. Work observations cannot supply a selected edition. */
export function admitSourceRecord(
  target: EnrichmentIdentity,
  record: SourceRecord,
): SourceRecord | null {
  const isbn = normalizeIsbn(target.isbn ?? '')
  if (target.isbn?.trim() && !isbn) return null
  if (
    !record.title?.trim() ||
    !Array.isArray(record.authors) ||
    !record.authors.length ||
    record.authors.some((author) => typeof author !== 'string' || !author.trim())
  )
    return null
  if (target.title?.trim() && !sourceTitleMatches(target.title, record)) return null
  const author = workIdentityPart(target.author ?? '')
  if (author && !record.authors.some((value) => workIdentityPart(value) === author)) return null
  const rawIsbns = [record.isbn13, record.isbn10, ...(record.isbns ?? [])].filter(
    Boolean,
  ) as string[]
  const isbns = [...new Set(rawIsbns.map(normalizeIsbn).filter(Boolean))]
  if (isbn && !isbns.includes(isbn)) return null
  if (record.scope === 'edition') {
    // Edition records with competing or malformed identifiers are not a single selected copy.
    if (!isbn || !rawIsbns.length || rawIsbns.some((value) => normalizeIsbn(value) !== isbn))
      return null
    return { ...record, isbn13: isbn, isbns: [isbn], isbn10: undefined }
  }
  // A title-only query has no contributor confirmation. It stays a search result for review.
  if (!target.title?.trim() || !author || record.scope !== 'work') return null
  return {
    title: record.title,
    subtitle: record.subtitle,
    authors: record.authors,
    categories: record.categories,
    description: record.description,
    cover: record.cover,
    scope: 'work',
    ids: record.ids?.work ? { work: record.ids.work } : {},
    // Search series labels also lack relational membership evidence.
  }
}
