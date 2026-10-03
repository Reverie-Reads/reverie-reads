import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { normalizeSeriesStatus, type SeriesStatus } from '@reverie/core'
import { useAuth } from '../auth/AuthProvider'
import { ingestCorpusCover } from '../lib/covers'
import { supabase } from '../lib/supabase'

export type HouseholdMemberRole = 'owner' | 'member'

export interface HouseholdMember {
  householdId: string
  householdName: string
  userId: string
  displayName: string
  role: HouseholdMemberRole
  allowMemberLibraryAdds: boolean
}

export interface HouseholdBook {
  id: string
  title: string
  author: string
  /** Display cover: canonical corpus artwork first, then an eligible personal-copy fallback. */
  cover: string
  coverColor: string
  /** Canonical values stay separate so a display fallback never becomes an implicit corpus edit. */
  corpusCover: string
  corpusCoverColor: string
  coverOptions: { url?: string; source?: string; sourceUrl?: string }[]
  /** False makes administrator review fail closed when accepted-option state was not returned. */
  coverOptionsAvailable: boolean
  series: string
  position: number | null
  seriesCount: number | null
  seriesStatus: SeriesStatus
  primaryGenre: string
  genres: string[]
  subgenre: string
  subgenres: string[]
  isbns: string[]
  owners: HouseholdBookOwner[]
  householdTags: string[]
  householdTropes: HouseholdTrope[]
  publicationYear: number | null
  publicationMonth: number | null
  publicationDay: number | null
  addedAt: string
}

export interface HouseholdTrope {
  id?: string
  name: string
  emphasis: 'pinned' | 'present'
  scope?: 'corpus'
}

export interface HouseholdBookOwner {
  bookId: string
  userId: string
  displayName: string
  ownership: string
  borrowed: boolean
  ownedPhysical: string
  ownedEbook: boolean
  ownedAudiobook: boolean
  bookFormat: string
  cover: string
  coverThumb: string
  coverColor: string
  shared: boolean
}

interface HouseholdBookSelection {
  bookId: string
  householdId: string
}

interface HouseholdRosterRow {
  household_id: string
  household_name: string
  user_id: string
  display_name: string | null
  member_role: HouseholdMemberRole
  allow_member_library_adds: boolean
}

interface HouseholdBookRow {
  work_id: string
  title: string
  author: string | null
  cover_url: string | null
  cover_color: string | null
  cover_options: { url?: string; source?: string; sourceUrl?: string }[] | null
  series_name: string | null
  series_position: number | string | null
  series_count: number | null
  series_status: string | null
  primary_genre: string | null
  genres: string[] | null
  subgenre: string | null
  subgenres: string[] | null
  isbns: string[] | null
  owners: HouseholdBookOwnerRow[] | null
  household_tags: string[] | null
  household_tropes: unknown[] | null
  pub_y: number | null
  pub_m: number | null
  pub_d: number | null
  added_at: string
}

interface HouseholdBookOwnerRow {
  bookId?: string
  userId?: string
  displayName?: string | null
  ownership?: string | null
  borrowed?: boolean | null
  ownedPhysical?: string | null
  ownedEbook?: boolean | null
  ownedAudiobook?: boolean | null
  format?: string | null
  coverUrl?: string | null
  coverThumbUrl?: string | null
  coverColor?: string | null
  shared?: boolean | null
}

const readerName = (value: string | null): string => value?.trim() || 'Reader'

const numericPosition = (value: number | string | null): number | null => {
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const householdTropes = (value: readonly unknown[] | null): HouseholdTrope[] =>
  (value ?? []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as { id?: unknown; name?: unknown; emphasis?: unknown; scope?: unknown }
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!name) return []
    return [{
      ...(typeof row.id === 'string' && row.id ? { id: row.id } : {}),
      name,
      emphasis: row.emphasis === 'pinned' ? 'pinned' : 'present',
      ...(row.scope === 'corpus' ? { scope: 'corpus' as const } : {}),
    }]
  })

/**
 * Explicit mappers are a second whitelist beside the RPC return signature. If the database
 * function ever grows a column, it does not silently become client state just because PostgREST
 * included it in the response.
 */
