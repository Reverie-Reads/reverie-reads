import { useRef, useState } from 'react'
import type { SeriesRecoveryRun } from '../data/seriesRecoveryRuns'
import { seriesRecoveryStatusText } from '../data/seriesRecoveryRuns'
import { SERIES_RECOVERY_EXCLUSION_COUNT } from '../lib/seriesRecoveryPolicy'
import { UtilityGlyph } from './UtilityGlyph'

export function SeriesRecoveryControl({
  run,
  status,
  onStart,
  onResume,
  onStop,
}: {
  run: SeriesRecoveryRun | null | undefined
  status: string | null
  onStart: (manifest: unknown) => Promise<void>
  onResume: () => Promise<void>
  onStop: () => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [manifest, setManifest] = useState<unknown>(null)
  const [fileStatus, setFileStatus] = useState<string | null>(null)
  const active = run?.status === 'queued' || run?.status === 'running'

  async function choose(file?: File) {
    setManifest(null)
    setFileStatus(null)
    if (!file) return
    try {
      const value = JSON.parse(await file.text()) as { works?: unknown[] }
      if (!Array.isArray(value.works) || value.works.length !== SERIES_RECOVERY_EXCLUSION_COUNT) {
        throw new Error(`Expected the reviewed ${SERIES_RECOVERY_EXCLUSION_COUNT}-work file`)
      }
      setManifest(value)
      setFileStatus(
        `${SERIES_RECOVERY_EXCLUSION_COUNT} protected exclusions ready. The file stays out of source control and Workflow history.`,
      )
    } catch (error) {
      setFileStatus(`Couldn’t use that file: ${(error as Error).message}`)
    }
  }

  return (
    <div className="w-full border-t border-line pt-3">
      <p className="text-[13px] font-semibold text-ink">Historical series recovery</p>
      <p className="mt-1 text-[12px] text-muted">
        Incident-only admin tool · retries the September 10 relationship outage in durable batches
        of 25. It does not fetch covers or other metadata, approve reviews, or overwrite reader
        choices.
      </p>
      {active ? (
        <button
          type="button"
          onClick={() => void onStop()}
          className="skin-control mt-3 inline-flex items-center gap-2 border border-line px-4 py-2 text-[13px] font-semibold text-ink"
          style={{ background: 'var(--field)' }}
        >
          <UtilityGlyph name="stop" /> Stop historical recovery
        </button>
      ) : (run?.status === 'failed' || run?.status === 'cancelled') && !run.uncertain ? (
        <button
          type="button"
          onClick={() => void onResume()}
          className="skin-control mt-3 border border-line px-4 py-2 text-[13px] font-semibold text-ink"
          style={{ background: 'var(--field)' }}
        >
          Resume untouched works
        </button>
      ) : run ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => void choose(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink"
            style={{ background: 'var(--field)' }}
          >
            Choose private exclusions file
          </button>
          <button
            type="button"
            disabled={!manifest}
            onClick={() => manifest && void onStart(manifest)}
            className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:border-dashed"
            style={{ background: 'var(--field)' }}
          >
            Start historical recovery
          </button>
        </div>
      )}
      {(fileStatus || status || run) && (
        <p className="mt-2 text-[12px] text-muted" role="status" aria-live="polite">
          {status || (run ? seriesRecoveryStatusText(run) : fileStatus)}
        </p>
      )}
    </div>
  )
}
