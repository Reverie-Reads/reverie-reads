import { CatalogReviewNav } from '../components/catalog/CatalogReviewNav'
import { useEffect, useRef, useState } from 'react'
import { createRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { findDuplicateGroups, planTitleCleanup, richness, type Book } from '@reverie/core'
import { rootRoute } from './RootRoute'
import { useBooks, useUpdateBook } from '../data/books'
import { useProfile, useUpdateProfile } from '../data/profile'
import { usePerformMerge } from '../data/mergeBooks'
import { buildBackup, buildLibraryCsv } from '../data/importExport'
import { importDetectedExport, type ImportExportResult } from '../data/importLibrary'
import { enrichImported } from '../data/importEnrich'
import { ImportSummary } from '../components/ImportSummary'
import { importSessionKey } from '../data/importReview'
import { deleteAccount } from '../data/account'
import {
  bulkComplete,
  fetchEnrichmentStamps,
  isIncomplete,
  sweepCandidates,
  type BulkOptions,
  type BulkProgress,
} from '../data/enrichLibrary'
import {
  corpusEnrichmentCandidatesKey,
  useCorpusAdminStatus,
  useCorpusEnrichmentCandidates,
} from '../data/enrichCorpus'
import {
  cancelCorpusSweep,
  corpusSweepStatusText,
  startCorpusSweep,
  useCurrentCorpusSweep,
} from '../data/corpusSweepRuns'
import { resharpenCovers, resharpenSource, type ResharpenProgress } from '../data/resharpenCovers'
import { sweepCountText } from '../data/sweepProgress'
import { DuplicateReview } from '../components/DuplicateReview'
import { CorpusCompleteControl } from '../components/CorpusCompleteControl'
import { fileToCsvText } from '../data/xlsxAdapter'
import type { ReviewCandidate } from '../data/intake'
import { APP_NAME, SKIN_LIST, type Mode } from '@reverie/core'
import { BUILD_LABEL } from '../lib/updates'
import { useSkin } from '../skin/useSkin'
import { useLabels } from '../skin/labels'
import { useSkinControls } from '../skin/controls'
import { useAuth } from '../auth/AuthProvider'
import { todayLocalDate } from '../lib/localDate'
import { Surface } from '../components/Surface'
import { useHouseholdLibraryAuthorization } from '../data/household'
import { AddDestinationPicker } from '../components/AddDestinationPicker'
import type { AddDestination } from '../components/addDestination'
import { ArrangementEditor } from '../components/ArrangementEditor'
import { RestoreBackupControl } from '../components/RestoreBackupControl'
import { UtilityGlyph } from '../components/UtilityGlyph'

const YEAR = new Date().getFullYear()

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Surface radius="panel" tone="card" pad={4}>
      <h2 className="mb-3 text-[15px] font-semibold text-ink">{title}</h2>
      {children}
    </Surface>
  )
}

const fieldClass = 'h-10 w-full skin-card border border-line px-3 text-[14px] text-ink outline-none'
const fieldStyle = { background: 'var(--field)' } as const

/**
 * The import control's two labels. One place, because the disabled state has to SAY why — a control
 * greyed out with no explanation reads as a broken app, and one that silently does nothing for a
 * second is its own defect.
 */