export const toHouseholdMember = (row: HouseholdRosterRow): HouseholdMember => ({
  householdId: row.household_id,
  householdName: row.household_name,
  userId: row.user_id,
  displayName: readerName(row.display_name),
  role: row.member_role,
  allowMemberLibraryAdds: row.allow_member_library_adds ?? false,
})

export const toHouseholdBook = (row: HouseholdBookRow): HouseholdBook => ({
  id: row.work_id,
  title: row.title,
  author: row.author?.trim() ?? '',
  cover: row.cover_url ?? '',
  coverColor: row.cover_color ?? '',
  corpusCover: row.cover_url ?? '',
  corpusCoverColor: row.cover_color ?? '',
  coverOptions: row.cover_options ?? [],
  coverOptionsAvailable: Array.isArray(row.cover_options),
  series: row.series_name ?? '',
  position: numericPosition(row.series_position),
  seriesCount: row.series_count,
  seriesStatus: normalizeSeriesStatus(row.series_status, !!row.series_name),
  primaryGenre: row.primary_genre ?? '',
  genres: row.genres ?? [],
  subgenre: row.subgenre ?? '',
  subgenres: row.subgenres ?? [],
  isbns: row.isbns ?? [],
  owners: (row.owners ?? []).flatMap((owner) =>
    owner.userId && owner.bookId
      ? [{
          bookId: owner.bookId,
          userId: owner.userId,
          displayName: readerName(owner.displayName ?? null),
          ownership: owner.ownership ?? 'unowned',
          borrowed: owner.borrowed ?? false,
          ownedPhysical: owner.ownedPhysical ?? '',
          ownedEbook: owner.ownedEbook ?? false,
          ownedAudiobook: owner.ownedAudiobook ?? false,
          bookFormat: owner.format ?? '',
          cover: owner.coverUrl ?? '',
          coverThumb: owner.coverThumbUrl ?? '',
          coverColor: owner.coverColor ?? '',
          shared: owner.shared ?? false,
        }]
      : [],
  ),
  householdTags: row.household_tags ?? [],
  householdTropes: householdTropes(row.household_tropes),
  publicationYear: row.pub_y,
  publicationMonth: row.pub_m,
  publicationDay: row.pub_d,
  addedAt: row.added_at,
})

const normalizedReaderName = (value: string): string => value.trim().toLocaleLowerCase()

function uniqueReaderSuffix(readerId: string, allReaderIds: readonly string[]): string {
  const distinctOthers = [...new Set(allReaderIds)].filter((candidate) => candidate !== readerId)
  let length = Math.min(8, readerId.length)
  while (
    length < readerId.length &&
    distinctOthers.some((candidate) => candidate.slice(0, length) === readerId.slice(0, length))
  ) {
    length += 1
  }
  return readerId.slice(0, length)
}

/**
 * One complete-roster-derived identity map feeds both member chips and book ownership labels.
 * Book rows are deliberately not allowed to decide whether a name is ambiguous: members with an
 * empty library still participate, and a colliding eight-character UUID prefix grows until unique.
 */
export function householdOwnerLabels(
  members: readonly HouseholdMember[],
): ReadonlyMap<string, string> {
  const idsByName = new Map<string, Set<string>>()
  for (const member of members) {
    const name = normalizedReaderName(member.displayName)
    const ids = idsByName.get(name) ?? new Set<string>()
    ids.add(member.userId)
    idsByName.set(name, ids)
  }

  const allReaderIds = members.map((member) => member.userId)
  return new Map(
    members.map((member) => {
      const ids = idsByName.get(normalizedReaderName(member.displayName)) ?? new Set<string>()
      const needsSuffix = member.displayName === 'Reader' || ids.size > 1
      const label = needsSuffix
        ? `${member.displayName} · ${uniqueReaderSuffix(member.userId, allReaderIds)}`
        : member.displayName
      return [member.userId, label]
    }),
  )
}

