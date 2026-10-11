import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  matchEntryForBook,
  makeSeriesClaim,
  mergeSourceEntries,
  normalizeSeriesClaim,
  sortEntries,
  type Book,
  type SeriesEntry,
  type SeriesStatus,
} from '@reverie/core'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import { booksKey } from './books'
import { allListItemsKey, nextItemPositionFor } from './listItems'

/**
 * Series + series_entries — the series-membership relation behind the series page (the page IS
 * the reading order). Structured rows are authoritative; books.series is only the primary
 * membership's compatibility projection. Opening a page is read-only. Trusted Add/import/edit
 * writes materialize membership transactionally, while historical unknown claims wait for an
 * explicit review. Source (Hardcover) data only ever fills gaps and never overwrites reader order.
 *
 * REMOVAL means one thing on both surfaces (book page and series page): that membership is gone.
 * Removing the selected primary clears the compatibility projection; removing a secondary leaves
 * the book's primary untouched. It is a SOFT delete — the row survives with `removed_at` stamped —
 * because a canonical source refresh would otherwise re-insert the ghost the reader just dismissed.
 * Tombstones are invisible to every read below; only the source merge is shown them.
 */

export interface UiSeries {
  id: string
  name: string
  status: SeriesStatus | null
  /** Canonical total when known. Null means unknown, never a one-book-series inference. */
  length?: number | null
  source: 'manual' | 'hardcover'
  sourceRef: string | null
  refreshedAt: string | null
}

interface SeriesRowT {
  id: string
  owner_id: string
  name: string
  status: string | null
  length: number | null
  source: string
  source_ref: string | null
  refreshed_at: string | null
}

interface SeriesEntryRowT {
  id: string
  series_id: string
  position: number | string
  sort_order?: number | string | null
  sort_user_edited?: boolean
  label: string | null
  title: string
  author: string
  book_id: string | null
  source: string
  user_edited: boolean
  removed_at: string | null
  is_primary?: boolean
  membership_claim?: Record<string, unknown>
  position_claim?: Record<string, unknown>
}

export interface SeriesDetail {
  series: UiSeries
  /** Confirmed live membership. Unknown historical rows never feed progress or gaps. */
  entries: SeriesEntry[]
  /** Live pre-Phase-2B rows awaiting one explicit reader review. */
  unreviewed: SeriesEntry[]
  /** Slots the reader removed. Never rendered — carried so a source refresh can't resurrect them. */
  removed: SeriesEntry[]
}

const toUiSeries = (row: SeriesRowT): UiSeries => ({
  id: row.id,
  name: row.name,
  status: (row.status as SeriesStatus) ?? null,
  length: row.length,
  source: row.source === 'hardcover' ? 'hardcover' : 'manual',
  sourceRef: row.source_ref,
  refreshedAt: row.refreshed_at,
})

const toEntry = (row: SeriesEntryRowT): SeriesEntry => ({
  id: row.id,
  position: Number(row.position) || 0,
  // Zero is a valid private key for an item moved before the first canonical volume. `||` would
  // mistake it for an absent value and repaint the old order after a reload.
  sortOrder: row.sort_order == null ? Number(row.position) || 0 : Number(row.sort_order),
  sortUserEdited: row.sort_user_edited ?? row.user_edited,
  label: row.label,
  title: row.title,
  author: row.author,
  bookId: row.book_id,
  source: row.source === 'hardcover' ? 'hardcover' : 'manual',
  userEdited: row.user_edited,
  isPrimary: row.is_primary ?? false,
  membershipClaim: normalizeSeriesClaim(row.membership_claim),
  positionClaim: normalizeSeriesClaim(row.position_claim),
})

export const seriesKey = (name: string) => ['series', name] as const
export const seriesListKey = ['seriesList'] as const
export const archivedSeriesListKey = ['archivedSeriesList'] as const

