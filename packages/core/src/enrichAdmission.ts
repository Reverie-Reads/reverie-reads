import type { SourceRecord } from './enrich'
import { normalizeIsbn } from './match'
import { workIdentityPart } from './normalize'

export interface EnrichmentIdentity {
  title?: string
  author?: string
  isbn?: string
}

// These comparison-only forms never change stored titles, contributor keys or series evidence.
const titleKey = (value: string): string =>
  workIdentityPart(value.replace(/(^|\s)&(?=\s|$)/g, '$1and'))

function authorKey(value: string): string {
  const parts = value.split(',').map((part) => part.trim())
  // Only an explicit two-part surname-first form. Do not drop initials, expand them, sort
  // tokens, or guess whether a suffix/multiple commas represent an author or a contributor list.
  if (
    parts.length === 2 &&
    parts.every((part) => /\p{L}/u.test(part)) &&
    !parts.some((part) => /^(jr|sr|ii|iii|iv|phd|md)\.?$/i.test(part))
  )
    return workIdentityPart(`${parts[1]} ${parts[0]}`)
  return workIdentityPart(value)
}

function titleWords(value: string): string[] {
  return (
    value
      .replace(/(^|\s)&(?=\s|$)/g, '$1and')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/\p{M}/gu, '')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
}

function descriptiveTitleVariant(left: string, right: string): boolean {
  const a = titleWords(left)
  const b = titleWords(right)
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  if (short.length < 2 || !short.every((word, i) => word === long[i])) return false
  const tail = long.slice(short.length)
  // A bounded descriptive phrase across genres, not arbitrary subtitle/prefix stripping.
  // Volume, edition, translation, multi-work and related-work qualifiers remain significant.
  return (
    tail.length >= 2 &&
    tail.length <= 8 &&
    /^(a|an)$/.test(tail[0] ?? '') &&
    /^(novel|novella|romance|thriller|mystery|fantasy|memoir|biography|autobiography|history)$/.test(
      tail[tail.length - 1] ?? '',
    ) &&
    tail.every((word) => /^\p{L}+$/u.test(word)) &&
    !tail.some((word) =>
      /^(book|volume|vol|part|edition|ed|revised|expanded|abridged|unabridged|illustrated|adapted|adaptation|translation|translated|retelling|omnibus|collection|anthology|companion|sequel|prequel|summary|guide|workbook|study|box|set|graphic|comic|comics|manga|audio|audiobook|braille|print|large|deluxe|special|collector|collectors|anniversary|signed|limited|paperback|hardcover|hardback|ebook|epub|kindle|unofficial|unauthorized|and|or|with|plus|of|for|[ivxlcdm]+)$/.test(
        word,
      ),
    )
  )
}

/** Formatting alternatives require a separately verified edition ISBN and full author. */
export function sourceTitleMatches(
  title: string,
  record: SourceRecord,
  editionFormatting = false,
): boolean {
  const key = workIdentityPart(title)
  const titles = [record.title ?? '']
  if (record.subtitle) titles.push(`${record.title ?? ''} ${record.subtitle}`)
  return (
    !!key &&
    titles.some(
      (candidate) =>
        key === workIdentityPart(candidate) ||
        (editionFormatting &&
          (titleKey(title) === titleKey(candidate) || descriptiveTitleVariant(title, candidate))),
    )
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
  const rawIsbns = [record.isbn13, record.isbn10, ...(record.isbns ?? [])].filter(
    Boolean,
  ) as string[]
  const isbns = [...new Set(rawIsbns.map(normalizeIsbn).filter(Boolean))]
  if (isbn && !isbns.includes(isbn)) return null
  const exactEdition =
    record.scope === 'edition' &&
    !!isbn &&
    rawIsbns.length > 0 &&
    rawIsbns.every((value) => normalizeIsbn(value) === isbn)
  if (record.scope === 'edition' && !exactEdition) return null
  const author = workIdentityPart(target.author ?? '')
  const formatting = exactEdition && !!author
  if (target.title?.trim() && !sourceTitleMatches(target.title, record, formatting)) return null
  if (
    author &&
    !record.authors.some(
      (value) =>
        workIdentityPart(value) === author ||
        (formatting && authorKey(value) === authorKey(target.author!)),
    )
  )
    return null
  if (exactEdition) return { ...record, isbn13: isbn, isbns: [isbn], isbn10: undefined }
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
