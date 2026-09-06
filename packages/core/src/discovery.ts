import { normalizeIsbn } from './match'
import { genreKey } from './genreNormalize'
import type { Book } from './types'

/** Public catalog facts only. A snapshot never contains a reader's notes, ratings, or read log. */
export interface DiscoveryBook {
  corpusWorkId?: string
  title: string
  authors: string[]
  cover: string
  coverThumb?: string
  isbn: string
  pub: string
  genre?: string
  genres?: string[]
  tags?: string[]
  description?: string
  catalogSource?: 'corpus' | 'catalog' | 'curated'
}
export const DISCOVERY_MOODS = ['Reflective', 'Hopeful', 'Unsettling', 'Adventurous'] as const
export type DiscoveryMood = (typeof DISCOVERY_MOODS)[number]
export type DiscoveryIntent =
  | { kind: 'anchor'; anchor: DiscoveryBook }
  | { kind: 'mood'; moods: DiscoveryMood[] }
  | { kind: 'genre'; genre: string }
export interface DiscoveryPick {
  book: DiscoveryBook
  reason: string
  basis: 'author' | 'genre' | 'description' | 'semantic' | 'series'
}
export interface DiscoverySession {
  version: 1
  id: string
  createdAt: string
  intent: DiscoveryIntent
  picks: DiscoveryPick[]
  dismissed: string[]
}
export const DISCOVERY_LIMIT = 5
export const DISCOVERY_POOL_LIMIT = 32
export const DISCOVERY_SAVED_LIMIT = 50
const norm = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
const authorKey = (book: Pick<DiscoveryBook, 'authors'>) =>
  book.authors.map(norm).filter(Boolean).sort().join('|')
export const discoveryKey = (book: DiscoveryBook): string =>
  book.corpusWorkId ? `work:${book.corpusWorkId}` : `title:${norm(book.title)}|${authorKey(book)}`

/** Conflicting known corpus identities stay distinct. Title matching never picks an ambiguous row. */
export function sameDiscoveryWork(a: DiscoveryBook, b: DiscoveryBook): boolean {
  if (a.corpusWorkId && b.corpusWorkId) return a.corpusWorkId === b.corpusWorkId
  const isbn = normalizeIsbn(a.isbn)
  if (isbn && isbn === normalizeIsbn(b.isbn)) return true
  return Boolean(authorKey(a)) && norm(a.title) === norm(b.title) && authorKey(a) === authorKey(b)
}
export function discoveryBookFromReader(book: Book): DiscoveryBook {
  return {
    corpusWorkId: book.corpusWorkId,
    title: book.title,
    authors: book.contributors
      .filter((c) => c.role === 'author' || c.role === 'co_author')
      .map((c) => c.name)
      .filter(Boolean).length
      ? book.contributors
          .filter((c) => c.role === 'author' || c.role === 'co_author')
          .map((c) => c.name)
          .filter(Boolean)
      : [[book.first, book.last].filter(Boolean).join(' ')].filter(Boolean),
    cover: book.cover,
    coverThumb: book.coverThumb,
    isbn: book.isbn,
    pub: book.pub.y ? String(book.pub.y) : '',
    genre: book.genre,
    genres: book.genres,
  }
}
export function discoveryLibraryMatch(
  hit: DiscoveryBook,
  books: readonly Book[],
): Book | undefined {
  if (hit.corpusWorkId) {
    const exact = books.filter((b) => b.corpusWorkId === hit.corpusWorkId)
    if (exact.length) return exact.length === 1 ? exact[0] : undefined
  }
  const isbn = normalizeIsbn(hit.isbn)
  const editions = isbn
    ? books.filter(
        (b) =>
          (!hit.corpusWorkId || !b.corpusWorkId || hit.corpusWorkId === b.corpusWorkId) &&
          normalizeIsbn(b.isbn) === isbn,
      )
    : []
  if (editions.length) return editions.length === 1 ? editions[0] : undefined
  const matches = books.filter((b) => sameDiscoveryWork(hit, discoveryBookFromReader(b)))
  return matches.length === 1 ? matches[0] : undefined
}
export function discoveryRelationship(
  book?: Pick<Book, 'ownership' | 'borrowed' | 'wishlist'>,
): string {
  if (!book) return 'New to your library'
  const states = [
    book.ownership === 'owned' && 'Owned',
    book.borrowed && 'Borrowed',
    book.wishlist && 'On your wishlist',
  ].filter(Boolean)
  return states.length ? states.join(' · ') : 'In your library'
}
export function dedupeDiscoveryBooks(books: readonly DiscoveryBook[]): DiscoveryBook[] {
  const out: DiscoveryBook[] = []
  for (const book of books) {
    if (!book.title.trim()) continue
    const index = out.findIndex((existing) => sameDiscoveryWork(existing, book))
    if (index < 0) out.push(book)
    // Keep the discovery position while preferring a known shared identity. Reordering every
    // corpus record before every external record would undo the balanced candidate pool.
    else if (book.corpusWorkId && !out[index]!.corpusWorkId) out[index] = book
  }
  return out
}
const bookGenres = (book: DiscoveryBook) => [
  ...new Set([book.genre, ...(book.genres ?? [])].filter(Boolean).map((g) => genreKey(g!))),
]
const sharedGenre = (a: DiscoveryBook, b: DiscoveryBook) =>
  bookGenres(a).find((g) => bookGenres(b).includes(g))

