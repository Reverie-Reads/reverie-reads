import {
  beginReadingPatch,
  isStrong,
  matchBook,
  mergeImport,
  parseCSV,
  parseCsvRows,
  parseImport,
  type Book,
  type Incoming,
} from '@reverie/core'
import { catalogIncoming, guestBook } from './catalog'

export type GuestView = 'library' | 'reading' | 'next' | 'history'
export type GuestPage = GuestView | 'add' | 'configure'
export const GUEST_VIEWS: Record<GuestView, string> = {
  library: 'Library',
  reading: 'Reading now',
  next: 'Next read',
  history: 'Reading journal',
}
export const GUEST_PRESETS: { name: string; note: string; dock: GuestView[] }[] = [
  {
    name: 'Keep my books close',
    note: 'Your shelves first, with reading close at hand.',
    dock: ['library', 'reading', 'next', 'history'],
  },
  {
    name: 'Find my next read',
    note: 'Start with a book for right now.',
    dock: ['next', 'library', 'reading', 'history'],
  },
  {
    name: 'Remember my reading',
    note: 'Make room for notes and finished reads.',
    dock: ['history', 'reading', 'library', 'next'],
  },
]
export interface GuestState {
  books: Book[]
  pendingNotes: Record<string, string>
  saved: string[]
  dock: GuestView[]
  page: GuestPage
  selected: string | null
  nextId: number
  notice: string
}
export function initialGuestState(): GuestState {
  return {
    books: [
      guestBook('guest-jane', {
        ...catalogIncoming('jane-eyre'),
        ownership: 'owned',
        owned: { physical: 'paperback', ebook: false, audiobook: false },
        format: 'Paperback',
        readStatus: 'Reading',
        progress: 24,
      }),
      guestBook('guest-left-hand', {
        ...catalogIncoming('left-hand-of-darkness'),
        borrowed: true,
        owned: { physical: false, ebook: false, audiobook: true },
        format: 'Audiobook',
        readStatus: 'Unread',
      }),
    ],
    pendingNotes: {},
    saved: [],
    dock: [...GUEST_PRESETS[0]!.dock],
    page: 'library',
    selected: null,
    nextId: 1,
    notice: 'Two books to begin with. Open one, or add a book of your own.',
  }
}
export type GuestAction =
  | { type: 'navigate'; page: GuestPage }
  | { type: 'select'; id: string | null }
  | { type: 'add'; rows: Incoming[]; warning?: string }
  | { type: 'save'; id: string; patch: Partial<Book>; notes: string }
  | { type: 'start' | 'favorite' | 'later' | 'remove'; id: string }
  | { type: 'finish'; id: string; date: string }
  | { type: 'configure'; dock: GuestView[] }
  | { type: 'notice'; message: string }
  | { type: 'reset' }

