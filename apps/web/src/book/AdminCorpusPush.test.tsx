import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import type { CorpusRecord } from '../data/corpusEditions'

const state = vi.hoisted(() => ({
  admin: true,
  account: 'reader',
  save: vi.fn(),
  reload: vi.fn(),
  record: null as CorpusRecord | null,
  timestamp: '2026-10-01T12:30:00Z' as string | null,
}))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: state.account } } }),
}))
vi.mock('../data/enrichCorpus', () => ({ useCorpusAdminStatus: () => ({ data: state.admin }) }))
vi.mock('../data/corpusEditions', async (original) => ({
  ...(await original<typeof import('../data/corpusEditions')>()),
  useCorpusRecord: () => ({ data: state.record, refetch: state.reload }),
  useCorpusUpdateTime: () => ({ data: state.timestamp, isPending: false, isError: false }),
  usePushCorpusRecord: () => ({ mutateAsync: state.save, isPending: false }),
}))
const { AdminCorpusPush } = await import('./AdminCorpusPush')
const record: CorpusRecord = {
  id: 'work',
  title: 'Shared title',
  author: 'Writer',
  description: null,
  genre: 'fantasy',
  genres: ['fantasy'],
  subgenre: null,
  subgenres: [],
  spice: 3,
  darkness: null,
  guidanceSource: null,
  isbns: ['9780306406157'],
  fingerprint: 'opened',
  editions: [],
  reports: [],
  history: [],
}
const book = makeBook({
  id: 'book',
  corpusWorkId: 'work',
  title: 'Saved title',
  isbn: '9780306406157',
  pages: 240,
  genre: '',
  genres: [],
  subgenre: '',
  subgenres: [],
  intensity: null,
  darkness: null,
})
beforeEach(() => {
  vi.clearAllMocks()
  state.admin = true
  state.account = 'reader'
  state.record = record
  state.timestamp = '2026-10-01T12:30:00Z'
  state.save.mockResolvedValue('work')
  state.reload.mockResolvedValue({ data: { ...record, fingerprint: 'reloaded' }, isError: false })
})
function open(input = book) {
  const view = render(<AdminCorpusPush book={input} />)
  fireEvent.click(screen.getByRole('button', { name: 'Push to corpus' }))
  return view
}
it('saves multiple selected differences directly without a manual verification gate', async () => {
  open({ ...book, genre: 'horror', genres: ['horror'], intensity: 0 })
  expect(screen.getByText('Your saved value: 240')).toBeVisible()
  expect(screen.queryByRole('textbox', { name: 'Evidence link' })).not.toBeInTheDocument()
  expect(state.save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Spice / sexual content' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save selected changes' }))
  await screen.findByRole('status')
  expect(state.save).toHaveBeenCalledOnce()
  expect(state.save.mock.calls[0]![0]).toMatchObject({
    record,
    reviewMode: 'direct',
    sourceUrl: '',
    note: '',
    changes: [
      { action: 'edition', value: { isbn: book.isbn, details: { pages: 240 } } },
      { action: 'guidance', value: { genres: ['horror'], spice: 3 } },
    ],
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('allows clearing and reselecting changes and keeps evidence optional', async () => {
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
  expect(screen.getByRole('button', { name: 'Save selected changes' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Select all changes' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add supporting evidence (optional)' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save selected changes' }))
  expect(screen.getByRole('alert')).toHaveTextContent('HTTPS evidence link')
  expect(state.save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: 'Evidence link' }), {
    target: { value: 'https://publisher.example/book' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Explanation' }), {
    target: { value: 'Checked this edition.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save selected changes' }))
  await screen.findByRole('status')
  expect(state.save.mock.calls[0]![0]).toMatchObject({
    reviewMode: 'evidence',
    sourceUrl: 'https://publisher.example/book',
    note: 'Checked this edition.',
  })
})
it('preserves the opened fingerprint and selection through a conflict and explicit reload', async () => {
  state.save.mockRejectedValueOnce(new Error('The corpus changed.'))
  const view = open({ ...book, genre: 'horror', genres: ['horror'] })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Genres' }))
  state.record = { ...record, fingerprint: 'background' }
  view.rerender(<AdminCorpusPush book={book} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save selected changes' }))
  await screen.findByRole('alert')
  expect(state.save.mock.calls[0]![0].record.fingerprint).toBe('opened')
  expect(screen.getByRole('button', { name: 'Save selected changes' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Reload corpus for review' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save selected changes' })).toBeEnabled(),
  )
  expect(screen.getByRole('checkbox', { name: 'Genres' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Save selected changes' }))
  await screen.findByRole('status')
  expect(state.save.mock.calls[1]![0].record.fingerprint).toBe('reloaded')
  expect(state.save.mock.calls[1]![0].changes).toHaveLength(1)
})
it('blocks duplicate submissions while a save is unresolved', async () => {
  let resolve!: (value: string) => void
  state.save.mockReturnValueOnce(
    new Promise<string>((r) => {
      resolve = r
    }),
  )
  open()
  const save = screen.getByRole('button', { name: 'Save selected changes' })
  fireEvent.click(save)
  fireEvent.click(save)
  expect(state.save).toHaveBeenCalledOnce()
  expect(screen.getByRole('checkbox', { name: 'Pages' })).toBeDisabled()
  resolve('work')
  await screen.findByRole('status')
})
it('hides the action from non-admins and closes a departed account’s draft', () => {
  state.admin = false
  const c = render(<AdminCorpusPush book={book} />)
  expect(screen.queryByRole('button', { name: 'Push to corpus' })).not.toBeInTheDocument()
  state.admin = true
  c.rerender(<AdminCorpusPush book={book} />)
  fireEvent.click(screen.getByRole('button', { name: 'Push to corpus' }))
  expect(screen.getByRole('dialog')).toBeVisible()
  state.account = 'other-reader'
  c.rerender(<AdminCorpusPush book={book} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  state.account = 'reader'
  c.rerender(<AdminCorpusPush book={book} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(state.save).not.toHaveBeenCalled()
})
it('shows the persisted timestamp and never invents a time for missing status', () => {
  const c = render(<AdminCorpusPush book={book} />)
  expect(c.container.querySelector('time')).toHaveAttribute('datetime', state.timestamp)
  state.timestamp = null
  c.rerender(<AdminCorpusPush book={book} />)
  expect(screen.getByText('Last corpus update is unavailable.')).toBeVisible()
  expect(c.container.querySelector('time')).toBeNull()
})
it('asks which ISBN-less edition to update instead of silently creating another', async () => {
  state.record = {
    ...record,
    editions: [
      {
        id: 'existing-edition',
        work_id: record.id,
        isbn: null,
        details: { publisher: 'Example Press' },
        reviewed: true,
        revision: 1,
        source_url: null,
      },
    ],
  }
  state.save.mockRejectedValueOnce(new Error('Connection interrupted'))
  state.reload.mockResolvedValue({ data: state.record, isError: false })
  open({ ...book, isbn: '' })
  expect(screen.getByText(/Choose an existing ISBN-less edition/)).toBeVisible()
  expect(state.save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('combobox', { name: /Published edition to update/ }), {
    target: { value: 'existing-edition' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save selected changes' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Reload corpus for review' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save selected changes' })).toBeEnabled(),
  )
  expect(screen.getByRole('combobox', { name: /Published edition to update/ })).toHaveValue(
    'existing-edition',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save selected changes' }))
  await screen.findByRole('status')
  expect(
    state.save.mock.calls[0]![0].changes.find(
      (change: { action: string }) => change.action === 'edition',
    ).value,
  ).toMatchObject({
    id: 'existing-edition',
    isbn: null,
    details: { publisher: 'Example Press', pages: 240 },
  })
})

it('keeps uncertain new-edition retry identities separate when the saved inventory selection changes', async () => {
  const first = {
    id: 'first-personal-edition',
    label: '',
    format: 'hardcover' as const,
    isbn: '9780143117841',
    publisher: 'First Press',
    published: '',
    pages: 200,
    cover: '',
  }
  const second = { ...first, id: 'second-personal-edition', isbn: '9780306406157' }
  const input = {
    ...book,
    copyInventory: { version: 1 as const, editions: [first, second], copies: [] },
  }
  state.record = { ...record, editions: [] }
  state.save.mockImplementationOnce(async (saved) => {
    state.reload.mockResolvedValue({
      data: {
        ...record,
        fingerprint: 'first-edition-saved',
        editions: [
          {
            ...saved.changes.find((change: { action: string }) => change.action === 'edition')
              .value,
            work_id: record.id,
            reviewed: true,
            revision: 1,
            source_url: null,
          },
        ],
      },
      isError: false,
    })
    throw new Error('The response was lost.')
  })
  open(input)
  fireEvent.change(screen.getByRole('combobox', { name: 'Your saved edition' }), {
    target: { value: first.id },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save selected changes' }))
  await screen.findByRole('alert')
  const firstAttempt = state.save.mock.calls[0]![0].changes.find(
    (change: { action: string }) => change.action === 'edition',
  ).value
  fireEvent.click(screen.getByRole('button', { name: 'Reload corpus for review' }))
  await screen.findByRole('combobox', { name: 'Your saved edition' })
  fireEvent.change(screen.getByRole('combobox', { name: 'Your saved edition' }), {
    target: { value: second.id },
  })
  expect(screen.getByText(/Create a published edition/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Save selected changes' }))
  await screen.findByRole('status')
  const secondAttempt = state.save.mock.calls[1]![0].changes.find(
    (change: { action: string }) => change.action === 'edition',
  ).value
  expect(secondAttempt.isbn).toBe(second.isbn)
  expect(secondAttempt.id).not.toBe(firstAttempt.id)
})
