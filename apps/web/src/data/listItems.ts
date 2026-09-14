import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import { listsKey } from './lists'

export const bookListsKey = (bookId: string) => ['book-lists', bookId] as const
export const allListItemsKey = ['list-items', 'all'] as const

export interface ListItemRow {
  list_id: string
  book_id: string
  position: number | null
  /** Insertion time — the tiebreak for un-positioned rows. See orderListItems. */
  added_at: string
}

/** Spaced step for manual ordering within a shelf, mirroring lists' ORDER_STEP. */
export const ITEM_POSITION_STEP = 1000

/**
 * The next append position within a list — THE one implementation, extracted after the
 * nullable-ordering class audit found `max + 1000` computed independently at three call sites
 * (search.ts, series.ts, listItems' insert-after) while three OTHER paths wrote NULL. Same shape
 * and same reason as lists' nextListSortOrderFor (#294): a policy that exists once cannot be
 * forgotten by the next writer. Computed in JS over a plain select so it behaves identically
 * under mock clients.
 */
export async function nextItemPositionFor(listId: string): Promise<number> {
  // PAGED. One shelf, but a shelf is not small: after the corpus import a single "Imported TBR"
  // can hold well over a thousand books, and a truncated read here does not fail — it returns a
  // MAX that is too low, so the next append collides with an existing position. The fold stays in
  // JS on purpose (see above); paging fixes the truncation without re-opening that choice.
  const rows = await pageAll<{ position: number | null }>('list_items', (from, to) =>
    supabase
      .from('list_items')
      .select('position', { count: 'exact' })
      .eq('list_id', listId)
      .order('book_id')
      .range(from, to),
  )
  return Math.max(0, ...rows.map((r) => r.position ?? 0)) + ITEM_POSITION_STEP
}

/**
 * A shelf's books in reading order — a TOTAL order, which is the defect this closes.
 *
 * `position` first (the reader's own arrangement), then `added_at` as the tiebreak, then `book_id`
 * to make the sequence total rather than merely mostly-stable — the same three-layer shape as
 * series.ts's entries query.
 *
 * WHY added_at AND NOT book_id ALONE: three ordinary write paths (add-one, bulk-add, CSV import
 * upsert) left `position` NULL, so an imported or bulk-added shelf is entirely NULL — every row
 * collapsing to the same sort key, rendering in whatever order the unordered fetch happened to
 * return, and RESHUFFLING between refetches. book_id would fix the instability with a random uuid
 * order that corresponds to nothing; added_at yields "the order you added them", which is stable
 * AND what a reader expects an un-arranged shelf to show. The column already exists (NOT NULL
 * DEFAULT now()), so this costs one field in the select and no migration.
 *
 * Pure, and exported for exactly that reason: the shuffle-invariance test drives THIS rather than
 * the route.
 */
export function orderListItems<T extends ListItemRow>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY) ||
      a.added_at.localeCompare(b.added_at) ||
      a.book_id.localeCompare(b.book_id),
  )
}

/** All list memberships — used to render Shelves and the Home priority shelf. */
export function useAllListItems() {
  return useQuery({
    queryKey: allListItemsKey,
    queryFn: async (): Promise<ListItemRow[]> => {
      // Every shelf membership in the account — scales with the library, not with shelf count.
      return await pageAll<ListItemRow>('list_items', (from, to) =>
        supabase
          .from('list_items')
          .select('list_id, book_id, position, added_at', { count: 'exact' })
          .order('list_id')
          .order('book_id')
          .range(from, to),
      )
    },
  })
}

/** The set of list ids that currently contain this book. */
export function useBookListIds(bookId: string) {
  return useQuery({
    queryKey: bookListsKey(bookId),
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('list_items')
        .select('list_id')
        .eq('book_id', bookId)
      if (error) throw error
      return (data as { list_id: string }[]).map((r) => r.list_id)
    },
    enabled: !!bookId,
  })
}

