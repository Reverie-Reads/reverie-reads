import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CatalogEvidenceReview } from './CatalogEvidenceReview'
import type { CatalogMetadataWork } from '../../data/corpusMetadataReview'
import type { CatalogEvidenceContext } from '../../data/catalogEvidence'
const api = vi.hoisted(() => ({
  apply: vi.fn(),
  refetch: vi.fn(),
  readAttempt: vi.fn(),
  user: 'admin',
}))
const context: CatalogEvidenceContext = {
  version: 1,
  fingerprint: 'frozen-evidence',
  history: [],
  record: {
    id: 'work',
    title: 'Still Waters',
    author: 'Jane Smith',
    description: 'Existing description',
    genre: null,
    genres: [],
    subgenre: null,
    subgenres: [],
    spice: null,
    darkness: null,
    guidanceSource: null,
    isbns: ['9780306406157'],
    fingerprint: 'record-fingerprint',
    reports: [],
    history: [],
    editions: [
      {
        id: 'e8000000-0000-4000-8000-000000000003',
        work_id: 'work',
        isbn: '9780306406157',
        details: { format: 'paperback', pages: 100 },
        reviewed: false,
        revision: 1,
        source_url: null,
      },
    ],
  },
}
const work: CatalogMetadataWork = {
  id: 'work',
  title: 'Still Waters',
  author: 'Jane Smith',
  isbns: ['9780306406157'],
  description: 'Existing description',
  descriptionSource: null,
  cover: null,
  year: null,
  publisher: null,
  language: null,
  issues: [],
  related: [],
  relatedTotal: 0,
  fingerprint: 'legacy-fingerprint',
  revision: 0,
  state: 'open',
  note: '',
  sourceUrl: '',
}
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: api.user } } }),
}))
vi.mock('../../data/catalogEvidence', () => ({
  useCatalogEvidence: () => ({
    data: context,
    isPending: false,
    isError: false,
    refetch: api.refetch,
  }),
  useApplyCatalogEvidence: () => ({ mutateAsync: api.apply, isPending: false }),
  readCatalogEvidenceAttempt: (...args: unknown[]) => api.readAttempt(...args),
}))
const onSaved = vi.fn(),
  onDirtyChange = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  api.user = 'admin'
  context.fingerprint = 'frozen-evidence'
  context.history = []
  api.apply.mockResolvedValue({ status: 'applied' })
  api.refetch.mockResolvedValue({ data: context, isError: false })
  api.readAttempt.mockResolvedValue({ ...context, attempt: null })
})
function open() {
  return render(
    <CatalogEvidenceReview
      work={work}
      blocked={false}
      onSaved={onSaved}
      onDirtyChange={onDirtyChange}
    />,
  )
}
function fill() {
  for (const [name, value] of [
    ['Supported value', 'A supported short summary.'],
    ['Title at this source', 'Still Waters'],
    ['Source full author names', 'Jane Smith'],
    ['Original evidence link', 'https://publisher.example/book'],
    ['Source record identifier', 'book'],
    ['Where the fact appears', 'Synopsis'],
    [
      'Why the evidence supports this fact',
      'I checked each sentence against the original synopsis.',
    ],
    ['Source-use reference', 'https://publisher.example/terms'],
    [
      'How the basis covers retaining and displaying this value',
      'Inspected terms cover this retained summary.',
    ],
    ['Correction note', 'Supported fact; other concerns stay open.'],
  ])
    fireEvent.change(screen.getByLabelText(name!), { target: { value } })
  fireEvent.click(screen.getByRole('checkbox', { name: /I independently checked/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Preview supported correction' }))
}
async function apply() {
  fireEvent.click(screen.getByRole('checkbox', { name: /Approve exactly/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Apply supported correction' }))
  await waitFor(() => expect(api.apply).toHaveBeenCalledOnce())
}
it('requires independent inspection then approval of a frozen preview', async () => {
  open()
  expect(screen.getByRole('button', { name: 'Preview supported correction' })).toBeDisabled()
  fill()
  expect(api.apply).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Apply supported correction' })).toBeDisabled()
  await apply()
  await screen.findByText(
    'Supported correction saved. Personal data and reading history were preserved.',
  )
  expect(api.apply.mock.calls[0]?.[0]).toMatchObject({
    fingerprint: 'frozen-evidence',
    draft: {
      field: 'description',
      editionId: null,
      value: 'A supported short summary.',
      sourceUse: { scope: 'catalog_description' },
    },
  })
  expect(onSaved).not.toHaveBeenCalled()
})
it('invalidates inspection and preview when evidence changes', () => {
  open()
  fill()
  fireEvent.click(screen.getByRole('checkbox', { name: /Approve exactly/ }))
  fireEvent.change(screen.getByLabelText('Original evidence link'), {
    target: { value: 'https://publisher.example/other' },
  })
  expect(screen.queryByRole('button', { name: 'Apply supported correction' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Preview supported correction' })).toBeDisabled()
  expect(api.apply).not.toHaveBeenCalled()
})
it('freezes the target before background updates and never refreshes a reviewed payload silently', async () => {
  const view = open()
  fill()
  context.fingerprint = 'newer-evidence'
  view.rerender(
    <CatalogEvidenceReview
      work={work}
      blocked={false}
      onSaved={onSaved}
      onDirtyChange={onDirtyChange}
    />,
  )
  await apply()
  expect(api.apply.mock.calls[0]?.[0].fingerprint).toBe('frozen-evidence')
})
it('binds pages to an explicitly selected published edition', async () => {
  open()
  fireEvent.change(screen.getByLabelText('Fact to review'), { target: { value: 'pages' } })
  fireEvent.change(screen.getByLabelText('Published edition'), {
    target: { value: context.record.editions[0]!.id },
  })
  fireEvent.change(screen.getByLabelText('ISBN at this source'), {
    target: { value: '9780306406157' },
  })
  fill() // Replace the description-like value before inspecting again.
  fireEvent.change(screen.getByLabelText('Supported value'), { target: { value: '456' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /I independently checked/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Preview supported correction' }))
  await apply()
  expect(api.apply.mock.calls[0]?.[0].draft).toMatchObject({
    editionId: context.record.editions[0]!.id,
    field: 'pages',
    value: { pages: 456 },
    identity: { isbn: '9780306406157' },
    support: { scope: 'edition' },
  })
})

it('withholds a valid source ISBN for a different edition before any save', () => {
  open()
  fireEvent.change(screen.getByLabelText('Fact to review'), { target: { value: 'pages' } })
  fireEvent.change(screen.getByLabelText('Published edition'), {
    target: { value: context.record.editions[0]!.id },
  })
  fireEvent.change(screen.getByLabelText('ISBN at this source'), {
    target: { value: '9780140449136' },
  })
  fill()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The source ISBN must match the explicitly selected published edition.',
  )
  expect(screen.queryByRole('button', { name: 'Apply supported correction' })).toBeNull()
  expect(api.apply).not.toHaveBeenCalled()
})
it('recovers a lost response using its exact receipt even outside recent history', async () => {
  api.apply.mockRejectedValue(new Error('Lost response'))
  open()
  fill()
  await apply()
  await screen.findByText('Lost response')
  expect(screen.getByRole('button', { name: 'Discard evidence draft' })).toBeDisabled()
  const saved = api.apply.mock.calls[0]?.[0]
  api.readAttempt.mockResolvedValue({
    ...context,
    attempt: { id: saved.id, draft: Object.fromEntries(Object.entries(saved.draft).reverse()) },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check evidence history' }))
  await screen.findByText(
    'Supported correction saved. Personal data and reading history were preserved.',
  )
  expect(api.readAttempt).toHaveBeenCalledWith('work', saved.id)
  expect(api.apply).toHaveBeenCalledOnce()
})
it('offers only a deliberate identical retry after checking an absent receipt', async () => {
  api.apply.mockRejectedValueOnce(new Error('Request never arrived'))
  open()
  fill()
  await apply()
  await screen.findByText('Request never arrived')
  expect(screen.queryByRole('button', { name: 'Retry exactly this reviewed save' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Check evidence history' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry exactly this reviewed save' }))
  await screen.findByText(
    'Supported correction saved. Personal data and reading history were preserved.',
  )
  expect(api.apply).toHaveBeenCalledTimes(2)
  expect(api.apply.mock.calls[1]?.[0]).toEqual(api.apply.mock.calls[0]?.[0])
})
it('a failed history read never unlocks another write', async () => {
  api.apply.mockRejectedValue(new Error('Lost response'))
  api.readAttempt.mockRejectedValue(new Error('Read failed'))
  open()
  fill()
  await apply()
  await screen.findByText('Lost response')
  fireEvent.click(screen.getByRole('button', { name: 'Check evidence history' }))
  await screen.findByText(/exact attempted save could not be checked/)
  expect(screen.queryByRole('button', { name: 'Retry exactly this reviewed save' })).toBeNull()
  expect(api.apply).toHaveBeenCalledOnce()
})
it('an account change discards the departed account’s evidence draft', () => {
  const view = open()
  fill()
  api.user = 'other-admin'
  view.rerender(
    <CatalogEvidenceReview
      work={work}
      blocked={false}
      onSaved={onSaved}
      onDirtyChange={onDirtyChange}
    />,
  )
  expect(screen.getByLabelText('Supported value')).toHaveValue('')
  expect(screen.queryByRole('button', { name: 'Apply supported correction' })).toBeNull()
})
it('keeps sibling drafts safe when returning after a confirmed save', async () => {
  const view = open()
  fill()
  await apply()
  await screen.findByText(
    'Supported correction saved. Personal data and reading history were preserved.',
  )
  view.rerender(
    <CatalogEvidenceReview
      work={work}
      blocked={true}
      onSaved={onSaved}
      onDirtyChange={onDirtyChange}
    />,
  )
  expect(screen.getByRole('button', { name: 'Return to current catalog record' })).toBeDisabled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('offers explicit reload for a definitive initial rejection without rebasing or another submission', async () => {
  const onRefresh = vi.fn()
  api.apply.mockRejectedValue({ code: 'PT409', message: 'Catalog changed' })
  render(
    <CatalogEvidenceReview
      work={work}
      blocked={false}
      onSaved={onSaved}
      onDirtyChange={onDirtyChange}
      onRefresh={onRefresh}
    />,
  )
  fill()
  await apply()
  await screen.findByText('Catalog changed')
  fireEvent.click(
    screen.getByRole('button', { name: 'Reload current record and discard rejected draft' }),
  )
  expect(onRefresh).toHaveBeenCalledOnce()
  expect(api.apply).toHaveBeenCalledOnce()
})

it('a rejected retry cannot declare that the earlier uncertain save failed', async () => {
  const onRefresh = vi.fn()
  api.apply
    .mockRejectedValueOnce(new Error('Response lost'))
    .mockRejectedValueOnce({ code: '42501', message: 'Permission removed' })
  render(
    <CatalogEvidenceReview
      work={work}
      blocked={false}
      onSaved={onSaved}
      onDirtyChange={onDirtyChange}
      onRefresh={onRefresh}
    />,
  )
  fill()
  await apply()
  await screen.findByText('Response lost')
  fireEvent.click(screen.getByRole('button', { name: 'Check evidence history' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry exactly this reviewed save' }))
  await screen.findByText('Permission removed')
  expect(
    screen.queryByRole('button', { name: 'Reload current record and discard rejected draft' }),
  ).toBeNull()
  expect(onRefresh).not.toHaveBeenCalled()
})
