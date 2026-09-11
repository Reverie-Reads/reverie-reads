import { useEffect, useRef, useState } from 'react'
import { createRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  contributorsFromAuthors,
  formatAuthors,
  makeSeriesClaim,
  parseNumericField,
  possessionPatch,
  SERIES_POSITION,
  SKINS,
  toFirstLast,
  workKeyOf,
  type Book,
  type Contributor,
  type Incoming,
  type Owned,
  type PossessionState,
  type SeriesClaim,
} from '@reverie/core'
import { useQueryClient } from '@tanstack/react-query'
import { rootRoute } from './RootRoute'
import { useAuth } from '../auth/AuthProvider'
import { useIntake, type ReviewCandidate } from '../data/intake'
import { useBooks } from '../data/books'
import {
  useAddCorpusWorkToHousehold,
  useAddCorpusWorkToMemberLibrary,
  useAddPersonalBooksToHousehold,
  useCreateHouseholdCatalogWork,
  useHouseholdLibraryAuthorization,
} from '../data/household'
import { useWorksLookup, workToHit, type WorkRow } from '../data/works'
import { parseReleasePub } from '../data/releases'
import { useCorpusAdminStatus } from '../data/enrichCorpus'
import { resultIsbn, triageLabel, triageResults, type TriagedResult } from '../lib/addTriage'
import { resolveCandidate, type ReviewAction } from '../data/duplicates'
import { enrichBook, type CoverAlternate } from '../lib/enrich'
import {
  googleBooksResultUrl,
  partitionSearchResults,
  searchEverywhere,
  type SearchResult,
} from '../lib/search'
import { useEffectiveSkin, useLabels, useVoice } from '../skin/labels'
import { Chip } from '../components/Chip'
import { CoverImage } from '../components/CoverImage'
import { CoverSheet } from '../components/CoverSheet'
import { TropePicker } from '../components/TropePicker'
import { ContributorEditor } from '../book/ContributorEditor'
import {
  FORMATS,
  OWNERSHIP_LABELS,
  READ_STATUS_OPTIONS,
  readStatusLabel,
  otherGenreSubgenres,
  subgenreGradient,
  subgenresForGenre,
} from '../library/constants'
import { CORE_GENRES } from '@reverie/core'
import { Surface } from '../components/Surface'
import { LevelPicker } from '../components/LevelPicker'
import { AddDestinationPicker } from '../components/AddDestinationPicker'
import { delegatedMemberId, type AddDestination } from '../components/addDestination'
import { GoogleBooksAttribution, GoogleBooksResultLink } from '../components/GoogleBooksAttribution'

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats: string[] }) => BarcodeDetectorLike
  }
}

interface SearchHit {
  source: 'hardcover' | 'google'
  title: string
  authors: string[]
  cover: string
  isbn: string
  pub: string
  sourceUrl?: string
}

/**
 * What a pick hands the form: the five catalog fields, plus the three a `works` row carries and a
 * catalog result does not. A corpus pick is the better prefill precisely because of those three —
 * prefilling from the search hit instead would throw away the series, position and genre the
 * corpus already knows and make the reader retype them.
 *
 * NOT tags. The corpus's `tags` are lowercased tag tokens and this form has nowhere to put them:
 * tropes are tagged in the refine step against a saved id, and there is no freeform tag field by
 * design. Inventing one here to have somewhere to land them would be a bigger change than the
 * prefill is worth; the tags stay on the corpus row for whoever wires the refine step to it.
 */
interface Picked extends Partial<SearchHit> {
  corpusWorkId?: string
  series?: string
  position?: string
  genre?: string
  seriesClaim?: SeriesClaim
}

/** How many catalog results Add shows. */
const ADD_RESULT_LIMIT = 8

/**
 * Add's catalog lookup — routed through the `search` edge function, NOT the browser.
 *
 * NAMED FOR WHAT IT DOES. This was `searchGoogleBooks` until this change, which was a leftover from
 * before the client-side Google fallback was removed and had become a name that LIES about a
 * privacy-relevant behaviour: the browser does not talk to Google here, `searchEverywhere` does the
 * whole job server-side (Hardcover + Google fill, server-cached, rate-limited). Someone auditing
 * "does the browser talk to Google" greps for exactly that name, and would have been misled by it.
 *
 * Returns `SearchResult`, not Add's five-field `SearchHit`, and that is load-bearing rather than
 * incidental: `series` and `seriesPosition` survive to the triage classifier, which needs them for
 * matchBook's `title-series-pos` leg. Truncating first would disable that leg silently.
 */
async function searchCatalog(q: string): Promise<SearchResult[]> {
  const results = await searchEverywhere(q)
  const sections = partitionSearchResults(results.filter((r) => r.title))
  // Add keeps its concise catalog limit, while every Google result returned by the provider stays
  // visible and in order. Truncating the combined array would silently alter Google's result set.
  return [...sections.catalog.slice(0, ADD_RESULT_LIMIT), ...sections.google]
}

/** A catalog result as the form's prefill — `pub` takes the fn's `year`, and its ISBN-13-preferred
 *  `isbn` is already the field Add wanted. */
const hitOf = (r: SearchResult): SearchHit => ({
  source: r.source,
  title: r.title,
  authors: r.authors,
  cover: r.cover,
  isbn: resultIsbn(r),
  pub: r.year,
  sourceUrl: r.sourceUrl,
})

/** A corpus row as the form's prefill. The five shared fields come from `workToHit` — the SAME
 *  mapper Discover's corpus picks use, so a corpus pick means the same thing on both screens — and
 *  the three corpus-only fields ride alongside. */
const pickedFromWork = (w: WorkRow, result: SearchResult): Picked => ({
  ...workToHit(w, resultIsbn(result)),
  source: result.source,
  sourceUrl: result.sourceUrl,
  series: w.series ?? '',
  ...(w.series
    ? { seriesClaim: makeSeriesClaim('corpus', 'catalog_prefill', { sourceRef: w.id }) }
    : {}),
  position: w.position == null ? '' : String(w.position),
  genre: w.genre ?? '',
})

function parsePub(s: string): Book['pub'] {
  const m = s.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/)
  if (!m) return { y: null, m: null, d: null }
  return { y: +(m[1] ?? 0), m: m[2] ? +m[2] : null, d: m[3] ? +m[3] : null }
}

/**
 * Step two of the add flow — the record now exists, so the SAME cover sheet and trope picker the
 * book screen uses run here against the real book, before the reader leaves. Both components persist
 * immediately and are keyed to a real book id (cover ingest scopes Storage by book; every trope
 * gesture writes book_tropes; suggestions query by id), so they can only bind to a saved book — this
 * refine step is how Add reaches full parity with Edit without a parallel implementation.
 */