const IMPORT_LABEL = '📚 Import a library export (CSV or Excel)'
const IMPORT_LOADING_LABEL = '📚 Loading your library…'
const counted = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`

function SettingsScreen() {
  const qc = useQueryClient()
  const { data: profile } = useProfile()
  const labels = useLabels()
  const { data: books } = useBooks()
  const updateProfile = useUpdateProfile()
  const updateBook = useUpdateBook()
  const performMerge = usePerformMerge()
  const activeSkin = useSkin((s) => s.skin)
  const activeMode = useSkin((s) => s.mode)
  const { setSkin, setMode } = useSkinControls()
  const { session, signOut } = useAuth()
  const household = useHouseholdLibraryAuthorization()
  const [importDestination, setImportDestination] = useState<AddDestination>('mine')
  const importDestinationChosen = useRef(false)
  useEffect(() => {
    if (!importDestinationChosen.current && household.authorized && household.members.length) {
      setImportDestination('both')
    }
  }, [household.authorized, household.members.length])
  const [deleteText, setDeleteText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [primed, setPrimed] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [showDupes, setShowDupes] = useState(false)
  const [review, setReview] = useState<ReviewCandidate[]>([])
  const [imported, setImported] = useState(false)
  const [importResult, setImportResult] = useState<ImportExportResult | null>(null)
  const [completing, setCompleting] = useState(false)
  const [tracing, setTracing] = useState(false)
  const [progress, setProgress] = useState<BulkProgress | null>(null)
  const stopRef = useRef(false)
  const [corpusStatus, setCorpusStatus] = useState<string | null>(null)
  const completedCorpusRun = useRef<string | null>(null)
  const [sharpening, setSharpening] = useState(false)
  const [sharpProgress, setSharpProgress] = useState<ResharpenProgress | null>(null)
  const sharpStopRef = useRef(false)
  const [showSweep, setShowSweep] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const [sweepProgress, setSweepProgress] = useState<{ done: number; total: number } | null>(null)
  const csvRef = useRef<HTMLInputElement>(null)

  const autoMerge = profile?.autoMergeDuplicates ?? true
  const incompleteCount = (books ?? []).filter(isIncomplete).length
  // THE SAME PREDICATE THE SWEEP RUNS — not a half-copy. `incompleteCount` alone once put (112) on
  // the button while bulkComplete's own filter (isIncomplete AND outside the recheck window)
  // selected zero, so the label promised work the action would not do. The eligible count comes
  // from the exported `sweepCandidates` the sweep itself consumes; the stamps are one cheap
  // id+enriched_at query, refetched after every sweep (each checked book was just restamped).
  const { data: stamps } = useQuery({
    queryKey: ['enrichmentStamps'],
    queryFn: fetchEnrichmentStamps,
  })
  const eligibleCount = stamps ? sweepCandidates(books ?? [], stamps).length : null
  const restingCount = eligibleCount === null ? 0 : incompleteCount - eligibleCount
  const { data: isCorpusAdmin = false } = useCorpusAdminStatus()
  const { data: corpusCandidates } = useCorpusEnrichmentCandidates(isCorpusAdmin)
  const corpusEligibleCount = corpusCandidates?.length ?? null
  const corpusRunQuery = useCurrentCorpusSweep(isCorpusAdmin, session?.access_token)
  const corpusRun = corpusRunQuery.data
  const corpusCompleting = corpusRun?.status === 'queued' || corpusRun?.status === 'running'
  const corpusProgress = corpusRun
    ? {
        scanned: corpusRun.scanned,
        total: corpusRun.total,
        filled: corpusRun.filled,
        recoveryScanned: corpusRun.recoveryScanned,
        failed: corpusRun.failed,
        recoveryFailed: corpusRun.recoveryFailed,
        recoveryFailedBatches: corpusRun.recoveryFailedBatches,
        errorMessage: corpusRun.errorMessage,
        phase:
          corpusRun.phase === 'recovering' ? ('recovering' as const) : ('classifying' as const),
      }
    : null

  useEffect(() => {
    if (!corpusRun || corpusCompleting || completedCorpusRun.current === corpusRun.id) return
    completedCorpusRun.current = corpusRun.id
    setCorpusStatus(corpusSweepStatusText(corpusRun))
    void Promise.all([
      qc.invalidateQueries({ queryKey: corpusEnrichmentCandidatesKey }),
      qc.invalidateQueries({ queryKey: ['works-browse'] }),
      qc.invalidateQueries({ queryKey: ['household'] }),
    ])
  }, [corpusCompleting, corpusRun, qc])
  // Covers whose STORED pixels can be improved from a larger source (Google/OL) — the re-sharpen set.
  const sharpenableCount = (books ?? []).filter((b) => resharpenSource(b) !== null).length

  // Prime the form fields once the profile loads.
  if (profile && !primed) {
    setName(profile.displayName)
    setGoal(profile.goalYear === YEAR && profile.goalTarget ? String(profile.goalTarget) : '')
    setPrimed(true)
  }

  const all = books ?? []
  /**
   * "NOT YET KNOWN" IS NOT "KNOWN TO BE EMPTY", and `books ?? []` erases the difference.
   *
   * Every consumer of `all` above treats the fallback as a real library. For the counts that is
   * harmless — their controls are gated on the count being non-zero, so a still-loading library
   * renders them inert. The IMPORT has no such gate, and handing it `[]` is not a no-op: it is a
   * statement that the reader owns nothing, so every incoming row matches nothing, nothing reaches
   * the duplicate review queue, and the whole file is inserted as new. A reader who navigates to
   * this screen in order to import — and whose library is large enough that the query is slow, i.e.
   * exactly the reader with the most to lose — lands inside that window with the file picker in
   * front of them.
   *
   * So the import control asks whether the library is KNOWN, not whether it is non-empty: a genuinely
   * empty library (a first import, the common case for this screen) must still be importable.
   */
  const libraryLoaded = books !== undefined
  const dupes = findDuplicateGroups(all)
  // Legacy titles imported before #54 still carry Goodreads series junk ("Title (Series, #2)"); the
  // sweep re-parses them, cleaning the title and filling series only where the book has none.
  const titleCleanups = planTitleCleanup(all)

  const saveProfile = () =>
    updateProfile.mutate(
      { displayName: name.trim(), goalYear: YEAR, goalTarget: Math.max(0, parseInt(goal) || 0) },
      { onSuccess: () => setStatus('Saved') },
    )

  const exportBackup = async () => {
    const json = await buildBackup()
    const a = document.createElement('a')
    a.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`
    // Local, not UTC — see localDate.ts. Same class as the log-a-read default: cosmetic here
    // (a filename, not stored data), but wrong for the same reason near midnight west of UTC.
    a.download = `reverie-backup-${todayLocalDate()}.json`
    a.click()
  }

  /**
   * The spreadsheet export — the library in the shape of the source file it is meant to be compared
   * against, NOT a backup. Same download mechanics as the JSON one above, and the same reason for
   * the local (not UTC) date in the filename.
   *
   * Busy state, unlike the JSON export: this one pages the whole library over the network, so on a
   * large library there is a real gap between the click and the file, and a control that looks
   * inert invites a second click and a second full read.
   */
  const [csvBusy, setCsvBusy] = useState(false)
  const exportLibraryCsv = async () => {
    setCsvBusy(true)
    try {
      const csv = await buildLibraryCsv()
      const a = document.createElement('a')
      a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
      a.download = `reverie-library-${todayLocalDate()}.csv`
      a.click()
    } catch (e) {
      setStatus(`Couldn’t export the CSV: ${(e as Error).message}`)
    } finally {
      setCsvBusy(false)
    }
  }

  const confirmText = 'delete my account'
  async function runDelete() {
    if (deleteText.trim().toLowerCase() !== confirmText) return
    setDeleting(true)
    try {
      await deleteAccount()
      // The account is gone; end the session and return to the signed-out state.
      await signOut()
    } catch (e) {
      setStatus(`Couldn’t delete the account: ${(e as Error).message}`)
      setDeleting(false)
    }
  }

  // fileToCsvText reads JSON/CSV as text and converts an .xlsx to CSV-identical rows, so the CSV
  // import picker accepts spreadsheets too while the JSON restore picker is unaffected.
  const readFile = (input: HTMLInputElement, handler: (text: string) => Promise<void>) => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    void (async () => {
      try {
        await handler(await fileToCsvText(file))
        void qc.invalidateQueries()
      } catch (e) {
        setStatus(`Failed: ${(e as Error).message}`)
      }
    })()
  }

  // Apply the legacy-title sweep. Batched + resumable: each row is its own optimistic write, and a
  // fresh plan is computed at click time, so a re-run after a stop simply continues (already-clean
  // titles no longer match). Fills series/position ONLY where the book had none (non-overwrite).
  async function applySweep() {
    const plan = planTitleCleanup(all)
    if (!plan.length) return
    setSweeping(true)
    let done = 0
    for (const c of plan) {
      const patch: Partial<Book> = { title: c.newTitle }
      if (c.fillsSeries) {
        patch.series = c.series
        patch.position = c.position
        patch.status = 'ongoing'
      }
      try {
        await updateBook.mutateAsync({ id: c.id, patch })
        done++
        setSweepProgress({ done, total: plan.length })
      } catch (e) {
        setStatus(
          `Cleaned ${done} of ${plan.length} titles; stopped (${(e as Error).message}). Re-run to continue.`,
        )
        setSweeping(false)
        return
      }
    }
    setSweeping(false)
    setSweepProgress(null)
    setShowSweep(false)
    // each rewritten title just had its enrichment stamp cleared by the DB trigger
    // (20260811010000) — the sweep button's eligible count changes with it
    void qc.invalidateQueries({ queryKey: ['enrichmentStamps'] })
    setStatus(`Cleaned ${done} legacy title${done === 1 ? '' : 's'}`)
  }

  async function mergeOneGroup(group: Book[]) {
    const sorted = [...group].sort((a, b) => richness(b) - richness(a))
    const primary = sorted[0]
    if (!primary) return
    for (const loser of sorted.slice(1)) {
      await performMerge.mutateAsync({ primary, loser })
    }
  }

  async function mergeGroup(group: Book[]) {
    const primary = [...group].sort((a, b) => richness(b) - richness(a))[0]
    if (!primary) return
    if (!window.confirm(`Merge ${group.length} copies of “${primary.title}” into one entry?`))
      return
    try {
      await mergeOneGroup(group)
      setStatus('Merged')
    } catch (e) {
      setStatus(`Merge failed — nothing was lost (the merge is atomic). ${(e as Error).message}`)
    }
  }

  // Each pair-merge is an atomic RPC, so a failure leaves earlier groups merged and the rest
  // untouched — re-running "Merge all" simply continues from the still-duplicated groups.
  async function mergeAllGroups() {
    if (
      !window.confirm(`Review and merge all ${dupes.length} duplicate groups into one entry each?`)
    )
      return
    let merged = 0
    for (const g of dupes) {
      try {
        await mergeOneGroup(g)
        merged++
      } catch (e) {
        setStatus(
          `Merged ${merged} of ${dupes.length}; stopped at a failure (${(e as Error).message}). Nothing was lost — re-run “Merge all” to continue.`,
        )
        return
      }
    }
    setStatus(`Merged ${merged} duplicate groups`)
  }

  // `trace` runs a SHORT, instrumented sweep: same code path, same order, capped at `limit` books,
  // writing one sweep_traces row each. It is the measurement run — not a faster or different sweep.
  async function runComplete(opts?: BulkOptions) {
    stopRef.current = false
    setCompleting(true)
    setTracing(!!opts?.trace)
    // total: null, not 0 — the count isn't known until bulkComplete's first emission, and a
    // placeholder zero renders as "Stop (0/0)" on a run the reader has just committed minutes to.
    setProgress({ scanned: 0, total: null, filled: 0 })
    const runId = crypto.randomUUID()
    try {
      const r = await bulkComplete(all, setProgress, () => stopRef.current, {
        ...opts,
        runId,
      })
      // A RUN THAT BROKE MUST NOT READ LIKE A RUN THAT FINISHED. Three sweeps stalled and each
      // reported the same shape as a completed one, because a stop was only ever described by a
      // soft prefix and failures were counted as books that had nothing.
      const prefix =
        r.stopReason === 'error'
          ? '⚠ Stopped early — '
          : r.stopReason === 'rate_limited'
            ? 'Paused — the book data sources are busy; it’ll resume where it left off next time. '
            : r.stopReason === 'limit'
              ? 'Paused at the per-run limit — run again to continue. '
              : r.stopReason === 'user'
                ? 'Stopped — '
                : ''
      // Failures are reported separately from misses and are never folded into "had nothing new":
      // those books were not checked and were deliberately left unstamped, so they retry next run.
      const failures = r.failed
        ? ` · ${r.failed} couldn’t be checked (left to retry${r.errorMessage ? `: ${r.errorMessage}` : ''})`
        : ''
      // Only a clean, complete pass may say so without qualification.
      const completeness =
        r.stopReason === 'done' && !r.failed
          ? ''
          : ` — ${r.total - r.scanned} of ${r.total} not reached`
      setStatus(
        `${prefix}checked ${r.scanned} of ${r.total} · filled ${r.filled} · ${r.nothing} had nothing new${failures}${completeness}.` +
          (opts?.trace ? ` Trace run ${runId} — ${r.scanned} rows in sweep_traces.` : ''),
      )
      await qc.invalidateQueries({ queryKey: ['books'] })
      // every checked book was just restamped — the eligible count must not keep the old answer
      await qc.invalidateQueries({ queryKey: ['enrichmentStamps'] })
    } catch (e) {
      setStatus(`Couldn’t finish completing details: ${(e as Error).message}`)
    }
    setCompleting(false)
    setTracing(false)
    setProgress(null)
  }

  async function runCorpusComplete() {
    setCorpusStatus(null)
    try {
      const token = session?.access_token
      if (!token) throw new Error('Sign in again before starting the corpus sweep')
      await startCorpusSweep(token)
      setCorpusStatus('Corpus sweep queued. You can leave this page; progress will reconnect here.')
      await corpusRunQuery.refetch()
    } catch (error) {
      setCorpusStatus(`Couldn’t start the corpus sweep: ${(error as Error).message}`)
    }
  }

  async function stopCorpusComplete() {
    const token = session?.access_token
    if (!token || !corpusRun) return
    try {
      await cancelCorpusSweep(token, corpusRun.id)
      setCorpusStatus('Stop requested. The current work will finish before the sweep stops.')
      await corpusRunQuery.refetch()
    } catch (error) {
      setCorpusStatus(`Couldn’t stop the corpus sweep: ${(error as Error).message}`)
    }
  }

  async function runResharpen() {
    sharpStopRef.current = false
    setSharpening(true)
    setSharpProgress({ scanned: 0, total: null, sharpened: 0 })
    try {
      const r = await resharpenCovers(all, setSharpProgress, () => sharpStopRef.current)
      const prefix =
        r.stopReason === 'limit'
          ? 'Paused at the per-run limit — run again to finish. '
          : r.stopReason === 'user'
            ? 'Stopped — '
            : ''
      setStatus(`${prefix}re-fetched ${r.scanned} of ${r.total} covers · ${r.sharpened} sharpened.`)
      await qc.invalidateQueries({ queryKey: ['books'] })
    } catch (e) {
      setStatus(`Couldn’t finish sharpening covers: ${(e as Error).message}`)
    }
    setSharpening(false)
    setSharpProgress(null)
  }

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <h1
        className="mb-4 text-[22px] italic text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
      >
        Settings
      </h1>

      <div className="flex flex-col gap-4">
        <Section title="Account">
          <p className="text-[13px] text-muted">
            Signed in as <span className="text-ink">{session?.user.email}</span>. Your library is
            stored in your account and follows you across devices — sign in anywhere to see the same
            shelves.
          </p>
        </Section>

        <Section title="Your library guide">
          <p className="text-[14px] leading-relaxed text-muted">
            Change your starting pace, revisit a walkthrough, or explore tools you have not tried
            yet.
          </p>
          <Link
            to="/guide"
            className="skin-control skin-btn-secondary mt-3 inline-flex min-h-11 items-center px-4 py-2 text-[14px]"
          >
            Open the library guide
          </Link>
        </Section>

        <Section title="Profile & goal">
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-muted">
              Display name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Shown in clubs & shared lists"
              className={fieldClass}
              style={fieldStyle}
            />
          </label>
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-muted">
              Reading goal for {YEAR}
            </span>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              type="number"
              min={0}
              placeholder="e.g. 50"
              className={fieldClass}
              style={fieldStyle}
            />
          </label>
          <button
            type="button"
            onClick={saveProfile}
            className="h-10 skin-control px-5 text-[14px] font-semibold"
            style={{
              background: 'linear-gradient(135deg, var(--primary), var(--gold))',
              color: 'var(--on-primary)',
            }}
          >
            Save
          </button>
        </Section>

        <Section title="Appearance">
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.15em] text-muted">Mode</div>
          <div className="flex gap-2">
            {(
              [
                ['light', '☀ Light'],
                ['dark', '☾ Dark'],
                ['system', '◐ System'],
              ] as [Mode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={activeMode === value}
                className="flex-1 skin-control border px-3 py-2.5 text-[13px] font-semibold"
                style={
                  activeMode === value
                    ? {
                        background: 'var(--accent-fill)',
                        color: 'var(--on-primary)',
                        borderColor: 'transparent',
                      }
                    : {
                        background: 'var(--field)',
                        color: 'var(--ink)',
                        borderColor: 'var(--line)',
                      }
                }
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mb-1.5 mt-4 text-[11px] uppercase tracking-[0.15em] text-muted">Skin</div>
          <p className="mb-2 text-[12.5px] text-muted">
            A skin restyles the whole app — palette, type, and ambiance. Light/dark is separate.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SKIN_LIST.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSkin(s.id)}
                aria-pressed={activeSkin === s.id}
                className="skin-tile border p-3 text-left"
                style={
                  activeSkin === s.id
                    ? { background: 'var(--field)', borderColor: 'var(--primary)' }
                    : { background: 'var(--field)', borderColor: 'var(--line)' }
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="text-[14px] font-semibold text-ink"
                    style={{ fontFamily: s.displayFont }}
                  >
                    {s.label}
                  </span>
                  {activeSkin === s.id && (
                    // Inline --accent-ink, matching SkinGalleryRoute's badge: --primary as text on
                    // the --field surface measured 1.98:1 in hearth/dark (a11y sweep, 2026-08-10).
                    // No text-accent-ink Tailwind mapping exists, and a two-site fix doesn't earn
                    // one — inline style, same as the gallery.
                    <span
                      className="text-[11px] font-semibold"
                      style={{ color: 'var(--accent-ink)' }}
                    >
                      active
                    </span>
                  )}
                </div>
                <div className="text-[11.5px] text-muted">{s.genre}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted">
            Browse and preview them in the{' '}
            {/* accent-ink, not primary: this link sits on the --card surface, where hearth/dark's
                --primary measures 2.24:1 (a11y sweep, 2026-08-10). Same inline treatment as the
                "active" badge above. */}
            <Link to="/skins" className="underline" style={{ color: 'var(--accent-ink)' }}>
              Skin Gallery
            </Link>
            .
          </p>

          <label className="mt-4 flex items-start gap-2.5 text-[13px] text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={profile?.hideIntensity ?? false}
              onChange={(e) => updateProfile.mutate({ hideIntensity: e.target.checked })}
            />
            <span>
              Hide {labels.intensity.toLowerCase()} {labels.intensityGlyph}
              <span className="block text-[12px] text-muted">
                Removes it everywhere — the mark on covers and book pages, the filter, the sort, and
                the stats card. Nothing is deleted: levels you have already set are kept, and
                turning this off brings them all back.
              </span>
            </span>
          </label>
        </Section>

        <Section title="Arrange Reverie">
          <ArrangementEditor />
        </Section>

        <Section title="Library tools">
          <div className="flex flex-wrap gap-2">
            <Link
              to="/covers"
              search={{ state: 'attention', q: '', page: 0, book: undefined }}
              className="skin-control skin-btn-secondary inline-flex min-h-11 items-center px-4 text-[13px] font-semibold"
            >
              Care for your covers
            </Link>
            {isCorpusAdmin && <CatalogReviewNav />}
            <button
              type="button"
              onClick={() => setShowDupes((v) => !v)}
              className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink"
              style={{ background: 'var(--field)' }}
            >
              🔗 Merge duplicates{dupes.length ? ` (${dupes.length})` : ''}
            </button>
            {completing ? (
              <button
                type="button"
                onClick={() => (stopRef.current = true)}
                className="skin-control inline-flex items-center gap-2 border border-line px-4 py-2 text-[13px] font-semibold text-ink"
                style={{ background: 'var(--field)' }}
              >
                <UtilityGlyph name="stop" />
                <span>
                  Stop ({sweepCountText(progress)}){tracing ? ' · tracing' : ''}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void runComplete()}
                disabled={!eligibleCount}
                className="skin-control inline-flex items-center gap-2 border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:border-dashed"
                style={{ background: 'var(--field)' }}
              >
                ✨ Complete missing covers &amp; info
                {eligibleCount !== null && eligibleCount > 0 ? ` (${eligibleCount})` : ''}
              </button>
            )}
            {!completing && restingCount > 0 && (
              <p className="w-full text-[12px] text-muted">
                {restingCount} incomplete book{restingCount === 1 ? '' : 's'} checked recently —
                eligible again after the recheck window (3 days, 30 once cover and series are in).
              </p>
            )}
            {isCorpusAdmin && (
              <CorpusCompleteControl
                completing={corpusCompleting}
                progress={corpusProgress}
                eligibleCount={corpusEligibleCount}
                status={corpusStatus}
                onRun={() => void runCorpusComplete()}
                onStop={() => void stopCorpusComplete()}
              />
            )}
            {isCorpusAdmin && !corpusCompleting && (
              <p className="w-full text-[12px] text-muted">
                Admin tool · fills objective gaps for personal, household-only, and corpus-only
                books, and checks shared series information once for the whole corpus. Uncertain
                series matches go to Review; a catalog miss never becomes a standalone claim.
              </p>
            )}
            {!completing && (
              <button
                type="button"
                onClick={() =>
                  void runComplete({
                    trace: true,
                    limit: 10,
                    unvisitedFirst: true,
                    refresh: true,
                  })
                }
                disabled={!eligibleCount}
                title="Runs the sweep over 10 never-checked books, bypassing the shared enrichment cache so the sources are actually queried, and records per-stage timings to sweep_traces. Deliberately a worst case, not an average."
                className="skin-control inline-flex items-center gap-2 border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:border-dashed"
                style={{ background: 'var(--field)' }}
              >
                <UtilityGlyph name="timer" />
                <span>Trace 10 books</span>
              </button>
            )}
            {sharpening ? (
              <button
                type="button"
                onClick={() => (sharpStopRef.current = true)}
                className="skin-control inline-flex items-center gap-2 border border-line px-4 py-2 text-[13px] font-semibold text-ink"
                style={{ background: 'var(--field)' }}
              >
                <UtilityGlyph name="stop" />
                <span>Stop ({sweepCountText(sharpProgress)})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void runResharpen()}
                disabled={!sharpenableCount}
                className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:border-dashed"
                style={{ background: 'var(--field)' }}
              >
                🔍 Sharpen covers{sharpenableCount ? ` (${sharpenableCount})` : ''}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSweep((v) => !v)}
              disabled={!titleCleanups.length}
              className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:border-dashed"
              style={{ background: 'var(--field)' }}
            >
              🧹 Clean up legacy titles{titleCleanups.length ? ` (${titleCleanups.length})` : ''}
            </button>
          </div>
          {completing && progress && (
            <p className="mt-2 text-[12.5px] text-muted">
              Completing details… {sweepCountText(progress)} · filled {progress.filled}. Sources are
              throttled, so this takes a while; you can keep using the app.
            </p>
          )}
          {sharpening && sharpProgress && (
            <p className="mt-2 text-[12.5px] text-muted">
              Sharpening covers… {sweepCountText(sharpProgress)} · {sharpProgress.sharpened}{' '}
              re-fetched at full resolution. Throttled; you can keep using the app.
            </p>
          )}
          {showDupes && (
            <div className="mt-3 flex flex-col gap-2">
              {dupes.length > 1 && (
                <button
                  type="button"
                  onClick={() => void mergeAllGroups()}
                  disabled={performMerge.isPending}
                  className="self-start skin-control px-4 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:border-dashed"
                  style={{
                    background: 'linear-gradient(135deg, var(--primary), var(--gold))',
                    color: 'var(--on-primary)',
                  }}
                >
                  Merge all {dupes.length} groups
                </button>
              )}
              {dupes.length ? (
                dupes.map((g, i) => (
                  <Surface
                    key={i}
                    radius="card"
                    tone="field"
                    pad={2}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-[14px] font-semibold text-ink">
                      {g[0]?.title}{' '}
                      <span className="text-[12px] font-normal text-muted">
                        · {g.length} copies
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void mergeGroup(g)}
                      disabled={performMerge.isPending}
                      className="skin-control px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:border-dashed"
                      style={{ background: 'var(--accent-fill)', color: 'var(--on-primary)' }}
                    >
                      Merge these {g.length}
                    </button>
                  </Surface>
                ))
              ) : (
                <p className="text-[13px] text-muted">
                  No likely duplicates found ✨ — your library’s clean.
                </p>
              )}
            </div>
          )}
          {showSweep && (
            <div className="mt-3">
              <p className="mb-2 text-[13px] text-muted">
                {titleCleanups.length} title{titleCleanups.length === 1 ? '' : 's'} still carry
                series junk. Review below — the series and position fill in only where a book has
                none, and nothing is renamed until you apply.
              </p>
              <ul className="mb-3 flex max-h-[40dvh] flex-col gap-1.5 overflow-y-auto">
                {titleCleanups.slice(0, 100).map((c) => (
                  <Surface
                    as="li"
                    key={c.id}
                    radius="card"
                    tone="field"
                    pad={0}
                    className="p-2.5 text-[13px]"
                  >
                    <div className="text-muted line-through">{c.oldTitle}</div>
                    <div className="font-semibold text-ink">{c.newTitle}</div>
                    {c.fillsSeries && (
                      <div className="text-[12px]" style={{ color: 'var(--accent-ink)' }}>
                        + series: {c.series}
                        {c.position !== '' ? ` #${c.position}` : ''}
                      </div>
                    )}
                  </Surface>
                ))}
              </ul>
              {titleCleanups.length > 100 && (
                <p className="mb-2 text-[12px] text-muted">
                  …and {titleCleanups.length - 100} more will be cleaned too.
                </p>
              )}
              <button
                type="button"
                onClick={() => void applySweep()}
                disabled={sweeping}
                className="skin-control px-4 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:border-dashed"
                style={{
                  background: 'linear-gradient(135deg, var(--primary), var(--gold))',
                  color: 'var(--on-primary)',
                }}
              >
                {sweeping && sweepProgress
                  ? `Cleaning… ${sweepProgress.done}/${sweepProgress.total}`
                  : `Clean ${titleCleanups.length} title${titleCleanups.length === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </Section>

        <Section title="Backup & import">
          <AddDestinationPicker
            value={importDestination}
            onChange={(next) => {
              importDestinationChosen.current = true
              setImportDestination(next)
            }}
            members={household.authorized ? household.members : []}
            currentReaderId={session?.user.id ?? ''}
            importOnly
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void exportBackup()}
              className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink"
              style={{ background: 'var(--field)' }}
            >
              ⬇ Export library (JSON)
            </button>
            <button
              type="button"
              /* A state-independent handle, for the reason spelled out on the import button below:
               * the label flips while the export runs, so a test that finds this by its text is
               * waiting for the label rather than asserting the control. */
              data-testid="export-library-csv"
              onClick={() => void exportLibraryCsv()}
              disabled={csvBusy}
              className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:border-dashed"
              style={{ background: 'var(--field)' }}
            >
              {csvBusy ? 'Exporting…' : '⬇ Export for spreadsheet (CSV)'}
            </button>
            <RestoreBackupControl
              currentBookCount={libraryLoaded ? all.length : null}
              onRestored={(result) => {
                void qc.invalidateQueries()
                setStatus(
                  `Restored ${counted(result.books, 'book')}, ${counted(result.lists, 'shelf')}, ${counted(result.reads, 'reading record')}, ${counted(result.tropes, 'trope')}, ${counted(result.moods, 'mood')}, ${counted(result.follows, 'author choice')}, ${counted(result.tombstones, 'removed series slot')}, and ${counted(result.dismissals, 'dismissed suggestion')}.`,
                )
              }}
            />
            <button
              type="button"
              /*
               * A STATE-INDEPENDENT HANDLE. The visible label changes with the loading state, so a
               * test that locates this button by its text is really waiting for the label to flip —
               * it passes with the guard deleted, which is exactly what mutation testing caught.
               */
              data-testid="import-library"
              onClick={() => csvRef.current?.click()}
              /*
               * THE GUARD IS HERE, ON THE BUTTON, AND ONLY HERE. Disabling the hidden <input> too
               * was tried and removed: a disabled file input still accepts a programmatic
               * `setInputFiles`, so it stopped nothing and would have been decoration with a
               * passing test on top of it. The button is the only way a person reaches the file
               * dialog, so it is the real control.
               */
              disabled={!libraryLoaded}
              className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:border-dashed"
              style={{ background: 'var(--field)' }}
            >
              {libraryLoaded ? IMPORT_LABEL : IMPORT_LOADING_LABEL}
            </button>
            <input
              ref={csvRef}
              type="file"
              accept=".csv,.xlsx,text/csv"
              hidden
              onChange={(e) =>
                readFile(e.currentTarget, async (text) => {
                  const r = await importDetectedExport(all, text, {
                    autoMerge,
                    addToHousehold: importDestination === 'both',
                  })
                  setReview(r.review)
                  setImportResult(r)
                  // Stash the per-book outcomes so the Import review screen can build its read-model.
                  qc.setQueryData(importSessionKey, { outcomes: r.outcomes })
                  setImported(true)
                  setStatus(null) // the summary panel below now speaks for the import
                  // Cover handoff: backfill missing covers for the imported books in the background (§3).
                  void enrichImported(qc, r.bookIds)
                })
              }
            />
          </div>

          <label className="mt-3 flex items-start gap-2.5 text-[13px] text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={autoMerge}
              onChange={(e) => updateProfile.mutate({ autoMergeDuplicates: e.target.checked })}
            />
            <span>
              Auto-merge exact duplicates on import
              <span className="block text-[12px] text-muted">
                Folds ISBN / title + author matches in silently. Off sends every match to the review
                queue. Similar-but-not-exact matches always go to review.
              </span>
            </span>
          </label>

          <p className="mt-3 text-[12.5px] text-muted">
            Import a CSV or Excel export — Goodreads / StoryGraph, or a full library export (genres,
            tags, series, contributors, read status). The shape is detected automatically; matches
            fold into existing books, so re-importing is safe. Starting from scratch?{' '}
            <a
              href="/Reverie_Import_Template.xlsx"
              download
              className="font-semibold underline decoration-dotted underline-offset-2"
              style={{ color: 'var(--accent-ink)' }}
            >
              Download the Excel template
            </a>{' '}
            and fill it in.
          </p>

          {importResult && (
            <div className="mt-4 border-t border-line pt-4">
              <ImportSummary result={importResult} />
            </div>
          )}

          {imported && (
            <Link
              to="/review"
              className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 skin-control px-4 text-[14px] font-semibold"
              style={{ background: 'var(--accent-fill)', color: 'var(--on-primary)' }}
            >
              Review import →
            </Link>
          )}

          {review.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="mb-2 text-[14px] font-semibold text-ink">
                Review possible duplicates ({review.length})
              </h3>
              <p className="mb-3 text-[12.5px] text-muted">
                Your entry is always the one that’s kept — merging only folds in any new details.
              </p>
              <DuplicateReview candidates={review} onDone={() => setReview([])} />
            </div>
          )}
          <p className="mt-3 text-[12px] text-muted">
            The JSON export is a complete copy — books, contributors, tropes, moods, reads, shelves,
            reviews, reading orders, merge decisions, followed authors, and your appearance + taste
            profile. It also keeps your refusals: series slots you removed stay removed, and trope
            suggestions you dismissed stay dismissed. Everything deleting your account would erase,
            this hands back.
          </p>
        </Section>

        <Section title="Your data & privacy">
          <p className="mb-2 text-[13px] text-muted">What this app stores in your account:</p>
          <ul className="flex flex-col gap-1.5 text-[12.5px] text-muted">
            {[
              [
                'Your library',
                'books and the details you add — series, tropes/tags, intensity, genre, owned formats, covers, ISBNs.',
              ],
              [
                'Reading activity',
                'ratings, read status, reread log with dates, and reading goals.',
              ],
              [
                'Authorship',
                'contributors (authors, co-authors, translators…) you record on a book.',
              ],
              ['Shelves & orders', 'your TBR/collections and custom reading orders.'],
              [
                'Reviews & clubs',
                'reviews you write and club memberships, progress, and comments (only where you opt in).',
              ],
              [
                'Taste profile',
                'an adaptive-skin signal derived from your library to theme the app — kept private in your profile.',
              ],
              [
                'Account',
                'your email (for sign-in) and display name. No third-party trackers run in the app.',
              ],
            ].map(([k, v]) => (
              <li key={k}>
                <span className="font-semibold text-ink">{k}:</span> {v}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-muted">
            Book metadata is fetched from reviewed sources (Open Library and Hardcover) through our
            server and cached globally by work — never tied to you. Export or delete everything
            below.
          </p>
        </Section>

        <Section title="Delete account">
          <p className="text-[13px] text-muted">
            Permanently delete your account and <b>all</b> of your data — library, reads, shelves,
            reviews, reading orders, and profile. This cannot be undone. Consider exporting a backup
            first.
          </p>
          <label className="mt-3 block">
            <span className="mb-1 block text-[12px] text-muted">
              Type <span className="font-semibold text-ink">{confirmText}</span> to confirm
            </span>
            <input
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder={confirmText}
              aria-label={`Type "${confirmText}" to confirm account deletion`}
              className={fieldClass}
              style={fieldStyle}
            />
          </label>
          <button
            type="button"
            onClick={() => void runDelete()}
            disabled={deleting || deleteText.trim().toLowerCase() !== confirmText}
            className="mt-3 h-10 skin-control border px-5 text-[14px] font-semibold disabled:opacity-40"
            style={{
              background: 'var(--field)',
              borderColor: 'var(--primary)',
              color: 'var(--primary)',
            }}
          >
            {deleting ? 'Deleting…' : 'Delete my account permanently'}
          </button>
        </Section>

        {status && <p className="text-center text-[13px] text-primary">{status}</p>}

        {/* Build stamp — which deploy this client is running (the update toast handles new ones). */}
        <p
          className="mt-6 text-center text-[11.5px]"
          style={{ color: 'var(--faint, var(--muted))' }}
        >
          {APP_NAME} · build {BUILD_LABEL}
        </p>
      </div>
    </section>
  )
}

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  component: SettingsScreen,
})
