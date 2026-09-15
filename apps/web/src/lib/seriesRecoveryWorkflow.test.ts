import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runSeriesRecoveryLoop } from '../../workflows/series-recovery'

const steps = {
  claimBatch: vi.fn(),
  processWork: vi.fn(),
  finish: vi.fn(),
  pause: vi.fn(),
}

describe('durable series recovery workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    steps.finish.mockResolvedValue(undefined)
    steps.pause.mockResolvedValue(undefined)
  })

  it('processes durable batches and paces each provider attempt', async () => {
    steps.claimBatch.mockResolvedValueOnce(['one', 'two']).mockResolvedValueOnce([])
    steps.processWork.mockResolvedValue(undefined)

    await expect(runSeriesRecoveryLoop('run', steps)).resolves.toEqual({ runId: 'run' })
    expect(steps.processWork).toHaveBeenNthCalledWith(1, 'run', 'one')
    expect(steps.processWork).toHaveBeenNthCalledWith(2, 'run', 'two')
    expect(steps.pause).toHaveBeenCalledTimes(2)
    expect(steps.pause).toHaveBeenCalledWith('4s')
    expect(steps.finish).toHaveBeenCalledWith('run')
  })

  it('stops the whole run without replay when an attempted item is uncertain', async () => {
    steps.claimBatch.mockResolvedValueOnce(['one', 'two'])
    steps.processWork
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('database changed'))

    await runSeriesRecoveryLoop('run', steps)

    expect(steps.processWork).toHaveBeenCalledTimes(2)
    expect(steps.claimBatch).toHaveBeenCalledTimes(1)
    expect(steps.finish).toHaveBeenCalledWith('run', 'database changed')
  })
})