function RefineAdded({
  bookId,
  householdWarning,
  onDone,
}: {
  bookId: string
  householdWarning?: string | null
  onDone: () => void
}) {
  const labels = useLabels()
  const { data: books } = useBooks()
  const book = books?.find((b) => b.id === bookId)
  const [dialog, setDialog] = useState<'cover' | 'trope' | null>(null)

  if (!book) {
    return (
      <Surface
        radius="panel"
        tone="card"
        pad={3}
        className="mt-4 text-[13px] text-muted"
        role="status"
      >
        Saving…
      </Surface>
    )
  }

  const [g0, g1] = subgenreGradient(book.subgenre, book.genre)
  const tropeCount = book.tropes.length

  return (
    <Surface radius="panel" tone="card" pad={3} className="mt-4">
      {householdWarning ? (
        <p role="status" className="mb-3 text-[12.5px] text-accent-ink">
          {householdWarning}
        </p>
      ) : null}
      <h2
        className="text-[16px] italic text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
      >
        Added — finish the details
      </h2>
      <p className="mb-3 mt-1 text-[13px] text-muted">
        {book.title} is in your library. Fix the cover or tag its {labels.tags.toLowerCase()} now —
        or leave it and edit later.
      </p>
      <div className="flex gap-4">
        <div
          className="aspect-[2/3] w-20 flex-none overflow-hidden rounded-lg border border-line"
          style={{ background: `linear-gradient(150deg, ${g0}, ${g1})` }}
        >
          <CoverImage book={book} thumb />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <button
            type="button"
            onClick={() => setDialog('cover')}
            className="h-10 skin-control border border-line text-[13.5px] font-semibold text-ink"
            style={{ background: 'var(--field)' }}
          >
            Change cover
          </button>
          <button
            type="button"
            onClick={() => setDialog('trope')}
            className="h-10 skin-control border border-line text-[13.5px] font-semibold text-ink"
            style={{ background: 'var(--field)' }}
          >
            Tag {labels.tags.toLowerCase()}
            {tropeCount ? ` · ${tropeCount}` : ''}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDone}
        className="mt-4 h-11 w-full skin-control text-[14px] font-semibold"
        style={{
          background: 'linear-gradient(135deg, var(--primary), var(--gold))',
          color: 'var(--on-primary)',
        }}
      >
        Done
      </button>
      {dialog === 'cover' && <CoverSheet book={book} onClose={() => setDialog(null)} />}
      {dialog === 'trope' && <TropePicker book={book} onClose={() => setDialog(null)} />}
    </Surface>
  )
}

