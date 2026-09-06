import { describe, expect, it } from 'vitest'
import { makeBook } from './book.fixture'
import {
  dedupeDiscoveryBooks,
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