export function labelHouseholdData(
  members: readonly HouseholdMember[],
  books: readonly HouseholdBook[],
  currentReaderId = '',
): { members: HouseholdMember[]; books: HouseholdBook[] } {
  const labels = householdOwnerLabels(members)
  return {
    members: members.map((member) => ({
      ...member,
      displayName: labels.get(member.userId) ?? member.displayName,
    })),
    // Owner copy data is roster-authorized independently of household membership. An unknown
    // owner is dropped, while the work itself remains: household membership survives personal
    // removal and therefore legitimately has no active owner copy.
    books: books.map((book) => {
      const owners = book.owners.flatMap((owner) => {
        const displayName = labels.get(owner.userId)
        return displayName ? [{ ...owner, displayName }] : []
      })
      const personalCover =
        owners.find((owner) => owner.userId === currentReaderId && owner.cover) ??
        owners.find((owner) => owner.cover)
      return {
        ...book,
        cover: book.corpusCover || personalCover?.cover || '',
        coverColor: book.corpusCover ? book.corpusCoverColor : (personalCover?.coverColor ?? ''),
        owners,
      }
    }),
  }
}

/**
 * A household selection carries the household that authorized it. Any authorization transition
 * clears the stored value, so recovery cannot reopen a drawer without a new reader gesture even if
 * the same book id becomes visible again.
 */
export function useHouseholdBookSelection({
  householdId,
  books,
  authorized,
  loading = false,
}: {
  householdId: string | null
  books: readonly HouseholdBook[]
  authorized: boolean
  /** A routine network revalidation hides data but is not an authorization loss. */
  loading?: boolean
}) {
  const [selection, setSelection] = useState<HouseholdBookSelection | null>(null)
  const selected =
    (authorized &&
      selection?.householdId === householdId &&
      books.find((book) => book.id === selection.bookId)) ||
    null

  useEffect(() => {
    if (!selection) return
    // Keep the reader's explicit selection behind the loading screen during an ordinary
    // revalidation. A paused, failed, revoked, or replacement authorization settles with
    // `loading=false` and still clears it before anything can be rendered again.
    if (!authorized && loading) return
    const remainsAuthorized =
      authorized &&
      !!householdId &&
      selection.householdId === householdId &&
      books.some((book) => book.id === selection.bookId)
    if (!remainsAuthorized) setSelection(null)
  }, [authorized, books, householdId, loading, selection])

  return {
    selected,
    open: (bookId: string) => {
      if (authorized && householdId && books.some((book) => book.id === bookId)) {
        setSelection({ bookId, householdId })
      }
    },
    clear: () => setSelection(null),
  }
}

export const householdRosterKey = (readerId: string) => ['household', 'roster', readerId] as const
export const householdBooksKey = (readerId: string, householdId: string) =>
  ['household', 'books', readerId, householdId] as const

interface HouseholdAuthorizationQueryState {
  status: 'pending' | 'error' | 'success'
  fetchStatus: 'fetching' | 'paused' | 'idle'
}

/**
 * Cached household data is not authorization. A query authorizes its response only after a
 * successful network attempt has completely settled. In particular, TanStack reports an offline
 * revalidation as success + paused when it has cached data; treating !isFetching as settled would
 * repaint that data while membership cannot be checked.
 */
export const householdQueryIsAuthorized = (query: HouseholdAuthorizationQueryState): boolean =>
  query.status === 'success' && query.fetchStatus === 'idle'

const authorizationSensitiveQueryOptions = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: 'always' as const,
  refetchOnWindowFocus: 'always' as const,
}

export function useHouseholdRoster() {
  const { session } = useAuth()
  const readerId = session?.user.id ?? ''
  const queryClient = useQueryClient()
  const queryKey = householdRosterKey(readerId)

  useEffect(() => {
    const mountedQueryKey = householdRosterKey(readerId)
    return () => queryClient.removeQueries({ queryKey: mountedQueryKey, exact: true })
  }, [queryClient, readerId])

  return useQuery({
    queryKey,
    enabled: !!readerId,
    ...authorizationSensitiveQueryOptions,
    queryFn: async (): Promise<HouseholdMember[]> => {
      const { data, error } = await supabase.rpc('household_roster')
      if (error) throw error
      return ((data ?? []) as HouseholdRosterRow[]).map(toHouseholdMember)
    },
  })
}