function AddForm({
  hit,
  defaultUnowned = false,
  addToHousehold = false,
  onAdded,
}: {
  hit: Picked
  defaultUnowned?: boolean
  addToHousehold?: boolean
  onAdded: () => void
}) {
  const intake = useIntake()
  const addPersonalBooksToHousehold = useAddPersonalBooksToHousehold()
  const voice = useVoice()
  // Context-sensitive default: arriving from a wanting context (Discover) assumes wishlist; a plain
  // catalog add leaves possession UNSET rather than forcing "owned" (docs/archive/task-ownership-v2.md).
  // Form-session state only — never persisted as a preference. One exclusive WORD; possessionPatch
  // expands it to the model's flags at submit (docs/archive/task-shelf-model.md).
  const [possession, setPossession] = useState<PossessionState>(
    defaultUnowned ? 'wishlist' : 'unset',
  )
  const qc = useQueryClient()
  const { data: books } = useBooks()
  // genre is a required metadata field, not a romance-only tag — default it to the ROOM the reader
  // is in (add in Grimoire → fantasy, in Marrow → horror), never a hardcoded 'romance'.
  const skinGenre = SKINS[useEffectiveSkin()].genre.toLowerCase()
  const [dup, setDup] = useState<ReviewCandidate | null>(null)
  // Once the record is created we hand off to the refine step (cover + tropes) instead of leaving.
  const [addedId, setAddedId] = useState<string | null>(null)
  const [householdWarning, setHouseholdWarning] = useState<string | null>(null)
  const [contribs, setContribs] = useState<Contributor[]>(
    contributorsFromAuthors(hit.authors ?? []),
  )
  const [form, setForm] = useState({
    title: hit.title ?? '',
    // Prefilled ONLY from a corpus pick — a catalog hit carries none of these three, so for every
    // other entry point they are still '' and the picker still prompts rather than guessing.
    // `seriesEdited` stays false for a corpus prefill, which is correct: the reader did not choose
    // it, so `seriesUserChosen` saves false and a later enrich sweep may still treat it as
    // fill-only. Same for `genreEdited`.
    series: hit.series ?? '',
    position: hit.position ?? '',
    // NOT skinGenre. The skin still decides which genre the picker OPENS to (see `skinGenre`'s uses
    // below) — that convenience is the reason it exists and is kept. What it must not do is get
    // SAVED: an untouched picker meant the active skin's association was stored as though the
    // reader had chosen it. types.ts is explicit — "'' = not chosen yet — the edit form prompts,
    // never guesses" — and this form was guessing.
    genre: hit.genre ?? '',
    format: 'Paperback' as string,
    readStatus: 'unset' as Book['readStatus'],
    // Release cards and the manual horizon form carry flexible precision into Add. Keeping this
    // editable lets the reader correct a catalog date before it becomes their own record.
    pub: hit.pub ?? '',
  })
  // Subgenres are a multi-pick; the first selection leads (drives the cover gradient).
  // Empty, not the skin genre's first subgenre. Pre-selecting one both stored an unchosen value and
  // LIED in the UI — a chip rendered as active that the reader never tapped. The chip VOCABULARY
  // still opens on the skin's genre (`subgenresForGenre(form.genre || skinGenre)` below); only the
  // selection starts empty, so `subs` being non-empty now means exactly "the reader tapped a chip"
  // and needs no separate edited-flag to say so.
  const [subs, setSubs] = useState<string[]>([])
  const toggleSub = (s: string) =>
    setSubs((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  const [intensity, setIntensity] = useState(0)
  const [darkness, setDarkness] = useState(0)
  const [showOtherSubs, setShowOtherSubs] = useState(false)
  // Position gets the same treatment Edit got in #78: one explicit parser, errors shown rather than
  // silently coerced. `Number(v) || ''` turned 0 into "unset" and quietly ate "1.5 (novella)".
  const [positionError, setPositionError] = useState<string | null>(null)
  const [publicationError, setPublicationError] = useState<string | null>(null)
  // Track whether the user edited genre, so enrichment fills it but never overrides their choice.
  const genreEdited = useRef(false)
  // Same tracking for series: typed -> seriesUserChosen true; left as the verified corpus-prefilled
  // value (or never touched) -> false, so later corpus corrections remain default-only.
  const seriesEdited = useRef(false)
  const [seriesClaim] = useState<SeriesClaim>(hit.seriesClaim ?? { origin: 'unknown' })
  // Distinct contributor names across the library, for the editor's autocomplete.
  const authorSuggestions = [
    ...new Set((books ?? []).flatMap((b) => b.contributors.map((c) => c.name)).filter(Boolean)),
  ].sort()
  const labels = useLabels()
  const [cover, setCover] = useState(hit.cover ?? '')
  // Enrichment's alternate editions (real cover URLs) — a pre-save chooser so a wrong fetched cover
  // is fixable before the record even exists; upload/camera/more editions live in the refine step.
  const [alternates, setAlternates] = useState<CoverAlternate[]>([])
  const [coverNote, setCoverNote] = useState<string | null>(null)
  const [enriching, setEnriching] = useState(false)
  const set = (k: keyof typeof form, v: string) => {
    setForm((p) => ({ ...p, [k]: v }))
    if (k === 'position') setPositionError(null)
    if (k === 'pub') setPublicationError(null)
  }
  const ownSubOptions = [
    ...subs.filter((x) => !subgenresForGenre(form.genre || skinGenre).includes(x)),
    ...subgenresForGenre(form.genre || skinGenre),
  ]
  const [g0, g1] = subgenreGradient(subs[0] ?? '', form.genre || skinGenre)
  // For the preview plate — the placeholder sets the author line from these, so a coverless book
  // in progress reads as itself rather than as "Untitled".
  const { first: previewFirst, last: previewLast } = toFirstLast(contribs)

  async function fetchDetails() {
    setEnriching(true)
    setCoverNote(null)
    const res = await enrichBook({
      title: form.title,
      author: formatAuthors(contribs),
      isbn: hit.isbn,
    })
    setEnriching(false)
    if (!res) {
      setCoverNote('Couldn’t reach the catalog just now — add details by hand, or try again.')
      return
    }
    // Seed contributors from enrichment only if the user hasn't entered any names yet.
    if (res.authors?.length && !contribs.some((c) => c.name.trim()))
      setContribs(contributorsFromAuthors(res.authors))
    // Fill only blanks — never overwrite what the user typed. genre is the mapped primary genre
    // (C1 fill); only applied if the user hasn't edited the genre field themselves.
    setForm((p) => ({
      ...p,
      // A resolved book search is not series-membership evidence. Corpus classification fills this
      // later when a relational source contains the book; readers can still enter it explicitly.
      genre: genreEdited.current ? p.genre : res.genre || p.genre,
    }))
    // Cover — honor the match confidence the backend already scores (ISBN, exact title, author
    // conflict, ambiguity). A HIGH match (or an ISBN scan) auto-fills; anything softer shows the
    // choice rather than silently committing a guess. Alternates are always offered for override.
    const alts = res.alternates ?? []
    setAlternates(alts)
    const strong = res.confidence === 'high' || !!hit.isbn
    if (res.cover && !cover) setCover(res.cover) // tentative preview either way — never overwrites a user pick
    if (!strong && res.cover) {
      setCoverNote(
        alts.length
          ? 'Not a certain match — check the cover and pick the right edition below.'
          : 'Not a certain match — double-check the cover, or change it after adding.',
      )
    }
  }
  const inputClass =
    'h-10 w-full skin-card border border-line px-3 text-[14px] text-ink outline-none'
  const inputStyle = { background: 'var(--field)' } as const

  async function save() {
    if (!form.title.trim()) return
    const parsedPosition = parseNumericField(form.position, SERIES_POSITION)
    if (!parsedPosition.ok) {
      setPositionError(parsedPosition.error)
      return
    }
    const parsedPub = form.pub.trim() ? parseReleasePub(form.pub) : parsePub('')
    if (!parsedPub) {
      setPublicationError('Use YYYY, YYYY-MM, or YYYY-MM-DD.')
      return
    }
    const f = form.format.toLowerCase()
    const isEbook = f.includes('ebook') || f.includes('kindle')
    const isAudio = f.includes('audio')
    // Format flags always record the edition in hand OR the edition you're eyeing — on a
    // wishlist add they sit latent (bookOwnedFormats suppresses them until the book is in hand),
    // so flipping to Owned later lands with the right copy already marked.
    const owned: Owned = {
      physical: f.includes('hardcover') ? 'hardcover' : isEbook || isAudio ? false : 'paperback',
      ebook: isEbook,
      audiobook: isAudio,
    }
    const { first, last } = toFirstLast(contribs)
    const editedIdentity = workKeyOf({ title: form.title.trim(), last: formatAuthors(contribs) })
    const pickedIdentity = workKeyOf({
      title: hit.title ?? '',
      last: formatAuthors(contributorsFromAuthors(hit.authors ?? [])),
    })
    const book: Partial<Book> & { title: string } = {
      // A corpus pick is a binding, not a suggestion to carry across arbitrary title/author edits.
      // Clearing it here lets the database resolve the edited bibliography (ISBN first, then the
      // Unicode title/full-author key) instead of rejecting a stale supplied UUID.
      corpusWorkId:
        hit.corpusWorkId && editedIdentity === pickedIdentity ? hit.corpusWorkId : undefined,
      title: form.title.trim(),
      first,
      last,
      contributors: contribs.filter((c) => c.name.trim()),
      series: form.series.trim(),
      seriesUserChosen: seriesEdited.current,
      seriesClaim: seriesEdited.current
        ? makeSeriesClaim('reader', 'add', { at: new Date().toISOString() })
        : seriesClaim,
      position: parsedPosition.value ?? '',
      seriesCount: null,
      status: form.series.trim() ? 'ongoing' : 'standalone',
      genre: form.genre.trim(),
      subgenre: subs[0] ?? '',
      subgenres: subs,
      // Bug fix: this used to be `subs.slice(0, 1)` — the first SUBGENRE (e.g. 'dark romance'),
      // not the CORE genre. genres[] must hold CORE_GENRES keys like the rest of the app expects
      // (import's normalizeImportGenres, filters.ts's search blob, merge_books) — same value as
      // `genre` above, just array-shaped so a second genre tag (added via Edit details) has
      // somewhere to live without a later edit silently overwriting it back to one.
      genres: form.genre.trim() ? [form.genre.trim()] : [],
      // tropes are tagged in the refine step via the full picker (book_tropes needs a saved id);
      // no lightweight freeform tags here — the structured trope system is the one source of truth.
      intensity,
      darkness,
      ...possessionPatch(possession),
      owned,
      cover,
      isbn: hit.isbn ?? '',
      format: form.format,
      readStatus: form.readStatus,
      source: 'Owned',
      pub: parsedPub,
    }
    // Dedup on intake: a strong match folds into the existing record instead of duplicating.
    // With auto-merge off, a match comes back for an inline decision instead.
    //
    // 'review', not 'add', and the difference is only ever the FUZZY tier — decideIntake consults
    // fuzzyMode on its last line, after `none`, the always_merge/keep_separate verdicts and the
    // strong-match branch have each already returned. Strong-match auto-merge is untouched by this.
    //
    // What it fixes: a fuzzy title/author match used to fall through to a silent insert, so adding
    // "The Hobbit" next to an existing "Hobbit, The" quietly produced a second row. The review UI
    // for exactly this decision already existed and was already wired up below (`setDup`, and the
    // `dup && …` block) — it was simply unreachable from single-Add, because this argument said to
    // skip it. Import and bulk paths already ask.
    const res = await intake(book, 'review')
    if (res.outcome === 'review' && res.review) {
      setDup(res.review)
      return
    }
    // Added or merged — hand off to the refine step against the real book (cover + tropes).
    if (res.bookId) {
      if (addToHousehold) {
        try {
          await addPersonalBooksToHousehold.mutateAsync([res.bookId])
        } catch {
          setHouseholdWarning(
            'The personal book was saved, but the household entry could not be added. Try Household only after reconnecting.',
          )
        }
      }
      setAddedId(res.bookId)
      return
    }
    onAdded()
  }

  async function resolveDup(action: ReviewAction) {
    if (!dup) return
    const existing = (books ?? []).find((b) => b.id === dup.existingId)
    const resolvedBookId = existing ? await resolveCandidate(dup, existing, action) : null
    if (addToHousehold && resolvedBookId) {
      try {
        await addPersonalBooksToHousehold.mutateAsync([resolvedBookId])
      } catch {
        setHouseholdWarning(
          'The personal book was saved, but the household entry could not be added. Try Household only after reconnecting.',
        )
      }
    }
    await qc.invalidateQueries({ queryKey: ['books'] })
    await qc.invalidateQueries({ queryKey: ['reads', 'all'] })
    setDup(null)
    if (resolvedBookId) {
      setAddedId(resolvedBookId)
      return
    }
    onAdded()
  }

  if (addedId)
    return <RefineAdded bookId={addedId} householdWarning={householdWarning} onDone={onAdded} />

  return (
    <Surface radius="panel" tone="card" pad={3} className="mt-4">
      <div className="flex gap-4">
        <div className="flex-none">
          <div
            className="aspect-[2/3] w-20 overflow-hidden rounded-lg border border-line"
            style={{ background: `linear-gradient(150deg, ${g0}, ${g1})` }}
          >
            {/* Through CoverImage so a Google "no image" plate is rejected on load, same as the grid —
                and UNCONDITIONALLY, so a coverless book gets the skin's designed plate here exactly as
                it does everywhere else. Rendering this conditionally left the gradient bare on the one
                screen and made the genre tint visible in Add and nowhere after it
                (docs/decisions/0003-cover-gradient-latent-not-default.md). */}
            <CoverImage
              book={{ title: form.title, first: previewFirst, last: previewLast, cover }}
              thumb
            />
          </div>
          <button
            type="button"
            onClick={() => void fetchDetails()}
            disabled={enriching}
            className="mt-1.5 skin-control border border-line px-2.5 py-1 text-[11px] font-semibold text-ink disabled:opacity-50"
            style={{ background: 'var(--field)' }}
          >
            {enriching ? '…' : '🔎 Fetch details'}
          </button>
        </div>
        {/* min-w-0 is load-bearing: a flex item defaults to min-width:auto, so without it this
            column cannot shrink below its children's intrinsic minimum. ContributorEditor's row set
            that floor, this column overflowed the card, and the whole PAGE gained horizontal scroll
            (measured at a 390px viewport: scrollWidth 532 vs clientWidth 390). Never "fix" that
            class of symptom with overflow-x:hidden — it hides the next instance instead of the
            box being wrong. */}
        <div className="min-w-0 flex-1 space-y-2">
          <input
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Title"
            className={inputClass}
            style={inputStyle}
          />
          <ContributorEditor
            value={contribs}
            onChange={setContribs}
            suggestions={authorSuggestions}
          />
        </div>
      </div>

      {hit.source === 'google' && hit.sourceUrl && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <GoogleBooksAttribution />
          <GoogleBooksResultLink result={hit} />
        </div>
      )}

      {/* Pick a cover — enrichment's alternate editions, before saving (upload/camera come after add). */}
      {alternates.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.15em] text-muted">
            Pick a cover
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {alternates.map((a, i) => (
              <button
                key={a.isbn13 || a.cover || i}
                type="button"
                onClick={() => setCover(a.cover)}
                aria-label={`Use the ${a.source} cover`}
                aria-pressed={cover === a.cover}
                className="h-[4.5rem] w-12 flex-none overflow-hidden rounded"
                style={{
                  border: cover === a.cover ? '2px solid var(--primary)' : '1px solid var(--line)',
                }}
              >
                {/* through CoverImage so a "no image" plate never poses as a pickable cover */}
                <CoverImage book={{ title: form.title, cover: a.cover }} thumb />
              </button>
            ))}
          </div>
        </div>
      )}
      {coverNote && <p className="mt-1.5 text-[12px] text-muted">{coverNote}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <input
          value={form.series}
          onChange={(e) => {
            seriesEdited.current = true
            set('series', e.target.value)
          }}
          placeholder="Series"
          className={inputClass}
          style={inputStyle}
        />
        <input
          value={form.position}
          onChange={(e) => set('position', e.target.value)}
          placeholder="Book #"
          inputMode="decimal"
          aria-invalid={!!positionError}
          className={inputClass}
          style={inputStyle}
        />
        <select
          value={form.genre}
          onChange={(e) => {
            genreEdited.current = true
            set('genre', e.target.value)
          }}
          aria-label={labels.genre}
          className={inputClass}
          style={inputStyle}
        >
          {/* The unset state needs its own option, or the select renders the FIRST genre as though
              it were chosen — swapping one silent guess for another, this time in the UI. This is
              the "prompts" half of types.ts's "prompts, never guesses". */}
          <option value="">Genre — not set</option>
          {form.genre && !CORE_GENRES.some((g) => g.toLowerCase() === form.genre) && (
            <option value={form.genre}>{form.genre}</option>
          )}
          {CORE_GENRES.map((g) => (
            <option key={g} value={g.toLowerCase()}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={form.format}
          onChange={(e) => set('format', e.target.value)}
          className={inputClass}
          style={inputStyle}
        >
          {FORMATS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          value={form.readStatus}
          onChange={(e) => set('readStatus', e.target.value as Book['readStatus'])}
          className={inputClass}
          style={inputStyle}
        >
          {READ_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {readStatusLabel(s)}
            </option>
          ))}
        </select>
        <input
          value={form.pub}
          onChange={(e) => set('pub', e.target.value)}
          placeholder="Publication date — YYYY, YYYY-MM, or YYYY-MM-DD"
          aria-label="Publication date"
          aria-invalid={!!publicationError}
          className={`${inputClass} col-span-2 sm:col-span-3`}
          style={inputStyle}
        />
      </div>
      {positionError && (
        <p role="alert" className="mt-1.5 text-[12px]" style={{ color: 'var(--accent-ink)' }}>
          {positionError}
        </p>
      )}
      {publicationError && (
        <p role="alert" className="mt-1.5 text-[12px]" style={{ color: 'var(--accent-ink)' }}>
          {publicationError}
        </p>
      )}

      {/* Subgenres — multi-pick from the CHOSEN genre's shelf (selections survive a genre switch),
          with every other genre's shelf a disclosure away: a horror-romance is a real shape, and
          storage (flat text[]) always allowed it — only this vocabulary didn't. */}
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] uppercase tracking-[0.15em] text-muted">Subgenres</div>
        <div className="flex flex-wrap gap-1.5">
          {ownSubOptions.map((s) => (
            <Chip key={s} active={subs.includes(s)} onClick={() => toggleSub(s)}>
              {s}
            </Chip>
          ))}
        </div>
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
              {otherGenreSubgenres(form.genre || skinGenre)
                .filter((x) => !ownSubOptions.includes(x))
                .map((s) => (
                  <Chip key={s} active={subs.includes(s)} onClick={() => toggleSub(s)}>
                    {s}
                  </Chip>
                ))}
            </div>
          )}
        </div>
        {subs.length > 1 && (
          <p className="mt-1.5 text-[11px] text-muted">
            First pick leads — it sets the book’s gradient.
          </p>
        )}
      </div>

      {/* Ownership — a record no longer implies possession; most of a TBR is books you don't own. */}
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] uppercase tracking-[0.15em] text-muted">Ownership</div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ownership">
          {(
            [
              ['owned', voice.ownIt],
              ['borrowed', voice.borrowedIt],
              ['wishlist', voice.wantIt],
              ['unset', voice.unsetIt],
            ] as const
          ).map(([value, sub]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={possession === value}
              aria-label={OWNERSHIP_LABELS[value]}
              onClick={() => setPossession(value)}
              className="skin-control border px-3 py-1.5 text-center leading-tight"
              style={
                possession === value
                  ? {
                      background: 'var(--accent-fill)',
                      color: 'var(--on-primary)',
                      borderColor: 'transparent',
                    }
                  : {
                      background: 'var(--field)',
                      color: 'var(--muted)',
                      borderColor: 'var(--line)',
                    }
              }
            >
              {/* plain word tells you what it sets; the skin voice is the flavor subtitle */}
              <span className="block text-[12.5px] font-semibold">{OWNERSHIP_LABELS[value]}</span>
              <span className="block text-[10px] font-normal italic">{sub}</span>
            </button>
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

      {dup && (
        <Surface radius="card" tone="field" pad={2} className="mt-4 text-[13px]">
          <p className="text-ink">
            You may already have <span className="font-semibold">{dup.existingTitle}</span>
            {dup.existingAuthor ? ` · ${dup.existingAuthor}` : ''}.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void resolveDup('merge')}
              className="skin-control px-3 py-1.5 text-[12.5px] font-semibold text-on-primary"
              style={{ background: 'var(--accent-fill)' }}
            >
              Merge into it
            </button>
            <button
              type="button"
              onClick={() => void resolveDup('keep_both')}
              className="skin-control border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink"
              style={{ background: 'var(--card)' }}
            >
              Keep both
            </button>
            <button
              type="button"
              onClick={() => setDup(null)}
              className="skin-control px-3 py-1.5 text-[12.5px] font-semibold text-muted"
            >
              Cancel
            </button>
          </div>
        </Surface>
      )}

      <button
        type="button"
        onClick={() => void save()}
        className="mt-4 h-11 w-full skin-control text-[14px] font-semibold"
        style={{
          background: 'linear-gradient(135deg, var(--primary), var(--gold))',
          color: 'var(--on-primary)',
        }}
      >
        {addToHousehold ? 'Add to my library + Household' : 'Add to my library'}
      </button>
    </Surface>
  )
}