/** Reviewed search vocabulary. These are retrieval terms, never new personal mood assignments.
 * Require actual whole-word evidence: "hopeless" must not become a hopeful recommendation. */
export const DISCOVERY_MOOD_TERMS: Record<DiscoveryMood, readonly string[]> = {
  Reflective: ['reflective', 'introspective', 'contemplative', 'meditative', 'reflection'],
  Hopeful: ['hope', 'hopeful', 'uplifting', 'optimism', 'optimistic', 'healing'],
  Unsettling: ['unsettling', 'disturbing', 'eerie', 'dread', 'nightmare', 'haunted', 'horror'],
  Adventurous: [
    'adventure',
    'adventurous',
    'quest',
    'journey',
    'expedition',
    'exploration',
    'voyage',
  ],
}
export function discoveryMoodEvidence(
  book: DiscoveryBook,
  moods: readonly DiscoveryMood[],
): string[] | null {
  if (!moods.length || moods.length > 2) return null
  const text = ` ${norm([book.description, book.genre, ...(book.genres ?? []), ...(book.tags ?? [])].filter(Boolean).join(' '))} `
  const evidence = moods.map((mood) =>
    DISCOVERY_MOOD_TERMS[mood].find((term) => text.includes(` ${term} `)),
  )
  return evidence.every(Boolean) ? (evidence as string[]) : null
}
export function discoveryIntentText(intent: DiscoveryIntent): string {
  if (intent.kind === 'anchor')
    return [
      intent.anchor.title,
      intent.anchor.authors.join(', '),
      intent.anchor.genre,
      intent.anchor.description,
    ]
      .filter(Boolean)
      .join('. ')
      .slice(0, 1200)
  if (intent.kind === 'genre') return intent.genre
  return intent.moods.map((mood) => `${mood}: ${DISCOVERY_MOOD_TERMS[mood].join(', ')}`).join('. ')
}
export function discoveryIntentLabel(intent: DiscoveryIntent): string {
  if (intent.kind === 'anchor') return `From ${intent.anchor.title}`
  if (intent.kind === 'mood') return intent.moods.join(' + ')
  return `Exploring ${intent.genre}`
}
export function eligibleDiscoveryBooks(
  pool: readonly DiscoveryBook[],
  intent: DiscoveryIntent,
  library: readonly Book[],
): DiscoveryBook[] {
  return dedupeDiscoveryBooks(pool).filter((book) => {
    if (intent.kind === 'anchor' && sameDiscoveryWork(book, intent.anchor)) return false
    // Suppression asks whether ANY matching copy is held; it must not choose one edition.
    // The detail-link resolver deliberately returns undefined for ambiguous personal rows.
    if (
      library.some(
        (personal) =>
          sameDiscoveryWork(book, discoveryBookFromReader(personal)) &&
          (!personal.wishlist || personal.ownership === 'owned' || personal.borrowed),
      )
    )
      return false
    if (intent.kind === 'mood') return discoveryMoodEvidence(book, intent.moods) !== null
    if (intent.kind === 'genre') return bookGenres(book).includes(genreKey(intent.genre))
    return true
  })
}
/** Every bounded source gets a turn before the ranking ceiling, after library filtering.
 * A full author/corpus query must not crowd the wider catalog out before it can be compared. */
