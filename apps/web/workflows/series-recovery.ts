import { sleep } from 'workflow'
import {
  claimSeriesRecoveryBatch,
  finishSeriesRecovery,
  processSeriesRecoveryWork,
} from '../server/seriesRecovery'

const PROVIDER_PACE = '4s'

export interface SeriesRecoveryWorkflowSteps {
  claimBatch: (runId: string) => Promise<string[]>
  processWork: (runId: string, workId: string) => Promise<void>
  finish: (runId: string, errorMessage?: string) => Promise<void>
  pause: (duration: typeof PROVIDER_PACE) => Promise<void>
}

export async function runSeriesRecoveryLoop(
  runId: string,
  { claimBatch, processWork, finish, pause }: SeriesRecoveryWorkflowSteps,
): Promise<{ runId: string }> {
  try {
    while (true) {
      const workIds = await claimBatch(runId)
      if (!workIds.length) break
      for (const workId of workIds) {
        try {
          await processWork(runId, workId)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await finish(runId, message)
          return { runId }
        }
        await pause(PROVIDER_PACE)
      }
    }
    await finish(runId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finish(runId, message)
  }
  return { runId }
}

/** The workflow receives only the durable run id. Private exclusions and user credentials never
 * enter Workflow history. */
export async function durableSeriesRecovery(runId: string): Promise<{ runId: string }> {
  'use workflow'

  return runSeriesRecoveryLoop(runId, {
    claimBatch: claimSeriesRecoveryBatch,
    processWork: processSeriesRecoveryWork,
    finish: finishSeriesRecovery,
    pause: sleep,
  })
}
