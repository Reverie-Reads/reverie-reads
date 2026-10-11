import { describe, expect, it } from 'vitest'
import type { HouseholdBook } from '../data/household'
import {
  defaultHouseholdFilters,
  matchesHouseholdFilters,
  matchesHouseholdQuery,
  sortHouseholdBooks,
} from './householdFilters'
const book: HouseholdBook = {
  id: 'shared',
  title: 'The Long Way',
  author: 'Ada North',
  cover: '',
  coverColor: '',
  corpusCover: '',
  corpusCoverColor: '',
  coverOptions: [],
  coverOptionsAvailable: true,
  series: 'Stars',
  position: 2,
  seriesCount: 3,
  seriesStatus: 'completed',
  primaryGenre: 'science fiction',
  genres: ['science fiction', 'adventure'],
  subgenre: 'Space opera',
  subgenres: ['Space opera'],
  isbns: ['9780143117841'],
  householdTags: ['found family'],
  householdTropes: [{ name: 'unlikely allies', emphasis: 'present' }],
  publicationYear: 2025,
  publicationMonth: null,
  publicationDay: null,
  addedAt: '2026-01-01',
  owners: [
    {
      userId: 'one',
      bookId: 'copy-one',
      displayName: 'One',
      ownership: 'owned',
      borrowed: false,
      ownedPhysical: 'Paperback',
      ownedEbook: false,
      ownedAudiobook: false,
      bookFormat: 'Paperback',
      cover: '',
      coverThumb: '',
      coverColor: '',
      shared: true,
    },
    {
      userId: 'two',
      bookId: 'copy-two',
      displayName: 'Two',
      ownership: 'unowned',
      borrowed: true,
      ownedPhysical: '',
      ownedEbook: true,
      ownedAudiobook: false,
      bookFormat: 'eBook',
      cover: '',
      coverThumb: '',
      coverColor: '',
      shared: true,
    },
  ],
}
describe('household search', () => {
  it.each([
    'long way',
    ' ADA NORTH ',
    'stars',
    'found family',
    'unlikely allies',
    'adventure',
    'Space opera',
    '978-0-14-311784-1',
  ])('finds shared metadata: %s', (query) => {
    expect(matchesHouseholdQuery(book, query)).toBe(true)
  })
  it('never searches private fields even if an unexpected payload carries them', () => {
    expect(
      matchesHouseholdQuery(
        { ...book, notes: 'private phrase' } as HouseholdBook,
        'private phrase',
      ),
    ).toBe(false)
  })
  it('combines shared facets without inventing reading or ownership status', () => {
    const filters = {
      ...defaultHouseholdFilters(),
      genre: 'adventure',
      tags: ['unlikely allies'],
      len: '3' as const,
    }
    expect(matchesHouseholdFilters(book, filters)).toBe(true)
    expect(matchesHouseholdFilters({ ...book, owners: [] }, filters)).toBe(true)
    expect(
      matchesHouseholdFilters({ ...book, owners: [] }, { ...filters, possession: 'owned' }),
    ).toBe(false)
  })
  it('requires member, format and possession to match the same copy owner', () => {
    expect(
      matchesHouseholdFilters(book, {
        ...defaultHouseholdFilters(),
        member: 'one',
        format: 'eBook',
      }),
    ).toBe(false)
    expect(
      matchesHouseholdFilters(book, {
        ...defaultHouseholdFilters(),
        member: 'two',
        format: 'eBook',
        possession: 'borrowed',
      }),
    ).toBe(true)
  })
  it('sorts a copy and keeps unknown series numbers after known numbers', () => {
    const items = [{ ...book, id: 'unknown', position: null }, book]
    expect(sortHouseholdBooks(items, 'series').map((b) => b.id)).toEqual(['shared', 'unknown'])
    expect(items[0]?.id).toBe('unknown')
  })
})
