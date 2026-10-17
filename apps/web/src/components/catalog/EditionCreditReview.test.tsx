import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CorpusEdition, CorpusRecord } from '../../data/corpusEditions'
import type { EditionCreditReview as Review } from '../../data/editionCredits'
const api = vi.hoisted(() => ({ prepare: vi.fn(), apply: vi.fn(), get: vi.fn() }))
vi.mock('../../data/editionCredits', () => ({
  prepareEditionCredits: api.prepare,
  applyEditionCredits: api.apply,
  getEditionCreditReviews: api.get,
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}))
import { EditionCreditReview } from './EditionCreditReview'
const edition: CorpusEdition = {
  id: 'edition',
  work_id: 'work',
  isbn: '9780306406157',
  details: {},
  reviewed: false,
  revision: 1,
  source_url: null,
  credits: [],
}
const record = {
  id: 'work',
  title: 'Still Waters',
  author: 'Jane Smith',
  fingerprint: 'frozen',
  editions: [edition],
} as CorpusRecord
let prepared: Review
beforeEach(() => {
  vi.clearAllMocks()
  api.prepare.mockImplementation(async (input) => {
    prepared = {
      id: input.id,
      status: 'prepared',
      evidence: input.evidence,
      decisions: [{ position: 0, eligible: true, reasons: [] }],
    }
    return prepared
  })
  api.apply.mockResolvedValue({ status: 'applied' })
  api.get.mockImplementation(async () => [prepared])
})
function open() {
  const saved = vi.fn(),
    close = vi.fn(),
    view = render(
      <EditionCreditReview record={record} edition={edition} onClose={close} onSaved={saved} />,
    )
  return { saved, close, view }
}
function fill() {
  for (const [label, value] of [
    ['Source page URL', 'https://publisher.example/edition'],
    ['Source title', 'Still Waters'],
    ['Full creators on the source, one per line', 'Jane Smith'],
    ['Source ISBN', '9780306406157'],
    ['Where the credits appear on the page', 'Edition credits'],
    ['Credit 1 name', 'Ann Brown'],
    ['Credit 1 original role label', 'Introduction by'],
  ])
    fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Source attribution' }), {
    target: { value: 'publisher' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Credit 1 role' }), {
    target: { value: 'introduction' },
  })
  fireEvent.click(screen.getByRole('checkbox', { name: /I inspected/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /may be retained/ }))
}
async function prepare() {
  fill()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare review' }))
  await screen.findByText(/Frozen source:/)
}
function select() {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Ann Brown · introduction' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /Save only the selected/ }))
}
it('freezes the actual evidence and requires deliberate selection and confirmation before saving', async () => {
  const c = open()
  await prepare()
  expect(screen.queryByRole('textbox', { name: 'Source title' })).not.toBeInTheDocument()
  expect(api.apply).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Save selected edition credits' })).toBeDisabled()
  select()
  fireEvent.click(screen.getByRole('button', { name: 'Save selected edition credits' }))
  await waitFor(() => expect(c.saved).toHaveBeenCalledOnce())
  expect(api.apply).toHaveBeenCalledWith(prepared.id, [0])
  expect(prepared.evidence.credits[0]).toMatchObject({
    role: 'introduction',
    sourceRole: 'Introduction by',
    basis: 'edition',
  })
})
it('held credits cannot be selected even after source confirmation', async () => {
  api.prepare.mockImplementation(async (input) => ({
    id: input.id,
    status: 'prepared',
    evidence: input.evidence,
    decisions: [{ position: 0, eligible: false, reasons: ['credit_scope_unverified'] }],
  }))
  open()
  await prepare()
  expect(screen.getByRole('checkbox', { name: 'Ann Brown · introduction' })).toBeDisabled()
  expect(screen.getByText(/not been observed on the selected edition/)).toBeVisible()
  expect(api.apply).not.toHaveBeenCalled()
})
it('double activation is guarded and a lost response retries only the identical selection', async () => {
  const c = open()
  await prepare()
  select()
  let reject!: (error: Error) => void
  api.apply.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r
      }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save selected edition credits' }))
  fireEvent.click(screen.getByRole('button', { name: 'Retry the same confirmation' }))
  expect(api.apply).toHaveBeenCalledTimes(1)
  reject(new Error('Response lost'))
  await screen.findByRole('alert')
  expect(screen.getByRole('checkbox', { name: 'Ann Brown · introduction' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry the same confirmation' }))
  await waitFor(() => expect(c.saved).toHaveBeenCalledOnce())
  expect(api.apply.mock.calls[1]).toEqual(api.apply.mock.calls[0])
})
it('a failed prepare retains its UUID and exact source snapshot for retry', async () => {
  api.prepare.mockRejectedValueOnce(new Error('Response lost'))
  open()
  fill()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare review' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('textbox', { name: 'Source title' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry the same review' }))
  await screen.findByText(/Frozen source:/)
  expect(api.prepare.mock.calls[1]).toEqual(api.prepare.mock.calls[0])
})
it('discarded account/work components never receive a late save callback', async () => {
  const c = open()
  await prepare()
  select()
  let resolve!: () => void
  api.apply.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r
      }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save selected edition credits' }))
  c.view.unmount()
  resolve()
  await new Promise((r) => setTimeout(r, 0))
  expect(c.saved).not.toHaveBeenCalled()
})
it('history read failures stay visible without invoking a save', async () => {
  api.get.mockRejectedValue(new Error('Read failed'))
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Check saved reviews' }))
  await screen.findByRole('alert')
  expect(api.prepare).not.toHaveBeenCalled()
  expect(api.apply).not.toHaveBeenCalled()
})
