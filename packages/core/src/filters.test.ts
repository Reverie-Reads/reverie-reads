import { describe, expect, it } from 'vitest'
import {
  activeFilterCount,
  defaultFilters,
  hasReadingHistory,
  hiddenMatchCount,
  inDefaultLibrary,
  isBookRead,
  matchesFilters,
  seriesLenBucket,
  sortBooks,
  type LibraryFilters,
} from './filters'
import { newCopy, newEdition, inventoryPossession } from './copyInventory'
import { makeBook } from './book.fixture'

describe('matchesFilters', () => {
  const book = makeBook({
    id: '1',
    title: 'Iron Flame',
    last: 'Yarros',
    series: 'The Empyrean',
    subgenre: 'Romantasy',
    tags: ['Dragon Riders', 'Enemies to Lovers'],
    status: 'ongoing',
    readStatus: 'Read',
    fave: true,
  })

  it('finds the reported title and a special edition after its copy was given away', () => {
    const edition = { ...newEdition('hardcover'), label: 'Bookish Box', special: true }
    const inventory = {
      version: 1 as const,
      editions: [edition],
      copies: [newCopy(edition.id, 'given-away')],
    }
    const book = makeBook({
      id: 'former',
      title: 'Blood & Roses',
      ...inventoryPossession(inventory),
      copyInventory: inventory,
    })
    expect(book.ownership).toBe('unowned')
    expect(book.wishlist).toBe(false)
    for (const q of ['Blood and Roses', 'bookish', 'special edition']) {
      expect(
        matchesFilters(book, {
          ...defaultFilters(),
          q,
          specialEdition: true,
          previouslyOwned: true,
        }),
      ).toBe(true)
    }
    expect(matchesFilters(book, { ...defaultFilters(), shelf: 'owned' })).toBe(false)
  })

  // The genre facet is genres[]-aware via bookGenres, which is what makes a multi-genre book
  // reachable from either genre's facet rather than only its primary.
  describe('genre facet', () => {
    it('matches a single-genre book on its primary genre, and rejects another genre', () => {
      const single = makeBook({ id: 's', title: 'Single', genre: 'romance', genres: [] })
      expect(matchesFilters(single, { ...defaultFilters(), genre: 'romance' })).toBe(true)
      expect(matchesFilters(single, { ...defaultFilters(), genre: 'fantasy' })).toBe(false)
    })

    it('matches a two-genre book on EITHER of its genres', () => {
      const both = makeBook({
        id: 'b',
        title: 'Romantasy',
        genre: 'romance',
        genres: ['romance', 'fantasy'],
      })
      expect(matchesFilters(both, { ...defaultFilters(), genre: 'romance' })).toBe(true)
      expect(matchesFilters(both, { ...defaultFilters(), genre: 'fantasy' })).toBe(true)
      expect(matchesFilters(both, { ...defaultFilters(), genre: 'horror' })).toBe(false)
    })

    it('falls back to the primary genre when genres[] is empty (pre-multi-genre rows)', () => {
      const legacy = makeBook({ id: 'l', title: 'Legacy', genre: 'mystery', genres: [] })
      expect(matchesFilters(legacy, { ...defaultFilters(), genre: 'mystery' })).toBe(true)
    })

    it('handles a non-CORE value in genres[] without crashing or matching a real genre', () => {
      const odd = makeBook({
        id: 'o',
        title: 'Odd',
        genre: 'romance',
        genres: ['romance', 'not-a-real-genre'],
      })
      expect(matchesFilters(odd, { ...defaultFilters(), genre: 'not-a-real-genre' })).toBe(true)
      expect(matchesFilters(odd, { ...defaultFilters(), genre: 'fantasy' })).toBe(false)
    })

    it("'All' is off — every book passes regardless of genre", () => {
      const f = makeBook({ id: 'f', title: 'F', genre: 'fantasy', genres: ['fantasy'] })
      expect(matchesFilters(f, { ...defaultFilters(), genre: 'All' })).toBe(true)
      expect(defaultFilters().genre).toBe('All')
    })
  })

  it('requires ALL selected tropes to be present', () => {
    expect(matchesFilters(book, { ...defaultFilters(), tags: ['Dragon Riders'] })).toBe(true)
    expect(matchesFilters(book, { ...defaultFilters(), tags: ['Dragon Riders', 'Mafia'] })).toBe(
      false,
    )
  })

  it('matches subgenre, fave, and free-text search across fields', () => {
    expect(matchesFilters(book, { ...defaultFilters(), sub: 'Dark Romance' })).toBe(false)
    expect(matchesFilters(book, { ...defaultFilters(), fave: true })).toBe(true)
    expect(matchesFilters(book, { ...defaultFilters(), q: 'yarros' })).toBe(true)
    expect(matchesFilters(book, { ...defaultFilters(), q: 'empyrean' })).toBe(true)
    expect(matchesFilters(book, { ...defaultFilters(), q: 'nope' })).toBe(false)
  })

  it('treats logged reads as Read for the reading-status filter', () => {
    const unreadButLogged = makeBook({
      id: '2',
      title: 'X',
      readStatus: 'Unread',
      reads: [{ date: '2025-01-01', format: 'ebook', rating: 0, notes: '' }],
    })
    expect(matchesFilters(unreadButLogged, { ...defaultFilters(), read: 'Read' })).toBe(true)
    expect(matchesFilters(unreadButLogged, { ...defaultFilters(), read: 'Unread' })).toBe(false)
  })

  it('filters by intensity/spice level (empty = any, set = membership)', () => {
    const spicy = makeBook({ id: 's', title: 'Spicy', intensity: 4 })
    const sweet = makeBook({ id: 'w', title: 'Sweet', intensity: 1 })
    expect(matchesFilters(spicy, { ...defaultFilters(), intensity: [] })).toBe(true) // any
    expect(matchesFilters(spicy, { ...defaultFilters(), intensity: [4, 5] })).toBe(true)
    expect(matchesFilters(sweet, { ...defaultFilters(), intensity: [4, 5] })).toBe(false)
    // an unrated book (intensity 0/undefined) never matches a positive-level filter
    expect(
      matchesFilters(makeBook({ id: 'z', title: 'Z', intensity: 0 }), {
        ...defaultFilters(),
        intensity: [3],
      }),
    ).toBe(false)
  })
})