const splitName = (full: string): { first: string; last: string } => {
  const parts = full.trim().split(/\s+/)
  if (parts.length <= 1) return { first: '', last: parts[0] ?? '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] ?? '' }
}

async function ownerId(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const id = data.user?.id
  if (!id) throw new Error('Not signed in')
  return id
}

/**
 * Every active series row with its entries — the /series index's whole read.
 *
 * WIDENED for the index (feat/series-builder), additively: the entry select carries the full row
 * rather than three columns, and the `removed_at is null` filter is gone so tombstones can be
 * COUNTED here instead of needing a second query. `total` and `ghosts` mean confirmed live entries.
 *
 * READ-ONLY, and that is load-bearing. The index renders only confirmed structured entries; legacy
 * scalar claims and unknown historical slots are counted separately for explicit review.
 */
export interface SeriesListRow {
  series: UiSeries
  /** live entries */
  total: number
  /** live entries with no linked book */
  ghosts: number
  /** tombstones — removed slots, invisible to every other read */
  removed: number
  /** live historical slots that have not been reviewed into structured authority */
  unreviewed: number
  /** live entries in reading order */
  entries: SeriesEntry[]
}

export function useSeriesList() {
  return useQuery({
    queryKey: seriesListKey,
    queryFn: async (): Promise<Map<string, SeriesListRow>> => {
      // series_entries carries a row per slot — including the ghost slots a series implies — so it
      // crosses the cap ahead of `series`, and a short read here silently shortens series.
      const [rows, ents] = await Promise.all([
        pageAll<SeriesRowT>('series', (from, to) =>
          supabase.from('series').select('*', { count: 'exact' }).order('id').range(from, to),
        ),
        pageAll<SeriesEntryRowT>('series_entries', (from, to) =>
          supabase.from('series_entries').select('*', { count: 'exact' }).order('id').range(from, to),
        ),
      ])
      const byId = new Map<string, SeriesListRow>()
      for (const r of (rows ?? []) as SeriesRowT[])
        byId.set(r.id, {
          series: toUiSeries(r),
          total: 0,
          ghosts: 0,
          removed: 0,
          unreviewed: 0,
          entries: [],
        })
      for (const e of (ents ?? []) as SeriesEntryRowT[]) {
        const s = byId.get(e.series_id)
        if (!s) continue
        if (e.removed_at) {
          s.removed++
          continue
        }
        if (e.membership_claim?.origin === 'unknown') {
          s.unreviewed++
          continue
        }
        s.total++
        if (!e.book_id) s.ghosts++
        s.entries.push(toEntry(e))
      }
      const byName = new Map<string, SeriesListRow>()
      for (const v of byId.values()) {
        v.entries = sortEntries(v.entries)
        byName.set(v.series.name.toLowerCase(), v)
      }
      return byName
    },
  })
}

export interface ArchivedSeries {
  id: string
  name: string
  status: SeriesStatus | null
  length: number | null
  archivedAt: string
  entryCount: number
  linkedBookCount: number
  ghostCount: number
}

interface ArchivedSeriesRowT {
  id: string
  name: string
  status: string | null
  length: number | string | null
  archived_at: string
  entry_count: number | string
  linked_book_count: number | string
  ghost_count: number | string
}

/** Archived series are intentionally absent from normal RLS reads. This explicit, owner-scoped
 * RPC is the only restore inventory, so the ordinary index cannot accidentally render them. */
export function useArchivedSeriesList() {
  return useQuery({
    queryKey: archivedSeriesListKey,
    queryFn: async (): Promise<ArchivedSeries[]> => {
      const { data, error } = await supabase.rpc('list_archived_personal_series')
      if (error) throw error
      return ((data ?? []) as ArchivedSeriesRowT[]).map((row) => ({
        id: row.id,
        name: row.name,
        status: (row.status as SeriesStatus) ?? null,
        length: row.length == null ? null : Number(row.length),
        archivedAt: row.archived_at,
        entryCount: Number(row.entry_count) || 0,
        linkedBookCount: Number(row.linked_book_count) || 0,
        ghostCount: Number(row.ghost_count) || 0,
      }))
    },
  })
}

export function useArchiveSeries(permanent = false) {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'The series deletion' },
    mutationFn: async (series: Pick<UiSeries, 'id' | 'name'>) => {
      const { data, error } = await supabase.rpc(
        permanent ? 'delete_personal_series' : 'archive_personal_series',
        { p_series: series.id },
      )
      if (error) {
        if (permanent && (error.code === 'PGRST202' || error.code === '42883'))
          throw new Error(
            'Permanent series deletion is not available on this server yet. Your series and books have not changed.',
          )
        throw error
      }
      return data as { series_id: string }
    },
    onSuccess: (_data, series) => {
      void qc.invalidateQueries({ queryKey: seriesListKey })
      void qc.invalidateQueries({ queryKey: archivedSeriesListKey })
      void qc.invalidateQueries({ queryKey: seriesKey(series.name) })
      void qc.invalidateQueries({ queryKey: booksKey })
      void qc.invalidateQueries({ queryKey: ['series-strip'] })
      void qc.invalidateQueries({ queryKey: ['book-series-memberships'] })
    },
  })
}

