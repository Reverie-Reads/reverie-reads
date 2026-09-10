import { useState, type ReactNode } from 'react'
import {
  authorOf,
  bookGenres,
  bookSubgenres,
  CORE_GENRES,
  normalizeBookGenres,
  fromFirstLast,
  applyBookMergePicks,
  bookMergeOptions,
  type MergeFieldPicks,
  parseNumericFields,
  possessionPatch,
  possessionState,
  PUB_DAY,
  PUB_MONTH,
  PAGE_COUNT,
  PUB_YEAR,
  SERIES_COUNT,
  SERIES_POSITION,
  SERIES_STATUS_LABELS,
  SERIES_STATUS_VALUES,
  type Book,
  type Contributor,
  type SeriesStatus,
} from '@reverie/core'
import { Modal } from '../components/Modal'
import { Chip } from '../components/Chip'
import { Stars } from '../components/Stars'
import {
  FORMATS,
  otherGenreSubgenres,
  OWNERSHIP_LABELS,
  READ_STATUS_OPTIONS,
  readStatusLabel,
  subgenresForGenre,
} from '../library/constants'
import { useBooks, useUpdateBook } from '../data/books'
import { useSetContributors } from '../data/contributors'
import { useSyncBookSeries } from '../data/series'
import { useAddRead } from '../data/reads'
import { usePerformMerge } from '../data/mergeBooks'
import { maybeChainPrompt } from '../lib/chainPrompt'
import { ContributorEditor } from './ContributorEditor'
import { OwnedCopies } from './OwnedCopies'
import { MoodPicker } from '../components/MoodPicker'
import { useLabels } from '../skin/labels'
import { readableWriteError } from '../lib/writeErrors'
import { todayLocalDate } from '../lib/localDate'
import { Surface } from '../components/Surface'
import { LevelPicker } from '../components/LevelPicker'

/** Distinct contributor names across the library, for autocomplete. */
function useAuthorSuggestions(): string[] {
  const { data: books } = useBooks()
  const names = new Set<string>()
  for (const b of books ?? []) for (const c of b.contributors) if (c.name) names.add(c.name)
  return [...names].sort((a, b) => a.localeCompare(b))
}

const fieldClass =
  'h-10 w-full skin-field border border-line px-3 text-[14px] text-ink outline-none'
const fieldStyle = { background: 'var(--field)' } as const

function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-muted">{label}</span>
      {children}
      {/* Named right under the field that's wrong, so a rejected value is obvious and local. */}
      {error && (
        <span className="mt-1 block text-[11.5px]" style={{ color: 'var(--accent-ink)' }}>
          {error}
        </span>
      )}
    </label>
  )
}