describe('seriesLenBucket', () => {
  it('buckets by series length, with null => Unknown and 5+ collapsed', () => {
    expect(seriesLenBucket(makeBook({ id: '1', title: 'a', seriesCount: null }))).toBe('Unknown')
    expect(seriesLenBucket(makeBook({ id: '2', title: 'b', seriesCount: 3 }))).toBe('3')
    expect(seriesLenBucket(makeBook({ id: '3', title: 'c', seriesCount: 7 }))).toBe('5+')
  })
})

describe('sortBooks', () => {
  it('sorts A–Z by title', () => {
    const books = [makeBook({ id: '1', title: 'Zodiac' }), makeBook({ id: '2', title: 'Apple' })]
    expect(sortBooks(books, 'az').map((b) => b.title)).toEqual(['Apple', 'Zodiac'])
  })
})

describe('activeFilterCount', () => {
  it('counts each active facet (search excluded)', () => {
    expect(activeFilterCount(defaultFilters())).toBe(0)
    expect(
      activeFilterCount({
        ...defaultFilters(),
        sub: 'Romantasy',
        tags: ['Fae'],
        fave: true,
        q: 'x',
      }),
    ).toBe(3)
    // intensity counts as one facet however many levels are picked
    expect(activeFilterCount({ ...defaultFilters(), intensity: [3, 4, 5] })).toBe(1)
  })
})

