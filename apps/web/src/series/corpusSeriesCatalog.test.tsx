import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CorpusSeriesCatalogRow } from '../data/corpusSeriesCatalog'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  merge: vi.fn(),
  restore: vi.fn(),
  history: null as { sourceUrl: string; note: string; position: number | null } | null,
}))

const row: CorpusSeriesCatalogRow = {
  id: 'series-1',
  name: 'The Lantern Sequence',
  creatorKey: 'inez north',
  status: 'ongoing',
  declaredCount: 3,
  state: 'confirmed',
  revision: 7,
  aliases: ['Lantern Books'],
  sources: [{ source: 'hardcover', sourceRef: 'hc-lantern' }],
  entries: [
    {
      id: 'entry-1',
      workId: 'work-1',
      position: 1,
      label: '',
      title: 'A Map of Quiet Stars',
      author: 'Inez North',
      primary: true,
      source: 'hardcover',
      evidence: [],
      work: {
        id: 'work-1',
        title: 'A Map of Quiet Stars',
        author: 'Inez North',
        cover: 'https://example.com/map.jpg',
      },
    },
  ],
}

const mutation = (mutate: ReturnType<typeof vi.fn>) => ({
  isPending: false,
  mutate,
  variables: undefined,
})

vi.mock('../data/corpusSeriesCatalog', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/corpusSeriesCatalog')>()
  return {
    ...original,
    useCorpusSeriesCatalog: () => ({ data: [row], isLoading: false, isError: false }),
    useArchivedCorpusSeries: () => ({ data: [] }),
    useSaveCorpusSeriesEntry: () => mutation(mocks.save),
    useSeriesOrderReview: () => ({ data: mocks.history, isError: false }),
    useRemoveCorpusSeriesEntry: () => mutation(mocks.remove),
    useUpdateCorpusSeries: () => mutation(mocks.update),
    useArchiveCorpusSeries: () => mutation(mocks.archive),
    useMergeCorpusSeries: () => mutation(mocks.merge),
    useRestoreCorpusSeries: () => mutation(mocks.restore),
  }
})

const { CorpusSeriesCatalog } = await import('./CorpusSeriesCatalog')
const { SharedSeriesCatalogBrowser } = await import('./SharedSeriesCatalogBrowser')

describe('canonical shared-series catalog interfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.history = null
  })

  it('shows reviewed shared series to readers without personal management controls', () => {
    render(<SharedSeriesCatalogBrowser />)

    expect(screen.getByText('The Lantern Sequence')).toBeInTheDocument()
    expect(screen.getByText('#1 · A Map of Quiet Stars')).toBeInTheDocument()
    expect(document.querySelector('img[src="https://example.com/map.jpg"]')).toHaveClass(
      'object-contain',
    )
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('lets an administrator correct a linked slot and add an unbound known slot', () => {
    render(<CorpusSeriesCatalog />)
    expect(screen.getByText('Sources hardcover · hc-lantern')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const positions = screen.getAllByLabelText('Position')
    fireEvent.change(positions[0]!, { target: { value: '1.5' } })
    expect(screen.getByRole('button', { name: 'Save slot' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Order source URL'), {
      target: { value: 'https://publisher.example/lantern' },
    })
    fireEvent.change(screen.getByLabelText('Order review explanation'), {
      target: { value: 'Publisher places the novella after the first volume.' },
    })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save slot' }))
    expect(mocks.save).toHaveBeenLastCalledWith(
      {
        seriesId: 'series-1',
        revision: 7,
        entryId: 'entry-1',
        title: 'A Map of Quiet Stars',
        author: 'Inez North',
        position: 1.5,
        label: '',
        sourceUrl: 'https://publisher.example/lantern',
        reviewNote: 'Publisher places the novella after the first volume.',
      },
      expect.any(Object),
    )

    fireEvent.change(screen.getByLabelText('Slot title'), {
      target: { value: 'The Winter Archive' },
    })
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'E. L. Quill' } })
    fireEvent.change(positions[1]!, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add known slot' }))
    expect(mocks.save).toHaveBeenLastCalledWith(
      {
        seriesId: 'series-1',
        revision: 7,
        entryId: null,
        title: 'The Winter Archive',
        author: 'E. L. Quill',
        position: 2,
        label: '',
      },
      expect.any(Object),
    )
  })

  it('keeps destructive catalog actions explicit', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CorpusSeriesCatalog />)

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(window.confirm).toHaveBeenCalledWith(
      'Archive The Lantern Sequence? Shared membership will be suspended, but the catalog record and its history remain recoverable.',
    )
    expect(mocks.archive).toHaveBeenCalledWith({ id: 'series-1', revision: 7 })
  })

  it('shows the last citation as historical when the current position differs', () => {
    mocks.history = {
      sourceUrl: 'https://publisher.example/title',
      note: '<script>not HTML</script>',
      position: 5,
    }
    render(<CorpusSeriesCatalog />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('Reviewed position: 5. Current position: 1.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View order source' })).toHaveAttribute(
      'href',
      'https://publisher.example/title',
    )
    expect(screen.getByText('<script>not HTML</script>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByLabelText('Order source URL')).toHaveValue('')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('requires fresh confirmation after the proposed position changes, including a clear', () => {
    render(<CorpusSeriesCatalog />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const position = screen.getAllByLabelText('Position')[0]!
    fireEvent.change(position, { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Order source URL'), {
      target: { value: 'https://publisher.example/title' },
    })
    fireEvent.change(screen.getByLabelText('Order review explanation'), {
      target: { value: 'The publisher numbers the exact title.' },
    })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Save slot' })).toBeEnabled()
    fireEvent.change(position, { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Save slot' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save slot' }))
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ position: null }),
      expect.any(Object),
    )
  })

  it('keeps label-only edits available without manufacturing an order citation', () => {
    render(<CorpusSeriesCatalog />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getAllByLabelText('Reading-order note')[0]!, {
      target: { value: 'Read first' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save slot' }))
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ position: 1, label: 'Read first' }),
      expect.any(Object),
    )
    expect(mocks.save.mock.calls[0]?.[0]).not.toHaveProperty('sourceUrl')
  })

  it('resets confirmation when an unbound slot identity changes', () => {
    const entry = row.entries[0]!
    const original = { workId: entry.workId, work: entry.work }
    entry.workId = null
    entry.work = null
    try {
      render(<CorpusSeriesCatalog />)
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      fireEvent.change(screen.getAllByLabelText('Position')[0]!, { target: { value: '5' } })
      fireEvent.change(screen.getByLabelText('Order source URL'), {
        target: { value: 'https://publisher.example/title' },
      })
      fireEvent.change(screen.getByLabelText('Order review explanation'), {
        target: { value: 'Exact title and order checked.' },
      })
      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.change(screen.getAllByLabelText('Slot title')[0]!, {
        target: { value: 'Corrected title' },
      })
      expect(screen.getByRole('checkbox')).not.toBeChecked()
      expect(screen.getByRole('button', { name: 'Save slot' })).toBeDisabled()
      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.change(screen.getAllByLabelText('Author')[0]!, {
        target: { value: 'Corrected author' },
      })
      expect(screen.getByRole('checkbox')).not.toBeChecked()
      expect(screen.getByRole('button', { name: 'Save slot' })).toBeDisabled()
    } finally {
      Object.assign(entry, original)
    }
  })
})