export function useRestoreSeries() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'The series restoration' },
    mutationFn: async (series: Pick<ArchivedSeries, 'id' | 'name'>) => {
      const { data, error } = await supabase.rpc('restore_personal_series', {
        p_series: series.id,
      })
      if (error) throw error
      return data as { series_id: string; primaries_restored: number; primaries_skipped: number }
    },
    onSuccess: (_data, series) => {
      void qc.invalidateQueries({ queryKey: seriesListKey })
      void qc.invalidateQueries({ queryKey: archivedSeriesListKey })
      void qc.invalidateQueries({ queryKey: seriesKey(series.name) })
      void qc.invalidateQueries({ queryKey: booksKey })
      void qc.invalidateQueries({ queryKey: ['series-strip'] })
      void qc.invalidateQueries({ queryKey: ['book-series-memberships'] })
    },
  })
}


/**
 * The production series read is deliberately side-effect-free. A page view is not evidence that a
 * legacy books.series string is true, so it cannot create a series row, adopt a ghost, revive a
 * tombstone, assign an order, or seed status. Explicit review and trusted mutation paths own those
 * transitions.
 */
export async function fetchSeriesDetail(name: string): Promise<SeriesDetail | null> {
  const { data: rows, error } = await supabase
    .from('series')
    .select('*')
    .eq('name', name)
    .limit(1)
  if (error) throw error
  const seriesRow = (rows as SeriesRowT[])[0]
  if (!seriesRow) return null

  const { data: entRows, error: entryError } = await supabase
    .from('series_entries')
    .select('*')
    .eq('series_id', seriesRow.id)
    .order('sort_order', { ascending: true })
    .order('position', { ascending: true })
    .order('id', { ascending: true })
  if (entryError) throw entryError
  const allRows = (entRows ?? []) as SeriesEntryRowT[]
  const live = allRows.filter((row) => !row.removed_at)
  return {
    series: toUiSeries(seriesRow),
    entries: sortEntries(
      live.filter((row) => row.membership_claim?.origin !== 'unknown').map(toEntry),
    ),
    unreviewed: sortEntries(
      live.filter((row) => row.membership_claim?.origin === 'unknown').map(toEntry),
    ),
    removed: allRows.filter((row) => row.removed_at).map(toEntry),
  }
}
export function useSeriesDetail(name: string) {
  return useQuery({ queryKey: seriesKey(name), enabled: !!name.trim(), queryFn: () => fetchSeriesDetail(name) })
}

export function useReviewSeriesClaims(name: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'The series review' },
    mutationFn: async (seriesId?: string) => {
      const { data, error } = await supabase.rpc('admit_series_compatibility_claims', {
        p_series: seriesId ?? null,
        p_series_name: name,
      })
      if (error) throw error
      return data as { series_id: string; books_admitted: number; entries_reviewed: number }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: seriesKey(name) })
      void qc.invalidateQueries({ queryKey: seriesListKey })
      void qc.invalidateQueries({ queryKey: booksKey })
    },
  })
}

/** Promote one already-confirmed membership to the book's primary compatibility projection. */
export function useSetPrimarySeriesMembership(name: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'The primary series' },
    mutationFn: async (entryId: string) => {
      const { error } = await supabase.rpc('set_primary_series_membership', {
        p_entry: entryId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: seriesKey(name) })
      void qc.invalidateQueries({ queryKey: seriesListKey })
      void qc.invalidateQueries({ queryKey: booksKey })
      void qc.invalidateQueries({ queryKey: ['series-strip'] })
      void qc.invalidateQueries({ queryKey: ['book-series-memberships'] })
    },
  })
}