describe('library scope — have it, or have opened it (task-shelf-model)', () => {
  const owned = makeBook({ id: 'o', title: 'Owned One' })
  const borrowed = makeBook({
    id: 'b',
    title: 'Borrowed One',
    ownership: 'unowned',
    borrowed: true,
    readStatus: 'unset',
  })
  const wished = makeBook({
    id: 'w',
    title: 'Wished One',
    ownership: 'unowned',
    wishlist: true,
    readStatus: 'unset',
  })
  const bare = makeBook({
    id: 'u',
    title: 'Uncatalogued',
    ownership: 'unowned',
    readStatus: 'unset',
  })
  // the reading-history hole: read it, don't own it, never marked it borrowed
  const readNotOwned = makeBook({
    id: 'r',
    title: 'Read Not Owned',
    ownership: 'unowned',
    wishlist: true,
    readStatus: 'Read',
  })
  // the SECOND reading-history hole, which the four-state model left open: started it, gave up,
  // never possessed it. Not read, so isBookRead says no — but the reader definitely handled it.
  const dnfNotOwned = makeBook({
    id: 'd',
    title: 'Abandoned',
    ownership: 'unowned',
    readStatus: 'DNF',
  })

  it('default grid shows books in hand and books with any reading history, DNF included', () => {
    const f = defaultFilters()
    expect(matchesFilters(owned, f)).toBe(true)
    expect(matchesFilters(borrowed, f)).toBe(true) // in hand, though not owned
    expect(matchesFilters(readNotOwned, f)).toBe(true) // reading history never hidden by possession
    expect(matchesFilters(dnfNotOwned, f)).toBe(true) // abandoned is still handled
    expect(matchesFilters(wished, f)).toBe(false)
    expect(matchesFilters(bare, f)).toBe(false)
  })

  it('an abandoned book is VISIBLE but is still not Read — the two predicates disagree by design', () => {
    // hasReadingHistory admits DNF so the book stops being invisible; isBookRead must not, or a
    // series would report progress the reader never made and the taste profile would learn from a
    // book they bailed on.
    expect(inDefaultLibrary(dnfNotOwned)).toBe(true)
    expect(isBookRead(dnfNotOwned)).toBe(false)
    expect(hasReadingHistory(dnfNotOwned)).toBe(true)
    // and it does not leak into the Read facet
    expect(matchesFilters(dnfNotOwned, { ...defaultFilters(), read: 'Read' })).toBe(false)
    expect(matchesFilters(dnfNotOwned, { ...defaultFilters(), read: 'DNF' })).toBe(true)
  })

  it('possession is read through the flags, not a single enum slot', () => {
    // A book both owned and wanted is in the default library on the strength of owning it — the
    // want no longer competes for the same field.
    const ownedAndWanted = makeBook({
      id: 'ow',
      title: 'Owned And Wanted',
      ownership: 'owned',
      wishlist: true,
      readStatus: 'unset',
    })
    expect(matchesFilters(ownedAndWanted, defaultFilters())).toBe(true)
  })

  it('the wishlist flag lets the hidden remainder in', () => {
    const f = { ...defaultFilters(), wishlist: true }
    expect(matchesFilters(owned, f)).toBe(true)
    expect(matchesFilters(wished, f)).toBe(true)
    expect(matchesFilters(bare, f)).toBe(true)
  })

  it('counts as an active filter', () => {
    expect(activeFilterCount({ ...defaultFilters(), wishlist: true })).toBe(1)
  })
})

describe('shelf link — /shelves derived-shelf header deep link (task-shelf-headers-linkable)', () => {
  const owned = makeBook({ id: 'o', title: 'Owned One' })
  const borrowed = makeBook({
    id: 'b',
    title: 'Borrowed One',
    ownership: 'unowned',
    borrowed: true,
    readStatus: 'unset',
  })
  const wishlistOnly = makeBook({
    id: 'w',
    title: 'Wished Only',
    ownership: 'unowned',
    wishlist: true,
    readStatus: 'unset',
  })
  const read = makeBook({ id: 'r', title: 'Read One', ownership: 'unowned', readStatus: 'Read' })
  // abandoned, never possessed — hasReadingHistory says yes, isBookRead says no (see the
  // library-scope describe block above). The Read SHELF header's unsplit count includes it.
  const dnfNotOwned = makeBook({
    id: 'd',
    title: 'Abandoned',
    ownership: 'unowned',
    readStatus: 'DNF',
  })
  const bare = makeBook({
    id: 'u',
    title: 'Uncatalogued',
    ownership: 'unowned',
    readStatus: 'unset',
  })

  it('defaults to All — no shelf scoping applied', () => {
    expect(defaultFilters().shelf).toBe('All')
  })

  it('owned link matches isOwnedBook only — a borrowed-not-owned book is excluded', () => {
    const f = { ...defaultFilters(), shelf: 'owned' as const }
    expect(matchesFilters(owned, f)).toBe(true)
    expect(matchesFilters(borrowed, f)).toBe(false)
  })

  it('borrowed link matches the borrowed flag only', () => {
    const f = { ...defaultFilters(), shelf: 'borrowed' as const }
    expect(matchesFilters(borrowed, f)).toBe(true)
    expect(matchesFilters(owned, f)).toBe(false)
  })

  it('read link matches hasReadingHistory — includes DNF, unlike the read=Read facet', () => {
    const f = { ...defaultFilters(), shelf: 'read' as const }
    expect(matchesFilters(read, f)).toBe(true)
    expect(matchesFilters(dnfNotOwned, f)).toBe(true)
    expect(matchesFilters(owned, f)).toBe(false)
  })

  it('wishlist link matches isWanted directly — an unowned, unborrowed, unread book still qualifies', () => {
    const f = { ...defaultFilters(), shelf: 'wishlist' as const }
    expect(matchesFilters(wishlistOnly, f)).toBe(true)
    expect(matchesFilters(bare, f)).toBe(false)
  })

  it('a shelf link bypasses the default-library scope gate entirely, not just widens it', () => {
    // wishlist-only books are normally hidden unless the separate `wishlist` chip is on; the shelf
    // link must show them without that chip, because /shelves filters the whole library too.
    const f = { ...defaultFilters(), shelf: 'wishlist' as const, wishlist: false }
    expect(matchesFilters(wishlistOnly, f)).toBe(true)
  })

  it('counts as an active filter', () => {
    expect(activeFilterCount({ ...defaultFilters(), shelf: 'owned' })).toBe(1)
  })
})