/** Generic search results identify books; they do not independently prove membership. Bulk Add
 * creates a neutral personal row and the shared corpus classifier seeds a series only after a
 * relational source contains the exact book. */
export function bulkIncomingFromSearch(
  result: SearchResult,
  skinGenre: string,
  bulkSub: string,
): Incoming {
  const hit = hitOf(result)
  const authorParts = (hit.authors[0] ?? '').trim().split(/\s+/)
  return {
    title: hit.title,
    first: authorParts.length > 1 ? (authorParts[0] ?? '') : '',
    last: authorParts.length > 1 ? authorParts.slice(1).join(' ') : (authorParts[0] ?? ''),
    series: '',
    position: '',
    status: 'standalone',
    genre: skinGenre,
    subgenre: bulkSub,
    subgenres: [bulkSub],
    // Same bug as single Add (see save() above): this held the subgenre, not the genre.
    genres: [skinGenre],
    tags: [],
    intensity: null,
    darkness: null,
    owned: { physical: 'paperback', ebook: false, audiobook: false },
    cover: hit.cover,
    isbn: hit.isbn,
    readStatus: 'Unread',
    source: 'Owned',
    pub: parsePub(hit.pub),
  }
}

function BulkAdd({ addToHousehold }: { addToHousehold: boolean }) {
  const intake = useIntake()
  const addPersonalBooksToHousehold = useAddPersonalBooksToHousehold()
  const skinGenre = SKINS[useEffectiveSkin()].genre.toLowerCase()
  const bulkSub = subgenresForGenre(skinGenre)[0] ?? 'Other' // genre's primary subgenre (always defined)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    const lines = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!lines.length) return
    setBusy(true)
    let added = 0
    let merged = 0
    const bookIds: string[] = []
    for (const [i, line] of lines.entries()) {
      setStatus(`Looking up ${i + 1}/${lines.length}…`)
      try {
        const top = (await searchCatalog(line))[0]
        if (!top) continue
        const res = await intake(bulkIncomingFromSearch(top, skinGenre, bulkSub), 'add')
        if (res.outcome === 'merged') merged++
        else added++
        if (res.bookId) bookIds.push(res.bookId)
      } catch {
        /* skip lines that fail */
      }
    }
    if (addToHousehold && bookIds.length) {
      try {
        await addPersonalBooksToHousehold.mutateAsync([...new Set(bookIds)])
      } catch {
        setBusy(false)
        setStatus(
          `Added the personal books, but the household entries could not be added. Reconnect and try Household only.`,
        )
        return
      }
    }
    setBusy(false)
    setStatus(
      `Added ${added}${merged ? ` · merged ${merged} into existing` : ''} of ${lines.length}${
        addToHousehold ? ' to your library + Household' : ''
      }.`,
    )
    setText('')
  }

  return (
    <Surface as="details" radius="panel" tone="card" pad={3} className="mt-4">
      <summary className="cursor-pointer text-[14px] font-semibold text-ink">
        Bulk add — paste a list
      </summary>
      <p className="mb-2 mt-2 text-[12.5px] text-muted">
        One title or ISBN per line. Each is looked up and added.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        aria-label="Books to add, one title or ISBN per line"
        placeholder={'Iron Flame\n9781649374172\nThe Love Hypothesis'}
        className="w-full skin-field border border-line text-ink outline-none"
        style={{ background: 'var(--field)' }}
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !text.trim()}
          className="skin-control px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, var(--primary), var(--gold))',
            color: 'var(--on-primary)',
          }}
        >
          Add all
        </button>
        {status && <span className="text-[12.5px] text-muted">{status}</span>}
      </div>
    </Surface>
  )
}