export interface BookSeriesMembership {
  series: Pick<UiSeries, 'id' | 'name'>
  entry: SeriesEntry
}

interface BookSeriesMembershipRowT extends SeriesEntryRowT {
  series: { id: string; name: string } | { id: string; name: string }[]
}

/** Every confirmed live series membership for one book, primary first. */
export async function fetchBookSeriesMemberships(bookId: string): Promise<BookSeriesMembership[]> {
  const { data, error } = await supabase
    .from('series_entries')
    .select('*, series:series_id(id, name)')
    .eq('book_id', bookId)
    .is('removed_at', null)
  if (error) throw error
  return ((data ?? []) as BookSeriesMembershipRowT[])
    .filter((row) => row.membership_claim?.origin !== 'unknown')
    .flatMap((row) => {
      const series = Array.isArray(row.series) ? row.series[0] : row.series
      return series ? [{ series, entry: toEntry(row) }] : []
    })
    .sort(
      (a, b) =>
        Number(!!b.entry.isPrimary) - Number(!!a.entry.isPrimary) ||
        a.series.name.localeCompare(b.series.name),
    )
}

/** Read-only peek for the book-detail strip and the chain prompt — never creates rows. */
export async function fetchSeriesEntries(name: string): Promise<SeriesEntry[] | null> {
  const { data: rows } = await supabase.from('series').select('id').eq('name', name).limit(1)
  const row = (rows ?? [])[0] as { id: string } | undefined
  if (!row) return null
  const { data: ents } = await supabase.from('series_entries').select('*').eq('series_id', row.id).is('removed_at', null)
  return sortEntries(
    ((ents ?? []) as SeriesEntryRowT[])
      .filter((entry) => entry.membership_claim?.origin !== 'unknown')
      .map(toEntry),
  )
}

function useSeriesInvalidate(name: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: seriesKey(name) })
    void qc.invalidateQueries({ queryKey: seriesListKey })
  }
}

export function useUpdateSeries(name: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'The series' },
    mutationFn: async (input: { id: string; name?: string; status?: SeriesStatus | null }) => {
      if (input.name !== undefined && input.name !== name) {
        const { error } = await supabase.rpc('rename_personal_series', {
          p_series: input.id,
          p_name: input.name,
        })
        if (error) throw error
      }
      if (input.status !== undefined) {
        const { error } = await supabase
          .from('series')
          .update({ status: input.status })
          .eq('id', input.id)
        if (error) throw error
      }
    },
    onSuccess: (_d, input) => {
      void qc.invalidateQueries({ queryKey: seriesKey(name) })
      if (input.name) void qc.invalidateQueries({ queryKey: seriesKey(input.name) })
      void qc.invalidateQueries({ queryKey: seriesListKey })
      void qc.invalidateQueries({ queryKey: booksKey })
    },
  })
}

/**
 * A slot write: which entry, where it lands, and optionally a new label.
 *
 * `bookId` is deliberately ABSENT. It used to ride along on every move so the client could mirror
 * the position onto `books.position` itself; `set_series_order` reads it from the entry row inside
 * the transaction instead, which is the only way the mirror can't be pointed at the wrong book by
 * a stale cache. Nothing here needs to know a book id to move a slot.
 */
export interface SeriesSlot {
  entryId: string
  position: number
  label?: string | null
}

export interface SeriesReadingOrderSlot {
  entryId: string
  sortOrder: number
}

interface SeriesOrderResult {
  moved: number
  skipped_user_edited: number
  /** source-origin only: moves dropped because their target position is held outside the batch */
  skipped_collision: number
  books_synced: number
  length_set: boolean
  length_books_synced: number
}

/**
 * THE ONE WRITE PATH for series position and series length (`set_series_order`, 20260814010000).
 *
 * Everything that moves a slot or sets a length goes through here. Before Phase 2 this was spread
 * across a per-row update loop, a `books.position` mirror issued as a separate statement
 * (`syncBookPosition`), and a `books.series_count` write buried in the book patch — three writers
 * for two facts, none of them transactional with the others. docs/audits/series-count-schema.md §5
 * named the mirror specifically as "the dual-write-without-a-chokepoint shape".
 *
 * `origin` is the user_edited contract and the server enforces it, not this function: a `'source'`
 * batch cannot move a row the reader has arranged, decided from the STORED flag rather than
 * whatever this client's cache believes. The skipped count comes back so a refresh can say what it
 * left alone instead of appearing to do nothing.
 */