export function LogReadForm({
  book,
  onClose,
  mode = 'finish',
}: {
  book: Book
  onClose: () => void
  mode?: 'finish' | 'past'
}) {
  const addRead = useAddRead(book.id)
  const { data: books } = useBooks()
  const updateBook = useUpdateBook(book.id)
  // Local, not UTC — see localDate.ts. West of UTC in the evening, toISOString() already reports
  // tomorrow, and this default is what a reread finished tonight silently landed on.
  const [date, setDate] = useState(() => todayLocalDate())
  const [format, setFormat] = useState(book.format)
  const [rating, setRating] = useState(0)
  const [notes, setNotes] = useState('')
  const [savedRead, setSavedRead] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  async function save() {
    if (saving) return
    setSaving(true)
    setSaveError('')
    let readSaved = savedRead
    try {
      // The completion and its rating belong to this read. A status retry must not append it twice.
      if (!readSaved) {
        await addRead.mutateAsync({ date, format, rating, notes: notes.trim() })
        readSaved = true
        setSavedRead(true)
      }
      if (mode === 'finish') {
        await updateBook.mutateAsync({ id: book.id, patch: { readStatus: 'Read', progress: 100 } })
      }
      onClose()
      if (mode === 'finish') void maybeChainPrompt(book, books ?? [])
    } catch {
      setSaveError(
        readSaved
          ? 'Your read is saved, but the current reading status could not be updated. Try again to finish that update.'
          : 'The read could not be saved. Your entries are still here; please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={mode === 'past' ? 'Log a past read' : 'Finish this read'}
      onClose={() => {
        if (!saving) onClose()
      }}
    >
      <p className="-mt-2 mb-4 text-[13px] text-muted">
        {mode === 'past'
          ? `Record an earlier read of ${book.title}. Your current reading status and progress stay as they are.`
          : `${book.title} — save this finish to your reading journal.`}
      </p>
      <div className="flex flex-col gap-3">
        <fieldset disabled={saving || savedRead} className="flex min-w-0 flex-col gap-3">
          <Field label="Date finished">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={fieldClass}
              style={fieldStyle}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Format">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className={fieldClass}
                style={fieldStyle}
              >
                <option value="">Not recorded</option>
                {FORMATS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Field>
            <Field label="Rating">
              <div className="flex h-10 items-center">
                <Stars value={rating} step={0.5} onChange={setRating} />
              </div>
            </Field>
          </div>
          <Field label="Your thoughts on this read">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="How was this time through? Optional."
              className="skin-field w-full border border-line p-3 text-[14px] text-ink outline-none"
              style={fieldStyle}
            />
          </Field>
        </fieldset>
        {saveError && (
          <p role="alert" className="text-[14px] text-ink">
            {saveError}
          </p>
        )}
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="mt-1 h-11 skin-control skin-btn-primary text-[14px] font-semibold"
        >
          {saving
            ? 'Saving…'
            : savedRead
              ? 'Retry status update'
              : mode === 'finish'
                ? 'Save finished read'
                : 'Save to read log'}
        </button>
      </div>
    </Modal>
  )
}

export function EditDetails({
  book,
  onClose,
  onChangeCover,
}: {
  book: Book
  onClose: () => void
  /** modest "change cover" affordance — swaps this dialog for the cover sheet */
  onChangeCover?: () => void
}) {
  // Carries OwnedCopies too, whose format toggles each write the whole `owned` object.
  const updateBook = useUpdateBook(book.id)
  const labels = useLabels()
  const setContributors = useSetContributors()
  const syncBookSeries = useSyncBookSeries()
  const suggestions = useAuthorSuggestions()
  const [contribs, setContribs] = useState<Contributor[]>(
    book.contributors.length ? book.contributors : fromFirstLast(book.first, book.last),
  )
  const [f, setF] = useState({
    title: book.title,
    isbn: book.isbn,
    series: book.series,
    position: book.position === '' ? '' : String(book.position),
    seriesCount: book.seriesCount == null ? '' : String(book.seriesCount),
    pages: book.pages == null ? '' : String(book.pages),
    status: book.status as string,
    genre: book.genre,
    format: book.format,
    pubY: book.pub.y == null ? '' : String(book.pub.y),
    pubM: book.pub.m == null ? '' : String(book.pub.m),
    pubD: book.pub.d == null ? '' : String(book.pub.d),
  })
  // Subgenres are a multi-pick; the first selection leads (it colors the gradient). Picks made
  // under one genre survive a genre switch — nothing is silently dropped.
  const [subs, setSubs] = useState<string[]>(() => bookSubgenres(book))
  // Genres are a multi-pick too, same "first pick leads" convention as subs: the <select> above
  // stays the PRIMARY genre (it alone drives the gradient + subgenre vocabulary, unchanged);
  // extraGenres are additional tags a book can also carry (the romantasy shape import already
  // produces via normalizeImportGenres — this is what lets a hand-edited book match that, and
  // what lets the reader add a second tag to any book, not just imported ones).
  const [extraGenres, setExtraGenres] = useState<string[]>(() =>
    bookGenres(book).filter((g) => g !== book.genre),
  )
  const toggleGenre = (g: string) =>
    setExtraGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))
  // Spice was settable in Add and NOWHERE else — a book's intensity could not be changed after
  // creation except by CSV import. Same control as Add, so the gesture is the one readers know.
  const [intensity, setIntensity] = useState<number>(book.intensity ?? 0)
  const [darkness, setDarkness] = useState<number>(book.darkness ?? 0)
  const toggleSub = (s: string) =>
    setSubs((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  const subVocab = subgenresForGenre(f.genre)
  const subOptions = [...subs.filter((s) => !subVocab.includes(s)), ...subVocab]
  // Cross-genre subgenres are a real shape — a horror-romance is not a taxonomy error. Storage
  // always allowed it (flat text[]); only the picker's vocabulary didn't. Disclosed rather than
  // shown by default, so the genre's own shelf stays the obvious first answer.
  const [showOtherSubs, setShowOtherSubs] = useState(false)
  const otherSubs = otherGenreSubgenres(f.genre).filter((x) => !subOptions.includes(x))
  const set = (k: keyof typeof f, v: string) => {
    setF((prev) => ({ ...prev, [k]: v }))
    setFieldErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev)) // typing clears its own error
  }
  const oldSeries = book.series.trim()
  const leavingSeries = !!oldSeries && f.series.trim() !== oldSeries
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof typeof f, string | undefined>>
  >({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  /** All five numeric fields through the ONE parser, with the bounds the columns actually enforce. */
  const readNumbers = () =>
    parseNumericFields({
      position: { raw: f.position, spec: SERIES_POSITION },
      seriesCount: { raw: f.seriesCount, spec: SERIES_COUNT },
      pages: { raw: f.pages, spec: PAGE_COUNT },
      pubY: { raw: f.pubY, spec: PUB_YEAR },
      pubM: { raw: f.pubM, spec: PUB_MONTH },
      pubD: { raw: f.pubD, spec: PUB_DAY },
    })

  /**
   * Save, as ONE sequenced operation that either lands or reports where it stopped.
   *
   * Three independent writes used to be fired off side by side and the dialog closed immediately.
   * If the book patch was rejected — an out-of-range month was enough — the contributors RPC still
   * succeeded, leaving the byline changed and every other field reverted, with nothing said. So:
   * validate first (the rejection above is now impossible), then run the writes in order, stopping
   * at the first failure, and keep the dialog open so the reader can see and fix it.
   *
   * Order between the book write and the series sync is no longer forced by correctness — each
   * touches a disjoint column set now (`sync_book_series` reads the OLD series off the row itself,
   * not from anything `updateBook` wrote), so a failure between them leaves the series side
   * untouched and consistent: a reported non-save, not the half-committed state the old two-write
   * sequence could produce. Kept sequential anyway, by convention, adjacent to the write it's
   * conceptually paired with.
   */
  async function save() {
    if (!f.genre || saving) return
    const parsed = readNumbers()
    // A blank title is REFUSED, not quietly reverted to the old one. Silently substituting a value
    // the reader didn't type is the same invisible write #78 exists to eliminate: the dialog would
    // close, the save would look successful, and the edit would simply not have happened.
    const errors: Partial<Record<keyof typeof f, string>> = parsed.ok ? {} : { ...parsed.errors }
    if (!f.title.trim()) errors.title = 'A book needs a title.'
    if (Object.keys(errors).length) {
      setFieldErrors(errors)
      setSaveError('Some values need fixing before this can save.')
      setConfirmingLeave(false)
      return
    }
    const {
      position: pos,
      seriesCount,
      pages,
      pubY,
      pubM,
      pubD,
    } = (parsed as Extract<typeof parsed, { ok: true }>).values

    setSaving(true)
    setSaveError(null)
    // `action` names the step, so a failure at any point says which one didn't save.
    try {
      await updateBook.mutateAsync({
        id: book.id,
        patch: {
          // Title and ISBN were write-once through the UI, which compounds badly with adopting a
          // wrong search hit — the record was uncorrectable from the app afterwards.
          title: f.title.trim(),
          isbn: f.isbn.trim(),
          intensity,
          darkness,
          // series, position and seriesCount are DELIBERATELY ABSENT from this patch. All three are
          // series-level facts (books.series itself, plus its synced copies
          // series_entries.position and series.length), and sync_book_series below owns all three
          // atomically. Sending any of them here too would make the book patch a second writer
          // racing the RPC in the same save — exactly the shape sync_book_series exists to close.
          pages,
          status: f.status as SeriesStatus,
          genre: f.genre,
          genres: normalizeBookGenres([f.genre, ...extraGenres]),
          subgenres: subs,
          subgenre: subs[0] ?? '',
          format: f.format,
          pub: { y: pubY, m: pubM, d: pubD },
        },
      })
      // Kept adjacent to the book write for readability, not because either depends on the other
      // — see the save() docstring above.
      await syncBookSeries.mutateAsync({
        book,
        newSeries: f.series,
        newPosition: pos,
        newSeriesCount: seriesCount,
      })
      // Contributors last: the most independent write, through its own RPC (it also refreshes the
      // primary first/last + byline).
      await setContributors.mutateAsync({ bookId: book.id, contributors: contribs })
      onClose()
    } catch (err) {
      // The global MutationCache handler already surfaced the toast; this names the state INSIDE the
      // dialog and — crucially — leaves it OPEN, so nothing is silently half-applied behind a
      // dismissed sheet. Steps before the failure did land; the reader sees the form still showing
      // what they typed and can retry.
      setSaveError(readableWriteError(err))
      setSaving(false)
    }
  }

  return (
    <Modal title="Edit details" onClose={onClose} wide>
      {onChangeCover && (
        <div className="mb-3">
          <button
            type="button"
            onClick={onChangeCover}
            className="text-[12.5px] font-semibold text-primary"
          >
            Change cover…
          </button>
        </div>
      )}
      <div className="mb-3">
        <Field label="Title" error={fieldErrors.title}>
          <input
            value={f.title}
            onChange={(e) => set('title', e.target.value)}
            aria-label="Title"
            aria-invalid={!!fieldErrors.title}
            className={fieldClass}
            style={fieldStyle}
          />
        </Field>
      </div>
      <div className="mb-3">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-muted">
          Contributors
        </span>
        <ContributorEditor value={contribs} onChange={setContribs} suggestions={suggestions} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Series">
          <input
            value={f.series}
            onChange={(e) => set('series', e.target.value)}
            className={fieldClass}
            style={fieldStyle}
          />
        </Field>
        <Field label="Position" error={fieldErrors.position}>
          <input
            value={f.position}
            onChange={(e) => set('position', e.target.value)}
            inputMode="decimal"
            aria-invalid={!!fieldErrors.position}
            className={fieldClass}
            style={fieldStyle}
          />
        </Field>
        <Field label="Series length" error={fieldErrors.seriesCount}>
          <input
            value={f.seriesCount}
            onChange={(e) => set('seriesCount', e.target.value)}
            placeholder="None set"
            inputMode="numeric"
            aria-invalid={!!fieldErrors.seriesCount}
            className={fieldClass}
            style={fieldStyle}
          />
        </Field>
        <Field label="Series status">
          {/* the SERIES' publication status — the reader's own progress lives in reads */}
          <select
            value={f.status}
            onChange={(e) => set('status', e.target.value)}
            className={fieldClass}
            style={fieldStyle}
          >
            {SERIES_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {SERIES_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Genre">
          <select
            value={f.genre}
            onChange={(e) => set('genre', e.target.value)}
            className={fieldClass}
            style={fieldStyle}
          >
            {!f.genre && <option value="">Choose a genre…</option>}
            {f.genre && !CORE_GENRES.some((g) => g.toLowerCase() === f.genre) && (
              <option value={f.genre}>{f.genre}</option>
            )}
            {CORE_GENRES.map((g) => (
              <option key={g} value={g.toLowerCase()}>
                {g}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Format">
          <select
            value={f.format}
            onChange={(e) => set('format', e.target.value)}
            className={fieldClass}
            style={fieldStyle}
          >
            {FORMATS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Pages" error={fieldErrors.pages}>
          <input
            value={f.pages}
            onChange={(e) => set('pages', e.target.value)}
            placeholder="Unknown"
            inputMode="numeric"
            aria-label="Pages"
            aria-invalid={!!fieldErrors.pages}
            className={fieldClass}
            style={fieldStyle}
          />
        </Field>
        <Field label="ISBN">
          <input
            value={f.isbn}
            onChange={(e) => set('isbn', e.target.value)}
            placeholder="None set"
            inputMode="numeric"
            aria-label="ISBN"
            className={fieldClass}
            style={fieldStyle}
          />
        </Field>
      </div>
      {f.genre && (
        <div className="mt-3">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-muted">
            Also tag as
          </span>
          <div className="flex flex-wrap gap-1.5">
            {CORE_GENRES.filter((g) => g.toLowerCase() !== f.genre).map((g) => (
              <Chip
                key={g}
                active={extraGenres.includes(g.toLowerCase())}
                onClick={() => toggleGenre(g.toLowerCase())}
              >
                {g}
              </Chip>
            ))}
          </div>
          {extraGenres.length > 0 && (
            <p className="mt-1.5 text-[11px] text-muted">
              A romantasy-shaped book — tagged under more than one genre's shelf at once.
            </p>
          )}
        </div>
      )}
      <div className="mt-3">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-muted">
          Subgenres
        </span>
        {f.genre ? (
          <div className="flex flex-wrap gap-1.5">
            {subOptions.map((s) => (
              <Chip key={s} active={subs.includes(s)} onClick={() => toggleSub(s)}>
                {s}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted">
            This book hasn’t chosen its genre yet — pick one above and its subgenre shelf appears.
          </p>
        )}
        {f.genre && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowOtherSubs((v) => !v)}
              aria-expanded={showOtherSubs}
              className="text-[12px] font-semibold text-primary"
            >
              {showOtherSubs ? 'Hide other genres’ subgenres' : 'Other genres’ subgenres…'}
            </button>
            {showOtherSubs && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {otherSubs.map((s) => (
                  <Chip key={s} active={subs.includes(s)} onClick={() => toggleSub(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
        {subs.length > 1 && (
          <p className="mt-1.5 text-[11px] text-muted">
            First pick leads — it sets the book’s gradient.
          </p>
        )}
      </div>
      {/* Reader state — ownership, the formats in hand, and read status. These lived ONLY on the book
          page's inline controls, so "edit details" was not actually the place you edit the details
          (the post-#80 matrix). Same components as the book page: OwnedCopies owns ownership AND the
          per-format flags together, and the read-status chips are the same vocabulary. They persist
          IMMEDIATELY, like MoodPicker below — independent of this form's Save, because that is how
          they behave on the book page and a control should not change meaning by moving. */}
      <div className="mt-4">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-muted">
          Your copies
        </span>
        <OwnedCopies
          possession={possessionState(book)}
          owned={book.owned}
          onChange={(owned) => updateBook.mutate({ id: book.id, patch: { owned } })}
          onPossessionChange={(next) =>
            updateBook.mutate({ id: book.id, patch: possessionPatch(next) })
          }
        />
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-muted">
          Reading status
        </span>
        <div className="flex flex-wrap gap-1.5">
          {READ_STATUS_OPTIONS.map((rs) => (
            <Chip
              key={rs}
              active={book.readStatus === rs}
              onClick={() =>
                updateBook.mutate({
                  id: book.id,
                  patch: {
                    readStatus: rs,
                    ...(rs === 'Reading' ? { readingNowHidden: false } : {}),
                  },
                })
              }
            >
              {readStatusLabel(rs)}
            </Chip>
          ))}
        </div>
      </div>

      <LevelPicker
        label={labels.intensity}
        glyph={labels.intensityGlyph}
        levels={labels.intensityLevels}
        value={intensity}
        onChange={setIntensity}
        name="intensity"
      />
      <LevelPicker
        label={labels.darkness}
        glyph={labels.darknessGlyph}
        levels={labels.darknessLevels}
        value={darkness}
        onChange={setDarkness}
        name="darkness"
      />
      {/* Mood — the reader's own impression (how it landed). Reader-assigned, never derived; assigns
          persist immediately (book_moods), independent of this form's Save. */}
      <div className="mt-3">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-muted">Mood</span>
        <p className="mb-1.5 text-[12px] text-muted">
          How did it land on you? Optional, and yours alone.
        </p>
        <MoodPicker book={book} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Field label="Pub year" error={fieldErrors.pubY}>
          <input
            value={f.pubY}
            onChange={(e) => set('pubY', e.target.value)}
            placeholder="2021"
            inputMode="numeric"
            aria-invalid={!!fieldErrors.pubY}
            className={fieldClass}
            style={fieldStyle}
          />
        </Field>
        <Field label="Month" error={fieldErrors.pubM}>
          <input
            value={f.pubM}
            onChange={(e) => set('pubM', e.target.value)}
            placeholder="1–12"
            inputMode="numeric"
            aria-invalid={!!fieldErrors.pubM}
            className={fieldClass}
            style={fieldStyle}
          />
        </Field>
        <Field label="Day" error={fieldErrors.pubD}>
          <input
            value={f.pubD}
            onChange={(e) => set('pubD', e.target.value)}
            placeholder="1–31"
            inputMode="numeric"
            aria-invalid={!!fieldErrors.pubD}
            className={fieldClass}
            style={fieldStyle}
          />
        </Field>
      </div>
      {/* Clearing or renaming the series REMOVES this book's slot from that series' reading order —
          the same removal the series page's ✕ performs. Destructive enough to name before it happens. */}
      {confirmingLeave ? (
        <Surface tone="field" radius="card" pad={2} className="mt-4">
          <p className="text-[13px] text-ink">
            {f.series.trim()
              ? `Moving this book to ${f.series.trim()} removes its slot from ${oldSeries}.`
              : `This removes the book’s slot from ${oldSeries}.`}{' '}
            <span className="text-muted">
              The book stays in your library, and fetching {oldSeries} again won’t bring the slot
              back.
            </span>
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingLeave(false)}
              className="h-11 flex-1 skin-control-quiet border border-line text-[13.5px] font-semibold text-ink"
              style={{
                background: 'var(--card)',
              }}
            >
              Keep it in {oldSeries}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="h-11 flex-1 skin-control text-[14px] font-semibold disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, var(--primary), var(--gold))',
                color: 'var(--on-primary)',
              }}
            >
              {saving ? 'Saving…' : 'Save and remove'}
            </button>
          </div>
        </Surface>
      ) : (
        <button
          type="button"
          onClick={() => (leavingSeries ? setConfirmingLeave(true) : void save())}
          disabled={!f.genre || saving}
          className="mt-4 h-11 w-full skin-control text-[14px] font-semibold disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, var(--primary), var(--gold))',
            color: 'var(--on-primary)',
          }}
        >
          {saving ? 'Saving…' : f.genre ? 'Save details' : 'Pick a genre to save'}
        </button>
      )}
      {/* The dialog stays OPEN on failure — the reader keeps what they typed and can see why. */}
      {saveError && (
        <p role="alert" className="mt-2 text-[12.5px]" style={{ color: 'var(--accent-ink)' }}>
          {saveError}
        </p>
      )}
    </Modal>
  )
}

/** Union two books' inline refs (moods/tropes) by id, preserving order primary-first. */
function unionRefs<T extends { id: string; name: string }>(a: readonly T[], b: readonly T[]): T[] {
  const byId = new Map<string, T>()
  for (const x of [...a, ...b]) if (!byId.has(x.id)) byId.set(x.id, x)
  return [...byId.values()]
}

/** The list of formats a merged copy is marked as owning, for the diff. */
function ownedFormatList(owned: Book['owned']): string[] {
  const out: string[] = []
  if (owned.physical === 'hardcover') out.push('Hardcover')
  else if (owned.physical === 'paperback') out.push('Paperback')
  else if (owned.physical === true) out.push('Physical')
  if (owned.ebook) out.push('eBook')
  if (owned.audiobook) out.push('Audiobook')
  return out
}

function DiffRow({
  label,
  children,
  changed,
}: {
  label: string
  children: ReactNode
  changed?: boolean
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-24 flex-none text-[11px] uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      <span className="flex-1 text-[13px] text-ink">{children}</span>
      {changed && (
        <span
          className="flex-none text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--accent-ink)' }}
        >
          updated
        </span>
      )}
    </div>
  )
}

/**
 * The pre-merge diff (docs/archive/task-manual-merge.md §2). Merging is destructive and there is no undo, so
 * the reader sees the exact outcome first: which record survives, the four-state ownership union, the
 * format flags, and every mood/trope + read that carries over. The union comes from the SAME core
 * merge engine the RPC applies — no second merge path.
 */
function MergePreview({
  primary,
  loser,
  pending,
  onBack,
  onConfirm,
  onClose,
}: {
  primary: Book
  loser: Book
  pending: boolean
  onBack: () => void
  onConfirm: (picks: MergeFieldPicks) => void
  onClose: () => void
}) {
  /*
   * Per-field picks over the engine's defaults — same model as DuplicateReview's picker: absent
   * key = the engine's answer, so an untouched dialog confirms exactly what it confirmed before
   * the picker existed. The preview below renders the PICK-AWARE merge, so flipping a field
   * updates the rows a reader is already looking at rather than a separate summary.
   */
  const [picks, setPicks] = useState<Record<string, boolean>>({})
  const options = bookMergeOptions(primary, loser)
  const merged = applyBookMergePicks(primary, loser, picks)
  const moods = unionRefs(primary.moods, loser.moods)
  const tropes = unionRefs(primary.tropes, loser.tropes)
  const formats = ownedFormatList(merged.owned)
  // Compare the WORD, not the column: a merge that turns "wishlist" into "owned" changes two flags
  // and the reader needs to see that as one possession change, in the vocabulary the control uses.
  const mergedPossession = possessionState(merged)
  const primaryPossession = possessionState(primary)
  const ownershipChanged = mergedPossession !== primaryPossession
  const titleDropped = loser.title.trim() !== primary.title.trim()

  return (
    <Modal title="Review the merge" onClose={onClose}>
      <p className="-mt-2 mb-3 text-[13px] text-muted">
        <span className="font-semibold text-ink">{loser.title}</span> folds into{' '}
        <span className="font-semibold text-ink">{primary.title}</span>, then it’s removed. This
        can’t be undone — check what survives.
      </p>

      <Surface tone="field" radius="card" pad={2}>
        <DiffRow label="Survivor">
          <span className="font-semibold">{merged.title}</span>
          <span className="block text-[12px] text-muted">
            {authorOf(merged) || authorOf(primary) || 'Unknown author'}
          </span>
        </DiffRow>
        <DiffRow label="Ownership" changed={ownershipChanged}>
          {OWNERSHIP_LABELS[mergedPossession]}
          {ownershipChanged && (
            <span className="text-[12px] text-muted">
              {' '}
              — was {OWNERSHIP_LABELS[primaryPossession]}, took the stronger
            </span>
          )}
        </DiffRow>
        <DiffRow label="Formats">
          {formats.length ? formats.join(' · ') : <span className="text-muted">none marked</span>}
        </DiffRow>
        <DiffRow label="Series">
          {merged.series ? (
            `${merged.series}${merged.position !== '' ? ` #${merged.position}` : ''}`
          ) : (
            <span className="text-muted">none</span>
          )}
        </DiffRow>
        <DiffRow label="Cover">
          {merged.cover ? (
            merged.cover === primary.cover ? (
              'kept this one’s'
            ) : (
              'taken from the other'
            )
          ) : (
            <span className="text-muted">none</span>
          )}
        </DiffRow>
        <DiffRow label="Rating">
          {merged.rating ? `${merged.rating}★` : <span className="text-muted">unrated</span>}
        </DiffRow>
        <DiffRow label="Reads">
          {merged.reads.length ? (
            `${merged.reads.length} kept (from both)`
          ) : (
            <span className="text-muted">none</span>
          )}
        </DiffRow>
        <DiffRow label="Moods">
          {moods.length ? (
            moods.map((m) => m.name).join(', ')
          ) : (
            <span className="text-muted">none</span>
          )}
        </DiffRow>
        <DiffRow label="Tropes">
          {tropes.length ? (
            tropes.map((t) => t.name).join(', ')
          ) : (
            <span className="text-muted">none</span>
          )}
        </DiffRow>
      </Surface>

      {options.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[12.5px] text-muted marker:content-none">
            <span className="underline">Choose fields ({options.length})</span> — the rows above
            update as you pick
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1" data-testid="merge-book-picker">
            {options.map((o) => (
              <li key={o.key}>
                <label className="flex items-start gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={picks[o.key] ?? o.take}
                    onChange={(e) => setPicks((prev) => ({ ...prev, [o.key]: e.target.checked }))}
                  />
                  <span className="min-w-0">
                    <span className="text-ink">{o.label}</span>{' '}
                    {o.kind === 'add' ? (
                      <span className="text-muted">
                        {o.theirs ? `take “${o.theirs}”` : 'take the other book’s'}
                      </span>
                    ) : (
                      <span className="text-muted">
                        {o.mine || o.theirs
                          ? `keep “${o.mine}” — or take “${o.theirs}”`
                          : 'take the other book’s'}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-3 text-[12px] text-muted">
        {titleDropped ? `“${loser.title}” (the other title) is dropped. ` : ''}
        List memberships from both move to the survivor.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="h-11 flex-1 skin-control border border-line text-[13.5px] font-semibold text-ink disabled:opacity-50"
          style={{ background: 'var(--card)' }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => onConfirm(picks)}
          disabled={pending}
          className="h-11 flex-1 skin-control text-[14px] font-semibold disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, var(--primary), var(--gold))',
            color: 'var(--on-primary)',
          }}
        >
          {pending ? 'Merging…' : 'Merge — no undo'}
        </button>
      </div>
    </Modal>
  )
}

export function MergeDialog({
  book,
  allBooks,
  onClose,
}: {
  book: Book
  allBooks: Book[]
  onClose: () => void
}) {
  const merge = usePerformMerge()
  const [q, setQ] = useState('')
  const [loser, setLoser] = useState<Book | null>(null)
  const candidates = allBooks
    .filter((b) => b.id !== book.id)
    .filter((b) => `${b.title} ${authorOf(b)}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 25)

  if (loser)
    return (
      <MergePreview
        primary={book}
        loser={loser}
        pending={merge.isPending}
        onBack={() => setLoser(null)}
        onClose={onClose}
        onConfirm={(picks) => merge.mutate({ primary: book, loser, picks }, { onSuccess: onClose })}
      />
    )

  return (
    <Modal title="Merge into this book" onClose={onClose}>
      <p className="-mt-2 mb-3 text-[13px] text-muted">
        Pick the duplicate to fold into “{book.title}”. You’ll see exactly what survives before
        anything changes — its reads, moods, tropes, rating, cover, and list memberships merge in.
      </p>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your library…"
        aria-label="Search for a book to merge"
        className={fieldClass}
        style={fieldStyle}
      />
      <ul className="mt-3 flex max-h-[50dvh] flex-col gap-1.5 overflow-y-auto">
        {candidates.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => setLoser(b)}
              className="flex w-full items-center justify-between gap-3 skin-control-quiet border border-line px-3 py-2 text-left"
              style={{
                background: 'var(--field)',
              }}
            >
              <span>
                <span className="text-[14px] font-semibold text-ink">{b.title}</span>
                <span className="block text-[12px] text-muted">
                  {authorOf(b) || 'Unknown author'}
                </span>
              </span>
              <span className="text-[12px] font-semibold text-primary">Compare →</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