/**
 * ONE search result, with its triage state said out loud.
 *
 * THE STATE IS TEXT. Not a colour, not an icon alone — it has to survive greyscale, a colour-blind
 * reader and a screen reader equally. It rides `--muted` (4.51:1 at worst across all eighteen
 * skin x mode combinations), NOT `--accent-fill`, which measures 1.00:1 against `--card` in
 * almanac/dark — literally the same colour — and under 3:1 in three more dark skins. The level
 * picker was rebuilt on `--muted` for exactly this reason.
 *
 * WHY 'library' IS NOT A PICK BUTTON. For the other two states the whole row is the add gesture,
 * which is the right primary action. For a book the reader already has it is not: the thing they
 * want is the record they already own, so the row stops being a pick target entirely and the only
 * control is "Open it". Leaving the add gesture on it and adding a link beside would have offered
 * "add a second copy" as the primary action, and would also have nested one interactive element
 * inside another.
 */
function TriageRow({
  t,
  onPick,
  household = false,
}: {
  t: TriagedResult
  onPick: (p: Picked) => void
  household?: boolean
}) {
  const r = t.result
  const picked = t.work
    ? pickedFromWork(t.work, r)
    : household && t.book?.corpusWorkId
      ? { ...hitOf(r), corpusWorkId: t.book.corpusWorkId }
      : hitOf(r)
  const inner = (
    <>
      <span
        className="h-16 w-11 flex-none overflow-hidden rounded border border-line"
        style={{ background: 'var(--chip)' }}
      >
        {/* through CoverImage so a catalog "no image" plate never renders as a result cover */}
        {r.cover && <CoverImage book={{ title: r.title, cover: r.cover }} thumb />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[14px] font-semibold text-ink">{r.title}</span>
        <span className="block break-words text-[12px] text-muted">
          {r.authors.join(', ')}
          {r.year ? ` \u00b7 ${r.year.slice(0, 4)}` : ''}
        </span>
        {/* Semibold, not a second colour: the state has to be distinguishable from the author line
            it sits under, and weight does that without adding a colour the reader must decode.
            `--muted` is the carrier (4.51:1 at worst across all eighteen skin x mode combinations);
            `--accent-fill` is not, at 1.00:1 against `--card` in almanac/dark. */}
        <span
          className="block break-words text-[12px] font-semibold text-muted"
          data-testid="triage-label"
        >
          {household && t.state === 'library'
            ? 'In your personal library · can also join the household'
            : triageLabel(t)}
        </span>
      </span>
    </>
  )

  return (
    <Surface
      as="li"
      radius="card"
      tone="field"
      pad={0}
      className="flex flex-wrap items-center gap-3 p-2"
      data-testid="add-result"
      data-triage={t.state}
    >
      {!household && t.state === 'library' && t.book ? (
        <>
          <span className="flex flex-1 items-center gap-3">{inner}</span>
          <GoogleBooksResultLink result={r} />
          <Link
            to="/book/$bookId"
            params={{ bookId: t.book.id }}
            data-testid="triage-open"
            className="skin-control flex-none border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink"
            style={{ background: 'var(--card)' }}
          >
            Open it
          </Link>
        </>
      ) : (
        <>
          <button
            type="button"
            // A corpus row is the better prefill: it carries the series, position and genre the
            // catalog result does not, so picking one fills them in rather than making the reader
            // retype what the corpus already knows.
            onClick={() => onPick(picked)}
            className="flex min-w-[12rem] flex-1 items-center gap-3 text-left"
          >
            {inner}
          </button>
          <GoogleBooksResultLink result={r} />
        </>
      )}
    </Surface>
  )
}

function HouseholdAddForm({
  hit,
  targetMemberId,
  targetMemberName,
  onAdded,
}: {
  hit: Picked
  targetMemberId?: string | null
  targetMemberName?: string
  onAdded: () => void
}) {
  const { session } = useAuth()
  const household = useHouseholdLibraryAuthorization()
  const addExisting = useAddCorpusWorkToHousehold()
  const addToMember = useAddCorpusWorkToMemberLibrary()
  const createWork = useCreateHouseholdCatalogWork()
  const { data: isCorpusAdmin = false } = useCorpusAdminStatus()
  const [title, setTitle] = useState(hit.title ?? '')
  const [author, setAuthor] = useState(formatAuthors(contributorsFromAuthors(hit.authors ?? [])))
  const [isbn, setIsbn] = useState(hit.isbn ?? '')
  const [coverWarning, setCoverWarning] = useState('')
  const [saveError, setSaveError] = useState('')
  const currentMember = household.members.find((member) => member.userId === session?.user.id)
  const canCreate = !!currentMember
  const canPersistPickedCover =
    hit.source === 'google' || currentMember?.role === 'owner' || isCorpusAdmin
  const pending = addExisting.isPending || createWork.isPending || addToMember.isPending

  async function save() {
    let workId = hit.corpusWorkId
    if (workId) await addExisting.mutateAsync(workId)
    else {
      const result = await createWork.mutateAsync({
        title: title.trim(),
        author: author.trim(),
        isbn: isbn.trim(),
        coverUrl: canPersistPickedCover ? hit.cover : undefined,
        coverSource: canPersistPickedCover ? hit.source : undefined,
      })
      if (result.coverWarning) {
        setCoverWarning(result.coverWarning)
        // The shared work already committed. A delegated personal add is independent of its
        // optional cover ingest, so finish that requested destination before pausing on the warning.
        if (!targetMemberId) return
      }
      workId = result.workId
    }
    if (targetMemberId && workId) {
      await addToMember.mutateAsync({ workId, memberId: targetMemberId })
    }
    onAdded()
  }

  async function handleSave() {
    setSaveError('')
    try {
      await save()
    } catch {
      setSaveError(
        targetMemberId
          ? `The shared entry may have been added, but ${targetMemberName ?? 'the selected member'}’s personal book could not be created. Reconnect and try that destination again.`
          : 'The household entry could not be added. Reconnect and try again.',
      )
    }
  }

  return (
    <Surface radius="panel" tone="card" pad={3} className="mt-4">
      <div className="flex gap-4">
        <div className="aspect-[2/3] w-20 flex-none overflow-hidden rounded-lg border border-line">
          <CoverImage book={{ title, cover: hit.cover ?? '' }} thumb />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            readOnly={!!hit.corpusWorkId}
            placeholder="Title"
            className="h-10 w-full skin-card border border-line px-3 text-[14px] text-ink outline-none read-only:opacity-75"
            style={{ background: 'var(--field)' }}
          />
          <input
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            readOnly={!!hit.corpusWorkId}
            placeholder="Author"
            aria-label="Author"
            className="h-10 w-full skin-card border border-line px-3 text-[14px] text-ink outline-none read-only:opacity-75"
            style={{ background: 'var(--field)' }}
          />
          {!hit.corpusWorkId ? (
            <input
              value={isbn}
              onChange={(event) => setIsbn(event.target.value)}
              placeholder="ISBN — optional"
              aria-label="ISBN"
              className="h-10 w-full skin-card border border-line px-3 text-[14px] text-ink outline-none"
              style={{ background: 'var(--field)' }}
            />
          ) : null}
        </div>
      </div>

      {hit.source === 'google' && hit.sourceUrl && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <GoogleBooksAttribution />
          <GoogleBooksResultLink result={hit} />
        </div>
      )}

      <p className="mt-3 text-[12.5px] text-muted">
        {targetMemberId
          ? `This adds one shared entry and a neutral personal book for ${targetMemberName ?? 'the selected member'}. It does not say they own, borrowed, want, or have read it.`
          : 'This adds one shared household entry. It does not create a personal book or say that anyone owns, borrowed, wants, or has read it.'}
      </p>
      {hit.cover && !canPersistPickedCover ? (
        <p role="status" className="mt-3 text-[12.5px] text-muted">
          This preview needs a household owner or corpus admin to save it as the shared cover. The
          shared record can still be added without it.
        </p>
      ) : null}
      {coverWarning ? (
        <p role="status" className="mt-3 text-[12.5px] text-accent-ink">
          {coverWarning}{' '}
          <Link
            to="/library"
            search={{ scope: 'household' }}
            className="font-semibold underline underline-offset-2"
          >
            View household library
          </Link>
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="mt-3 text-[12.5px] text-accent-ink">
          {saveError}
        </p>
      ) : null}
      {!household.authorized ? (
        <p role="status" className="mt-3 text-[12.5px] text-muted">
          Connect to a verified household before adding shared books.
        </p>
      ) : !hit.corpusWorkId && !canCreate ? (
        <p role="status" className="mt-3 text-[12.5px] text-muted">
          This title is not in the shared catalog yet. Reconnect with an active household membership
          before creating its provisional shared record.
        </p>
      ) : (
        <button
          type="button"
          disabled={pending || !title.trim()}
          onClick={() => void handleSave()}
          className="skin-control skin-btn-primary mt-4 h-11 w-full px-4 text-[14px] font-semibold disabled:opacity-50"
        >
          {pending
            ? 'Adding…'
            : hit.corpusWorkId
              ? targetMemberId
                ? `Add to ${targetMemberName ?? 'member'} + Household`
                : 'Add to household library'
              : targetMemberId
                ? `Create shared record and add to ${targetMemberName ?? 'member'}`
                : 'Create shared record and add'}
        </button>
      )}
    </Surface>
  )
}