/** Add several books to a list at once (used by Match's "add top 3 to Priority TBR"). */
export function useAddBooksToList() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'The shelf' },
    mutationFn: async ({ listId, bookIds }: { listId: string; bookIds: string[] }): Promise<void> => {
      const { data: auth } = await supabase.auth.getUser()
      const ownerId = auth.user?.id
      if (!ownerId) throw new Error('Sign in again to save books to a shelf.')
      if (!bookIds.length) return
      // Bulk add: ONE max lookup, then sequential slots — so a 200-book import lands in a
      // deterministic arrangement instead of an all-NULL shelf that reshuffles per fetch.
      const base = await nextItemPositionFor(listId)
      const { error } = await supabase
        .from('list_items')
        .upsert(
          bookIds.map((book_id, i) => ({
            list_id: listId,
            book_id,
            owner_id: ownerId,
            position: base + i * ITEM_POSITION_STEP,
          })),
          { onConflict: 'list_id,book_id', ignoreDuplicates: true },
        )
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: allListItemsKey })
      void qc.invalidateQueries({ queryKey: listsKey })
    },
  })
}

/** Remove a specific book from a specific list (used by the Shelves list editor). */
export function useRemoveListItem() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'The shelf' },
    mutationFn: async ({ listId, bookId }: { listId: string; bookId: string }): Promise<void> => {
      const { error } = await supabase
        .from('list_items')
        .delete()
        .eq('list_id', listId)
        .eq('book_id', bookId)
      if (error) throw error
    },
    onSuccess: (_data, { bookId }) => {
      void qc.invalidateQueries({ queryKey: allListItemsKey })
      void qc.invalidateQueries({ queryKey: listsKey })
      void qc.invalidateQueries({ queryKey: bookListsKey(bookId) })
    },
  })
}

/** Add or remove a book from a list (optimistic). */
export function useToggleListItem(bookId: string) {
  const qc = useQueryClient()
  const key = bookListsKey(bookId)
  return useMutation({
    meta: { action: 'The shelf' },
    mutationFn: async ({ listId, member }: { listId: string; member: boolean }): Promise<void> => {
      if (member) {
        const { error } = await supabase
          .from('list_items')
          .delete()
          .eq('list_id', listId)
          .eq('book_id', bookId)
        if (error) throw error
      } else {
        const { data: auth } = await supabase.auth.getUser()
        const ownerId = auth.user?.id
        if (!ownerId) throw new Error('Not signed in')
        // Appends at the end of the manual order like every other add path — used to write NULL.
        const position = await nextItemPositionFor(listId)
        const { error } = await supabase
          .from('list_items')
          .insert({ list_id: listId, book_id: bookId, owner_id: ownerId, position })
        if (error) throw error
      }
    },
    onMutate: async ({ listId, member }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<string[]>(key)
      qc.setQueryData<string[]>(key, (old) =>
        member ? (old ?? []).filter((id) => id !== listId) : [...(old ?? []), listId],
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: listsKey })
      void qc.invalidateQueries({ queryKey: allListItemsKey })
    },
  })
}

/** Add one book to a list, appended to the end of the manual order. Pass the list's current
 *  max position (from the items cache); the item lands after it. */
export function useAddListItem() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'The shelf' },
    mutationFn: async ({ listId, bookId, afterPosition }: { listId: string; bookId: string; afterPosition: number }): Promise<void> => {
      const { data: auth } = await supabase.auth.getUser()
      const ownerId = auth.user?.id
      if (!ownerId) throw new Error('Not signed in')
      const { error } = await supabase
        .from('list_items')
        .upsert(
          // Deliberately NOT nextItemPositionFor: this is INSERT-AFTER, positioning relative to a
          // specific neighbour, not appending to the end. Same policy, different question.
          [
            {
              list_id: listId,
              book_id: bookId,
              owner_id: ownerId,
              position: afterPosition + ITEM_POSITION_STEP,
            },
          ],
          { onConflict: 'list_id,book_id', ignoreDuplicates: true },
        )
      if (error) throw error
    },
    onSuccess: (_d, { bookId }) => {
      void qc.invalidateQueries({ queryKey: allListItemsKey })
      void qc.invalidateQueries({ queryKey: listsKey })
      void qc.invalidateQueries({ queryKey: bookListsKey(bookId) })
    },
  })
}
