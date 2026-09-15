import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SeriesRecoveryRun } from '../data/seriesRecoveryRuns'
import { SeriesRecoveryControl } from './SeriesRecoveryControl'

const run = (status: SeriesRecoveryRun['status']): SeriesRecoveryRun => ({
  id: 'run-1',
  status,
  total: 780,
  eligible: 803,
  excluded: 23,
  checked: 100,
  confirmed: 80,
  review: 20,
  deferred: 5,
  uncertain: 0,
  batches: 5,
  errorMessage: status === 'failed' ? 'provider unavailable' : null,
  cancelRequestedAt: null,
  createdAt: '2026-09-14T00:00:00Z',
  completedAt: null,
})

describe('SeriesRecoveryControl', () => {
  it('requires the private exclusion file before the one-time start', () => {
    render(
      <SeriesRecoveryControl
        run={null}
        status={null}
        onStart={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Choose private exclusions file' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Start historical recovery' })).toBeDisabled()
  })

  it.each(['failed', 'cancelled'] as const)(
    'offers a no-replay resume for a safe %s run',
    (runStatus) => {
      const resume = vi.fn().mockResolvedValue(undefined)
      render(
        <SeriesRecoveryControl
          run={run(runStatus)}
          status={null}
          onStart={vi.fn()}
          onResume={resume}
          onStop={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Resume untouched works' }))
      expect(resume).toHaveBeenCalledOnce()
      expect(screen.getByRole('status')).toHaveTextContent('100 of 780 saved')
    },
  )

  it('shows durable progress and stop for an active run', () => {
    const stop = vi.fn().mockResolvedValue(undefined)
    render(
      <SeriesRecoveryControl
        run={run('running')}
        status={null}
        onStart={vi.fn()}
        onResume={vi.fn()}
        onStop={stop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stop historical recovery' }))
    expect(stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('batch 5')
  })
})
