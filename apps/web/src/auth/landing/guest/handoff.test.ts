import { beforeEach, describe, expect, it } from 'vitest'
import { initialGuestState } from './state'
import {
  GUEST_HANDOFF_STORAGE_ID,
  GUEST_HANDOFF_TTL_MS,
  clearGuestHandoff,
  createGuestHandoff,
  loadGuestHandoff,
  saveGuestHandoff,
  summarizeGuestHandoff,
} from './handoff'

beforeEach(() => clearGuestHandoff())

describe('guest library handoff', () => {
  it('does not persist until the visitor explicitly saves it', () => {
    const handoff = createGuestHandoff(initialGuestState(), { skin: 'folio', mode: 'light' }, 100)
    expect(localStorage.getItem(GUEST_HANDOFF_STORAGE_ID)).toBeNull()
    expect(saveGuestHandoff(handoff)).toBe(true)
    expect(loadGuestHandoff(101)).toEqual(handoff)
  })

  it('keeps reading records and unfinished drafts distinct', () => {
    const state = initialGuestState()
    state.pendingNotes['guest-jane'] = 'A line to keep while reading.'
    state.books[1]!.reads = [
      { date: '2026-09-01', format: 'Audiobook', rating: 4.5, notes: 'A finished note.' },
    ]
    const handoff = createGuestHandoff(state, { skin: 'aphelion', mode: 'dark' }, 100)
    expect(summarizeGuestHandoff(handoff)).toEqual({
      books: 2,
      activeReads: 1,
      completedReads: 1,
      readingNotes: 1,
      draftNotes: 1,
    })
    expect(handoff.books[0]!.draftNote).toBe('A line to keep while reading.')
    expect(handoff.books[0]!.incoming.reads).toEqual([])
    expect(handoff.books[1]!.incoming.reads?.[0]?.notes).toBe('A finished note.')
  })

  it('strips guest identity and untrusted remote covers from account intake', () => {
    const state = initialGuestState()
    state.books[0]!.cover = 'https://private.example/my-cover.jpg'
    state.books[0]!.corpusWorkId = 'guest-must-not-bind-corpus'
    const handoff = createGuestHandoff(state, { skin: 'folio', mode: 'light' })
    expect(handoff.books[0]!.incoming.id).toBeUndefined()
    expect(handoff.books[0]!.incoming.corpusWorkId).toBeUndefined()
    expect(handoff.books[0]!.incoming.cover).toBe('')
  })

  it('keeps the public Google Books cover used by the sample library', () => {
    const state = initialGuestState()
    const handoff = createGuestHandoff(state, { skin: 'folio', mode: 'light' })
    expect(handoff.books[0]!.incoming.cover).toContain('books.google.com/books/content')
  })

  it('expires and removes stale or malformed browser data', () => {
    const handoff = createGuestHandoff(initialGuestState(), { skin: 'folio', mode: 'light' }, 100)
    saveGuestHandoff(handoff)
    expect(loadGuestHandoff(100 + GUEST_HANDOFF_TTL_MS + 1)).toBeNull()
    expect(localStorage.getItem(GUEST_HANDOFF_STORAGE_ID)).toBeNull()

    localStorage.setItem(GUEST_HANDOFF_STORAGE_ID, '{bad json')
    expect(loadGuestHandoff()).toBeNull()
    expect(localStorage.getItem(GUEST_HANDOFF_STORAGE_ID)).toBeNull()
  })
})