async function writeSeriesOrder(input: {
  seriesId: string
  slots?: SeriesSlot[]
  origin?: 'reader' | 'source'
  length?: number | null
  setLength?: boolean
}): Promise<SeriesOrderResult> {
  const { data, error } = await supabase.rpc('set_series_order_claimed', {
    p_series: input.seriesId,
    p_slots: (input.slots ?? []).map((s) => ({
      entry_id: s.entryId,
      position: s.position,
      // Only sent when the caller means to change it — the RPC keys off key PRESENCE, so passing
      // `label: undefined` and omitting the key are not the same thing to it.
      ...(s.label !== undefined ? { label: s.label } : {}),
    })),
    p_origin: input.origin ?? 'reader',
    p_opts: input.setLength ? { length: input.length ?? null } : {},
  })
  if (error) throw error
  return data as SeriesOrderResult
}

/** Reposition entries without changing their canonical volume numbers. Midpoint values live only
 * in `sort_order`; readers see ordinal shelf order plus the independent volume number. */
export function useMoveEntry(name: string) {
  const invalidate = useSeriesInvalidate(name)
  return useMutation({
    meta: { action: 'The series' },
    mutationFn: async (input: { seriesId: string; slots: SeriesReadingOrderSlot[] }) => {
      const { data, error } = await supabase.rpc('set_series_reading_order', {
        p_series: input.seriesId,
        p_slots: input.slots.map((slot) => ({
          entry_id: slot.entryId,
          sort_order: slot.sortOrder,
        })),
      })
      if (error) throw error
      return data as { moved: number }
    },
    onSuccess: () => invalidate(),
  })
}

/**
 * Edit the canonical volume number and optional label together. This deliberately uses the
 * established position writer so the primary book projection and position provenance remain
 * transactional, while `sort_order` stays untouched.
 */
export function useUpdateEntry(name: string) {
  const invalidate = useSeriesInvalidate(name)
  return useMutation({
    meta: { action: 'The series' },
    mutationFn: (input: {
      seriesId: string
      entryId: string
      position: number
      label: string | null
    }) =>
      writeSeriesOrder({
        seriesId: input.seriesId,
        slots: [{ entryId: input.entryId, position: input.position, label: input.label }],
        origin: 'reader',
      }),
    onSuccess: () => invalidate(),
  })
}

/**
 * Remove one membership — the series page's ✕. The row is soft-deleted so a later Hardcover
 * refresh cannot resurrect what the reader dismissed. Removing the selected primary also clears
 * the compatibility tuple; removing a secondary leaves the book's other membership untouched.
 *
 * ONE RPC, ATOMICALLY (`remove_series_entry`, 20260731010000). This used to be two sequential,
 * independently-committed writes — tombstone the entry, then null `books.series` — and a failure
 * between them left the slot tombstoned while the book still named the series. That state did not go
 * stale, it silently UNDID the removal: the reconciliation in `useSeriesDetail` revives any tombstone
 * whose title matches a book still naming the series, so the next read of this page brought the slot
 * back. Both writes now land in one transaction or neither does.
 *
 * The RPC takes only the entry id. `book_id` is read from the entry row SERVER-SIDE rather than passed
 * in: the caller used to send it from whatever the component's cache held, and a stale cache would
 * clear the wrong book's series while leaving the linked one still naming it — the fix reproducing the
 * defect through its own call. The entry row is the only authority on what the slot links to.
 *
 * Works for ghosts too — an entry with no linked book tombstones and touches no `books` row at all.
 */
export function useRemoveEntry(name: string) {
  const qc = useQueryClient()
  const invalidate = useSeriesInvalidate(name)
  return useMutation({
    meta: { action: 'The series' },
    mutationFn: async (input: { entryId: string }) => {
      const { error } = await supabase.rpc('remove_series_membership', {
        p_entry: input.entryId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: booksKey })
      void qc.invalidateQueries({ queryKey: ['series-strip'] })
      void qc.invalidateQueries({ queryKey: ['book-series-memberships'] })
    },
  })
}

