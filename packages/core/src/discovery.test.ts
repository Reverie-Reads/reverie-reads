import { describe, expect, it } from 'vitest'
import { makeBook } from './book.fixture'
import {
  dedupeDiscoveryBooks,
  discoveryCandidatePool,
  discoveryKey,
  discoveryLibraryMatch,
  discoveryMoodEvidence,
  discoveryRelationship,
  discoveryShortlist,
  eligibleDiscoveryBooks,
  parseDiscoverySession,
  visibleDiscoverySession,
  type DiscoveryBook,
  type DiscoverySession,
} from './discovery'

const hit = (title: string, extra: Partial<DiscoveryBook> = {}): DiscoveryBook => ({
  title,
  authors: ['Nell Stone'],
  cover: '',
  isbn: '',
  pub: '',
  genre: 'fantasy',
  ...extra,
})
const id = 'f9100000-0000-4000-8000-000000000001'
const anchor = hit('A beginning')
const hopeful = hit('A welcome', { description: 'An introspective story of hope and healing.' })
const scary = hit('A shadow', {
  genre: 'horror',
  description: 'An eerie nightmare. A hopeless night.',
})

describe('guided discovery identity and possession', () => {
  it('matches ISBN-10 and ISBN-13 without using fuzzy title guesses', () => {
    const owned = makeBook({
      id: 'b',
      title: 'A welcome',
      first: 'Nell',
      last: 'Stone',
      isbn: '0-306-40615-2',
    })
    expect(discoveryLibraryMatch(hit('A welcome', { isbn: '9780306406157' }), [owned])).toBe(owned)
    expect(discoveryLibraryMatch(hit('A welcome home'), [owned])).toBeUndefined()
  })
  it('does not choose between ambiguous editions or conflicting corpus identities', () => {
    const a = makeBook({
      id: 'a',
      title: 'A welcome',
      first: 'Nell',
      last: 'Stone',
      corpusWorkId: id,
    })
    const b = { ...a, id: 'b', corpusWorkId: 'f9100000-0000-4000-8000-000000000002' }
    expect(discoveryLibraryMatch(hopeful, [a, b])).toBeUndefined()
    expect(discoveryLibraryMatch({ ...hopeful, corpusWorkId: b.corpusWorkId }, [a])).toBeUndefined()
    expect(
      dedupeDiscoveryBooks([
        { ...hopeful, corpusWorkId: id },
        { ...hopeful, corpusWorkId: b.corpusWorkId },
      ]),
    ).toHaveLength(2)
  })
  it('keeps wanted books eligible but excludes owned, borrowed, and the anchor itself', () => {
    const wanted = makeBook({
      id: 'w',
      title: hopeful.title,
      first: 'Nell',
      last: 'Stone',
      ownership: 'unowned',
      wishlist: true,
    })
    const borrowed = makeBook({
      id: 'b',
      title: scary.title,
      first: 'Nell',
      last: 'Stone',
      ownership: 'unowned',
      borrowed: true,
      wishlist: true,
    })
    expect(
      eligibleDiscoveryBooks([anchor, hopeful, scary], { kind: 'anchor', anchor }, [
        wanted,
        borrowed,
      ]),
    ).toEqual([hopeful])
    expect(discoveryRelationship({ ownership: 'owned', borrowed: true, wishlist: true })).toBe(
      'Owned · Borrowed · On your wishlist',
    )
    expect(discoveryRelationship(wanted)).toBe('On your wishlist')
  })
  it('prefers a shared work over an external edition and never mutates the pool', () => {
    const pool = [hopeful, { ...hopeful, corpusWorkId: id, isbn: '9780306406157' }]
    expect(dedupeDiscoveryBooks(pool)).toEqual([pool[1]])
    expect(pool).toHaveLength(2)
  })
})

