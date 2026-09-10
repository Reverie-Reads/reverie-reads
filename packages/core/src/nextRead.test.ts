import { describe, expect, it } from 'vitest'
import { makeBook } from './book.fixture'
import type { Book } from './types'
import { beginReadingPatch, nextReadCandidates } from './nextRead'

const book = (id: string, patch: Partial<Book> = {}) => makeBook({ id, title: id, ...patch })
const completed = { date: '2026-08-01', format: 'Paperback', rating: 4, notes: 'Keep this note' }

describe('next read candidate scope', () => {
  const books = [
    book('owned'),
    book('borrowed', { ownership: 'unowned', borrowed: true }),
    book('wanted', { ownership: 'unowned', wishlist: true }),
    book('owned-and-wanted', { wishlist: true }),
    book('latent-format', {
      ownership: 'unowned',
      owned: { physical: true, ebook: false, audiobook: false },
    }),
    book('reading', { readStatus: 'Reading' }),
    book('read', { readStatus: 'Read' }),
    book('history', { readStatus: 'Unread', reads: [completed] }),
    book('dnf', { readStatus: 'DNF' }),
    book('abandoned-reread', { readStatus: 'DNF', reads: [completed] }),
  ]
  const ids = (options?: Parameters<typeof nextReadCandidates>[1]) =>
    nextReadCandidates(books, options).map((b) => b.id)

  it('includes owned and borrowed books without mistaking format flags for possession', () => {
    expect(ids()).toEqual(['owned', 'borrowed', 'owned-and-wanted'])
  })
  it('keeps overlapping wishlist and whole-library scopes honest', () => {
    expect(ids({ scope: 'wishlist' })).toEqual(['wanted', 'owned-and-wanted'])
    expect(ids({ scope: 'library' })).toEqual([
      'owned',
      'borrowed',
      'wanted',
      'owned-and-wanted',
      'latent-format',
    ])
  })
  it('requires separate consent for rereads and abandoned books, and never suggests an active read', () => {
    expect(ids({ includeRereads: true })).toEqual([
      'owned',
      'borrowed',
      'owned-and-wanted',
      'read',
      'history',
    ])
    expect(ids({ includeDnf: true })).toEqual(['owned', 'borrowed', 'owned-and-wanted', 'dnf'])
    expect(ids({ includeDnf: true, includeRereads: true })).toEqual([
      'owned',
      'borrowed',
      'owned-and-wanted',
      'read',
      'history',
      'dnf',
      'abandoned-reread',
    ])
  })
})

describe('begin reading', () => {
  it('starts a wishlist book without acquiring it or recording a finished read', () => {
    const before = book('wanted', { ownership: 'unowned', wishlist: true, readingNowHidden: true })
    expect(beginReadingPatch(before)).toEqual({
      readStatus: 'Reading',
      readingNowHidden: false,
      progress: 0,
    })
    expect({ ...before, ...beginReadingPatch(before) }).toMatchObject({
      ownership: 'unowned',
      wishlist: true,
      reads: [],
    })
  })
  it('resets only the new reread progress, retaining history, rating, and copy state', () => {
    const before = book('finished', {
      readStatus: 'Read',
      reads: [completed],
      progress: 100,
      rating: 4,
      borrowed: true,
    })
    expect({ ...before, ...beginReadingPatch(before) }).toMatchObject({
      readStatus: 'Reading',
      progress: 0,
      reads: [completed],
      rating: 4,
      borrowed: true,
    })
    expect(before.progress).toBe(100)
  })
  it('preserves progress in an active or abandoned reread', () => {
    for (const readStatus of ['Reading', 'DNF'] as const) {
      expect(
        beginReadingPatch(book('reread', { readStatus, reads: [completed], progress: 37 }))
          .progress,
      ).toBe(37)
    }
  })
  it('resumes a set-aside reread from its retained place', () => {
    const paused = book('paused-reread', {
      readStatus: 'Unread',
      reads: [completed],
      progress: 37,
    })
    expect(beginReadingPatch(paused)).toEqual({
      readStatus: 'Reading',
      readingNowHidden: false,
      progress: 37,
    })
  })
  it('does not mistake a completed record for a paused read', () => {
    const completedBook = book('complete', {
      readStatus: 'Read',
      reads: [completed],
      progress: 37,
    })
    expect(beginReadingPatch(completedBook).progress).toBe(0)
  })
})
