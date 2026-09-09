import { canonicalIsbn, language } from './supplement.mjs'

// This finite registry is the evaluation contract, not a production metadata allowlist.
export const VALUE_FIELDS = ['pages', 'editionFormat', 'publisher', 'publicationDate', 'language']
export const normalizedPublisher = (v) =>
  typeof v === 'string' && v.trim() && v.length <= 500
    ? v.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
    : null
export function publicationDate(v) {
  if (typeof v !== 'string' || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(v)) return null
  const [y, m, d] = v.split('-').map(Number)
  if (y < 1000 || y > 2200 || (m != null && (m < 1 || m > 12))) return null
  if (d != null && (d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate())) return null
  return v
}
export const knownLanguage = (v) => {
  const result = language(v)
  return ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'].includes(result) ? result : null
}
const nonempty = (v) => typeof v === 'string' && v.trim().length > 0

/** Called only after exact identity admission. No text, artwork or related ISBN leaves this projection. */
export function valueMetadata(source, b) {
  const ol = source === 'openlibrary'
  const google = source === 'google'
  const publisher = ol
    ? Array.isArray(b.publishers) && b.publishers.length === 1
      ? b.publishers[0]
      : null
    : b.publisher
  const lang = ol
    ? Array.isArray(b.languages) && b.languages.length === 1
      ? b.languages[0]?.key?.split('/').at(-1)
      : null
    : b.language
  const rawDate = ol ? b.publish_date : google ? b.publishedDate : b.date_published
  const date = publicationDate(rawDate)
  return {
    publisher: normalizedPublisher(publisher),
    publicationDate: date,
    language: knownLanguage(lang),
    unparsedFields: nonempty(rawDate) && date === null ? ['publicationDate'] : [],
    availability: {
      cover: google
        ? Object.values(b.imageLinks ?? {}).some(nonempty)
        : ol
          ? Array.isArray(b.covers) && b.covers.some((v) => Number.isInteger(v) && v > 0)
          : nonempty(b.image) || nonempty(b.image_original),
      description: google
        ? nonempty(b.description)
        : ol
          ? nonempty(b.description) || nonempty(b.description?.value)
          : nonempty(b.synopsis),
      // Other ISBNs are discovery hints, not evidence of safe work merges or series membership.
      relatedEditions:
        source === 'isbndb' &&
        Array.isArray(b.other_isbns) &&
        b.other_isbns.some(
          (v) => canonicalIsbn(v?.isbn) && canonicalIsbn(v.isbn) !== canonicalIsbn(b.isbn13),
        ),
    },
  }
}
