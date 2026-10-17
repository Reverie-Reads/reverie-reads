import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CorpusRecord } from '../../data/corpusEditions'

const state = vi.hoisted(() => ({ save: vi.fn(), record: null as CorpusRecord | null }))
vi.mock('../../data/corpusEditions', async (original) => ({
  ...(await original<typeof import('../../data/corpusEditions')>()),
  useCorpusRecord: () => ({ data: state.record, isPending: false, isError: false }),
  useSaveCorpusRecord: () => ({ mutateAsync: state.save, isPending: false }),
}))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'admin' } } }),
}))
const { CorpusRegistryEditor } = await import('./CorpusRegistryEditor')
const record: CorpusRecord = {
  id: 'work',
  title: 'Example',
  author: 'Writer',
  description: null,
  genre: 'fiction',
  genres: ['fiction'],
  subgenre: null,
  subgenres: [],
  spice: null,
  darkness: null,
  guidanceSource: null,
  isbns: ['9780306406157'],
  fingerprint: 'opened',
  reports: [],
  history: [],
  editions: [
    {
      id: 'edition',
      work_id: 'work',
      isbn: '9780306406157',
      details: { pages: 100, publication: { y: 2024, m: null, d: null } },
      reviewed: false,
      revision: 1,
      source_url: null,
    },
  ],
}
beforeEach(() => {
  vi.clearAllMocks()
  state.record = record
  state.save.mockResolvedValue('work')
})
function open() {
  const saved = vi.fn(),
    dirty = vi.fn()
  const view = render(
    <CorpusRegistryEditor workId="work" blocked={false} onDirtyChange={dirty} onSaved={saved} />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Edit shared genres, guidance & editions' }))
  return { saved, dirty, view }
}
function evidence() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Evidence link' }), {
    target: { value: 'https://publisher.example/book' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Explanation' }), {
    target: { value: 'Checked the edition copyright page.' },
  })
}
it('requires explicit review and confirmation, then saves exact edition facts and date precision', async () => {
  const c = open()
  fireEvent.click(screen.getByRole('button', { name: 'Edit edition 9780306406157' }))
  expect(c.dirty).toHaveBeenCalledWith(true)
  fireEvent.change(screen.getByRole('textbox', { name: 'Pages' }), { target: { value: '240' } })
  evidence()
  fireEvent.click(screen.getByRole('button', { name: 'Review change' }))
  expect(state.save).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Save shared change' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Save shared change' }))
  await waitFor(() => expect(c.saved).toHaveBeenCalledOnce())
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({
      record,
      change: {
        action: 'edition',
        value: {
          id: 'edition',
          isbn: '9780306406157',
          details: expect.objectContaining({
            pages: 240,
            publication: { y: 2024, m: null, d: null },
          }),
        },
      },
    }),
  )
})
it('preserves a stale draft and refuses a second submission after an uncertain failure', async () => {
  state.save.mockRejectedValue(
    new Error('This catalog record changed. Reload before reviewing the change again.'),
  )
  const c = open()
  fireEvent.click(screen.getByRole('button', { name: 'Edit shared guidance' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Spice / sexual content' }), {
    target: { value: '0' },
  })
  evidence()
  state.record = { ...record, fingerprint: 'newer' }
  c.view.rerender(
    <CorpusRegistryEditor
      workId="work"
      blocked={false}
      onDirtyChange={c.dirty}
      onSaved={c.saved}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Review change' }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Save shared change' }))
  await screen.findByText(/This catalog record changed/)
  expect(screen.getByRole('button', { name: 'Save shared change' })).toBeDisabled()
  expect(state.save).toHaveBeenCalledOnce()
  expect(state.save.mock.calls[0]![0].record.fingerprint).toBe('opened')
  expect(state.save.mock.calls[0]![0].change.value).toEqual({
    genres: ['fiction'],
    subgenres: [],
    spice: 0,
    darkness: null,
  })
  expect(c.saved).not.toHaveBeenCalled()
})
it('cannot preview an invalid ISBN, date or page count', () => {
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Edit edition 9780306406157' }))
  evidence()
  fireEvent.change(screen.getByRole('textbox', { name: 'ISBN' }), {
    target: { value: '9780306406158' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Review change' }))
  expect(screen.getByRole('alert')).toHaveTextContent('valid ISBN')
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'ISBN' }), { target: { value: '' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Published \(/ }), {
    target: { value: '2025-02-29' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Review change' }))
  expect(screen.getByRole('alert')).toHaveTextContent('publication date')
  expect(state.save).not.toHaveBeenCalled()
})