/** Save a deliberate primary membership through the owner-bound atomic RPC. Other
 * memberships remain secondary; clearing the primary tombstones only that membership. */
export function useSyncBookSeries() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'The series' },
    mutationFn: async ({
      book,
      newSeries,
      newPosition,
      newSeriesCount,
    }: {
      book: Book
      newSeries: string
      newPosition: number | null
      newSeriesCount?: number | null
    }) => {
      const membershipClaim = makeSeriesClaim('reader', 'book_edit', {
        at: new Date().toISOString(),
      })
      const { error } = await supabase.rpc('set_book_series_membership', {
        p_book: book.id,
        p_series: null,
        p_series_name: newSeries,
        p_position: newPosition,
        p_length: newSeriesCount ?? null,
        p_make_primary: true,
        p_membership_claim: membershipClaim,
        p_position_claim:
          newPosition == null ? { origin: 'unknown' } : membershipClaim,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: seriesListKey })
      void qc.invalidateQueries({ queryKey: booksKey })
      void qc.invalidateQueries({ queryKey: ['series-strip'] })
      void qc.invalidateQueries({ queryKey: ['book-series-memberships'] })
      // REMOVE rather than invalidate: the series query is persisted to IndexedDB and staleTime keeps
      // a restored copy "fresh", so an invalidated query still PAINTS the old badges for a beat before
      // the refetch lands. Dropping it means the series page opens on its loading line and the first
      // thing the reader sees is the number they just typed.
      qc.removeQueries({ queryKey: ['series'] })
    },
  })
}

/**
 * Revive a tombstone matching this title, if one exists — an explicit add is the reader taking their
 * removal back, and reusing the row keeps it from going on suppressing source refreshes forever.
 * Returns true when it handled the add.
 */
async function revivedTombstone(
  seriesId: string,
  title: string,
  author: string,
  position: number,
  bookId: string | null,
): Promise<boolean> {
  const { data } = await supabase
    .from('series_entries')
    // `author` is selected because the match needs it to break a same-title tie; ordered so that a
    // tie is at least resolved the same way twice. Both were missing before: this path picked the
    // first tombstone out of an unordered result and never read author at all.
    .select('id, title, author')
    .eq('series_id', seriesId)
    .not('removed_at', 'is', null)
    .order('position', { ascending: true })
    .order('id', { ascending: true })
  const candidates = (data ?? []) as { id: string; title: string; author: string }[]
  // The caller knows the author as a display string already (a Book's byline, or what the reader
  // typed for a ghost), so it arrives pre-joined rather than as first/last.
  const match = matchEntryForBook(candidates, { title, first: '', last: author })
  if (match.kind !== 'match') return false
  const { error } = await supabase
    .from('series_entries')
    .update({
      removed_at: null,
      book_id: bookId,
      position,
      sort_order: position,
      sort_user_edited: true,
      is_primary: false,
      membership_claim: makeSeriesClaim('reader', 'series_builder', {
        at: new Date().toISOString(),
      }),
      position_claim: makeSeriesClaim('reader', 'series_order', {
        at: new Date().toISOString(),
      }),
      user_edited: true,
    })
    .eq('id', match.entry.id)
  return !error
}