export function useHouseholdBooks(householdId: string | null) {
  const { session } = useAuth()
  const readerId = session?.user.id ?? ''
  const queryClient = useQueryClient()
  const queryKey = householdBooksKey(readerId, householdId ?? '')

  useEffect(() => {
    const mountedQueryKey = householdBooksKey(readerId, householdId ?? '')
    return () => queryClient.removeQueries({ queryKey: mountedQueryKey, exact: true })
  }, [queryClient, readerId, householdId])

  return useQuery({
    queryKey,
    enabled: !!readerId && !!householdId,
    ...authorizationSensitiveQueryOptions,
    queryFn: async (): Promise<HouseholdBook[]> => {
      const { data, error } = await supabase.rpc('household_library_works')
      if (error) throw error
      return ((data ?? []) as HouseholdBookRow[]).map(toHouseholdBook)
    },
  })
}

/**
 * The sole authorization boundary for the household screen. It returns no renderable roster or
 * books until both required queries are successful and idle, and reports paused separately so the
 * screen can explain why network-only household access is unavailable.
 */
export function useHouseholdLibraryAuthorization() {
  const { session } = useAuth()
  const readerId = session?.user.id ?? ''
  const queryClient = useQueryClient()
  const roster = useHouseholdRoster()
  const rosterAuthorized = householdQueryIsAuthorized(roster)
  const householdId = rosterAuthorized ? (roster.data?.[0]?.householdId ?? null) : null
  const householdBooks = useHouseholdBooks(householdId)
  const booksAuthorized = !householdId || householdQueryIsAuthorized(householdBooks)
  const authorized = rosterAuthorized && booksAuthorized
  const paused =
    roster.fetchStatus === 'paused' ||
    (!!householdId && householdBooks.fetchStatus === 'paused')
  const error = roster.error ?? householdBooks.error

  return {
    householdId,
    members: authorized ? (roster.data ?? []) : [],
    books: authorized ? (householdBooks.data ?? []) : [],
    authorized,
    paused,
    error,
    loading: !paused && !authorized && (!error || roster.isFetching || householdBooks.isFetching),
    retry: async () => {
      // Membership may have changed. Only retry books for the freshly authorized household.
      // Explicit invalidation also handles a fast, unchanged roster response: React can batch
      // that response without ever disabling/re-enabling an already-failed books query.
      const refreshed = await roster.refetch()
      const verifiedHousehold = householdQueryIsAuthorized(refreshed)
        ? refreshed.data?.[0]?.householdId
        : null
      if (verifiedHousehold)
        await queryClient.invalidateQueries(
          { queryKey: householdBooksKey(readerId, verifiedHousehold), exact: true },
          { cancelRefetch: false },
        )
    },
  }
}

const invalidateLibraryMembership = async (queryClient: ReturnType<typeof useQueryClient>) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['household'] }),
    queryClient.invalidateQueries({ queryKey: ['books'] }),
    queryClient.invalidateQueries({ queryKey: ['works-browse'] }),
  ])
}

