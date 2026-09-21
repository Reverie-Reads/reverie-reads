import { onFormatShelf, onUnmarkedShelf } from './shelves'
import { describe, expect, it } from 'vitest'
import {
  inventoryPossession,
  newCopy,
  newEdition,
  parseCopyInventory,
  prepareCopyInventory,
  validEditionDate,
  type CopyInventory,
} from './copyInventory'
import type { Book } from './types'

function inventory(): CopyInventory {
  const paper = newEdition('paperback'),
    hard = newEdition('hardcover'),
    audio = newEdition('audiobook')
  return {
    version: 1,
    editions: [paper, hard, audio],
    copies: [
      newCopy(paper.id, 'owned'),
      newCopy(hard.id, 'owned'),
      newCopy(hard.id, 'owned'),
      newCopy(audio.id, 'borrowed'),
    ],
  }
}
const book = (over: Partial<Book> = {}): Book => ({
  id: 'book',
  title: 'A library book',
  first: 'A',
  last: 'Reader',
  contributors: [],
  series: '',
  position: '',
  seriesCount: null,
  status: 'standalone',
  genre: '',
  subgenre: '',
  subgenres: [],
  genres: [],
  tags: [],
  tropes: [],
  moods: [],
  intensity: null,
  darkness: null,
  cover: '',
  isbn: '9780143117841',
  pages: 240,
  fave: false,
  ownership: 'owned',
  borrowed: false,
  wishlist: false,
  owned: { physical: 'paperback', ebook: false, audiobook: false },
  format: '',
  rating: 4,
  readStatus: 'Reading',
  source: '',
  pub: { y: 2026, m: null, d: null },
  reads: [],
  plan: { y: null, m: null, d: null },
  progress: 45,
  addedTs: 0,
  ...over,
})
describe('individual edition/copy inventory', () => {
  it('retains two identical hardbacks beside paperback and borrowed audio', () => {
    const value = inventory()
    expect(parseCopyInventory(value)).toEqual(value)
    expect(value.copies).toHaveLength(4)
    expect(new Set(value.copies.map((c) => c.id)).size).toBe(4)
    expect(inventoryPossession(value)).toEqual({
      ownership: 'owned',
      borrowed: true,
      wishlist: false,
      owned: { physical: true, ebook: false, audiobook: true },
    })
  })
  it('wishlist formats do not imply possession', () => {
    const e = newEdition('hardcover')
    expect(
      inventoryPossession({ version: 1, editions: [e], copies: [newCopy(e.id, 'wishlist')] }),
    ).toEqual({
      ownership: 'unowned',
      borrowed: false,
      wishlist: true,
      owned: { physical: false, ebook: false, audiobook: false },
    })
  })
  it('permits an edition without a copy and an explicitly empty collection', () => {
    expect(parseCopyInventory({ version: 1, editions: [newEdition()], copies: [] })).not.toBeNull()
    expect(parseCopyInventory({ version: 1, editions: [], copies: [] })).not.toBeNull()
  })
  it('rejects orphan copies, duplicate IDs, unknown fields and malformed pages', () => {
    const value = inventory()
    expect(parseCopyInventory({ ...value, copies: [...value.copies, value.copies[0]] })).toBeNull()
    expect(parseCopyInventory({ ...value, editions: [] })).toBeNull()
    expect(parseCopyInventory({ ...value, owner: 'another' })).toBeNull()
    for (const pages of [undefined, -1, 0, 1.5, 20001, '200']) {
      expect(
        parseCopyInventory({ ...value, editions: value.editions.map((e) => ({ ...e, pages })) }),
      ).toBeNull()
    }
  })
  it('validates precise and partial dates without inventing days', () => {
    for (const date of ['', '2026', '2026-09', '2024-02-29', '0096-02-29'])
      expect(validEditionDate(date), date).toBe(true)
    for (const date of ['0000', '2026-02-29', '2026-13', '2026-04-31', '2026-01-00'])
      expect(validEditionDate(date), date).toBe(false)
  })
  it('rejects unsafe cover protocols and credentials', () => {
    const value = inventory()
    for (const cover of [
      'javascript:alert(1)',
      'http://example.com/a.jpg',
      'https://reader:secret@example.com/a.jpg',
    ]) {
      expect(
        parseCopyInventory({ ...value, editions: value.editions.map((e) => ({ ...e, cover })) }),
      ).toBeNull()
    }
  })
  it('drafts legacy flags without assigning one ISBN to several formats', () => {
    const source = book({
      owned: { physical: 'hardcover', ebook: true, audiobook: false },
      borrowed: true,
      wishlist: true,
    })
    const value = prepareCopyInventory(source)
    expect(value.copies.map((c) => c.state)).toEqual(['owned', 'owned', 'borrowed', 'wishlist'])
    expect(value.editions.map((e) => e.isbn)).toEqual(['', '', '', ''])
    expect(source.copyInventory).toBeUndefined()
    expect(source.progress).toBe(45)
  })
  it('carries the single selected edition into a review draft and keeps date precision', () => {
    const value = prepareCopyInventory(book())
    expect(value.editions[0]).toMatchObject({
      isbn: '9780143117841',
      published: '2026',
      pages: 240,
    })
  })
  it('never turns latent format flags into owned copies', () => {
    expect(prepareCopyInventory(book({ ownership: 'unowned' })).copies).toEqual([])
  })
  it('editing an existing inventory does not mutate the saved data or regenerate IDs', () => {
    const existing = inventory(),
      draft = prepareCopyInventory(book({ copyInventory: existing }))
    expect(draft).toEqual(existing)
    draft.copies[0]!.state = 'wishlist'
    expect(existing.copies[0]!.state).toBe('owned')
  })
})

it('does not put borrowed audio on Owned audiobook when the paperback is owned', () => {
  const inventoryValue = inventory()
  const value = book({ copyInventory: inventoryValue, ...inventoryPossession(inventoryValue) })
  expect(onFormatShelf(value, 'physical')).toBe(true)
  expect(onFormatShelf(value, 'audiobook')).toBe(false)
  expect(onUnmarkedShelf(value)).toBe(false)
  const unknown = newEdition()
  const audio = newEdition('audiobook')
  const mixed: CopyInventory = {
    version: 1,
    editions: [unknown, audio],
    copies: [newCopy(unknown.id, 'owned'), newCopy(audio.id, 'borrowed')],
  }
  expect(onUnmarkedShelf(book({ copyInventory: mixed, ...inventoryPossession(mixed) }))).toBe(true)
})

it('retains optional release links without treating them as covers', () => {
  const value = inventory()
  value.editions[0]!.sourceUrl = 'https://hardcover.app/books/edition-handoff'
  expect(parseCopyInventory(value)).toEqual(value)
  value.editions[0]!.sourceUrl = 'https://hardcover.app.evil.test/books/title'
  expect(parseCopyInventory(value)).toBeNull()
})