describe('credible reasons and intent', () => {
  it('requires evidence for both selected moods and does not match hopeless as hopeful', () => {
    expect(discoveryMoodEvidence(hopeful, ['Reflective', 'Hopeful'])).toEqual([
      'introspective',
      'hope',
    ])
    expect(discoveryMoodEvidence(scary, ['Hopeful'])).toBeNull()
    expect(discoveryMoodEvidence(scary, ['Reflective', 'Unsettling'])).toBeNull()
    expect(discoveryMoodEvidence(scary, ['Unsettling'])).toEqual(['eerie'])
  })
  it('does not use a semantic score to promote an unsupported mood or genre', () => {
    expect(
      discoveryShortlist(
        [scary],
        { kind: 'mood', moods: ['Hopeful'] },
        { [discoveryKey(scary)]: 1 },
      ),
    ).toEqual([])
    expect(
      discoveryShortlist(
        [scary],
        { kind: 'genre', genre: 'fantasy' },
        { [discoveryKey(scary)]: 1 },
      ),
    ).toEqual([])
  })
  it('explains a shared author without inventing what the reader loved', () => {
    const [pick] = discoveryShortlist([hopeful], { kind: 'anchor', anchor })
    expect(pick?.basis).toBe('author')
    expect(pick?.reason).toBe('Another book by Nell Stone, the author of A beginning.')
  })
  it('does not pad a shortlist with unscored unrelated books', () => {
    const unrelated = hit('Unrelated', { authors: ['Someone Else'], genre: 'nonfiction' })
    expect(discoveryShortlist([unrelated], { kind: 'anchor', anchor })).toEqual([])
  })
})

const session: DiscoverySession = {
  version: 1,
  id,
  createdAt: '2026-09-06T00:00:00.000Z',
  intent: { kind: 'mood', moods: ['Hopeful'] },
  picks: [
    { book: hopeful, reason: 'Catalog evidence', basis: 'description' },
    { book: scary, reason: 'Saved comparison', basis: 'genre' },
  ],
  dismissed: [discoveryKey(scary)],
}
describe('private shortlist snapshots', () => {
  it('saves only visible picks without altering the session or books', () => {
    expect(visibleDiscoverySession(session).picks).toEqual([session.picks[0]])
    expect(visibleDiscoverySession(session).dismissed).toEqual([])
    expect(session.picks).toHaveLength(2)
    expect(session.dismissed).toHaveLength(1)
  })
  it('rejects future versions, invalid intents, duplicate identities and corrupt picks', () => {
    expect(parseDiscoverySession({ ...session, version: 2 })).toBeNull()
    expect(
      parseDiscoverySession({ ...session, intent: { kind: 'mood', moods: ['invented'] } }),
    ).toBeNull()
    expect(
      parseDiscoverySession({ ...session, picks: [session.picks[0], session.picks[0]] }),
    ).toBeNull()
    expect(parseDiscoverySession({ ...session, picks: [{ book: null }] })).toBeNull()
  })
  it('bounds text, rejects executable image URLs, and strips unrelated dismissal keys', () => {
    const restored = parseDiscoverySession({
      ...session,
      picks: [
        {
          ...session.picks[0],
          book: { ...hopeful, cover: 'javascript:alert(1)', description: 'x'.repeat(5000) },
        },
      ],
      dismissed: ['not-in-session'],
    })
    expect(restored?.picks[0]?.book.cover).toBe('')
    expect(restored?.picks[0]?.book.description).toHaveLength(2500)
    expect(restored?.dismissed).toEqual([])
  })
})

