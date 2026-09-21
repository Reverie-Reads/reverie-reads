import { beforeEach, expect, it, vi } from 'vitest'
import { inventoryPossession, newCopy, newEdition } from '@reverie/core'
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: mocks }))
import { applyIncoming, foldIn, incomingToBook, insertNewBook } from './intake'
const edition = { ...newEdition('hardcover'), sourceUrl: 'https://hardcover.app/books/edition-handoff' }
const inventory = { version: 1 as const, editions: [edition], copies: [newCopy(edition.id, 'wishlist')] }
const incoming = { title: 'Edition handoff', first: 'Nell', last: 'Writer', isbn: '9798991234504', copyInventory: inventory, ...inventoryPossession(inventory) }
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ error: null }) })
it('inserts the copy document in the same book insert, with no second copy write', async () => {
  const insert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'book-id' }, error: null }) }) }))
  mocks.from.mockReturnValue({ insert })
  const saved = await insertNewBook(incoming, 'reader', 'book-id')
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: 'book-id', owner_id: 'reader', copy_inventory: inventory, ownership: 'unowned', wishlist: true }))
  expect(saved.book.copyInventory).toEqual(inventory)
  expect(mocks.from).toHaveBeenCalledTimes(1)
})
it('an exact duplicate remains a review even when ordinary auto-merge is enabled', async () => {
  const existing = { ...incomingToBook({ title: 'Edition handoff', first: 'Nell', last: 'Writer', isbn: '9798991234504' }), id: 'existing' }
  const result = await applyIncoming(incoming, [existing], 'reader', { fuzzy: 'review', autoMergeStrong: true })
  expect(result).toMatchObject({ outcome: 'review', review: { existingId: 'existing', incoming } })
  expect(mocks.from).not.toHaveBeenCalled()
  await expect(foldIn(existing, incoming, 'reader')).rejects.toThrow('manage its editions and copies')
  expect(mocks.from).not.toHaveBeenCalled()
})
it('refuses malformed inventory before a write', async () => {
  await expect(insertNewBook({ ...incoming, copyInventory: { ...inventory, copies: [{ ...inventory.copies[0]!, editionId: 'missing' }] } }, 'reader')).rejects.toThrow('Invalid edition details')
  expect(mocks.from).not.toHaveBeenCalled()
})
