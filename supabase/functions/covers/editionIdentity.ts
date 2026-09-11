/** Provider search rank is not evidence that an image belongs to the requested book. */
export interface CoverIdentity {
  isbn?: string
  title?: string
  author?: string
}

// Dependency-free twin of _shared/workIdentity.ts; directly exercised by the core gate.
const norm = (value: string): string =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '')

/** ISBN-10 and its 978 ISBN-13 identify the same edition; punctuation is presentation only. */
function isbnKey(value: unknown): string {
  if (typeof value !== 'string') return ''
  const clean = value.replace(/[^0-9Xx]/g, '').toUpperCase()
  if (/^\d{13}$/.test(clean)) return clean
  if (!/^\d{9}[\dX]$/.test(clean)) return ''
  const stem = `978${clean.slice(0, 9)}`
  let sum = 0
  for (let i = 0; i < stem.length; i++) sum += Number(stem[i]) * (i % 2 ? 3 : 1)
  return stem + ((10 - (sum % 10)) % 10)
}

export function matchesCoverWork(input: CoverIdentity, title: unknown, authors: unknown): boolean {
  const wantedTitle = norm(input.title ?? '')
  const wantedAuthor = norm(input.author ?? '')
  return (
    !!wantedTitle &&
    !!wantedAuthor &&
    typeof title === 'string' &&
    wantedTitle === norm(title) &&
    Array.isArray(authors) &&
    authors.some((author: unknown) => typeof author === 'string' && norm(author) === wantedAuthor)
  )
}

export function uniqueCoverBookId(ids: unknown[]): number | null {
  const parsed = ids.map((id) => (typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id))
  if (
    !parsed.length ||
    parsed.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
  )
    return null
  const unique = new Set(parsed as number[])
  return unique.size === 1 ? [...unique][0]! : null
}

export function hardcoverCoverBookId(input: CoverIdentity, hits: unknown): number | null {
  if (!Array.isArray(hits)) return null
  const ids: unknown[] = []
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object') continue
    const document = (hit as { document?: unknown }).document
    if (!document || typeof document !== 'object') continue
    const book = document as Record<string, unknown>
    if (matchesCoverWork(input, book.title, book.author_names)) ids.push(book.id)
  }
  return uniqueCoverBookId(ids)
}

/** New identity policy cannot reuse older, unverified search results from the seven-day cache. */
export function editionsCacheKey(input: CoverIdentity): string {
  return `editions:v2:${isbnKey(input.isbn)}:${norm(input.title ?? '')}|${norm(input.author ?? '')}`
}
