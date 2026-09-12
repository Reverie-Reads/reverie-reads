import type { SourceRecord } from './enrich'
import { normalizeIsbn } from './match'
import { workIdentityPart } from './normalize'

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
