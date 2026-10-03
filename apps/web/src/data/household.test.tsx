import { act, renderHook, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  readerId: 'reader-a',
  rpc: vi.fn(),
  ingestCorpusCover: vi.fn(),
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    session: mocked.readerId ? { user: { id: mocked.readerId } } : null,
  }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: mocked.rpc },
}))

vi.mock('../lib/covers', () => ({
  ingestCorpusCover: mocked.ingestCorpusCover,
}))

import {
  householdBooksKey,
  labelHouseholdData,
  householdRosterKey,
  useHouseholdBookSelection,
  useHouseholdBooks,
  useHouseholdLibraryAuthorization,
  useHouseholdRoster,
  useAddCorpusWorkToHousehold,
  useAddCorpusWorkToMemberLibrary,
  useAddPersonalBooksToHousehold,
  useAddPersonalBookToHousehold,
  useAdminReviewHouseholdCoverForCorpus,
  useCreateHouseholdCatalogWork,
  useAdoptCorpusWorkMetadata,
  useRemoveHouseholdWork,
  useRemovePersonalBookFromHousehold,
  useSetHouseholdMemberLibraryAdds,
  useUpdateCorpusWorkMetadata,
  type HouseholdBook,
} from './household'

const queryHarness = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

const householdBook = (id: string, ownerId = 'reader-a'): HouseholdBook => ({
  id,
  title: 'Title',
  author: '',
  cover: '',
  coverColor: '',
  corpusCover: '',
  corpusCoverColor: '',
  coverOptions: [],
  coverOptionsAvailable: true,
  series: '',
  position: null,
  seriesCount: null,
  seriesStatus: 'standalone',
  primaryGenre: '',
  genres: [],
  subgenre: '',
  subgenres: [],
  isbns: [],
  owners: [{
    bookId: `copy-${id}`,
    userId: ownerId,
    displayName: 'Avery',
    ownership: 'owned',
    borrowed: false,
    ownedPhysical: '',
    ownedEbook: false,
    ownedAudiobook: false,
    bookFormat: '',
    cover: '',
    coverThumb: '',
    coverColor: '',
    shared: false,
  }],
  householdTags: [],
  householdTropes: [],
  publicationYear: null,
  publicationMonth: null,
  publicationDay: null,
  addedAt: '2026-08-25T00:00:00Z',
})

