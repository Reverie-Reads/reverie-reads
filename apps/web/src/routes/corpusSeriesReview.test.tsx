import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CorpusSeriesSuggestion } from '../data/enrichCorpus'

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('../data/enrichCorpus', () => ({
  useCorpusAdminStatus: () => ({ data: true }),
  useCorpusSeriesSuggestions: () => ({ data: [] }),
  useReviewCorpusSeriesSuggestion: () => ({ isPending: false, mutate: mocks.mutate }),
}))

const { CorpusSeriesReview } = await import('./ReviewRoute')

const suggestion: CorpusSeriesSuggestion = {
  id: 'suggestion-1',
  workId: 'work-1',
  title: 'A Child Alone with Strangers',
  author: 'Philip Fracassi',
  currentSeries: '',
  // Some legacy imports preserved a position even though no series identity was known. That
  // number must not be presented as meaningful membership evidence.
  currentPosition: 1,
  proposedSeries: 'The Stranger Cycle',
  proposedPosition: 2,
  proposedCount: 4,
  proposalAction: 'set',
  source: 'hardcover',
  identityConfidence: 'high',
  membershipConfidence: 'medium',
  reason: 'The relationship is plausible but needs review.',
  evidence: [
    {
      source: 'publisher',
      kind: 'relational_membership',
      sourceRef: 'https://publisher.example/stranger-cycle',
      series: 'The Stranger Cycle',
      position: 2,
      memberCount: 4,
      orderType: 'publication',
    },
  ],
  checkedAt: '2026-09-11T00:00:00Z',
}

describe('corpus series administrator review', () => {
  it('shows current and proposed facts instead of hiding the judgment in a toggle', () => {
    render(<CorpusSeriesReview suggestions={[suggestion]} />)

    expect(screen.getByText('A Child Alone with Strangers')).toBeInTheDocument()
    expect(screen.getByText('No series set')).toBeInTheDocument()
    expect(screen.queryByText('No series set · #1')).not.toBeInTheDocument()
    expect(screen.getByText('The Stranger Cycle · #2 · 4 books')).toBeInTheDocument()
    expect(screen.getByText('hardcover · identity high · membership medium')).toBeInTheDocument()
    expect(screen.getByText('The relationship is plausible but needs review.')).toBeInTheDocument()
    expect(screen.getByText('Evidence · 1 observation')).toBeInTheDocument()
    const sourceLink = screen.getByRole('link', { name: 'View source' })
    expect(sourceLink.closest('li')).toHaveTextContent(
      'publisher · membership · #2 · publication order · 4 books',
    )
    expect(sourceLink).toHaveAttribute('href', 'https://publisher.example/stranger-cycle')
  })

  it('sends an explicit accept or dismiss decision', () => {
    render(<CorpusSeriesReview suggestions={[suggestion]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Accept shared series' }))
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      suggestionId: 'suggestion-1',
      decision: 'accept',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      suggestionId: 'suggestion-1',
      decision: 'dismiss',
    })
  })

  it('labels a historical removal review as a keep-or-remove decision', () => {
    render(
      <CorpusSeriesReview
        suggestions={[
          {
            ...suggestion,
            id: 'removal-1',
            title: '1Q84',
            currentSeries: '1Q84',
            proposedSeries: '1Q84',
            proposalAction: 'remove',
            reason: 'The truth-blind review could not verify this historical shared series.',
            evidence: [],
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Removal reviews · 1' }))
    expect(screen.getByText('Remove the shared 1Q84 membership')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove false series' }))
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      suggestionId: 'removal-1',
      decision: 'accept',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Keep current series' }))
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      suggestionId: 'removal-1',
      decision: 'dismiss',
    })
  })

  it('separates corrections from removal reviews and searches the active view', () => {
    render(
      <CorpusSeriesReview
        suggestions={[
          suggestion,
          {
            ...suggestion,
            id: 'removal-1',
            title: '1Q84',
            author: 'Haruki Murakami',
            currentSeries: '1Q84',
            proposedSeries: '1Q84',
            proposalAction: 'remove',
          },
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: 'Corrections · 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('A Child Alone with Strangers')).toBeInTheDocument()
    expect(screen.queryByText('1Q84')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 2 pending reviews.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Removal reviews · 1' }))
    expect(screen.getByText('1Q84')).toBeInTheDocument()
    expect(screen.queryByText('A Child Alone with Strangers')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reviews' }), {
      target: { value: 'no match' },
    })
    expect(screen.getByText('No pending reviews match this view.')).toBeInTheDocument()
    expect(screen.getByText('Showing 0 of 2 pending reviews.')).toBeInTheDocument()
  })
})
