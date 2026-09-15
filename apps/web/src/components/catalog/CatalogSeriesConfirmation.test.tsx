import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CatalogMetadataWork } from '../../data/corpusMetadataReview'
import { CatalogSeriesConfirmation } from './CatalogSeriesConfirmation'

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
vi.mock('../../data/corpusMetadataReview', async (original) => ({
  ...(await original<typeof import('../../data/corpusMetadataReview')>()),
  useSaveCatalogSeriesConfirmation: () => ({ mutateAsync, isPending: false }),
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
  seriesConfirmationVersion: 1,
  seriesFingerprint: 'frozen-series',
  series: 'Exact Saga',
  position: 2,
  seriesCount: 4,
  seriesCheckState: 'unresolved',
}
const onSaved = vi.fn()
const onRefresh = vi.fn()
const onDirtyChange = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mutateAsync.mockResolvedValue(work.id)
})

function open(record = work) {
  render(
    <CatalogSeriesConfirmation
      work={record}
      blocked={false}
      onDirtyChange={onDirtyChange}
      onSaved={onSaved}
      onRefresh={onRefresh}
    />,
  )
}

function draft() {
  fireEvent.change(screen.getByLabelText('Series evidence link'), {
    target: { value: 'https://author.example/series' },
  })
  fireEvent.change(screen.getByLabelText('Series confirmation explanation'), {
    target: { value: 'The author lists this exact title as book two.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Preview series confirmation' }))
}

it('fails closed on an older server and never turns a missing tuple into a proposal', () => {
  open({ ...work, seriesConfirmationVersion: undefined })
  expect(screen.getByText(/needs the updated server/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Preview series confirmation' })).toBeNull()

  open({ ...work, series: null })
  expect(screen.getByText(/no shared series tuple to confirm/)).toBeTruthy()
  expect(mutateAsync).not.toHaveBeenCalled()
})

it('changing evidence discards the preview and requires fresh explicit approval', async () => {
  open()
  draft()
  const apply = screen.getByRole('button', { name: 'Confirm shared series' })
  expect(apply).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /I checked this book’s exact identity/ }))
  expect(apply).toBeEnabled()

  fireEvent.change(screen.getByLabelText('Series confirmation explanation'), {
    target: { value: 'A more precise explanation.' },
  })
  expect(screen.queryByRole('button', { name: 'Confirm shared series' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Preview series confirmation' }))
  expect(screen.getByRole('button', { name: 'Confirm shared series' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /I checked this book’s exact identity/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm shared series' }))

  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
    work,
    sourceUrl: 'https://author.example/series',
    note: 'A more precise explanation.',
    identityConfirmed: true,
  })
})

it('locks an uncertain one-shot result until explicit reload', async () => {
  mutateAsync.mockRejectedValue(new Error('Connection lost'))
  open()
  draft()
  fireEvent.click(screen.getByRole('checkbox', { name: /I checked this book’s exact identity/ }))
  const apply = screen.getByRole('button', { name: 'Confirm shared series' })
  fireEvent.click(apply)

  await screen.findByText('Connection lost')
  expect(apply).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Discard series draft' })).toBeDisabled()
  fireEvent.click(apply)
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  expect(onSaved).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Reload current record' }))
  expect(onRefresh).toHaveBeenCalledTimes(1)
})