function AddScreen() {
  const voice = useVoice()
  const navigate = useNavigate()
  // Deep-link prefill (?title=…&author=…): Discover — and anything else that finds a book
  // elsewhere in the app — lands here with the form already filled, one tap from saved.
  const prefill = addRoute.useSearch()
  const { session } = useAuth()
  const household = useHouseholdLibraryAuthorization()
  const [destination, setDestination] = useState<AddDestination>(
    prefill.scope === 'household' ? 'household' : 'mine',
  )
  const destinationChosen = useRef(prefill.scope === 'household')
  useEffect(() => {
    if (!destinationChosen.current && household.authorized && household.members.length) {
      setDestination('both')
    }
  }, [household.authorized, household.members.length])
  const targetMemberId = delegatedMemberId(destination)
  const targetMember = household.members.find((member) => member.userId === targetMemberId)
  const householdOnly = destination === 'household' || !!targetMemberId
  const collectiveDestination = destination !== 'mine'
  const [q, setQ] = useState('')
  // SearchResult, not SearchHit: the triage classifier needs `series`/`seriesPosition`, which the
  // five-field hit drops. The truncation to a hit happens at the PICK, not at the search.
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  // The term the results on screen belong to. Distinct from `q`, which changes on every keystroke:
  // the corpus lookup must follow what was SEARCHED, or a half-typed query refetches the corpus on
  // every character and labels the visible results against a term nobody asked for.
  const [searched, setSearched] = useState('')
  const [picked, setPicked] = useState<Picked | null>(() => pickedFromAddPrefill(prefill))
  const [scanStatus, setScanStatus] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Already paged (#350), so the library side of the check is sound above 1,000 rows.
  const { data: books } = useBooks()
  // The ranged term query starts alongside catalog search. Once results arrive, their ISBNs feed
  // one additional batched lookup so alternate catalog title/author metadata cannot hide a work.
  const corpus = useWorksLookup(searched, (results ?? []).map(resultIsbn))
  // Labelled the moment the hits arrive — on the library alone if the corpus query is still in
  // flight, gaining the corpus half when it resolves. Nothing here waits on a second round trip,
  // which is the regression that would be invisible on a fast connection.
  const resultSections = partitionSearchResults(results ?? [])
  const catalogTriaged = triageResults(resultSections.catalog, books ?? [], corpus.data)
  const googleTriaged = triageResults(resultSections.google, books ?? [], corpus.data)

  async function runSearch(term = q) {
    const query = term.trim()
    if (!query) return
    setBusy(true)
    setPicked(null)
    // Set BEFORE the await, so the corpus lookup starts alongside the catalog search rather than
    // after it. The two round trips overlap; neither waits on the other.
    setSearched(query)
    try {
      setResults(await searchCatalog(query))
    } catch {
      setResults([])
    } finally {
      setBusy(false)
    }
  }

  function stopScan() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setScanStatus(null)
  }

  async function startScan() {
    if (!window.BarcodeDetector || !navigator.mediaDevices) {
      setScanStatus(
        'Barcode scanning isn’t supported in this browser — search by title or ISBN below.',
      )
      return
    }
    try {
      setScanStatus('Requesting camera…')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()
      setScanStatus('Point at the barcode on the back cover…')
      const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] })
      const tick = async () => {
        if (!streamRef.current) return
        try {
          const codes = await detector.detect(video)
          const isbn = codes[0]?.rawValue?.replace(/[^0-9Xx]/g, '')
          if (isbn && isbn.length >= 10) {
            stopScan()
            setQ(isbn)
            void runSearch(isbn)
            return
          }
        } catch {
          /* keep scanning */
        }
        setTimeout(() => void tick(), 350)
      }
      void tick()
    } catch (e) {
      stopScan()
      setScanStatus(
        `Camera unavailable (${(e as Error).name || 'blocked'}). Search by title or ISBN below.`,
      )
    }
  }

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <h1
        className="text-[22px] italic text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
      >
        Add a book
      </h1>
      <p className="mb-4 text-[13px] text-muted">
        Scan a barcode, search by title or ISBN, or add manually. Choose the destination before you
        save.
      </p>

      <AddDestinationPicker
        value={destination}
        onChange={(next) => {
          destinationChosen.current = true
          setDestination(next)
        }}
        members={household.authorized ? household.members : []}
        currentReaderId={session?.user.id ?? ''}
      />

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
          }}
          placeholder="Title, author, or ISBN"
          aria-label="Search for a book"
          className="h-11 min-w-[200px] flex-1 skin-field border border-line px-4 text-[14px] text-ink outline-none"
          style={{ background: 'var(--field)' }}
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          className="h-11 skin-control px-5 text-[14px] font-semibold"
          style={{
            background: 'linear-gradient(135deg, var(--primary), var(--gold))',
            color: 'var(--on-primary)',
          }}
        >
          Search
        </button>
        <button
          type="button"
          onClick={streamRef.current ? stopScan : startScan}
          className="h-11 skin-control border border-line px-5 text-[14px] font-semibold text-ink"
          style={{ background: 'var(--card)' }}
        >
          {streamRef.current ? 'Stop' : '📷 Scan'}
        </button>
        {/* A peer of Search and Scan, as the intro copy has always promised. It used to appear ONLY
            in the results-empty branch — so a search that returned the WRONG books (rather than
            none) left no way in, and the reader had to adopt a wrong hit or search gibberish to
            force the empty state. The form already accepts a bare { title }. */}
        <button
          type="button"
          onClick={() => setPicked({ title: q.trim() })}
          className="h-11 skin-control border border-line px-5 text-[14px] font-semibold text-ink"
          style={{ background: 'var(--card)' }}
        >
          Add manually
        </button>
      </div>

      {scanStatus && (
        <Surface radius="card" tone="card" pad={2} className="mt-3 text-[13px] text-muted">
          {scanStatus}
        </Surface>
      )}
      <video
        ref={videoRef}
        className={`mt-3 w-full rounded-xl ${streamRef.current ? '' : 'hidden'}`}
        muted
        playsInline
      />

      {busy && <p className="mt-4 text-center text-[13px] text-muted">Searching…</p>}

      {results && !picked && (
        <div className="mt-4 flex flex-col gap-2">
          {results.length ? (
            <div className="space-y-6" data-testid="add-results">
              {catalogTriaged.length > 0 && (
                <section aria-labelledby="add-catalog-results">
                  <h2 id="add-catalog-results" className="mb-2 text-base font-semibold text-ink">
                    Catalog matches
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {catalogTriaged.map((t, i) => (
                      <TriageRow
                        key={`${t.result.isbn}|${t.result.title}|${i}`}
                        t={t}
                        onPick={setPicked}
                        household={collectiveDestination}
                      />
                    ))}
                  </ul>
                </section>
              )}
              {googleTriaged.length > 0 && (
                <section aria-labelledby="add-google-results">
                  <div className="mb-2 flex min-h-[30px] items-center justify-between gap-3">
                    <h2 id="add-google-results" className="text-base font-semibold text-ink">
                      Google Books search results
                    </h2>
                    <GoogleBooksAttribution />
                  </div>
                  <ul className="flex flex-col gap-2">
                    {googleTriaged.map((t, i) => (
                      <TriageRow
                        key={`${t.result.isbn}|${t.result.title}|${i}`}
                        t={t}
                        onPick={setPicked}
                        household={collectiveDestination}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-muted">
              {voice.miss}{' '}
              <button
                type="button"
                onClick={() => setPicked({ title: q })}
                className="font-semibold text-primary"
              >
                Add it manually
              </button>
              .
            </p>
          )}
        </div>
      )}

      {prefill.discoverSession && (
        <Link
          to="/discover"
          search={{ session: prefill.discoverSession }}
          className="my-4 inline-flex min-h-11 items-center text-ink underline"
        >
          Return to your shortlist
        </Link>
      )}
      {picked &&
        (householdOnly ? (
          <HouseholdAddForm
            hit={picked}
            targetMemberId={targetMemberId}
            targetMemberName={targetMember?.displayName}
            onAdded={() =>
              prefill.discoverSession
                ? void navigate({ to: '/discover', search: { session: prefill.discoverSession } })
                : void navigate({ to: '/library', search: { scope: 'household' } })
            }
          />
        ) : (
          <AddForm
            hit={picked}
            defaultUnowned={!!prefill.want}
            addToHousehold={destination === 'both'}
            onAdded={() =>
              prefill.discoverSession
                ? void navigate({ to: '/discover', search: { session: prefill.discoverSession } })
                : void navigate({
                    to: '/library',
                    search: destination === 'both' ? { scope: 'household' } : {},
                  })
            }
          />
        ))}

      {!picked && !householdOnly && <BulkAdd addToHousehold={destination === 'both'} />}
    </section>
  )
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/** All-optional prefill params — the explicit optional-key type keeps plain `to="/add"` links
 *  valid everywhere (no required `search` prop). */
interface AddPrefill {
  discoverSession?: string
  /** add to the collective household library without creating a personal book */
  scope?: 'household'
  /** exact shared-work identity when the pick came from the Reverie corpus */
  work?: string
  title?: string
  author?: string
  isbn?: string
  cover?: string
  source?: 'hardcover' | 'google'
  sourceUrl?: string
  pub?: string
  /** arrival from a wanting context (Discover, a shelf/TBR) — the ownership toggle defaults to
   *  "I want to read this" instead of "I own this" */
  want?: boolean
}

export function pickedFromAddPrefill(prefill: AddPrefill): Picked | null {
  if (!prefill.title) return null
  return {
    corpusWorkId: prefill.work,
    title: prefill.title,
    authors: prefill.author ? [prefill.author] : [],
    cover: prefill.cover ?? '',
    source: prefill.source,
    sourceUrl: prefill.sourceUrl,
    isbn: prefill.isbn ?? '',
    pub: prefill.pub ?? '',
  }
}

export const validateAddSearch = (s: Record<string, unknown>): AddPrefill => {
  const out: AddPrefill = {}
  if (
    typeof s.discoverSession === 'string' &&
    /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(s.discoverSession)
  )
    out.discoverSession = s.discoverSession
  if (s.scope === 'household') out.scope = 'household'
  if (str(s.work)) out.work = str(s.work)
  if (str(s.title)) out.title = str(s.title)
  if (str(s.author)) out.author = str(s.author)
  if (str(s.isbn)) out.isbn = str(s.isbn)
  if (str(s.cover)) out.cover = str(s.cover)
  if (s.source === 'hardcover' || s.source === 'google') out.source = s.source
  const sourceUrl = str(s.sourceUrl)
  if (sourceUrl && googleBooksResultUrl({ source: out.source, sourceUrl }))
    out.sourceUrl = sourceUrl
  if (str(s.pub)) out.pub = str(s.pub)
  if (s.want === true || s.want === 'true') out.want = true
  return out
}

export const addRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'add',
  component: AddScreen,
  validateSearch: validateAddSearch,
})