export function guestReducer(state: GuestState, action: GuestAction): GuestState {
  if (action.type === 'reset') return { ...initialGuestState(), notice: 'Guest library reset.' }
  if (action.type === 'navigate') return { ...state, page: action.page, selected: null }
  if (action.type === 'select') return { ...state, selected: action.id }
  if (action.type === 'notice') return { ...state, notice: action.message }
  if (action.type === 'configure') {
    const dock = [...new Set(action.dock)].filter((id) => id in GUEST_VIEWS)
    if (!dock.includes('library')) dock.unshift('library')
    return {
      ...state,
      dock,
      page: dock[0]!,
      selected: null,
      notice:
        'Your guest dock is arranged. It can follow these books into an account when you choose.',
    }
  }
  if (action.type === 'add') {
    let books = [...state.books]
    let added = 0,
      merged = 0,
      similar = 0
    let nextId = state.nextId
    for (const incoming of action.rows) {
      if (!incoming.title.trim()) continue
      const match = matchBook(incoming, books)
      if (match.book && isStrong(match.strength)) {
        const result = mergeImport(match.book, incoming)
        books = books.map((book) =>
          book.id === match.book!.id
            ? { ...book, ...result.patch, reads: [...book.reads, ...result.newReads] }
            : book,
        )
        merged++
      } else {
        if (match.strength === 'fuzzy') similar++
        books.unshift(guestBook(`guest-added-${nextId++}`, incoming))
        added++
      }
    }
    if (books.length > 60)
      return {
        ...state,
        notice:
          'This guest library holds up to 60 books. Use a smaller file or reset the sample; nothing from this addition was applied.',
      }
    return {
      ...state,
      books,
      nextId,
      page: 'library',
      selected: null,
      notice: `${added} ${added === 1 ? 'book added' : 'books added'}${merged ? ` · ${merged} existing ${merged === 1 ? 'book updated' : 'books updated'}` : ''}.${similar ? ' Similar titles were kept separate for review.' : ''}${action.warning ? ` ${action.warning}` : ''}`,
    }
  }
  const book = state.books.find((entry) => entry.id === action.id)
  if (!book) return state
  if (action.type === 'remove') {
    const pendingNotes = { ...state.pendingNotes }
    delete pendingNotes[book.id]
    return {
      ...state,
      pendingNotes,
      books: state.books.filter((b) => b.id !== book.id),
      selected: null,
      saved: state.saved.filter((id) => id !== book.id),
      notice: `${book.title} removed from this guest library.`,
    }
  }
  if (action.type === 'later')
    return {
      ...state,
      saved: [...new Set([...state.saved, book.id])],
      notice: `${book.title} saved for later.`,
    }
  if (action.type === 'start')
    return {
      ...state,
      books: state.books.map((b) => (b.id === book.id ? { ...b, ...beginReadingPatch(b) } : b)),
      page: 'reading',
      selected: book.id,
      notice: `You’re reading ${book.title}.`,
    }
  if (action.type === 'favorite')
    return {
      ...state,
      books: state.books.map((b) => (b.id === book.id ? { ...b, fave: !b.fave } : b)),
      notice: book.fave ? `${book.title} removed from favorites.` : `${book.title} is a favorite.`,
    }
  if (action.type === 'finish') {
    if (book.readStatus !== 'Reading') return state
    const notes = { ...state.pendingNotes }
    delete notes[book.id]
    return {
      ...state,
      pendingNotes: notes,
      books: state.books.map((b) =>
        b.id === book.id
          ? {
              ...b,
              readStatus: 'Read',
              progress: 100,
              reads: [
                ...b.reads,
                {
                  date: action.date,
                  format: b.format,
                  rating: b.rating,
                  notes: state.pendingNotes[b.id] ?? '',
                },
              ],
            }
          : b,
      ),
      notice: `Finished ${book.title}. This read and its note are in your reading journal.`,
    }
  }
  if (action.type !== 'save') return state
  const patch = action.patch
  const changed = { ...book, ...patch }
  const pendingNotes = { ...state.pendingNotes }
  if (book.readStatus === 'Read' && book.reads.length) {
    changed.reads = book.reads.map((read, index) =>
      index === book.reads.length - 1
        ? { ...read, notes: action.notes, rating: changed.rating }
        : read,
    )
  } else pendingNotes[book.id] = action.notes
  return {
    ...state,
    pendingNotes,
    books: state.books.map((b) => (b.id === book.id ? changed : b)),
    notice: `${changed.title} saved in your guest library.`,
  }
}

// A guest upload must not trigger requests to cover URLs embedded in a private export.
function offlineIncoming(incoming: Incoming): Incoming {
  const copy = { ...incoming }
  delete copy.cover
  delete copy.coverThumb
  return copy
}

/** Same import mapper and row parser as the real importer, with a bounded, memory-only intake. */
export function guestImport(text: string): { rows: Incoming[]; warning?: string } {
  const grid = parseCSV(text)
  if (grid.length < 2)
    throw new Error(
      'That file has no book rows. Try the sample CSV or a Goodreads, StoryGraph, or Reverie export.',
    )
  if (grid.length > 51)
    throw new Error('Choose a CSV with up to 50 book rows for this guest library.')
  const parsed = parseImport(text)
  if (parsed.profile.name !== 'generic') {
    if (!parsed.rows.length) throw new Error('No book titles were found in this CSV.')
    return {
      rows: parsed.rows.map((row) => offlineIncoming(row.incoming)),
      warning:
        'Book details imported. Cover URLs, custom shelves, and connected universes stay in the full import experience.',
    }
  }
  const headers = grid[0]!.map((cell) => cell.trim().toLowerCase())
  const hasReadingOrShelfColumn = [
    'exclusive shelf',
    'read status',
    'bookshelves',
    'shelves',
    'date read',
    'last date read',
    'dates read',
    'read dates',
    'read count',
  ].some((name) => headers.includes(name))
  const rows = parseCsvRows(text)
  if (!hasReadingOrShelfColumn)
    for (const row of rows) {
      row.incoming.readStatus = 'unset'
      row.incoming.ownership = 'unowned'
      row.incoming.borrowed = false
      row.incoming.wishlist = false
    }
  if (!rows.length)
    throw new Error('No Title column or book titles were found. Try a Goodreads or StoryGraph CSV.')
  return {
    rows: rows.map((row) => offlineIncoming(row.incoming)),
    warning: rows.some((row) => row.unplacedNotes || row.shelves.length)
      ? 'Some shelf names or notes without a reading entry are not represented in this demo; the original file is unchanged.'
      : undefined,
  }
}