/** Add library books (the picker path) — appended to the end in pick order. */
export function useAddSeriesEntries(name: string) {
  const qc = useQueryClient()
  const invalidate = useSeriesInvalidate(name)
  return useMutation({
    meta: { action: 'The series' },
    mutationFn: async (input: { seriesId: string; books: Book[]; after: number }) => {
      let at = Math.floor(input.after)
      for (const b of input.books) {
        const position = ++at
        const membershipClaim = makeSeriesClaim('reader', 'series_builder', {
          at: new Date().toISOString(),
        })
        const { error } = await supabase.rpc('set_book_series_membership', {
          p_book: b.id,
          p_series: input.seriesId,
          p_series_name: name,
          p_position: position,
          p_length: null,
          // Adding from a second series page means "also belongs here", not "replace the primary".
          // A book without a primary compatibility series adopts this one; otherwise the existing
          // primary stays selected until the reader explicitly presses Make primary.
          p_make_primary: !b.series.trim() || b.series.trim() === name.trim(),
          p_membership_claim: membershipClaim,
          p_position_claim: makeSeriesClaim('reader', 'series_order', {
            at: new Date().toISOString(),
          }),
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: booksKey })
      void qc.invalidateQueries({ queryKey: ['series-strip'] })
      void qc.invalidateQueries({ queryKey: ['book-series-memberships'] })
    },
  })
}

/** A canonical entry the reader doesn't have yet — a manual ghost slot. */
export function useAddGhostEntry(name: string) {
  const invalidate = useSeriesInvalidate(name)
  return useMutation({
    meta: { action: 'The series' },
    mutationFn: async (input: { seriesId: string; title: string; author: string; position: number }) => {
      const uid = await ownerId()
      if (await revivedTombstone(input.seriesId, input.title, input.author, input.position, null))
        return
      const { error } = await supabase.from('series_entries').insert({
        series_id: input.seriesId,
        owner_id: uid,
        position: input.position,
        sort_order: input.position,
        sort_user_edited: true,
        title: input.title,
        author: input.author,
        source: 'manual',
        user_edited: true,
        is_primary: false,
        membership_claim: makeSeriesClaim('reader', 'series_builder', {
          at: new Date().toISOString(),
        }),
        position_claim: makeSeriesClaim('reader', 'series_order', {
          at: new Date().toISOString(),
        }),
      })
      if (error) throw error
    },
    onSuccess: () => invalidate(),
  })
}

/**
 * The ghost-slot add action: creates a real (wishlist — per ownership model, a wanting context)
 * book record, links the entry, and optionally lands it straight on a TBR.
 */
export function useAcquireGhost(name: string) {
  const qc = useQueryClient()
  const invalidate = useSeriesInvalidate(name)
  return useMutation({
    meta: { action: 'The series' },
    mutationFn: async (input: { entry: SeriesEntry; genre: string; tbrId?: string }): Promise<string> => {
      const uid = await ownerId()
      const { first, last } = splitName(input.entry.author)
      const { data: book, error } = await supabase
        .from('books')
        .insert({
          owner_id: uid,
          title: input.entry.title,
          author_first: first || null,
          author_last: last || null,
          series: null,
          series_user_chosen: false,
          series_claim: { origin: 'unknown' },
          position: null,
          ownership: 'unowned',
          wishlist: true,
          borrowed: false,
          genre: input.genre,
          source: 'Series',
        })
        .select('id')
        .single()
      if (error) throw error
      const bookId = (book as { id: string }).id
      const { error: linkErr } = await supabase.rpc('link_series_entry_to_book', {
        p_entry: input.entry.id,
        p_book: bookId,
        p_make_primary: true,
        p_membership_claim: makeSeriesClaim('reader', 'ghost_acquire', {
          at: new Date().toISOString(),
        }),
      })
      if (linkErr) throw linkErr
      if (input.tbrId) {
        const after = await nextItemPositionFor(input.tbrId)
        const { error: liErr } = await supabase
          .from('list_items')
          .insert({ list_id: input.tbrId, book_id: bookId, owner_id: uid, position: after })
        if (liErr) throw liErr
      }
      return bookId
    },
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: booksKey })
      void qc.invalidateQueries({ queryKey: allListItemsKey })
      void qc.invalidateQueries({ queryKey: ['series-strip'] })
      void qc.invalidateQueries({ queryKey: ['book-series-memberships'] })
    },
  })
}

/**
 * Hardcover seeding — source data only fills gaps. New canonical slots arrive as ghosts; an
 * un-edited entry may take a refreshed position; user_edited rows are never moved, and nothing is
 * ever deleted.
 *
 * "Linked library books are never moved" was true when this was written and is no longer: a linked
 * entry the reader has not arranged is precisely what this now corrects. What protects a row is the
 * reader having touched it, not the row having a book attached.
 */