export function discoveryCandidatePool(
  groups: readonly (readonly DiscoveryBook[])[],
  intent: DiscoveryIntent,
  library: readonly Book[],
): DiscoveryBook[] {
  const eligible = groups.map((group) => eligibleDiscoveryBooks(group, intent, library))
  const mixed: DiscoveryBook[] = []
  const longest = Math.max(0, ...eligible.map((group) => group.length))
  for (let i = 0; i < longest; i++) {
    for (const group of eligible) if (group[i]) mixed.push(group[i]!)
  }
  return dedupeDiscoveryBooks(mixed).slice(0, DISCOVERY_POOL_LIMIT)
}
/** Semantic scores may order source-supported choices, but cannot invent a shared theme. */
export function discoveryShortlist(
  pool: readonly DiscoveryBook[],
  intent: DiscoveryIntent,
  scores: Readonly<Record<string, number>> = {},
): DiscoveryPick[] {
  const picks: { pick: DiscoveryPick; priority: number; semantic: number | null; index: number }[] =
    []
  pool.forEach((book, index) => {
    const score = scores[discoveryKey(book)]
    const semantic =
      typeof score === 'number' && Number.isFinite(score) && score >= -1 && score <= 1
        ? score
        : null
    let reason = ''
    let basis: DiscoveryPick['basis'] = 'genre'
    let priority = 0
    if (intent.kind === 'mood') {
      const evidence = discoveryMoodEvidence(book, intent.moods)
      if (!evidence) return
      reason = `For your ${intent.moods.map((m) => m.toLowerCase()).join(' + ')} search: the catalog description or tags include ${evidence.map((term) => `“${term}”`).join(' and ')}. Read a little to see if it fits.`
      basis = 'description'
    } else if (intent.kind === 'genre') {
      if (!bookGenres(book).includes(genreKey(intent.genre))) return
      reason =
        book.catalogSource === 'curated'
          ? `An editorial pick from our ${intent.genre.toLowerCase()} shelf, the genre you chose.`
          : `You chose ${intent.genre.toLowerCase()}. This book is cataloged on that shelf.`
    } else {
      const sharedAuthor = book.authors.find((a) =>
        intent.anchor.authors.some((b) => norm(a) === norm(b)),
      )
      if (sharedAuthor) {
        reason = `Another book by ${sharedAuthor}, the author of ${intent.anchor.title}.`
        basis = 'author'
        priority = 2
      } else if (sharedGenre(book, intent.anchor)) {
        reason = `More ${sharedGenre(book, intent.anchor)}, a genre shared with ${intent.anchor.title}.`
        priority = 1
      } else return
    }
    picks.push({ pick: { book, reason, basis }, priority, semantic, index })
  })
  const completePriorities = new Set(
    picks
      .map((p) => p.priority)
      .filter((priority) =>
        picks.filter((p) => p.priority === priority).every((p) => p.semantic !== null),
      ),
  )
  const ordered = picks.sort(
    (a, b) =>
      b.priority - a.priority ||
      // Rank each evidence tier semantically only when its coverage is complete. Treating
      // unscored candidates as zero would promote whichever batch happened to finish first.
      (completePriorities.has(a.priority) ? b.semantic! - a.semantic! : 0) ||
      Number(Boolean(b.pick.book.description?.trim())) -
        Number(Boolean(a.pick.book.description?.trim())) ||
      a.index - b.index,
  )
  const selected: DiscoveryPick[] = []
  const deferred: DiscoveryPick[] = []
  const authorCounts = new Map<string, number>()
  for (const { pick } of ordered) {
    const authors = pick.book.authors.map(norm).filter(Boolean)
    if (authors.some((author) => (authorCounts.get(author) ?? 0) >= 2)) deferred.push(pick)
    else {
      selected.push(pick)
      for (const author of authors) authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1)
    }
  }
  // Prefer variety when supported alternatives exist, without padding from unrelated books
  // or shortening a useful same-author shelf when it is the only evidence available.
  return [...selected, ...deferred].slice(0, DISCOVERY_LIMIT)
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const text = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.slice(0, limit) : ''
const strings = (value: unknown, limit: number, length: number) =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string')
        .slice(0, limit)
        .map((v) => v.slice(0, length))
    : []