describe('discovery quality regression set', () => {
  it.each([
    'romance',
    'fantasy',
    'science fiction',
    'horror',
    'mystery',
    'literary',
    'cozy',
    'nonfiction',
    'young adult',
  ])('%s offers several authors without sacrificing supported connections', (genre) => {
    const pool = Array.from({ length: 8 }, (_, i) =>
      hit(`Selection ${i}`, {
        genre,
        authors: [i < 5 ? 'Prolific Writer' : `Writer ${i}`],
        description: 'Catalog description.',
      }),
    )
    const picks = discoveryShortlist(pool, { kind: 'genre', genre })
    expect(picks).toHaveLength(5)
    expect(picks.filter((p) => p.book.authors.includes('Prolific Writer'))).toHaveLength(2)
    expect(new Set(picks.flatMap((p) => p.book.authors)).size).toBe(4)
  })
  it('suppresses held duplicate copies without choosing a personal detail destination', () => {
    const a = makeBook({
      id: 'a',
      title: hopeful.title,
      first: 'Nell',
      last: 'Stone',
      ownership: 'owned',
    })
    const b = { ...a, id: 'b', ownership: 'unowned' as const, wishlist: true }
    expect(discoveryLibraryMatch(hopeful, [a, b])).toBeUndefined()
    expect(eligibleDiscoveryBooks([hopeful], { kind: 'genre', genre: 'fantasy' }, [a, b])).toEqual(
      [],
    )
  })
  it('supports secondary genres and canonical spellings without appearance input', () => {
    const a = hit('Starting point', { genre: 'literary', genres: ['Sci-Fi'] })
    const b = hit('A distant place', { authors: ['Different Writer'], genre: 'science fiction' })
    expect(discoveryShortlist([b], { kind: 'anchor', anchor: a })[0]?.reason).toContain(
      'science fiction',
    )
    expect(eligibleDiscoveryBooks([b], { kind: 'genre', genre: 'Sci-Fi' }, [])).toEqual([b])
  })
  it('does not promote a partial scoring batch over unscored candidates', () => {
    const a = hit('Earlier', { authors: ['Author One'] })
    const b = hit('Later', { authors: ['Author Two'] })
    expect(
      discoveryShortlist([a, b], { kind: 'genre', genre: 'fantasy' }, { [discoveryKey(b)]: 1 }).map(
        (p) => p.book.title,
      ),
    ).toEqual(['Earlier', 'Later'])
    expect(
      discoveryShortlist(
        [a, b],
        { kind: 'genre', genre: 'fantasy' },
        { [discoveryKey(a)]: 0, [discoveryKey(b)]: 1 },
      ).map((p) => p.book.title),
    ).toEqual(['Later', 'Earlier'])
  })
  it('keeps author evidence above genre evidence and never invents variety', () => {
    const other = hit('Another writer', { authors: ['Different Writer'] })
    const scores = { [discoveryKey(hopeful)]: -1, [discoveryKey(other)]: 1 }
    expect(discoveryShortlist([other, hopeful], { kind: 'anchor', anchor }, scores)[0]?.book).toBe(
      hopeful,
    )
    const sameAuthor = Array.from({ length: 5 }, (_, i) => hit(`Same author ${i}`))
    expect(discoveryShortlist(sameAuthor, { kind: 'anchor', anchor })).toHaveLength(5)
  })
  it('prefers available descriptions when semantic ranking is unavailable', () => {
    const sparse = hit('A bare record', { authors: ['Other Writer'] })
    expect(
      discoveryShortlist([sparse, hopeful], { kind: 'genre', genre: 'fantasy' })[0]?.book,
    ).toBe(hopeful)
  })
})

it('gives both full candidate sources room before the 32-book limit', () => {
  const corpus = Array.from({ length: 32 }, (_, i) =>
    hit(`Corpus ${i}`, { corpusWorkId: `work-${i}` }),
  )
  const external = Array.from({ length: 32 }, (_, i) =>
    hit(`External ${i}`, { authors: ['Outside Writer'] }),
  )
  const pool = discoveryCandidatePool([corpus, external], { kind: 'genre', genre: 'fantasy' }, [])
  expect(pool).toHaveLength(32)
  expect(pool.filter((b) => b.corpusWorkId)).toHaveLength(16)
  expect(pool.filter((b) => !b.corpusWorkId)).toHaveLength(16)
  expect(pool.slice(0, 4).map((b) => b.title)).toEqual([
    'Corpus 0',
    'External 0',
    'Corpus 1',
    'External 1',
  ])
  expect(
    dedupeDiscoveryBooks([external[0]!, { ...external[0]!, corpusWorkId: id }])[0]?.corpusWorkId,
  ).toBe(id)
})