export function useApplySeriesSource(name: string) {
  const invalidate = useSeriesInvalidate(name)
  return useMutation({
    meta: { action: 'The series' },
    mutationFn: async (input: { detail: SeriesDetail; author: string }): Promise<{ added: number; skipped: number; skippedCollision: number; unavailable: boolean }> => {
      const uid = await ownerId()
      const { data, error } = await supabase.functions.invoke('series', {
        body: { name, author: input.author },
      })
      if (error) throw error
      const payload = data as { sourceRef: string | null; entries: { position: number; title: string; author: string }[]; unavailable?: boolean }
      const src = payload.entries ?? []
      if (payload.unavailable && !src.length) return { added: 0, skipped: 0, skippedCollision: 0, unavailable: true }
      const detail = await fetchSeriesDetail(name)
      if (!detail || detail.series.id !== input.detail.series.id) throw new Error('The series changed. Reload it before fetching again.')
      // Tombstones join `existing` so a removed slot MATCHES and is therefore never re-inserted —
      // the whole point of keeping them. They carry user_edited, so the merge can't try to move one.
      const { inserts, moves } = mergeSourceEntries(
        [...detail.entries, ...detail.unreviewed, ...detail.removed],
        src,
      )
      // ONE batched call, `origin: 'source'`. Two things change here beyond atomicity. The moves
      // used to go one row at a time, so a catalog reshuffle that passed entries through each
      // other's positions committed colliding intermediates. And `mergeSourceEntries` decided the
      // user_edited question client-side, from this component's cache; the RPC re-decides it from
      // the STORED flag and drops any row the reader has arranged, so a stale cache can no longer
      // talk the source into overwriting a reader's placement.
      let skipped = 0
      let skippedCollision = 0
      if (moves.length) {
        const res = await writeSeriesOrder({
          seriesId: detail.series.id,
          slots: moves.map((m) => ({ entryId: m.id, position: m.position })),
          origin: 'source',
        })
        skipped = res.skipped_user_edited
        // A catalog position already held by a slot outside the batch: that one move is dropped
        // server-side (the occupant is never renumbered out of the way) and the rest of the refresh
        // still applies — the whole batch no longer aborts on one collision.
        skippedCollision = res.skipped_collision
      }
      // Re-read after moves: returned source positions can collide with reader-held slots or
      // another session. A single batch insert either persists every new slot or reports failure.
      const afterMoves = moves.length ? await fetchSeriesDetail(name) : detail
      if (!afterMoves || afterMoves.series.id !== detail.series.id) throw new Error('The series changed. Reload it before fetching again.')
      const occupied = new Set([...afterMoves.entries, ...afterMoves.unreviewed].map(entry => entry.position))
      let nextFree = Math.floor(Math.max(0, ...occupied, ...src.map(entry => Number.isFinite(entry.position) ? entry.position : 0)))
      const seen = new Set<string>()
      const rows = []
      for (const entry of inserts) {
        const identity = entry.title.trim().toLocaleLowerCase()
        if (seen.has(identity)) continue
        seen.add(identity)
        const hasPosition = Number.isFinite(entry.position) && entry.position > 0
        const position = hasPosition ? entry.position : ++nextFree
        if (occupied.has(position)) { skippedCollision++; continue }
        occupied.add(position)
        const claim = makeSeriesClaim('enrichment', 'hardcover_series', {
          sourceRef: payload.sourceRef ?? undefined, confidence: 'high', at: new Date().toISOString(),
        })
        rows.push({
          series_id: detail.series.id, owner_id: uid, position, sort_order: position,
          sort_user_edited: false, title: entry.title, author: entry.author,
          source: 'hardcover', user_edited: false, is_primary: false,
          membership_claim: claim, position_claim: hasPosition ? claim : { origin: 'unknown' },
        })
      }
      let added = 0
      if (rows.length) {
        const { data: saved, error: insertError } = await supabase.from('series_entries').insert(rows).select('id')
        if (insertError) throw insertError
        if (saved?.length !== rows.length) throw new Error('Could not confirm the saved series entries. Reload before trying again.')
        added = saved.length
      }
      const { error: refreshError } = await supabase.from('series').update({
        refreshed_at: new Date().toISOString(),
        ...(src.length ? { source: 'hardcover', source_ref: payload.sourceRef } : {}),
      }).eq('id', detail.series.id)
      if (refreshError) throw refreshError
      return { added, skipped, skippedCollision, unavailable: !!payload.unavailable && !src.length }
    },
    onSettled: () => invalidate(),
  })
}
