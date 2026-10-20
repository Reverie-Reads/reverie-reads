import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
      sourceUseReview: input.sourceUseReview,
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
    ['Source-use reference URL', 'https://publisher.example/terms'],
    [
      'Why these terms or permission cover these facts',
      'These inspected terms cover attributed edition identity and contributor-credit facts.',
    ],
  ])
    fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Source attribution' }), {
    target: { value: 'publisher' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Credit 1 role' }), {
    target: { value: 'introduction' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Source-use basis' }), {
    target: { value: 'public_terms' },
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
  expect(prepared.sourceUseReview).toMatchObject({
    basis: 'public_terms',
    url: 'https://publisher.example/terms',
    scope: 'edition_identity_and_credit_facts',
    confirmed: true,
  })
})
it('held credits cannot be selected even after source confirmation', async () => {
  api.prepare.mockImplementation(async (input) => ({
    id: input.id,
    status: 'prepared',
    evidence: input.evidence,
    sourceUseReview: input.sourceUseReview,
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

it('keeps an unresolved source-use draft in the browser without preparing any server record', async () => {
  open()
  fill()
  fireEvent.change(screen.getByRole('combobox', { name: 'Source-use basis' }), {
    target: { value: '' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Prepare review' }))
  await screen.findByRole('alert')
  expect(api.prepare).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Source title' })).toHaveValue('Still Waters')
  expect(screen.getByRole('textbox', { name: 'Credit 1 name' })).toHaveValue('Ann Brown')
})

it('editing bibliography or permission evidence clears the corresponding confirmations', async () => {
  open()
  fill()
  const inspected = screen.getByRole('checkbox', { name: /I inspected/ })
  const retained = screen.getByRole('checkbox', { name: /may be retained/ })
  expect(inspected).toBeChecked()
  expect(retained).toBeChecked()
  fireEvent.change(screen.getByRole('textbox', { name: 'Source-use reference URL' }), {
    target: { value: 'https://publisher.example/new-terms' },
  })
  expect(retained).not.toBeChecked()
  expect(inspected).toBeChecked()
  fireEvent.click(retained)
  fireEvent.change(screen.getByRole('textbox', { name: 'Credit 1 name' }), {
    target: { value: 'Other Person' },
  })
  expect(retained).not.toBeChecked()
  expect(inspected).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare review' }))
  await screen.findByRole('alert')
  expect(api.prepare).not.toHaveBeenCalled()
})

it.each(['missing', 'stale'] as const)(
  'does not offer a save for %s source-use evidence even with a permissive response',
  async (state) => {
    api.prepare.mockImplementation(async (input) => ({
      id: input.id,
      status: 'prepared',
      evidence: input.evidence,
      sourceUseReview:
        state === 'missing'
          ? null
          : { ...input.sourceUseReview, checkedAt: '2020-01-01T00:00:00Z' },
      decisions: [{ position: 0, eligible: true, reasons: [] }],
    }))
    open()
    await prepare()
    expect(screen.getByRole('checkbox', { name: 'Ann Brown · introduction' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save selected edition credits' })).toBeDisabled()
    expect(api.apply).not.toHaveBeenCalled()
  },
)

it.each(['current', 'missing', 'stale'] as const)(
  'reopened history exposes the %s source-use receipt and its holds',
  async (state) => {
    const original = open()
    await prepare()
    const frozen = structuredClone(prepared)
    original.view.unmount()
    api.get.mockResolvedValue([
      {
        ...frozen,
        status: 'applied',
        selected: [0],
        sourceUseReview:
          state === 'missing'
            ? null
            : {
                ...frozen.sourceUseReview!,
                checkedAt:
                  state === 'stale' ? '2020-01-01T00:00:00Z' : frozen.sourceUseReview!.checkedAt,
              },
        decisions: [
          {
            position: 0,
            eligible: state === 'current',
            reasons:
              state === 'current'
                ? []
                : [state === 'missing' ? 'source_use_review_required' : 'source_use_stale'],
          },
        ],
      },
    ])
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Check saved reviews' }))
    const summary = await screen.findByText('Inspect this saved review')
    fireEvent.click(summary)
    const details = summary.closest('details')!
    if (state === 'missing')
      expect(within(details).getByText(/older review has no source-use record/)).toBeVisible()
    else {
      expect(
        within(details).getByRole('link', { name: 'Applicable public terms' }),
      ).toHaveAttribute('href', frozen.sourceUseReview!.url)
      expect(within(details).getByText(frozen.sourceUseReview!.note)).toBeVisible()
      if (state === 'stale')
        expect(within(details).getByText(/source-use inspection is stale/)).toBeVisible()
    }
    expect(api.apply).not.toHaveBeenCalled()
  },
)

it.each(['stale', 'missing'] as const)(
  'an uncertain save can retry only the original selection after %s receipt readback',
  async (state) => {
    const c = open()
    await prepare()
    select()
    api.apply.mockRejectedValueOnce(new Error('Response lost'))
    fireEvent.click(screen.getByRole('button', { name: 'Save selected edition credits' }))
    await screen.findByRole('alert')
    api.get.mockResolvedValue([
      {
        ...prepared,
        stale: true,
        sourceUseReview:
          state === 'missing'
            ? null
            : { ...prepared.sourceUseReview!, checkedAt: '2020-01-01T00:00:00Z' },
      },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Check saved reviews' }))
    await screen.findByText(/catalog changed/)
    expect(screen.getByRole('checkbox', { name: 'Ann Brown · introduction' })).toBeDisabled()
    const retry = screen.getByRole('button', { name: 'Retry the same confirmation' })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    await waitFor(() => expect(c.saved).toHaveBeenCalledOnce())
    expect(api.apply.mock.calls[1]).toEqual(api.apply.mock.calls[0])
  },
)
