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
  useSaveCorpusRecord: () => ({ mutateAsync: state.save, isPending: false }),
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
  fireEvent.change(screen.getByRole('textbox', { name: 'Evidence link' }), {
    target: { value: 'https://publisher.example/book' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Explanation' }), {
    target: { value: 'Checked the published edition.' },
  })
  return view
}
it('requires review and explicit confirmation before sending the selected details', async () => {
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Review corpus update' }))
  expect(screen.getByText('Proposed: 240')).toBeVisible()
  expect(state.save).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Confirm push to corpus' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm push to corpus' }))
  await screen.findByRole('status')
  expect(state.save).toHaveBeenCalledOnce()
  expect(state.save.mock.calls[0]![0]).toMatchObject({
    record,
    change: { action: 'edition', value: { isbn: book.isbn, details: { pages: 240 } } },
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('preserves the reviewed fingerprint after background updates and requires explicit reload after failure', async () => {
  state.save.mockRejectedValueOnce(new Error('The corpus changed.'))
  const view = open()
  fireEvent.click(screen.getByRole('button', { name: 'Review corpus update' }))
  state.record = { ...record, fingerprint: 'background' }
  view.rerender(<AdminCorpusPush book={book} />)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm push to corpus' }))
  await screen.findByRole('alert')
  expect(state.save.mock.calls[0]![0].record.fingerprint).toBe('opened')
  expect(screen.getByRole('button', { name: 'Confirm push to corpus' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Reload corpus for review' }))
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Explanation' })).toHaveValue(
      'Checked the published edition.',
    ),
  )
  expect(state.save).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Review corpus update' }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm push to corpus' }))
  await screen.findByRole('status')
  expect(state.save.mock.calls[1]![0].record.fingerprint).toBe('reloaded')
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
  open({ ...book, isbn: '' })
  fireEvent.click(screen.getByRole('button', { name: 'Review corpus update' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose an existing ISBN-less edition')
  expect(state.save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('combobox', { name: /Published edition to update/ }), {
    target: { value: 'existing-edition' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Review corpus update' }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm push to corpus' }))
  await screen.findByRole('status')
  expect(state.save.mock.calls[0]![0].change.value).toMatchObject({
    id: 'existing-edition',
    isbn: null,
    details: { publisher: 'Example Press', pages: 240 },
  })
})
