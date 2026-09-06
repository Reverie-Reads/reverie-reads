import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGuestHandoff } from '../auth/landing/guest/handoff'
import { initialGuestState } from '../auth/landing/guest/state'
import { importGuestHandoff } from './guestHandoff'

const mocked = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  loadVerdicts: vi.fn(),
  applyIncoming: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: mocked.getUser },
    from: mocked.from,
  },
}))
vi.mock('./duplicates', () => ({ loadVerdicts: mocked.loadVerdicts }))
vi.mock('./intake', () => ({ applyIncoming: mocked.applyIncoming }))

beforeEach(() => {
  vi.clearAllMocks()
  mocked.getUser.mockResolvedValue({ data: { user: { id: 'reader-1' } } })
  mocked.loadVerdicts.mockResolvedValue(new Map())
  mocked.eq.mockResolvedValue({ error: null })
  mocked.update.mockReturnValue({ eq: mocked.eq })
  mocked.from.mockReturnValue({ update: mocked.update })
})

describe('guest account import', () => {
  it('uses ordinary intake for every book, reports outcomes, and carries over the room', async () => {
    const handoff = createGuestHandoff(
      initialGuestState(),
      { skin: 'aphelion', mode: 'dark' },
      100,
    )
    mocked.applyIncoming
      .mockResolvedValueOnce({ outcome: 'added', bookId: 'book-1' })
      .mockResolvedValueOnce({ outcome: 'merged', bookId: 'book-2' })

    const result = await importGuestHandoff(handoff, [], { autoMerge: true })

    expect(mocked.applyIncoming).toHaveBeenCalledTimes(2)
    expect(mocked.applyIncoming).toHaveBeenNthCalledWith(
      1,
      handoff.books[0]!.incoming,
      expect.any(Array),
      'reader-1',
      expect.objectContaining({ fuzzy: 'review', autoMergeStrong: true }),
    )
    expect(result).toMatchObject({
      added: 1,
      merged: 1,
      unchanged: 0,
      review: [],
      bookIds: ['book-1', 'book-2'],
    })
    expect(mocked.from).toHaveBeenCalledWith('profiles')
    expect(mocked.update).toHaveBeenCalledWith({ skin: 'aphelion', mode: 'dark' })
    expect(mocked.eq).toHaveBeenCalledWith('id', 'reader-1')
  })

  it('requires a signed-in reader before intake or profile writes', async () => {
    mocked.getUser.mockResolvedValue({ data: { user: null } })
    const handoff = createGuestHandoff(initialGuestState(), { skin: 'folio', mode: 'light' })

    await expect(importGuestHandoff(handoff, [], { autoMerge: true })).rejects.toThrow(
      /sign in before adding/i,
    )
    expect(mocked.applyIncoming).not.toHaveBeenCalled()
    expect(mocked.from).not.toHaveBeenCalled()
  })

  it('does not mark the room imported when a book write fails', async () => {
    mocked.applyIncoming.mockRejectedValueOnce(new Error('network interrupted'))
    const handoff = createGuestHandoff(initialGuestState(), { skin: 'folio', mode: 'light' })

    await expect(importGuestHandoff(handoff, [], { autoMerge: false })).rejects.toThrow(
      'network interrupted',
    )
    expect(mocked.from).not.toHaveBeenCalled()
  })
})
