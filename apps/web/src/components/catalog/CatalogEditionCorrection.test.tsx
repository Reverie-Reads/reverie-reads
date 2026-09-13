import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CatalogMetadataWork } from '../../data/corpusMetadataReview'
import { CatalogEditionCorrection } from './CatalogEditionCorrection'

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
vi.mock('../../data/corpusMetadataReview', async (original) => ({
  ...(await original<typeof import('../../data/corpusMetadataReview')>()),
  useSaveCatalogEditionCorrection: () => ({ mutateAsync, isPending: false }),
}))
const work: CatalogMetadataWork = {
  id: 'fixture',
  title: 'Exact Title',
  author: 'Full Writer',
  contributors: [{ name: 'Full Writer', role: 'author' }],
  isbns: ['9780306406157'],
  description: '',
  descriptionSource: null,
  cover: null,
  year: 2024,
  publisher: null,
  language: null,
  issues: [],
  related: [],
  relatedTotal: 0,
  fingerprint: 'frozen',
  revision: 4,
  state: 'open',
  note: '',
  sourceUrl: '',
  editionCorrectionVersion: 1,
  pages: 123,
  publication: { y: 2024, m: null, d: null },
}
const onSaved = vi.fn(),
  onRefresh = vi.fn(),
  onDirtyChange = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  mutateAsync.mockResolvedValue(work.id)
})
function open(record = work) {
  render(
    <CatalogEditionCorrection
      work={record}
      blocked={false}
      onSaved={onSaved}
      onRefresh={onRefresh}
      onDirtyChange={onDirtyChange}
    />,
  )
}
function draft() {
  for (const [label, value] of [
    ['Reference edition ISBN', '9780306406157'],
    ['Title shown by the edition source', 'Exact Title'],
    ['Full contributor names shown by the edition source', 'Full Writer'],
    ['Proposed page count', '456'],
    ['Edition evidence link', 'https://publisher.example/edition'],
    ['Edition correction explanation', 'Checked this exact edition'],
  ] as const)
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview edition correction' }))
}
it('withholds all correction controls against an older server', () => {
  open({ ...work, editionCorrectionVersion: undefined })
  expect(screen.getByText(/need the updated server/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Preview edition correction' })).toBeNull()
  expect(mutateAsync).not.toHaveBeenCalled()
})
it('changing evidence discards the approved preview and requires another explicit approval', async () => {
  open()
  draft()
  const apply = screen.getByRole('button', { name: 'Apply edition correction' })
  expect(apply).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /I checked this edition/ }))
  expect(apply).toBeEnabled()
  fireEvent.change(screen.getByLabelText('Proposed page count'), { target: { value: '789' } })
  expect(screen.queryByRole('button', { name: 'Apply edition correction' })).toBeNull()
  expect(mutateAsync).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Preview edition correction' }))
  expect(screen.getByRole('button', { name: 'Apply edition correction' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /I checked this edition/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Apply edition correction' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(mutateAsync).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      work,
      correction: { field: 'pages', value: { pages: 789 } },
      identityConfirmed: true,
    }),
  )
})
it('an uncertain result locks both reapply and discard until an explicit reload', async () => {
  mutateAsync.mockRejectedValue(new Error('Connection lost'))
  open()
  draft()
  fireEvent.click(screen.getByRole('checkbox', { name: /I checked this edition/ }))
  const apply = screen.getByRole('button', { name: 'Apply edition correction' })
  fireEvent.click(apply)
  await screen.findByText('Connection lost')
  expect(apply).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Discard edition draft' })).toBeDisabled()
  fireEvent.click(apply)
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  expect(onSaved).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Reload current record' }))
  expect(onRefresh).toHaveBeenCalledTimes(1)
})
