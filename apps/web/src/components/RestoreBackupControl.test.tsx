import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupPreview } from '../data/importExport'
import { RestoreBackupControl } from './RestoreBackupControl'

const mocks = vi.hoisted(() => ({
  inspectBackup: vi.fn(),
  restoreBackup: vi.fn(),
}))

vi.mock('../data/importExport', () => mocks)

const preview = (patch: Partial<BackupPreview> = {}): BackupPreview => ({
  version: 9,
  isNewerVersion: false,
  exportedAt: '2026-09-08T17:30:00.000Z',
  integrity: 'verified',
  unknownSections: [],
  restoresProfile: true,
  counts: {
    books: 2,
    activeBooks: 2,
    removedBooks: 0,
    reads: 3,
    notes: 1,
    lists: 1,
    listItems: 2,
    reviews: 1,
    contributors: 2,
    tropes: 4,
    moods: 2,
    authorFollows: 1,
    series: 1,
    seriesEntries: 2,
    tombstones: 0,
    dismissals: 0,
    discoveries: 1,
    plannedBooks: 1,
    favoriteBooks: 1,
  },
  ...patch,
})

function backupFile(text = '{}') {
  const file = new File([text], 'my-reverie-backup.json', { type: 'application/json' })
  // jsdom versions have varied on Blob.text(); the browser contract this component uses is stable.
  Object.defineProperty(file, 'text', { value: async () => text })
  return file
}

describe('RestoreBackupControl', () => {
  beforeEach(() => {
    mocks.inspectBackup.mockReset()
    mocks.restoreBackup.mockReset()
  })

  it('shows real current, incoming, and projected counts before the first restore call', async () => {
    const onRestored = vi.fn()
    mocks.inspectBackup.mockReturnValue(preview())
    mocks.restoreBackup.mockResolvedValue({
      books: 2,
      lists: 1,
      reads: 3,
      tropes: 4,
      moods: 2,
      follows: 1,
      tombstones: 0,
      dismissals: 0,
    })
    render(<RestoreBackupControl currentBookCount={5} onRestored={onRestored} />)

    fireEvent.change(screen.getByTestId('restore-backup-file'), {
      target: { files: [backupFile()] },
    })

    const dialog = await screen.findByRole('dialog', { name: 'Review your restore' })
    expect(dialog).toHaveTextContent('Library after restore')
    expect(dialog).toHaveTextContent('7')
    expect(dialog).toHaveTextContent('add 2 books to the 5 books already here')
    expect(dialog).toHaveTextContent('Reading records3')
    expect(dialog).toHaveTextContent('Saved notes1')
    expect(dialog).toHaveTextContent('completeness record matches')
    expect(mocks.inspectBackup).toHaveBeenCalledWith('{}')
    expect(mocks.restoreBackup).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Restore this backup' }))
    await waitFor(() => expect(mocks.restoreBackup).toHaveBeenCalledWith('{}'))
    await waitFor(() =>
      expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ books: 2 })),
    )
    expect(screen.queryByRole('dialog', { name: 'Review your restore' })).not.toBeInTheDocument()
  })

  it('explains legacy uncertainty and lets the reader cancel without changing the account', async () => {
    mocks.inspectBackup.mockReturnValue(preview({ integrity: 'legacy', restoresProfile: false }))
    render(<RestoreBackupControl currentBookCount={0} onRestored={vi.fn()} />)

    fireEvent.change(screen.getByTestId('restore-backup-file'), {
      target: { files: [backupFile()] },
    })

    expect(await screen.findByText(/predates completeness records/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.restoreBackup).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('blocks a newer unknown section and reports an unreadable file without opening a dialog', async () => {
    mocks.inspectBackup.mockReturnValueOnce(preview({ unknownSections: ['reading_quotes'] }))
    const { rerender } = render(<RestoreBackupControl currentBookCount={5} onRestored={vi.fn()} />)

    fireEvent.change(screen.getByTestId('restore-backup-file'), {
      target: { files: [backupFile()] },
    })
    expect(await screen.findByText(/newer data Reverie cannot restore/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Restore this backup' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    mocks.inspectBackup.mockImplementationOnce(() => {
      throw new Error('That file doesn’t look like a Reverie backup.')
    })
    rerender(<RestoreBackupControl currentBookCount={5} onRestored={vi.fn()} />)
    fireEvent.change(screen.getByTestId('restore-backup-file'), {
      target: { files: [backupFile('nope')] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('doesn’t look like a Reverie backup')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('waits for the current library count before offering a misleading projected total', () => {
    render(<RestoreBackupControl currentBookCount={null} onRestored={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Loading before restore…' })).toBeDisabled()
  })
})
