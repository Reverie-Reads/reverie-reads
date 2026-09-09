import type { CorpusBulkProgress } from '../data/enrichCorpus'
import { UtilityGlyph } from './UtilityGlyph'

export function CorpusCompleteControl({
  completing,
  progress,
  eligibleCount,
  status,
  onRun,
  onStop,
}: {
  completing: boolean
  progress: CorpusBulkProgress | null
  eligibleCount: number | null
  status: string | null
  onRun: () => void
  onStop: () => void
}) {
  const activeIssues = progress
    ? [
        progress.failed
          ? `${progress.failed} ${progress.failed === 1 ? 'work' : 'works'} deferred to retry`
          : '',
        progress.recoveryFailed
          ? `${progress.recoveryFailed} cover ${progress.recoveryFailed === 1 ? 'source' : 'sources'} deferred`
          : '',
        progress.recoveryFailedBatches
          ? `${progress.recoveryFailedBatches} cover recovery ${progress.recoveryFailedBatches === 1 ? 'batch has' : 'batches have'} failed`
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const activeStatus = progress
    ? progress.phase === 'recovering'
      ? `Recovering household covers in small batches · ${progress.recoveryScanned} cover sources checked · ${progress.scanned} of ${progress.total} shared works classified${activeIssues ? ` · ${activeIssues}` : ''}.`
      : `Classifying shared metadata and series · ${progress.scanned} of ${progress.total} shared works classified${activeIssues ? ` · ${activeIssues}` : ''}.`
    : 'Starting the shared corpus sweep…'

  if (completing) {
    return (
      <>
        <button
          type="button"
          onClick={onStop}
          className="skin-control inline-flex items-center gap-2 border border-line px-4 py-2 text-[13px] font-semibold text-ink"
          style={{ background: 'var(--field)' }}
        >
          <UtilityGlyph name="stop" />
          <span>
            Stop shared corpus ({progress ? `${progress.scanned}/${progress.total}` : 'starting…'})
          </span>
        </button>
        <p className="w-full text-[12px] text-muted" role="status" aria-live="polite">
          {activeStatus}
        </p>
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={onRun}
        className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink"
        style={{ background: 'var(--field)' }}
      >
        ✨ Complete shared corpus &amp; series info
        {eligibleCount !== null && eligibleCount > 0 ? ` (${eligibleCount})` : ''}
      </button>
      {status && (
        <p className="w-full text-[12px] text-muted" role="status">
          {status}
        </p>
      )}
    </>
  )
}
