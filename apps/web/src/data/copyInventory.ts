import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parseCopyInventory, type Book, type CopyInventory } from '@reverie/core'
import { supabase } from '../lib/supabase'
import { booksKey } from './books'
import type { BookRow } from './types'
import { toBook } from './mappers'

export function useSaveCopyInventory(bookId: string) {
  const qc = useQueryClient()
  return useMutation({
    scope: { id: `book:${bookId}` },
    meta: { action: 'Editions and copies', errorPresentation: 'inline' },
    mutationFn: async ({ inventory, revision }: { inventory: CopyInventory; revision: number }): Promise<Book> => {
      if (!parseCopyInventory(inventory)) throw new Error('Check the edition details and copy information before saving.')
      const { data, error } = await supabase.rpc('save_copy_inventory', {
        p_book: bookId, p_expected_revision: revision, p_inventory: inventory,
      })
      if (error) throw new Error(error.code === 'PT409'
        ? 'Copies changed elsewhere. Your draft is still here. Close it and reopen to load the saved copies.'
        : error.message)
      if (!data) throw new Error('The saved copies could not be confirmed. Retry with this draft.')
      return toBook(data as BookRow)
    },
    onSuccess: (saved) => {
      // Do not replace separately hydrated contributors/reading history with the RPC's bare row.
      qc.setQueryData<Book[]>(booksKey, old => old?.map(book => book.id === saved.id ? {
        ...book, copyInventory: saved.copyInventory, copyInventoryRevision: saved.copyInventoryRevision,
        ownership: saved.ownership, borrowed: saved.borrowed, wishlist: saved.wishlist, owned: saved.owned,
      } : book))
      void qc.invalidateQueries({ queryKey: booksKey })
      void qc.invalidateQueries({ queryKey: ['household'] })
    },
  })
}