export function useAddPersonalBookToHousehold() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Sharing with the household' },
    mutationFn: async (bookId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('add_personal_book_to_household', {
        p_book: bookId,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}

export function useAddCorpusWorkToHousehold() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Adding to the household library' },
    mutationFn: async (workId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('add_corpus_work_to_household', {
        p_work: workId,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}

export function useAddPersonalBooksToHousehold() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Adding books to the household library' },
    mutationFn: async (bookIds: string[]): Promise<number> => {
      const { data, error } = await supabase.rpc('add_personal_books_to_household', {
        p_books: bookIds,
      })
      if (error) throw error
      return data as number
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}

export function useAddCorpusWorkToMemberLibrary() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Adding to a household member’s library' },
    mutationFn: async ({ workId, memberId }: { workId: string; memberId: string }): Promise<string> => {
      const { data, error } = await supabase.rpc('add_corpus_work_to_member_library', {
        p_work: workId,
        p_member: memberId,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}

export function useSetHouseholdMemberLibraryAdds() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Updating household add permission' },
    mutationFn: async (allow: boolean): Promise<boolean> => {
      const { data, error } = await supabase.rpc('set_household_member_library_adds', {
        p_allow: allow,
      })
      if (error) throw error
      return data as boolean
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}

export interface HouseholdCatalogWorkInput {
  title: string
  author: string
  isbn: string
  coverUrl?: string
  coverSource?: 'hardcover' | 'google'
}

export interface HouseholdCatalogCreateResult {
  workId: string
  /** The shared record committed, but its optional durable cover did not. */
  coverWarning: string | null
}

export function useCreateHouseholdCatalogWork() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Creating a shared catalog book' },
    mutationFn: async (input: HouseholdCatalogWorkInput): Promise<HouseholdCatalogCreateResult> => {
      const { data, error } = await supabase.rpc('create_household_catalog_work', {
        p_title: input.title,
        p_author: input.author,
        p_isbn: input.isbn || null,
        p_cover_url: input.coverUrl || null,
        p_cover_source: input.coverSource || null,
      })
      if (error) throw error
      const workId = data as string
      let coverWarning: string | null = null
      if (input.coverUrl && input.coverSource === 'hardcover') {
        const ingest = await ingestCorpusCover({
          workId,
          source: 'hardcover',
          url: input.coverUrl,
          sourceUrl: input.coverUrl,
        })
        if (ingest.status === 'error') {
          coverWarning = `The shared record was added, but its cover could not be saved (${ingest.code}).`
        } else {
          const selected = await supabase.rpc('set_corpus_work_cover', {
            p_work: workId,
            p_cover_url: ingest.data.cover,
            p_cover_source: 'hardcover',
            p_cover_source_url: input.coverUrl,
            p_cover_color: ingest.data.color,
          })
          if (selected.error) {
            coverWarning = 'The shared record was added, but its cover could not be selected.'
          }
        }
      }
      return { workId, coverWarning }
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}

export function useRemoveHouseholdWork() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Removing from the household library' },
    mutationFn: async (workId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('remove_household_work', { p_work: workId })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}

export function useRemovePersonalBookFromHousehold() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Removing your household share' },
    mutationFn: async (bookId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('remove_personal_book_from_household', {
        p_book: bookId,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}

export function useUpdateHouseholdWorkEnrichment() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Updating household details' },
    mutationFn: async ({
      workId,
      tags,
      tropes,
    }: {
      workId: string
      tags: string[]
      tropes: unknown[]
    }): Promise<string> => {
      const { data, error } = await supabase.rpc('update_household_work_enrichment', {
        p_work: workId,
        p_tags: tags,
        p_tropes: tropes,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}

export interface CorpusMetadataPatch {
  workId: string
  series: string
  position: number | null
  seriesCount: number | null
  seriesStatus: SeriesStatus
  genre: string
  subgenre: string
  genres: string[]
  subgenres: string[]
  coverUrl: string
  coverOptions: { url?: string; source?: string; sourceUrl?: string }[]
  publicationYear: number | null
  publicationMonth: number | null
  publicationDay: number | null
}

export function useUpdateCorpusWorkMetadata() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Updating shared book details' },
    mutationFn: async (patch: CorpusMetadataPatch): Promise<string> => {
      const { data, error } = await supabase.rpc('edit_corpus_work_metadata', {
        p_work: patch.workId,
        p_series: patch.series,
        p_position: patch.position,
        p_series_count: patch.seriesCount,
        p_status: patch.seriesStatus,
        p_genre: patch.genre,
        p_subgenre: patch.subgenre,
        p_genres: patch.genres,
        p_subgenres: patch.subgenres,
        p_cover_url: patch.coverUrl,
        p_cover_options: patch.coverOptions,
        p_pub_y: patch.publicationYear,
        p_pub_m: patch.publicationMonth,
        p_pub_d: patch.publicationDay,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}

export function useAdminReviewHouseholdCoverForCorpus() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Reviewing a household cover for the corpus' },
    mutationFn: async ({
      householdId,
      bookId,
      workId,
      coverUrl,
    }: {
      householdId: string
      bookId: string
      workId: string
      coverUrl: string
    }): Promise<string> => {
      const { data, error } = await supabase.rpc('admin_review_household_cover_for_corpus', {
        p_household: householdId,
        p_book: bookId,
        p_expected_work: workId,
        p_expected_cover_url: coverUrl,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}

export function useAdoptCorpusWorkMetadata() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Using shared book details' },
    mutationFn: async (bookId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('adopt_corpus_work_metadata', {
        p_book: bookId,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidateLibraryMembership(queryClient),
  })
}