const url = (value: unknown) => {
  const raw = text(value, 2048)
  try {
    return /^https?:$/.test(new URL(raw).protocol) ? raw : ''
  } catch {
    return ''
  }
}
export function parseDiscoveryBook(value: unknown): DiscoveryBook | null {
  const row = record(value)
  if (!row || !text(row.title, 400).trim()) return null
  return {
    title: text(row.title, 400),
    authors: strings(row.authors, 8, 160),
    cover: url(row.cover),
    coverThumb: url(row.coverThumb) || undefined,
    isbn: normalizeIsbn(text(row.isbn, 30)),
    pub: text(row.pub, 30),
    corpusWorkId:
      typeof row.corpusWorkId === 'string' &&
      /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(row.corpusWorkId)
        ? row.corpusWorkId
        : undefined,
    genre: text(row.genre, 80),
    genres: strings(row.genres, 12, 80),
    tags: strings(row.tags, 24, 100),
    description: text(row.description, 2500),
    catalogSource:
      row.catalogSource === 'corpus' ||
      row.catalogSource === 'catalog' ||
      row.catalogSource === 'curated'
        ? row.catalogSource
        : undefined,
  }
}
export function parseDiscoveryIntent(value: unknown): DiscoveryIntent | null {
  const row = record(value)
  if (!row) return null
  if (row.kind === 'anchor') {
    const anchor = parseDiscoveryBook(row.anchor)
    return anchor ? { kind: 'anchor', anchor } : null
  }
  if (row.kind === 'genre' && text(row.genre, 80).trim())
    return { kind: 'genre', genre: text(row.genre, 80).trim() }
  if (row.kind === 'mood') {
    const moods = [...new Set(strings(row.moods, 2, 40))].filter((m): m is DiscoveryMood =>
      DISCOVERY_MOODS.includes(m as DiscoveryMood),
    )
    return moods.length ? { kind: 'mood', moods } : null
  }
  return null
}
/** Fail closed for unsupported session versions or partial/corrupt picks; never display a different work. */
export function parseDiscoverySession(value: unknown): DiscoverySession | null {
  const row = record(value)
  if (
    !row ||
    row.version !== 1 ||
    typeof row.id !== 'string' ||
    !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(row.id) ||
    typeof row.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(row.createdAt))
  )
    return null
  const intent = parseDiscoveryIntent(row.intent)
  if (!intent || !Array.isArray(row.picks) || row.picks.length > DISCOVERY_LIMIT) return null
  const picks: DiscoveryPick[] = []
  for (const value of row.picks) {
    const entry = record(value)
    const book = parseDiscoveryBook(entry?.book)
    if (
      !entry ||
      !book ||
      !['author', 'genre', 'description', 'semantic', 'series'].includes(String(entry.basis)) ||
      typeof entry.reason !== 'string'
    )
      return null
    picks.push({
      book,
      reason: text(entry.reason, 600),
      basis: entry.basis as DiscoveryPick['basis'],
    })
  }
  const keys = new Set(picks.map((p) => discoveryKey(p.book)))
  if (keys.size !== picks.length) return null
  return {
    version: 1,
    id: row.id,
    createdAt: row.createdAt,
    intent,
    picks,
    dismissed: strings(row.dismissed, DISCOVERY_LIMIT, 1200).filter((key) => keys.has(key)),
  }
}
export function visibleDiscoverySession(session: DiscoverySession): DiscoverySession {
  return {
    ...session,
    picks: session.picks.filter((p) => !session.dismissed.includes(discoveryKey(p.book))),
    dismissed: [],
  }
}