beforeEach(() => {
  mocked.readerId = 'reader-a'
  mocked.rpc.mockReset()
  mocked.ingestCorpusCover.mockReset()
})

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('household query identity and RPC boundary', () => {
  it('keys roster responses to the reader and book responses to the authorized household', () => {
    expect(householdRosterKey('reader-a')).toEqual(['household', 'roster', 'reader-a'])
    expect(householdBooksKey('reader-b', 'house-2')).toEqual([
      'household',
      'books',
      'reader-b',
      'house-2',
    ])
  })

  it('reads the roster only through household_roster', async () => {
    mocked.rpc.mockResolvedValue({
      data: [
        {
          household_id: 'house-1',
          household_name: 'The Readers',
          user_id: 'reader-a',
          display_name: 'Avery',
          member_role: 'owner',
          allow_member_library_adds: true,
        },
        {
          household_id: 'house-1',
          household_name: 'The Readers',
          user_id: 'reader-b',
          display_name: 'Avery',
          member_role: 'member',
          allow_member_library_adds: false,
        },
        {
          household_id: 'house-1',
          household_name: 'The Readers',
          user_id: 'reader-c',
          display_name: null,
          member_role: 'member',
          allow_member_library_adds: false,
        },
      ],
      error: null,
    })

    const { wrapper } = queryHarness()
    const { result } = renderHook(() => useHouseholdRoster(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocked.rpc).toHaveBeenCalledWith('household_roster')
    expect(result.current.data).toEqual([
      {
        householdId: 'house-1',
        householdName: 'The Readers',
        userId: 'reader-a',
        displayName: 'Avery',
        role: 'owner',
        allowMemberLibraryAdds: true,
      },
      {
        householdId: 'house-1',
        householdName: 'The Readers',
        userId: 'reader-b',
        displayName: 'Avery',
        role: 'member',
        allowMemberLibraryAdds: false,
      },
      {
        householdId: 'house-1',
        householdName: 'The Readers',
        userId: 'reader-c',
        displayName: 'Reader',
        role: 'member',
        allowMemberLibraryAdds: false,
      },
    ])
  })

  it('keeps only the curated household_library_works fields in client state', async () => {
    mocked.rpc.mockResolvedValue({
      data: [
        {
          work_id: 'work-1',
          title: 'Duplicate Title',
          author: 'Quill Marrowbane',
          cover_url: null,
          cover_color: null,
          cover_options: [],
          series_name: null,
          series_position: '2.5',
          series_count: null,
          series_status: 'ongoing',
          primary_genre: 'literary',
          genres: [],
          subgenre: null,
          subgenres: [],
          isbns: ['9780000000001'],
          owners: [{
            bookId: 'book-1',
            userId: 'reader-b',
            displayName: 'Blake',
            ownership: 'owned',
            borrowed: true,
            ownedPhysical: 'hardcover',
            ownedEbook: false,
            ownedAudiobook: true,
            format: 'hardcover',
            coverUrl: 'https://covers.example.test/blake-personal.jpg',
            coverThumbUrl: 'https://covers.example.test/blake-personal-thumb.jpg',
            coverColor: '#123456',
            coverSource: 'upload',
            coverSourceUrl: null,
            shared: true,
          }],
          household_tags: ['found family'],
          household_tropes: [
            { id: 'trope-1', name: ' Only One Bed ', emphasis: 'pinned' },
            { name: 'Found Family', emphasis: 'unexpected-value', scope: 'corpus' },
            { name: '   ' },
            'not-an-object',
          ],
          pub_y: 2026,
          pub_m: null,
          pub_d: null,
          added_at: '2026-08-24T00:00:00Z',
          // Deliberately hostile extras: an RPC expansion must not become client state by accident.
          rating: 5,
          fave: true,
          read_status: 'Read',
          notes: 'private',
        },
      ],
      error: null,
    })

    const { wrapper } = queryHarness()
    const { result } = renderHook(() => useHouseholdBooks('house-1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocked.rpc).toHaveBeenCalledWith('household_library_works')
    expect(result.current.data?.[0]).toMatchObject({
      id: 'work-1',
      position: 2.5,
      householdTags: ['found family'],
      householdTropes: [
        { id: 'trope-1', name: 'Only One Bed', emphasis: 'pinned' },
        { name: 'Found Family', emphasis: 'present', scope: 'corpus' },
      ],
      owners: [{
        userId: 'reader-b',
        displayName: 'Blake',
        ownership: 'owned',
        borrowed: true,
        ownedPhysical: 'hardcover',
        cover: 'https://covers.example.test/blake-personal.jpg',
        coverThumb: 'https://covers.example.test/blake-personal-thumb.jpg',
      }],
    })
    expect(result.current.data?.[0]).not.toHaveProperty('rating')
    expect(result.current.data?.[0]).not.toHaveProperty('fave')
    expect(result.current.data?.[0]).not.toHaveProperty('readStatus')
    expect(result.current.data?.[0]).not.toHaveProperty('notes')
  })

  it('derives one collision-safe owner map from the complete roster, including empty libraries', () => {
    const firstId = 'aaaaaaaa-1111-4111-8111-111111111111'
    const secondId = 'aaaaaaaa-2222-4222-8222-222222222222'
    const members = [
      {
        householdId: 'house-1',
        householdName: 'Readers',
        userId: firstId,
        displayName: 'Avery',
        role: 'owner' as const,
        allowMemberLibraryAdds: false,
      },
      {
        householdId: 'house-1',
        householdName: 'Readers',
        userId: secondId,
        displayName: 'avery',
        role: 'member' as const,
        allowMemberLibraryAdds: false,
      },
    ]
    const baseBook = {
      id: 'book-1',
      title: 'Title',
      author: '',
      cover: '',
      coverColor: '',
      corpusCover: '',
      corpusCoverColor: '',
      coverOptions: [],
      coverOptionsAvailable: true,
      series: '',
      position: null,
      seriesCount: null,
      seriesStatus: 'standalone' as const,
      primaryGenre: '',
      genres: [],
      subgenre: '',
      subgenres: [],
      isbns: [],
      owners: [
        {
          bookId: 'copy-1',
          userId: firstId,
          displayName: 'Untrusted independent label',
          ownership: 'owned',
          borrowed: false,
          ownedPhysical: '',
          ownedEbook: false,
          ownedAudiobook: false,
          bookFormat: '',
          cover: 'https://covers.example.test/avery.jpg',
          coverThumb: '',
          coverColor: '#abcdef',
          shared: false,
        },
        {
          bookId: 'copy-outside',
          userId: 'outside-reader',
          displayName: 'Outside',
          ownership: 'owned',
          borrowed: false,
          ownedPhysical: '',
          ownedEbook: false,
          ownedAudiobook: false,
          bookFormat: '',
          cover: 'https://covers.example.test/outside.jpg',
          coverThumb: '',
          coverColor: '#000000',
          shared: false,
        },
      ],
      householdTags: [],
      householdTropes: [],
      publicationYear: null,
      publicationMonth: null,
      publicationDay: null,
      addedAt: '2026-08-25T00:00:00Z',
    }

    const labelled = labelHouseholdData(members, [baseBook], firstId)

    expect(labelled.members.map((member) => member.displayName)).toEqual([
      'Avery · aaaaaaaa-1',
      'avery · aaaaaaaa-2',
    ])
    expect(labelled.books).toHaveLength(1)
    expect(labelled.books[0]?.owners).toEqual([
      expect.objectContaining({ userId: firstId, displayName: labelled.members[0]?.displayName }),
    ])
    expect(labelled.books[0]).toMatchObject({
      cover: 'https://covers.example.test/avery.jpg',
      coverColor: '#abcdef',
    })
  })

  it('uses the current reader copy as a household fallback but never over a corpus cover', () => {
    const members = [
      {
        householdId: 'house-1',
        householdName: 'Readers',
        userId: 'reader-a',
        displayName: 'Avery',
        role: 'owner' as const,
        allowMemberLibraryAdds: false,
      },
      {
        householdId: 'house-1',
        householdName: 'Readers',
        userId: 'reader-b',
        displayName: 'Blake',
        role: 'member' as const,
        allowMemberLibraryAdds: false,
      },
    ]
    const a = householdBook('work-1', 'reader-a').owners[0]!
    const b = householdBook('work-1', 'reader-b').owners[0]!
    const personalOnly = {
      ...householdBook('work-1'),
      owners: [
        { ...a, cover: 'https://covers.example.test/a.jpg', coverColor: '#aaaaaa' },
        { ...b, cover: 'https://covers.example.test/b.jpg', coverColor: '#bbbbbb' },
      ],
    }

    expect(labelHouseholdData(members, [personalOnly], 'reader-b').books[0]).toMatchObject({
      cover: 'https://covers.example.test/b.jpg',
      coverColor: '#bbbbbb',
    })

    const corpusCover = {
      ...personalOnly,
      corpusCover: 'https://covers.example.test/corpus.jpg',
      corpusCoverColor: '#cccccc',
    }
    expect(labelHouseholdData(members, [corpusCover], 'reader-b').books[0]).toMatchObject({
      cover: 'https://covers.example.test/corpus.jpg',
      coverColor: '#cccccc',
    })
  })

  it('removes authorization-sensitive roster data on unmount and fetches again on remount', async () => {
    mocked.rpc.mockResolvedValue({ data: [], error: null })
    const { client, wrapper } = queryHarness()
    const first = renderHook(() => useHouseholdRoster(), { wrapper })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    expect(client.getQueryData(householdRosterKey('reader-a'))).toEqual([])

    first.unmount()
    expect(client.getQueryData(householdRosterKey('reader-a'))).toBeUndefined()

    const second = renderHook(() => useHouseholdRoster(), { wrapper })
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
    expect(mocked.rpc).toHaveBeenCalledTimes(2)
    second.unmount()
  })

  it('does not authorize cached household data while offline revalidation is paused', async () => {
    const cachedMember = {
      householdId: 'house-a',
      householdName: 'Cached household',
      userId: 'reader-a',
      displayName: 'Avery',
      role: 'owner' as const,
      allowMemberLibraryAdds: false,
    }
    const cachedBook = householdBook('cached-book')
    const { client, wrapper } = queryHarness()
    client.setQueryData(householdRosterKey('reader-a'), [cachedMember])
    client.setQueryData(householdBooksKey('reader-a', 'house-a'), [cachedBook])
    onlineManager.setOnline(false)

    const { result, unmount } = renderHook(() => useHouseholdLibraryAuthorization(), { wrapper })

    await waitFor(() => expect(result.current.paused).toBe(true))
    expect(result.current.paused).toBe(true)
    expect(result.current.authorized).toBe(false)
    expect(result.current.householdId).toBeNull()
    expect(result.current.members).toEqual([])
    expect(result.current.books).toEqual([])
    expect(client.getQueryData(householdRosterKey('reader-a'))).toEqual([cachedMember])
    expect(client.getQueryData(householdBooksKey('reader-a', 'house-a'))).toEqual([cachedBook])
    expect(mocked.rpc).not.toHaveBeenCalled()

    unmount()
  })

  it.each([['roster', 'same'], ['books', 'same'], ['roster', 'replacement'], ['books', 'replacement']])('recovers a failed %s load with %s membership through fresh validation', async (failure, membership) => {
    let failing = true
    let householdId = 'house-before-retry'
    mocked.rpc.mockImplementation(async (name: string) => {
      if (failing && name === (failure === 'roster' ? 'household_roster' : 'household_library_works'))
        return { data: null, error: new Error('temporarily unavailable') }
      if (name === 'household_roster') return {
        data: [{ household_id: householdId, household_name: 'Readers', user_id: 'reader-a', display_name: 'Avery', member_role: 'owner', allow_member_library_adds: false }], error: null,
      }
      return { data: [], error: null }
    })
    const { wrapper } = queryHarness()
    const { result } = renderHook(() => useHouseholdLibraryAuthorization(), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.members).toEqual([])
    expect(result.current.books).toEqual([])
    failing = false
    householdId = membership === 'same' ? householdId : 'house-after-retry'
    await act(async () => { await result.current.retry() })
    await waitFor(() => expect(result.current.authorized).toBe(true))
    expect(result.current.error).toBeNull()
    expect(result.current.householdId).toBe(householdId)
    expect(result.current.members[0]?.householdId).toBe(householdId)
  })

  it('forgets a selection across authorization loss or household replacement', () => {
    const firstBook = householdBook('book-1')
    const { result, rerender } = renderHook(
      ({ householdId, books, authorized }) =>
        useHouseholdBookSelection({ householdId, books, authorized }),
      {
        initialProps: {
          householdId: 'house-a' as string | null,
          books: [firstBook] as HouseholdBook[],
          authorized: true,
        },
      },
    )

    act(() => result.current.open(firstBook.id))
    expect(result.current.selected?.id).toBe(firstBook.id)

    rerender({ householdId: null, books: [], authorized: false })
    expect(result.current.selected).toBeNull()
    rerender({ householdId: 'house-a', books: [firstBook], authorized: true })
    expect(result.current.selected).toBeNull()

    act(() => result.current.open(firstBook.id))
    rerender({ householdId: 'house-b', books: [firstBook], authorized: true })
    expect(result.current.selected).toBeNull()
    rerender({ householdId: 'house-a', books: [firstBook], authorized: true })
    expect(result.current.selected).toBeNull()
  })

  it('preserves an explicit selection behind a routine authorization revalidation', () => {
    const firstBook = householdBook('book-1')
    const { result, rerender } = renderHook(
      ({ householdId, books, authorized, loading }) =>
        useHouseholdBookSelection({ householdId, books, authorized, loading }),
      {
        initialProps: {
          householdId: 'house-a' as string | null,
          books: [firstBook] as HouseholdBook[],
          authorized: true,
          loading: false,
        },
      },
    )

    act(() => result.current.open(firstBook.id))
    rerender({ householdId: null, books: [], authorized: false, loading: true })
    expect(result.current.selected).toBeNull()
    rerender({ householdId: 'house-a', books: [firstBook], authorized: true, loading: false })
    expect(result.current.selected?.id).toBe(firstBook.id)
  })

  it('fails closed without both a readable signed-in reader and roster-established household', async () => {
    const { wrapper } = queryHarness()
    const noHousehold = renderHook(() => useHouseholdBooks(null), { wrapper })
    await waitFor(() => expect(noHousehold.result.current.fetchStatus).toBe('idle'))
    expect(mocked.rpc).not.toHaveBeenCalled()
    noHousehold.unmount()

    mocked.readerId = ''
    const noReader = renderHook(() => useHouseholdBooks('house-1'), { wrapper })
    const { result } = noReader
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(mocked.rpc).not.toHaveBeenCalled()
    noReader.unmount()
  })

  it('uses separate RPCs for personal, household-only, catalog, adoption, and removal actions', async () => {
    mocked.rpc.mockResolvedValue({ data: 'work-1', error: null })
    const { wrapper } = queryHarness()
    const add = renderHook(() => useAddPersonalBookToHousehold(), { wrapper })
    const addWork = renderHook(() => useAddCorpusWorkToHousehold(), { wrapper })
    const addBooks = renderHook(() => useAddPersonalBooksToHousehold(), { wrapper })
    const addToMember = renderHook(() => useAddCorpusWorkToMemberLibrary(), { wrapper })
    const setMemberAdds = renderHook(() => useSetHouseholdMemberLibraryAdds(), { wrapper })
    const createWork = renderHook(() => useCreateHouseholdCatalogWork(), { wrapper })
    const editWork = renderHook(() => useUpdateCorpusWorkMetadata(), { wrapper })
    const adoptWork = renderHook(() => useAdoptCorpusWorkMetadata(), { wrapper })
    const unshare = renderHook(() => useRemovePersonalBookFromHousehold(), { wrapper })
    const removeWork = renderHook(() => useRemoveHouseholdWork(), { wrapper })

    await act(() => add.result.current.mutateAsync('book-1'))
    await act(() => addWork.result.current.mutateAsync('work-1'))
    await act(() => addBooks.result.current.mutateAsync(['book-1', 'book-2']))
    await act(() =>
      addToMember.result.current.mutateAsync({ workId: 'work-1', memberId: 'reader-b' }),
    )
    await act(() => setMemberAdds.result.current.mutateAsync(true))
    await act(() =>
      createWork.result.current.mutateAsync({
        title: 'Household only',
        author: 'A Writer',
        isbn: '',
      }),
    )
    await act(() => adoptWork.result.current.mutateAsync('book-1'))
    await act(() =>
      editWork.result.current.mutateAsync({
        workId: 'work-1',
        series: 'Shared Series',
        position: 2,
        seriesCount: 4,
        seriesStatus: 'ongoing',
        genre: 'fantasy',
        subgenre: 'epic fantasy',
        genres: ['fantasy'],
        subgenres: ['epic fantasy'],
        coverUrl: '',
        coverOptions: [],
        publicationYear: 2026,
        publicationMonth: null,
        publicationDay: null,
      }),
    )
    await act(() => unshare.result.current.mutateAsync('book-1'))
    await act(() => removeWork.result.current.mutateAsync('work-1'))

    expect(mocked.rpc.mock.calls).toEqual([
      ['add_personal_book_to_household', { p_book: 'book-1' }],
      ['add_corpus_work_to_household', { p_work: 'work-1' }],
      ['add_personal_books_to_household', { p_books: ['book-1', 'book-2'] }],
      [
        'add_corpus_work_to_member_library',
        { p_work: 'work-1', p_member: 'reader-b' },
      ],
      ['set_household_member_library_adds', { p_allow: true }],
      [
        'create_household_catalog_work',
        {
          p_title: 'Household only',
          p_author: 'A Writer',
          p_isbn: null,
          p_cover_url: null,
          p_cover_source: null,
        },
      ],
      ['adopt_corpus_work_metadata', { p_book: 'book-1' }],
      [
        'edit_corpus_work_metadata',
        {
          p_work: 'work-1',
          p_series: 'Shared Series',
          p_position: 2,
          p_series_count: 4,
          p_status: 'ongoing',
          p_genre: 'fantasy',
          p_subgenre: 'epic fantasy',
          p_genres: ['fantasy'],
          p_subgenres: ['epic fantasy'],
          p_cover_url: '',
          p_cover_options: [],
          p_pub_y: 2026,
          p_pub_m: null,
          p_pub_d: null,
        },
      ],
      ['remove_personal_book_from_household', { p_book: 'book-1' }],
      ['remove_household_work', { p_work: 'work-1' }],
    ])
  })

  it('binds household cover review to the displayed household, copy, work, and cover', async () => {
    mocked.rpc.mockResolvedValue({ data: 'work-1', error: null })
    const { client, wrapper } = queryHarness()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const review = renderHook(() => useAdminReviewHouseholdCoverForCorpus(), { wrapper })

    await act(() =>
      review.result.current.mutateAsync({
        householdId: 'house-1',
        bookId: 'book-2',
        workId: 'work-1',
        coverUrl: 'https://books.google.com/books/content?id=reviewed&printsec=frontcover&img=1&zoom=2&source=gbs_api',
      }),
    )

    expect(mocked.rpc).toHaveBeenCalledWith('admin_review_household_cover_for_corpus', {
      p_household: 'house-1',
      p_book: 'book-2',
      p_expected_work: 'work-1',
      p_expected_cover_url:
        'https://books.google.com/books/content?id=reviewed&printsec=frontcover&img=1&zoom=2&source=gbs_api',
    })
    expect(invalidate).toHaveBeenCalled()
  })

  it('ingests and selects a picked Hardcover cover for an authorized shared work', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: 'work-cover', error: null })
    mocked.ingestCorpusCover.mockResolvedValue({
      status: 'ok',
      data: {
        cover: 'http://127.0.0.1:55321/storage/v1/object/public/covers/w/work-cover/rev.webp',
        thumb: 'http://127.0.0.1:55321/storage/v1/object/public/covers/w/work-cover/rev_t.webp',
        color: '#123456',
        sourceUrl: 'https://assets.hardcover.app/cover.jpg',
      },
    })
    mocked.rpc.mockResolvedValueOnce({ data: 'work-cover', error: null })
    const { wrapper } = queryHarness()
    const createWork = renderHook(() => useCreateHouseholdCatalogWork(), { wrapper })

    await act(() =>
      createWork.result.current.mutateAsync({
        title: 'Covered household book',
        author: 'A Writer',
        isbn: '',
        coverUrl: 'https://assets.hardcover.app/cover.jpg',
        coverSource: 'hardcover',
      }),
    )

    expect(mocked.ingestCorpusCover).toHaveBeenCalledWith({
      workId: 'work-cover',
      source: 'hardcover',
      url: 'https://assets.hardcover.app/cover.jpg',
      sourceUrl: 'https://assets.hardcover.app/cover.jpg',
    })
    expect(mocked.rpc.mock.calls).toEqual([
      [
        'create_household_catalog_work',
        {
          p_title: 'Covered household book',
          p_author: 'A Writer',
          p_isbn: null,
          p_cover_url: 'https://assets.hardcover.app/cover.jpg',
          p_cover_source: 'hardcover',
        },
      ],
      [
        'set_corpus_work_cover',
        {
          p_work: 'work-cover',
          p_cover_url:
            'http://127.0.0.1:55321/storage/v1/object/public/covers/w/work-cover/rev.webp',
          p_cover_source: 'hardcover',
          p_cover_source_url: 'https://assets.hardcover.app/cover.jpg',
          p_cover_color: '#123456',
        },
      ],
    ])
  })

  it('returns a partial-success warning and still invalidates after cover ingest fails', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: 'work-without-cover', error: null })
    mocked.ingestCorpusCover.mockResolvedValue({ status: 'error', code: 'provider_unavailable' })
    const { client, wrapper } = queryHarness()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const createWork = renderHook(() => useCreateHouseholdCatalogWork(), { wrapper })

    const result = await act(() =>
      createWork.result.current.mutateAsync({
        title: 'Saved before cover failure',
        author: 'A Writer',
        isbn: '',
        coverUrl: 'https://assets.hardcover.app/unavailable.jpg',
        coverSource: 'hardcover',
      }),
    )

    expect(result).toEqual({
      workId: 'work-without-cover',
      coverWarning:
        'The shared record was added, but its cover could not be saved (provider_unavailable).',
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['household'] })
    expect(mocked.rpc).toHaveBeenCalledTimes(1)
  })
})