describe('subgenre filter over subgenres[]', () => {
  const multi = makeBook({
    id: 'm',
    title: 'Many Shelves',
    subgenre: 'Epic Fantasy',
    subgenres: ['Epic Fantasy', 'Romantasy', 'Dark Fantasy'],
  })
  const legacy = makeBook({ id: 'l', title: 'Old Single', subgenre: 'Noir', subgenres: [] })

  it('a book appears under EVERY subgenre it holds', () => {
    for (const sub of ['Epic Fantasy', 'Romantasy', 'Dark Fantasy']) {
      expect(matchesFilters(multi, { ...defaultFilters(), sub })).toBe(true)
    }
    expect(matchesFilters(multi, { ...defaultFilters(), sub: 'Noir' })).toBe(false)
  })

  it('pre-migration singles still match through the legacy field', () => {
    expect(matchesFilters(legacy, { ...defaultFilters(), sub: 'Noir' })).toBe(true)
    expect(matchesFilters(legacy, { ...defaultFilters(), sub: 'Gothic' })).toBe(false)
  })
})

describe('hiddenMatchCount — what the search matched and the scope withheld', () => {
  // The repro, as a unit: a wishlist-only book, no reads, queried by its exact full title. The grid
  // shows nothing and says nothing. This is the count that lets it say something.
  const wished = makeBook({
    id: 'w',
    title: 'The Cruel Prince',
    ownership: 'unowned',
    wishlist: true,
    readStatus: 'unset',
  })
  const owned = makeBook({ id: 'o', title: 'The Cruel Crown' })
  const bare = makeBook({
    id: 'u',
    title: 'The Cruel Curse',
    ownership: 'unowned',
    readStatus: 'unset',
  })
  const books = [wished, owned, bare]
  const q = (query: string, over: Partial<LibraryFilters> = {}): LibraryFilters => ({
    ...defaultFilters(),
    ...over,
    q: query,
  })

  it('counts the exact-title match the default scope withheld', () => {
    // The number IS the claim, so the test states the number — not "greater than zero".
    expect(hiddenMatchCount(books, q('The Cruel Prince'))).toBe(1)
    // …and the book really is absent from the grid, which is what makes the line worth showing.
    expect(books.filter((b) => matchesFilters(b, q('The Cruel Prince')))).toHaveLength(0)
  })

  it('counts EVERY withheld match, not just the first — a boolean would not do', () => {
    // Two out-of-scope books, one in scope: the query straddles all three.
    expect(hiddenMatchCount(books, q('The Cruel'))).toBe(2)
    expect(books.filter((b) => matchesFilters(b, q('The Cruel')))).toHaveLength(1)
  })

  it('is zero when the query hides nothing — the standing "0 hidden" is the noise to avoid', () => {
    expect(hiddenMatchCount(books, q('The Cruel Crown'))).toBe(0)
  })

  it('is zero when the query matches nothing at all', () => {
    expect(hiddenMatchCount(books, q('Piranesi'))).toBe(0)
  })

  it('is zero with no query — this narrates search, not the resting grid', () => {
    expect(hiddenMatchCount(books, defaultFilters())).toBe(0)
  })

  it('is zero once the wishlist chip is on — what it offers to do is already done', () => {
    expect(hiddenMatchCount(books, q('The Cruel Prince', { wishlist: true }))).toBe(0)
    expect(hiddenMatchCount(books, q('The Cruel', { wishlist: true }))).toBe(0)
  })

  it('is zero under a shelf link, which bypasses the scope gate rather than applying it', () => {
    // shelf !== All takes the other branch in matchesFilters, so there is no scope gate to lift.
    expect(hiddenMatchCount(books, q('The Cruel Prince', { shelf: 'wishlist' }))).toBe(0)
  })

  it('does not blame the scope for a book some OTHER facet excluded', () => {
    // In scope (owned) and matching the text, but the genre chip rejects it. Nothing about that is
    // the scope gate's doing, so revealing the wishlist would not bring it back — and the line must
    // not claim it would.
    const offGenre = makeBook({ id: 'g', title: 'The Cruel Sea', genre: 'fantasy', genres: [] })
    expect(hiddenMatchCount([offGenre], q('The Cruel Sea', { genre: 'romance' }))).toBe(0)
  })

  it('reports a book held out by scope AND matching every other active facet', () => {
    // The facets that DO pass must not suppress the report either: same wishlist-only book, under a
    // genre chip it satisfies.
    expect(hiddenMatchCount(books, q('The Cruel Prince', { genre: 'romance' }))).toBe(1)
  })
})
