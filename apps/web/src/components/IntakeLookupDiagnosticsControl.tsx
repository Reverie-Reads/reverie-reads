import { useSyncExternalStore } from 'react'
import { APP_NAME } from '@reverie/core'
import { intakeLookupDiagnostics } from '../lib/intakeLookupDiagnostics'

const button =
  'skin-control min-h-11 border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50'

/** Optional local session. The export is an observation summary, never a book-data packet. */
export function IntakeLookupDiagnosticsControl() {
  const counts = useSyncExternalStore(
    intakeLookupDiagnostics.subscribe,
    intakeLookupDiagnostics.getSnapshot,
  )
  const download = () => {
    const a = document.createElement('a')
    a.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(intakeLookupDiagnostics.export(), null, 2))}`
    a.download = `${APP_NAME.toLowerCase()}-add-diagnostics.json`
    a.click()
  }
  const inProgress = counts.active || counts.pending > 0
  return (
    <div className="flex flex-col gap-3" data-testid="intake-lookup-diagnostics">
      <p className="text-[13px] text-muted">
        Optionally count your next 20 Add searches, including pasted-list lookups and retries. This
        tab keeps counts only: no titles, ISBNs, search terms, account identifiers or library
        values. Diagnostic counts are never uploaded or stored automatically. Normal searches still
        use the existing catalog service. Reloading, signing out or changing accounts clears the
        session.
      </p>
      <p className="text-[13px] text-muted">
        These counts describe lookup attempts. A candidate is not a verified book or edition; an
        empty lookup does not prove a book is missing. Saving books and spreadsheet imports are not
        measured.
      </p>
      <p role="status" className="text-[13px] text-ink">
        {counts.active
          ? 'Counting Add lookups.'
          : counts.pending
            ? 'Finishing the last lookups.'
            : counts.attempted
              ? 'Session stopped.'
              : 'Diagnostics are off.'}{' '}
        {counts.attempted} of {counts.limit} attempts; {counts.pending} pending.
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px] text-ink">
        <dt>Returned candidates</dt>
        <dd>{counts.results.candidates}</dd>
        <dt>Empty lookups</dt>
        <dd>{counts.results.empty}</dd>
        <dt>Unavailable lookups</dt>
        <dd>{counts.results.unavailable}</dd>
        <dt>Cancelled lookups</dt>
        <dd>{counts.results.cancelled}</dd>
        <dt>Unfinished when stopped</dt>
        <dd>{counts.results.unfinished}</dd>
        <dt>Exact editions returned</dt>
        <dd>{counts.editions.exact}</dd>
        <dt>Edition identity held</dt>
        <dd>{counts.editions.identity_hold}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          style={{ background: 'var(--field)' }}
          onClick={intakeLookupDiagnostics.start}
          disabled={inProgress}
        >
          {counts.attempted ? 'Start a new diagnostic session' : 'Start diagnostic session'}
        </button>
        <button
          type="button"
          className={button}
          style={{ background: 'var(--field)' }}
          onClick={intakeLookupDiagnostics.stop}
          disabled={!inProgress}
        >
          Stop diagnostics
        </button>
        <button
          type="button"
          className={button}
          style={{ background: 'var(--field)' }}
          onClick={download}
          disabled={!counts.attempted}
        >
          Download diagnostic counts
        </button>
        <button
          type="button"
          className={button}
          style={{ background: 'var(--field)' }}
          onClick={intakeLookupDiagnostics.reset}
          disabled={!counts.attempted && !counts.active}
        >
          Discard diagnostic counts
        </button>
      </div>
      <p className="text-[12px] text-muted">
        Starting a new session replaces the counts. Stopping retains completed counts and marks
        pending attempts unfinished; their later replies cannot change the report. Download counts
        before closing this tab. Deliberately sharing the file is a separate choice.
      </p>
    </div>
  )
}
