import { parseReleaseHandoff, releaseFormat, type ReleaseHandoff } from '../lib/releaseHandoff'
import { useEffect, useRef, useState } from 'react'
import { createRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  APP_NAME,
  bookBarcode,
  contributorsFromAuthors,
  formatAuthors,
  makeSeriesClaim,
  normalizeIsbn,
  newEdition,
  newCopy,
  validEditionCover,
  inventoryPossession,
  parseNumericField,
  parseNumericFields,
  PUB_YEAR,
  PUB_MONTH,
  PUB_DAY,
  prepareCopyInventoryWithIncoming,
  PAGE_COUNT,
  parsePubDate,
  possessionPatch,
  SERIES_POSITION,
  SERIES_COUNT,
  normalizeBookGenres,
  type SeriesStatus,
  SKINS,
  toFirstLast,
  workKeyOf,
  type BarcodeCapture,
  type Book,
  type Contributor,
  type Incoming,
  type Owned,
  type PossessionState,
  type SeriesClaim,
} from '@reverie/core'
import { useQueryClient } from '@tanstack/react-query'
import { rootRoute } from './RootRoute'
import { useAddReturn } from '../components/addReturn'
import { DraftExitGuard } from '../components/DraftExitGuard'
import { useAuth } from '../auth/AuthProvider'
import { useIntake, type ReviewCandidate } from '../data/intake'
import { useBooks } from '../data/books'
import { useAddSearch } from '../data/useAddSearch'
import { useAddSave } from '../data/useAddSave'
import {
  useAddCorpusWorkToHousehold,
  useAddCorpusWorkToMemberLibrary,
  useAddPersonalBooksToHousehold,
  useCreateHouseholdCatalogWork,
  useHouseholdLibraryAuthorization,
} from '../data/household'
import { useWorksLookup, workToHit, type WorkRow } from '../data/works'
import { publicationDateError } from '../lib/publicationDate'
import { useCorpusAdminStatus } from '../data/enrichCorpus'
import { resultIsbn, triageLabel, triageResults, type TriagedResult } from '../lib/addTriage'
import { resolveCandidate } from '../data/duplicates'
import { enrichBook, type CoverAlternate } from '../lib/enrich'
import {
  googleBooksResultUrl,
  partitionSearchResults,
  selectedSearchIsbn,
  type SearchResult,
} from '../lib/search'
import { useEffectiveSkin, useLabels, useVoice } from '../skin/labels'
import { BarcodeBatch } from '../components/BarcodeBatch'
import { Modal } from '../components/Modal'
import { CoverImage } from '../components/CoverImage'
import {
  BookEditorSection,
  BookMetadataFields,
  BookReadingStatus,
  BookRating,
  type BookMetadataDraft,
} from '../book/BookMetadataFields'
import { CopyEditor } from '../book/EditionCopies'
import { OWNERSHIP_LABELS, subgenreGradient } from '../library/constants'
import { Surface } from '../components/Surface'
import { LevelPicker } from '../components/LevelPicker'
import { AddDestinationPicker } from '../components/AddDestinationPicker'
import { delegatedMemberId, type AddDestination } from '../components/addDestination'
import { GoogleBooksAttribution, GoogleBooksResultLink } from '../components/GoogleBooksAttribution'
import { BookAddReview } from '../book/BookAddReview'
import { BulkAddQueue, type BulkAddRow } from '../book/BulkAddQueue'
import { StartBookTour } from '../guidance/BookTour'
import { useBookTour, useBookTourObservation } from '../guidance/BookTourContext'

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
  edition?: ReleaseHandoff
  corpusWorkId?: string
  series?: string
  position?: string
  genre?: string
  seriesClaim?: SeriesClaim
}

/** A catalog result as the form's prefill — `pub` takes the fn's `year`, and its ISBN-13-preferred
 *  `isbn` is already the field Add wanted. */
export const hitOf = (r: SearchResult): SearchHit => ({
  source: r.source,
  title: r.title,
  authors: r.authors,
  // Google art is displayed with its attributed search result, then stops at that boundary. The
  // saved book can acquire a durable Hardcover/Open Library cover during enrichment or refinement.
  cover: r.source === 'google' ? '' : r.cover,
  isbn: selectedSearchIsbn(r),
  pub: '',
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
  const p = parsePubDate(s)
  return { y: p.pubY ?? null, m: p.pubM ?? null, d: p.pubD ?? null }
}

/** A confirmed save hands off to the real book; optional edits belong there. */
function RefineAdded({
  bookId,
  householdWarning,
  onDone,
  returnLabel,
  editionAdded = false,
}: {
  bookId: string
  householdWarning?: string | null
  onDone: () => void
  returnLabel: string
  editionAdded?: boolean
}) {
  const { data: books, isFetching, isError, fetchStatus, refetch } = useBooks()
  const book = books?.find((b) => b.id === bookId)
  // This screen only mounts after a confirmed save. Loading is not a loaded-book observation.
  useBookTourObservation(editionAdded ? null : book ? 'saved' : 'saved-loading', bookId)

  if (!book) {
    return (
      <Surface radius="panel" tone="card" pad={3} className="mt-4" data-book-tour-region>
        <div data-book-tour="book-load">
          <h2 className="text-[16px] font-semibold text-ink">
            {editionAdded ? 'The edition was saved' : 'Your book was saved'}
          </h2>
          {householdWarning && (
            <p role="status" className="mt-2 text-[13px] text-accent-ink">
              {householdWarning}
            </p>
          )}
          <p
            role={isError && !isFetching ? 'alert' : 'status'}
            className="mt-2 text-[13px] text-muted"
          >
            {isFetching
              ? 'Loading its details…'
              : fetchStatus === 'paused'
                ? 'Reconnect to load its details. You do not need to add it again.'
                : isError
                  ? 'Its details could not be loaded. Try loading them again; this will not add another copy.'
                  : 'Its details are unavailable in your current library. Try loading them again, or come back later.'}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={isFetching || fetchStatus === 'paused'}
            onClick={() => void refetch()}
            className="min-h-11 skin-control border border-line px-4 text-[14px] font-semibold text-ink disabled:opacity-60"
            style={{ background: 'var(--field)' }}
          >
            {isFetching ? 'Loading details…' : 'Try loading again'}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="min-h-11 px-2 text-[14px] text-ink underline"
          >
            {returnLabel}
          </button>
        </div>
        <div
          className="mt-3 empty:hidden"
          data-book-tour-inline="book-load"
          data-book-tour-inline-desktop
        />
      </Surface>
    )
  }

  return (
    <Surface radius="panel" tone="card" pad={3} className="mt-4" data-book-tour-region>
      <h2 className="text-xl text-ink" style={{ fontFamily: 'var(--font-display)' }}>
        {editionAdded ? 'Edition added' : 'Your book was saved'}
      </h2>
      {householdWarning && (
        <p role="status" className="mt-3 text-sm text-ink">
          {householdWarning}
        </p>
      )}
      <p className="mt-2 text-sm text-muted">
        Open your book to add notes, reading history, cover choices and copies whenever you are
        ready.
      </p>
      <BookAddReview book={book} destination="Your library" />
      <Link
        to="/book/$bookId"
        params={{ bookId }}
        replace
        className="mt-4 flex min-h-11 w-full items-center justify-center skin-control skin-btn-primary px-4 text-center text-sm font-semibold"
      >
        Open your book
      </Link>
      <button
        type="button"
        onClick={onDone}
        data-book-tour="book-done"
        className="mt-2 min-h-11 w-full skin-control skin-btn-secondary px-4 text-sm font-semibold"
      >
        {returnLabel}
      </button>
      <div
        className="mt-3 empty:hidden"
        data-book-tour-inline="book-done"
        data-book-tour-inline-desktop
      />
    </Surface>
  )
}

function AddForm({
  hit,
  defaultUnowned = false,
  addToHousehold = false,
  onAdded,
  onSaved,
  returnLabel,
  batchPending = false,
}: {
  hit: Picked
  defaultUnowned?: boolean
  addToHousehold?: boolean
  onAdded: () => void
  onSaved?: (bookId: string) => void
  returnLabel: string
  batchPending?: boolean
}) {
  const intake = useIntake()
  const { session } = useAuth()
  const saveState = useAddSave(session?.user.id)
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
  const { data: books, refetch: refreshBooks } = useBooks()
  // The room may color a placeholder, but it never supplies book metadata.
  const skinGenre = SKINS[useEffectiveSkin()].genre.toLowerCase()
  const [dup, setDup] = useState<ReviewCandidate | null>(null)
  // A confirmed save stays visible until the reader opens the book or deliberately continues.
  const [addedId, setAddedId] = useState<string | null>(null)
  const [addedExistingEdition, setAddedExistingEdition] = useState(false)
  const [editionTarget, setEditionTarget] = useState<{
    book: Book
    inventory: NonNullable<Book['copyInventory']>
  } | null>(null)
  const [editionTargetBusy, setEditionTargetBusy] = useState(false)
  const [editionTargetError, setEditionTargetError] = useState<string | null>(null)
  const [householdWarning, setHouseholdWarning] = useState<string | null>(null)
  const [contribs, setContribs] = useState<Contributor[]>(
    contributorsFromAuthors(hit.authors ?? []),
  )
  const [form, setForm] = useState({
    title: hit.title ?? '',
    isbn: hit.isbn ?? '',
    seriesCount: '',
    status: hit.series ? 'ongoing' : 'standalone',
    // Prefilled ONLY from a corpus pick — a catalog hit carries none of these three, so for every
    // other entry point they are still '' and the picker still prompts rather than guessing.
    // `seriesEdited` stays false for a corpus prefill, which is correct: the reader did not choose
    // it, so `seriesUserChosen` saves false and a later enrich sweep may still treat it as
    // fill-only. Same for `genreEdited`.
    series: hit.series ?? '',
    position: hit.position ?? '',
    // A room is presentation, never a genre choice. Keep an untouched genre unclassified.
    genre: hit.genre ?? '',
    format: hit.edition
      ? {
          paperback: 'Paperback',
          hardcover: 'Hardcover',
          ebook: 'eBook',
          audiobook: 'Audiobook',
          physical: 'Physical',
          unknown: '',
        }[hit.edition.format]
      : ('' as string),
    readStatus: 'unset' as Book['readStatus'],
    // Release cards and the manual horizon form carry flexible precision into Add. Keeping this
    // editable lets the reader correct a catalog date before it becomes their own record.
    pub: hit.pub ?? '',
    pages: '',
  })
  // Subgenres are a multi-pick; the first selection leads (drives the cover gradient).
  // Begin empty: subgenre choices belong to the reader, never to the active room.
  const [subs, setSubs] = useState<string[]>([])
  const [extraGenres, setExtraGenres] = useState<string[]>([])
  const [review, setReview] = useState<Incoming | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  useBookTourObservation(addedId ? null : reviewOpen ? 'review' : 'details')
  const reviewHousehold = useRef(false)
  const [rating, setRating] = useState(0)
  const [intensity, setIntensity] = useState<number | null>(null)
  const [darkness, setDarkness] = useState<number | null>(null)
  const [validationAttempt, setValidationAttempt] = useState(0)
  const [isbnError, setIsbnError] = useState<string | undefined>()
  const [titleError, setTitleError] = useState<string | undefined>()
  const [seriesCountError, setSeriesCountError] = useState<string | undefined>()
  const isbnEdited = useRef(false)
  const statusEdited = useRef(false)
  // Position gets the same treatment Edit got in #78: one explicit parser, errors shown rather than
  // silently coerced. `Number(v) || ''` turned 0 into "unset" and quietly ate "1.5 (novella)".
  const [positionError, setPositionError] = useState<string | null>(null)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [publicationErrors, setPublicationErrors] = useState<
    Partial<Record<'pubY' | 'pubM' | 'pubD', string>>
  >({})
  // Track whether the user edited genre, so enrichment fills it but never overrides their choice.
  const genreEdited = useRef(false)
  // Same tracking for series: typed -> seriesUserChosen true; left as the verified corpus-prefilled
  // value (or never touched) -> false, so later corpus corrections remain default-only.
  const seriesEdited = useRef(false)
  const [seriesClaim] = useState<SeriesClaim>(hit.seriesClaim ?? { origin: 'unknown' })
  const [editionIds] = useState(() => ({ edition: crypto.randomUUID(), copy: crypto.randomUUID() }))
  const releaseFieldsEdited = useRef({ pub: false, pages: false })
  const selectedFormat = releaseFormat([form.format])
  const releaseMatches =
    !!hit.edition &&
    workKeyOf({ title: form.title, last: formatAuthors(contribs) }) ===
      workKeyOf({
        title: hit.edition.title,
        last: formatAuthors(contributorsFromAuthors(hit.edition.authors)),
      }) &&
    (hit.edition.format === 'unknown' || selectedFormat === hit.edition.format) &&
    normalizeIsbn(form.isbn) === normalizeIsbn(hit.isbn ?? '')

  // Distinct contributor names across the library, for the editor's autocomplete.
  const authorSuggestions = [
    ...new Set((books ?? []).flatMap((b) => b.contributors.map((c) => c.name)).filter(Boolean)),
  ].sort()
  const labels = useLabels()
  const [cover, setCover] = useState(hit.cover ?? '')
  const draftFingerprint = JSON.stringify([
    form,
    contribs,
    subs,
    extraGenres,
    rating,
    intensity,
    darkness,
    possession,
    cover,
  ])
  const initialDraft = useRef(draftFingerprint)
  const hasDraftChanges = draftFingerprint !== initialDraft.current
  // Enrichment's alternate editions (real cover URLs) — a pre-save chooser so a wrong fetched cover
  // is fixable before the record even exists; upload/camera/more editions live in the refine step.
  const [alternates, setAlternates] = useState<CoverAlternate[]>([])
  const [coverNote, setCoverNote] = useState<string | null>(null)
  const [enriching, setEnriching] = useState(false)
  const set = (k: keyof typeof form, v: string) => {
    setForm((p) => ({ ...p, [k]: v }))
    if (k === 'pub' || k === 'pages') releaseFieldsEdited.current[k] = true
    if (k === 'position') setPositionError(null)
    if (k === 'pub') setPublicationErrors({})
    if (k === 'pages') setPagesError(null)
    if (k === 'title') setTitleError(undefined)
    if (k === 'isbn') setIsbnError(undefined)
    if (k === 'seriesCount') setSeriesCountError(undefined)
  }
  const pubParts = form.pub.split('-')
  const metadata: BookMetadataDraft = {
    ...form,
    pubY: pubParts[0] ?? '',
    pubM: pubParts[1] ?? '',
    pubD: pubParts[2] ?? '',
  }
  const changeMetadata = (key: keyof BookMetadataDraft, value: string) => {
    if (key === 'pubY' || key === 'pubM' || key === 'pubD') {
      const parts = [metadata.pubY, metadata.pubM, metadata.pubD]
      parts[{ pubY: 0, pubM: 1, pubD: 2 }[key]] = value
      // Keep incomplete/invalid drafts visible. Save validates the complete tuple.
      while (parts.length > 1 && !parts[parts.length - 1]) parts.pop()
      set('pub', parts.join('-'))
      return
    }
    if (key === 'genre') genreEdited.current = true
    if (key === 'series' || key === 'position' || key === 'seriesCount') seriesEdited.current = true
    if (key === 'status') statusEdited.current = true
    if (key === 'series' && !statusEdited.current)
      setForm((p) => ({ ...p, status: value.trim() ? 'ongoing' : 'standalone' }))
    if (key === 'isbn') {
      isbnEdited.current = true
      // Inherited edition facts do not follow a different ISBN.
      if (!releaseFieldsEdited.current.pub) setForm((p) => ({ ...p, pub: '' }))
      if (!releaseFieldsEdited.current.pages) setForm((p) => ({ ...p, pages: '' }))
    }
    set(key, value)
  }
  const [g0, g1] = subgenreGradient(subs[0] ?? '', form.genre || skinGenre)
  // For the preview plate — the placeholder sets the author line from these, so a coverless book
  // in progress reads as itself rather than as "Untitled".
  const { first: previewFirst, last: previewLast } = toFirstLast(contribs)

  const currentIdentity = useRef('')
  currentIdentity.current = JSON.stringify([form.title, contribs.map((c) => c.name), form.isbn])

  async function fetchDetails() {
    const requestedIdentity = currentIdentity.current
    setEnriching(true)
    setCoverNote(null)
    const res = await enrichBook({
      title: form.title,
      author:
        contribs.find((c) => c.role === 'author' || c.role === 'co_author')?.name ||
        contribs[0]?.name,
      isbn: hit.edition && !releaseMatches && !isbnEdited.current ? '' : form.isbn,
    })
    setEnriching(false)
    if (requestedIdentity !== currentIdentity.current) {
      setCoverNote('The title or contributors changed. Fetch details again for this book.')
      return
    }
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
      pages:
        p.title === form.title && !p.pages && res.pageCount != null
          ? String(res.pageCount)
          : p.pages,
      pub:
        p.title === form.title && !p.pub && res.pubY != null
          ? [
              String(res.pubY),
              ...(res.pubM == null ? [] : [String(res.pubM).padStart(2, '0')]),
              ...(res.pubD == null ? [] : [String(res.pubD).padStart(2, '0')]),
            ].join('-')
          : p.pub,
    }))
    // Cover — honor the match confidence the backend already scores (ISBN, exact title, author
    // conflict, ambiguity). A HIGH match (or an ISBN scan) auto-fills; anything softer shows the
    // choice rather than silently committing a guess. Alternates are always offered for override.
    const alts = res.alternates ?? []
    setAlternates(alts)
    const strong = res.confidence === 'high'
    if (res.cover && !cover) setCover(res.cover) // tentative preview either way — never overwrites a user pick
    if (!strong && res.cover) {
      setCoverNote(
        alts.length
          ? 'Not a certain match — check the cover and pick the right edition below.'
          : 'Not a certain match — double-check the cover, or change it after adding.',
      )
    }
  }

  async function save() {
    if (dup) return
    setValidationAttempt((attempt) => attempt + 1)
    if (
      hit.edition &&
      form.isbn.trim() &&
      (form.isbn.trim().length > 32 ||
        !/^[0-9Xx -]+$/.test(form.isbn.trim()) ||
        !normalizeIsbn(form.isbn))
    ) {
      setIsbnError('Enter a valid ISBN-10 or ISBN-13, or leave it blank.')
      return
    }
    if (!form.title.trim()) {
      setTitleError('A book needs a title.')
      return
    }
    const parsedSeriesCount = parseNumericField(form.seriesCount, SERIES_COUNT)
    if (!parsedSeriesCount.ok) {
      setSeriesCountError(parsedSeriesCount.error)
      return
    }
    const parsedPosition = parseNumericField(form.position, SERIES_POSITION)
    if (!parsedPosition.ok) {
      setPositionError(parsedPosition.error)
      return
    }
    const publication = parseNumericFields({
      pubY: { raw: metadata.pubY, spec: PUB_YEAR },
      pubM: { raw: metadata.pubM, spec: PUB_MONTH },
      pubD: { raw: metadata.pubD, spec: PUB_DAY },
    })
    if (!publication.ok) {
      setPublicationErrors(publication.errors)
      return
    }
    const parsedPub = {
      y: publication.values.pubY,
      m: publication.values.pubM,
      d: publication.values.pubD,
    }
    const dateError = publicationDateError(parsedPub)
    if (dateError) {
      setPublicationErrors({
        [dateError.field === 'year' ? 'pubY' : dateError.field === 'month' ? 'pubM' : 'pubD']:
          dateError.message,
      })
      return
    }
    const publicationText =
      parsedPub.y == null
        ? ''
        : [
            String(parsedPub.y),
            ...(parsedPub.m == null ? [] : [String(parsedPub.m).padStart(2, '0')]),
            ...(parsedPub.d == null ? [] : [String(parsedPub.d).padStart(2, '0')]),
          ].join('-')
    const parsedPages = parseNumericField(form.pages, PAGE_COUNT)
    if (!parsedPages.ok) {
      setPagesError(parsedPages.error)
      return
    }
    const f = form.format.toLowerCase()
    const isEbook = f.includes('ebook') || f.includes('kindle')
    const isAudio = f.includes('audio')
    // Format flags always record the edition in hand OR the edition you're eyeing — on a
    // wishlist add they sit latent (bookOwnedFormats suppresses them until the book is in hand),
    // so flipping to Owned later lands with the right copy already marked.
    const owned: Owned = {
      physical: f.includes('hardcover')
        ? 'hardcover'
        : f.includes('paperback')
          ? 'paperback'
          : f === 'physical' || f === 'special edition'
            ? true
            : false,
      ebook: isEbook,
      audiobook: isAudio,
    }
    const { first, last } = toFirstLast(contribs)
    const editedIdentity = workKeyOf({ title: form.title.trim(), last: formatAuthors(contribs) })
    const pickedIdentity = workKeyOf({
      title: hit.title ?? '',
      last: formatAuthors(contributorsFromAuthors(hit.authors ?? [])),
    })
    const edition = hit.edition
      ? {
          ...newEdition(selectedFormat),
          id: editionIds.edition,
          isbn: releaseMatches || isbnEdited.current ? form.isbn.trim() : '',
          published: releaseMatches || releaseFieldsEdited.current.pub ? publicationText : '',
          publisher: releaseMatches ? hit.edition.publisher : '',
          pages: releaseMatches || releaseFieldsEdited.current.pages ? parsedPages.value : null,
          cover: validEditionCover(cover) ? cover : '',
          ...(releaseMatches ? { sourceUrl: hit.edition.sourceUrl } : {}),
        }
      : null
    const inventory = edition
      ? {
          version: 1 as const,
          editions: [edition],
          copies: [
            {
              ...newCopy(edition.id, possession),
              id: editionIds.copy,
            },
          ],
        }
      : null
    const book: Partial<Book> & { title: string } = {
      // A corpus pick is a binding, not a suggestion to carry across arbitrary title/author edits.
      // Clearing it here lets the database resolve the edited bibliography (ISBN first, then the
      // Unicode title/full-author key) instead of rejecting a stale supplied UUID.
      corpusWorkId:
        hit.corpusWorkId &&
        editedIdentity === pickedIdentity &&
        normalizeIsbn(form.isbn) === normalizeIsbn(hit.isbn ?? '')
          ? hit.corpusWorkId
          : undefined,
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
      seriesCount: parsedSeriesCount.value,
      status: form.status as SeriesStatus,
      genre: form.genre.trim(),
      subgenre: subs[0] ?? '',
      subgenres: subs,
      // Bug fix: this used to be `subs.slice(0, 1)` — the first SUBGENRE (e.g. 'dark romance'),
      // not the CORE genre. genres[] must hold CORE_GENRES keys like the rest of the app expects
      // (import's normalizeImportGenres, filters.ts's search blob, merge_books) — same value as
      // `genre` above, just array-shaped so a second genre tag (added via Edit details) has
      // somewhere to live without a later edit silently overwriting it back to one.
      genres: normalizeBookGenres([form.genre, ...extraGenres]),
      // Tropes are tagged on the saved book via the full picker (book_tropes needs a saved id);
      // no lightweight freeform tags here — the structured trope system is the one source of truth.
      rating,
      intensity,
      darkness,
      ...possessionPatch(possession),
      owned,
      cover,
      isbn: hit.edition && !releaseMatches && !isbnEdited.current ? '' : form.isbn.trim(),
      format: form.format,
      readStatus: form.readStatus,
      source: 'Owned',
      pub:
        hit.edition && !releaseMatches && !releaseFieldsEdited.current.pub
          ? parsePub('')
          : parsedPub,
      pages:
        hit.edition && !releaseMatches && !releaseFieldsEdited.current.pages
          ? null
          : parsedPages.value,
      ...(inventory ? { copyInventory: inventory, ...inventoryPossession(inventory) } : {}),
    }
    reviewHousehold.current = addToHousehold
    setReview(book)
    setReviewOpen(true)
  }

  async function confirmReview() {
    if (!review) return
    await saveState.run('save', async (newId) => {
      await refreshBooks({ throwOnError: true })
      const res = await intake(review, 'review', newId, true, session?.user.id)
      if (res.outcome === 'review' && res.review) {
        setReviewOpen(false)
        setDup(res.review)
        return
      }
      if (!res.bookId) throw new Error('No confirmed book')
      await finishSavedBook(res.bookId)
    })
  }

  async function finishSavedBook(bookId: string, existingEdition = false) {
    if (reviewHousehold.current) {
      try {
        await addPersonalBooksToHousehold.mutateAsync([bookId])
      } catch {
        setHouseholdWarning(
          'The personal book was saved, but the household entry could not be added. Try Household only after reconnecting.',
        )
      }
    }
    setAddedExistingEdition(existingEdition)
    setAddedId(bookId)
    onSaved?.(bookId)
  }

  async function reviewEditionWithExistingBook() {
    if (!dup?.incoming.copyInventory || editionTargetBusy) return
    setEditionTargetBusy(true)
    setEditionTargetError(null)
    try {
      const fresh = await refreshBooks({ throwOnError: true })
      const existing = fresh.data?.find((book) => book.id === dup.existingId)
      if (!existing) throw new Error('The matching book is unavailable')
      setEditionTarget({
        book: existing,
        inventory: prepareCopyInventoryWithIncoming(existing, dup.incoming.copyInventory),
      })
    } catch (cause) {
      setEditionTargetError(
        cause instanceof Error
          ? cause.message
          : 'The existing copies could not be loaded. Nothing was changed.',
      )
    } finally {
      setEditionTargetBusy(false)
    }
  }

  async function resolveDup(action: 'merge' | 'keep_both') {
    if (!dup) return
    await saveState.run(action, async (newId) => {
      // Review choices must use the current record, including any fields saved before a lost response.
      const fresh = await refreshBooks({ throwOnError: true })
      const existing = fresh.data?.find((book) => book.id === dup.existingId)
      if (!existing) throw new Error('The matching book is unavailable')
      const resolvedBookId = await resolveCandidate(dup, existing, action, undefined, newId)
      if (!resolvedBookId) throw new Error('No confirmed book')
      await qc.invalidateQueries({ queryKey: ['books'] })
      await qc.invalidateQueries({ queryKey: ['reads', 'all'] })
      setDup(null)
      await finishSavedBook(resolvedBookId)
    })
  }

  if (addedId)
    return (
      <RefineAdded
        bookId={addedId}
        householdWarning={householdWarning}
        onDone={onAdded}
        returnLabel={returnLabel}
        editionAdded={addedExistingEdition}
      />
    )

  return (
    <Surface radius="panel" tone="card" pad={3} className="mt-4">
      {!saveState.recoveredBookId &&
        (batchPending || hasDraftChanges || saveState.busy || !!saveState.error) && (
          <DraftExitGuard busy={saveState.busy} />
        )}
      <h2 className="text-xl text-ink" style={{ fontFamily: 'var(--font-display)' }}>
        Quick Add
      </h2>
      <p className="mt-1 text-sm text-muted">
        Start with the basics. Review before saving, then add more from your book.
      </p>
      <fieldset
        disabled={saveState.busy || !!dup || !!saveState.error || !!saveState.recoveredBookId}
        className="min-w-0"
      >
        <div className="book-editor">
          <BookMetadataFields
            quick
            value={metadata}
            onChange={changeMetadata}
            contributors={contribs}
            onContributorsChange={setContribs}
            suggestions={authorSuggestions}
            subgenres={subs}
            onSubgenresChange={setSubs}
            extraGenres={extraGenres}
            onExtraGenresChange={setExtraGenres}
            validationAttempt={validationAttempt}
            errors={{
              isbn: isbnError,
              title: titleError,
              position: positionError ?? undefined,
              seriesCount: seriesCountError,
              pages: pagesError ?? undefined,
              ...publicationErrors,
            }}
            cover={
              <>
                <div className="flex items-center gap-4">
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
              </>
            }
            editionNotice={
              <>
                {hit.edition && (
                  <Surface
                    tone="field"
                    radius="card"
                    pad={3}
                    className="mt-3 text-sm leading-relaxed"
                  >
                    <p className="font-semibold text-ink">Selected release edition</p>
                    <p className="text-muted">
                      The date below belongs to this edition, not necessarily the book’s first
                      publication. Review it before saving.
                    </p>
                    <a
                      href={hit.edition.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center text-ink underline"
                    >
                      Release listing ↗
                    </a>
                    {releaseMatches && hit.isbn && (
                      <p className="break-all text-ink">ISBN {hit.isbn}</p>
                    )}
                    {!releaseMatches && (
                      <p role="status" className="text-ink">
                        The title, authors, ISBN or format no longer match this release. Its
                        inherited edition details will be left out. Only an ISBN, date or page count
                        you enter yourself will be kept.
                      </p>
                    )}
                  </Surface>
                )}
                {hit.source === 'google' && hit.sourceUrl && (
                  <div className="mt-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <GoogleBooksAttribution />
                      <GoogleBooksResultLink result={hit} />
                    </div>
                    <p className="mt-2 text-[12px] text-muted">
                      {APP_NAME} will keep the book details and look for a cover that can stay with
                      your library.
                    </p>
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
                            border:
                              cover === a.cover
                                ? '2px solid var(--primary)'
                                : '1px solid var(--line)',
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
              </>
            }
          />
          <details className="my-3">
            <summary className="min-h-11 cursor-pointer py-3 text-sm text-ink">
              Reading details (optional)
            </summary>
            <BookEditorSection id="reading" title="Your reading">
              <BookRating
                value={rating}
                onChange={setRating}
                disabled={saveState.busy || !!dup || !!saveState.recoveredBookId}
              />
              <BookReadingStatus
                value={form.readStatus}
                onChange={(status) => set('readStatus', status)}
              />
              <LevelPicker
                label={labels.intensity}
                glyph={labels.intensityGlyph}
                levels={labels.intensityLevels}
                value={intensity ?? 0}
                onChange={setIntensity}
                name="intensity"
              />
              <LevelPicker
                label={labels.darkness}
                glyph={labels.darknessGlyph}
                levels={labels.darknessLevels}
                value={darkness ?? 0}
                onChange={setDarkness}
                name="darkness"
              />
            </BookEditorSection>
          </details>
          <BookEditorSection id="copies" title="Your copies">
            {/* Ownership — a record no longer implies possession; most of a TBR is books you don't own. */}
            <div className="mt-3">
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.15em] text-muted">
                Ownership
              </div>
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
                    <span className="block text-[12.5px] font-semibold">
                      {OWNERSHIP_LABELS[value]}
                    </span>
                    <span className="block text-[10px] font-normal italic">{sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </BookEditorSection>
        </div>
      </fieldset>
      {reviewOpen && review && (
        <Modal
          title="Review your book"
          onClose={() => {
            if (!saveState.busy) setReviewOpen(false)
          }}
        >
          <p data-book-add-review className="text-sm text-muted">
            {saveState.error
              ? 'Check the save result below before continuing. Your original information is preserved.'
              : 'Nothing is saved until you confirm. Check the information below; you can add the rest later.'}
          </p>
          <p className="mt-2 text-sm text-muted">
            Starting information:{' '}
            {hit.corpusWorkId
              ? 'shared catalog'
              : hit.source === 'hardcover'
                ? 'Hardcover'
                : hit.source === 'google'
                  ? 'Google Books'
                  : 'your entry'}
            . Check it against your copy.
          </p>
          {coverNote && <p className="mt-2 text-sm text-ink">{coverNote}</p>}
          <BookAddReview
            book={review}
            destination={reviewHousehold.current ? 'Your library + Household' : 'Your library'}
          />
          {saveState.error && (
            <p role="alert" className="mt-3 text-sm text-ink">
              {saveState.error}
            </p>
          )}
          {saveState.recoveredBookId ? (
            <Link
              to="/book/$bookId"
              params={{ bookId: saveState.recoveredBookId }}
              className="mt-3 block min-h-11 text-ink underline"
            >
              Review saved book
            </Link>
          ) : (
            <button
              type="button"
              disabled={saveState.busy}
              data-book-tour="book-confirm"
              onClick={() => void confirmReview()}
              className="mt-4 min-h-11 w-full skin-control skin-btn-primary px-4 text-sm font-semibold"
            >
              {saveState.busy
                ? 'Saving…'
                : saveState.error
                  ? 'Try saving again'
                  : 'Confirm and add'}
            </button>
          )}
          <button
            type="button"
            disabled={saveState.busy}
            onClick={() => setReviewOpen(false)}
            className="mt-2 min-h-11 w-full skin-control skin-btn-secondary px-4 text-sm"
          >
            {saveState.error ? 'Close review' : 'Back to information'}
          </button>
        </Modal>
      )}
      {dup && (
        <Surface radius="card" tone="field" pad={2} className="mt-4 text-[13px]">
          <p className="text-ink">
            You may already have <span className="font-semibold">{dup.existingTitle}</span>
            {dup.existingAuthor ? ` · ${dup.existingAuthor}` : ''}.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {hit.edition ? (
              <>
                <button
                  type="button"
                  onClick={() => void reviewEditionWithExistingBook()}
                  disabled={editionTargetBusy || saveState.busy || !!saveState.recoveredBookId}
                  className="skin-control min-h-11 px-3 py-1.5 text-[12.5px] font-semibold text-on-primary"
                  style={{ background: 'var(--accent-fill)' }}
                >
                  {editionTargetBusy ? 'Loading copies…' : 'Add edition to existing book'}
                </button>
                <Link
                  to="/book/$bookId"
                  params={{ bookId: dup.existingId }}
                  className="skin-control min-h-11 px-3 py-2 text-ink underline"
                >
                  Open existing book
                </Link>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void resolveDup('merge')}
                disabled={
                  saveState.busy ||
                  !!saveState.recoveredBookId ||
                  (saveState.failedAction !== null && saveState.failedAction !== 'merge')
                }
                className="skin-control min-h-11 px-3 py-1.5 text-[12.5px] font-semibold text-on-primary"
                style={{ background: 'var(--accent-fill)' }}
              >
                {saveState.failedAction === 'merge' ? 'Try merging again' : 'Merge into it'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void resolveDup('keep_both')}
              disabled={
                saveState.busy ||
                !!saveState.recoveredBookId ||
                (saveState.failedAction !== null && saveState.failedAction !== 'keep_both')
              }
              className="skin-control min-h-11 border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink"
              style={{ background: 'var(--card)' }}
            >
              {saveState.failedAction === 'keep_both' ? 'Try keeping both again' : 'Keep both'}
            </button>
            <button
              type="button"
              onClick={() => setDup(null)}
              disabled={saveState.busy || saveState.failedAction !== null}
              className="skin-control min-h-11 px-3 py-1.5 text-[12.5px] font-semibold text-muted"
            >
              Cancel
            </button>
          </div>
          {editionTargetError && (
            <p role="alert" className="mt-2 text-[13px] text-ink">
              {editionTargetError}
            </p>
          )}
        </Surface>
      )}

      {editionTarget && (
        <CopyEditor
          book={editionTarget.book}
          initialInventory={editionTarget.inventory}
          title="Add edition to existing book"
          intro="Review the selected release with your existing editions and copies. Nothing changes until you save. Reading progress, notes and history stay with the book."
          submitLabel="Add edition & copy"
          onClose={() => setEditionTarget(null)}
          onSaved={async (saved) => {
            setEditionTarget(null)
            setDup(null)
            await finishSavedBook(saved.id, true)
          }}
        />
      )}

      {saveState.error && !reviewOpen && (
        <div className="mt-4 text-[14px] text-ink">
          <p role="alert">{saveState.error}</p>
          {saveState.recoveredBookId && (
            <Link
              to="/book/$bookId"
              params={{ bookId: saveState.recoveredBookId }}
              className="skin-control skin-btn-secondary mt-3 inline-flex min-h-11 items-center px-4"
            >
              Review saved book
            </Link>
          )}
        </div>
      )}
      {saveState.busy && (
        <p role="status" className="mt-4 text-[14px] text-muted">
          Saving your book…
        </p>
      )}
      <div
        className="mt-4 empty:hidden"
        data-book-tour-inline="book-save"
        data-book-tour-inline-desktop
      />
      <button
        type="button"
        onClick={() => (saveState.error && review ? setReviewOpen(true) : void save())}
        data-book-tour="book-save"
        disabled={saveState.busy || !!saveState.recoveredBookId || !!dup}
        aria-busy={saveState.busy}
        className="mt-4 h-11 w-full skin-control text-[14px] font-semibold"
        style={{
          background: 'linear-gradient(135deg, var(--primary), var(--gold))',
          color: 'var(--on-primary)',
        }}
      >
        {saveState.busy
          ? 'Saving…'
          : saveState.error && !dup && !saveState.recoveredBookId
            ? 'Try saving again'
            : 'Review book'}
      </button>
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
  const [reviewing, setReviewing] = useState(false)
  const [saved, setSaved] = useState(false)
  const saving = useRef(false)
  const currentMember = household.members.find((member) => member.userId === session?.user.id)
  const canCreate = !!currentMember
  const canPersistPickedCover =
    hit.source !== 'google' && (currentMember?.role === 'owner' || isCorpusAdmin)
  const pending = addExisting.isPending || createWork.isPending || addToMember.isPending
  const completed = useRef(false)
  const initialDraft = useRef(JSON.stringify([title, author, isbn]))
  const hasDraftChanges = JSON.stringify([title, author, isbn]) !== initialDraft.current

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
        if (!targetMemberId) {
          completed.current = true
          setSaved(true)
          setReviewing(false)
          return
        }
      }
      workId = result.workId
    }
    if (targetMemberId && workId) {
      await addToMember.mutateAsync({ workId, memberId: targetMemberId })
    }
    completed.current = true
    setSaved(true)
    setReviewing(false)
  }

  async function handleSave() {
    if (saving.current) return
    saving.current = true
    setSaveError('')
    try {
      await save()
    } catch {
      setSaveError(
        targetMemberId
          ? `The shared entry may have been added, but ${targetMemberName ?? 'the selected member'}’s personal book could not be created. Reconnect and try that destination again.`
          : 'The household entry could not be added. Reconnect and try again.',
      )
    } finally {
      saving.current = false
    }
  }

  if (saved)
    return (
      <Surface radius="panel" tone="card" pad={3} className="mt-4">
        <h2 className="text-xl text-ink">The household entry was saved</h2>
        <p className="mt-2 text-sm text-ink [overflow-wrap:anywhere]">{title}</p>
        {coverWarning && (
          <p role="status" className="mt-2 text-sm text-muted">
            {coverWarning}
          </p>
        )}
        <button
          type="button"
          onClick={onAdded}
          className="mt-4 min-h-11 w-full skin-control skin-btn-primary px-4 text-sm"
        >
          View household library
        </button>
      </Surface>
    )

  return (
    <Surface radius="panel" tone="card" pad={3} className="mt-4">
      {(hasDraftChanges || pending || !!saveError) && (
        <DraftExitGuard busy={pending} canLeave={() => completed.current || !!coverWarning} />
      )}
      {reviewing && (
        <Modal
          title="Review household entry"
          onClose={() => {
            if (!saving.current) setReviewing(false)
          }}
        >
          <BookAddReview
            book={{
              title,
              contributors: contributorsFromAuthors([author]),
              isbn,
              cover: canPersistPickedCover ? hit.cover : '',
              ownership: 'unowned',
              readStatus: 'unset',
            }}
            destination={
              targetMemberId ? `${targetMemberName ?? 'Member'} + Household` : 'Household only'
            }
          />
          <p className="mt-3 text-sm text-muted">
            This creates a shared catalog entry. It does not say that anyone owns or has read the
            book.
            {targetMemberId
              ? ' A neutral personal book is also added for the selected member.'
              : ' No personal book will be created.'}
          </p>
          {saveError && (
            <p role="alert" className="mt-3 text-sm text-ink">
              {saveError}
            </p>
          )}
          {coverWarning && (
            <p role="status" className="mt-3 text-sm text-ink">
              {coverWarning}
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => void handleSave()}
            className="mt-4 min-h-11 w-full skin-control skin-btn-primary px-4 text-sm"
          >
            {pending ? 'Adding…' : 'Confirm and add'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setReviewing(false)}
            className="mt-2 min-h-11 w-full skin-control skin-btn-secondary px-4 text-sm"
          >
            Back to information
          </button>
        </Modal>
      )}
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
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-3">
            <GoogleBooksAttribution />
            <GoogleBooksResultLink result={hit} />
          </div>
          <p className="mt-2 text-[12px] text-muted">
            {APP_NAME} will keep the book details and look for a cover that can stay with the shared
            library.
          </p>
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
          onClick={() => setReviewing(true)}
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
  const origin = useAddReturn()
  const { state: bookTour } = useBookTour()
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
  const { results, searched, busy, issue: searchIssue, search, cancel } = useAddSearch()
  const [picked, setPicked] = useState<Picked | null>(() => pickedFromAddPrefill(prefill))
  useBookTourObservation(picked ? null : !busy && results?.length ? 'choose' : 'search')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanBatch, setScanBatch] = useState<{ owner: string; items: BarcodeCapture[] }>({
    owner: '',
    items: [],
  })
  const [activeCapture, setActiveCapture] = useState<string | null>(null)
  const [bulkRows, setBulkRows] = useState<BulkAddRow[]>([])
  const [activeBulkId, setActiveBulkId] = useState<string | null>(null)
  const scanOwner = session?.user.id ?? ''
  const scanItems = scanBatch.owner === scanOwner ? scanBatch.items : []
  const changeScans = (items: BarcodeCapture[]) => setScanBatch({ owner: scanOwner, items })
  const returnToScans = () => {
    if (!activeCapture || !scanItems.some((item) => item.id === activeCapture)) return false
    // Called only by the existing confirmed-save continuation; lookup never consumes a capture.
    changeScans(scanItems.filter((item) => item.id !== activeCapture))
    setActiveCapture(null)
    setPicked(null)
    cancel()
    setQ('')
    setScannerOpen(true)
    return true
  }
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

  function runSearch(term = q, fromCapture = false) {
    setActiveBulkId(null)
    if (!fromCapture) setActiveCapture(null)
    if (term.trim().length >= 3) setPicked(null)
    return search(term)
  }

  function pickBook(book: Picked) {
    cancel()
    setPicked(book)
  }

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <button
        type="button"
        onClick={() =>
          origin
            ? origin.returnToOrigin()
            : void navigate({
                to: '/library',
                search: prefill.scope === 'household' ? { scope: 'household' } : {},
              })
        }
        className="mb-3 min-h-11 text-[14px] text-ink underline"
      >
        {(
          origin?.label ??
          (prefill.scope === 'household' ? 'Return to your household' : 'Return to your library')
        ).replace('Return to', 'Back to')}
      </button>
      {!householdOnly && <StartBookTour label="Guide me through adding" quiet />}
      <h1
        className="text-[22px] italic text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
      >
        Add a book
      </h1>
      {!picked && (
        <p className="mb-4 text-[13px] text-muted">
          Scan a barcode, search by title or ISBN, or add manually. Choose the destination before
          you save.
        </p>
      )}

      <AddDestinationPicker
        value={destination}
        onChange={(next) => {
          destinationChosen.current = true
          setDestination(next)
        }}
        members={household.authorized ? household.members : []}
        currentReaderId={session?.user.id ?? ''}
      />

      <details open={!picked} className="my-3">
        <summary hidden={!picked} className="min-h-11 cursor-pointer py-2 text-sm text-ink">
          Search or choose another book
        </summary>
        <div className="flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch()
            }}
            placeholder="Title, author, or ISBN"
            aria-label="Search for a book"
            aria-describedby={searchIssue ? 'add-search-issue' : undefined}
            aria-invalid={searchIssue === 'short' || undefined}
            data-book-tour="book-search"
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
            onClick={() => setScannerOpen(true)}
            disabled={!!picked}
            title={
              picked ? 'Finish this book review before returning to the scan batch' : undefined
            }
            className="h-11 skin-control border border-line px-5 text-[14px] font-semibold text-ink"
            style={{ background: 'var(--card)' }}
          >
            {scanItems.length ? `Scan books · ${scanItems.length}` : '📷 Scan books'}
          </button>
          {/* A peer of Search and Scan, as the intro copy has always promised. It used to appear ONLY
            in the results-empty branch — so a search that returned the WRONG books (rather than
            none) left no way in, and the reader had to adopt a wrong hit or search gibberish to
            force the empty state. The form already accepts a bare { title }. */}
          <button
            type="button"
            onClick={() => {
              setActiveBulkId(null)
              pickBook({ title: bookBarcode(q) ? '' : q.trim(), isbn: bookBarcode(q) || undefined })
            }}
            className="h-11 skin-control border border-line px-5 text-[14px] font-semibold text-ink"
            style={{ background: 'var(--card)' }}
          >
            Add manually
          </button>
        </div>
      </details>
      <div className="mt-3 empty:hidden" data-book-tour-inline="book-search" />

      {scannerOpen && (
        <Modal title="Scan books" onClose={() => setScannerOpen(false)} wide>
          <BarcodeBatch
            key={scanOwner}
            items={scanItems}
            onChange={changeScans}
            onReview={(item) => {
              setActiveCapture(item.id)
              setScannerOpen(false)
              setQ(item.isbn)
              void runSearch(item.isbn, true)
            }}
            onNoIsbn={() => {
              setActiveCapture(null)
              setScannerOpen(false)
              pickBook({ title: '' })
            }}
          />
        </Modal>
      )}

      {busy && (
        <p role="status" className="mt-4 text-center text-[13px] text-muted">
          Searching…
        </p>
      )}
      {searchIssue && (
        <Surface radius="card" tone="card" pad={3} className="mt-4">
          <p id="add-search-issue" role="alert" className="text-[14px] text-ink">
            {searchIssue === 'short'
              ? 'Enter at least 3 characters to search, or add the book manually.'
              : 'Search is unavailable right now. Try again, or add the book manually.'}
          </p>
          {searchIssue === 'unavailable' && (
            <button
              type="button"
              onClick={() => void runSearch()}
              className="skin-control skin-btn-secondary mt-3 min-h-11 px-4 text-[14px]"
            >
              Try search again
            </button>
          )}
        </Surface>
      )}

      {results && !picked && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="empty:hidden" data-book-tour-inline="book-results" />
          {results.length ? (
            <div
              className="space-y-6"
              data-testid="add-results"
              data-book-tour="book-results"
              tabIndex={-1}
            >
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
                        onPick={pickBook}
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
                        onPick={pickBook}
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
                onClick={() =>
                  pickBook({
                    title: bookBarcode(q) ? '' : q.trim(),
                    isbn: bookBarcode(q) || undefined,
                  })
                }
                className="font-semibold text-primary"
              >
                Add it manually
              </button>
              .
            </p>
          )}
        </div>
      )}

      {prefill.releaseWindow && (
        <Link
          to="/discover"
          search={{
            view: 'releases',
            window: prefill.releaseWindow,
            editions: prefill.releaseEditions,
          }}
          className="my-4 inline-flex min-h-11 items-center text-ink underline"
        >
          Return to releases
        </Link>
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
            onAdded={() => {
              if (activeBulkId) {
                setActiveBulkId(null)
                setPicked(null)
                return
              }
              if (returnToScans()) return
              if (origin) return origin.returnToOrigin()
              return prefill.discoverSession
                ? void navigate({ to: '/discover', search: { session: prefill.discoverSession } })
                : void navigate({ to: '/library', search: { scope: 'household' } })
            }}
          />
        ) : (
          <AddForm
            key={JSON.stringify(picked)}
            hit={picked}
            batchPending={bulkRows.some((row) => !row.bookId)}
            onSaved={(bookId) => {
              if (activeBulkId)
                setBulkRows((rows) =>
                  rows.map((row) => (row.id === activeBulkId ? { ...row, bookId } : row)),
                )
            }}
            defaultUnowned={!!prefill.want}
            addToHousehold={destination === 'both'}
            returnLabel={
              activeBulkId
                ? 'Continue with your list'
                : activeCapture && scanItems.some((item) => item.id === activeCapture)
                  ? 'Continue with scanned books'
                  : bookTour.status !== 'off' && bookTour.bookId
                    ? 'Return to your library'
                    : prefill.releaseWindow
                      ? 'Return to releases'
                      : prefill.discoverSession
                        ? 'Return to your shortlist'
                        : (origin?.label ?? 'Return to your library')
            }
            onAdded={() => {
              if (activeBulkId) {
                setActiveBulkId(null)
                setPicked(null)
                return
              }
              if (returnToScans()) return
              return bookTour.status !== 'off' && bookTour.bookId
                ? void navigate({ to: '/library', search: {} })
                : origin
                  ? origin.returnToOrigin()
                  : prefill.releaseWindow
                    ? void navigate({
                        to: '/discover',
                        search: {
                          view: 'releases',
                          window: prefill.releaseWindow,
                          editions: prefill.releaseEditions,
                        },
                      })
                    : prefill.discoverSession
                      ? void navigate({
                          to: '/discover',
                          search: { session: prefill.discoverSession },
                        })
                      : void navigate({
                          to: '/library',
                          search: destination === 'both' ? { scope: 'household' } : {},
                        })
            }}
          />
        ))}

      <BulkAddQueue
        rows={bulkRows}
        onChange={setBulkRows}
        hidden={!!picked || householdOnly}
        guardExit={!picked || !!bulkRows.find((row) => row.id === activeBulkId)?.bookId}
        onReview={(row, result) => {
          setActiveBulkId(row.id)
          setActiveCapture(null)
          pickBook(
            result
              ? hitOf(result)
              : {
                  title: bookBarcode(row.query) ? '' : row.query,
                  isbn: bookBarcode(row.query) || undefined,
                },
          )
        }}
      />
    </section>
  )
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/** All-optional prefill params — the explicit optional-key type keeps plain `to="/add"` links
 *  valid everywhere (no required `search` prop). */
interface AddPrefill {
  discoverSession?: string
  edition?: ReleaseHandoff
  releaseWindow?: 'recent' | 'upcoming'
  releaseEditions?: boolean
  /** add to the collective household library without creating a personal book */
  scope?: 'household'
  /** exact shared-work identity when the pick came from the Reverie corpus */
  work?: string
  title?: string
  author?: string
  authors?: string[]
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
  const candidate = parseReleaseHandoff(prefill.edition)
  const authors = prefill.authors?.length ? prefill.authors : prefill.author ? [prefill.author] : []
  const edition =
    candidate &&
    candidate.title === prefill.title &&
    JSON.stringify(candidate.authors) === JSON.stringify(authors) &&
    (candidate.isbn
      ? normalizeIsbn(candidate.isbn) === normalizeIsbn(prefill.isbn ?? '')
      : !prefill.isbn) &&
    candidate.pub === (prefill.pub ?? '')
      ? candidate
      : undefined
  return {
    corpusWorkId: prefill.work,
    title: prefill.title,
    authors: prefill.authors?.length ? prefill.authors : prefill.author ? [prefill.author] : [],
    cover: prefill.source === 'google' && !prefill.work ? '' : (prefill.cover ?? ''),
    source: edition ? (edition.source === 'hardcover' ? 'hardcover' : undefined) : prefill.source,
    edition,
    sourceUrl: edition?.sourceUrl ?? prefill.sourceUrl,
    isbn:
      edition?.isbn ??
      (prefill.source === 'hardcover' && !prefill.work ? '' : (prefill.isbn ?? '')),
    pub:
      edition?.pub ?? (prefill.source === 'hardcover' && !prefill.work ? '' : (prefill.pub ?? '')),
  }
}

export const validateAddSearch = (s: Record<string, unknown>): AddPrefill => {
  const out: AddPrefill = {}
  if ('edition' in s) out.edition = parseReleaseHandoff(s.edition)
  if (s.releaseWindow === 'recent' || s.releaseWindow === 'upcoming')
    out.releaseWindow = s.releaseWindow
  if (s.releaseEditions === true || s.releaseEditions === 'true') out.releaseEditions = true
  if (
    typeof s.discoverSession === 'string' &&
    /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(s.discoverSession)
  )
    out.discoverSession = s.discoverSession
  if (s.scope === 'household') out.scope = 'household'
  if (str(s.work)) out.work = str(s.work)
  if (str(s.title)) out.title = str(s.title)
  if (str(s.author)) out.author = str(s.author)
  if (
    Array.isArray(s.authors) &&
    s.authors.length <= 20 &&
    s.authors.every((a) => typeof a === 'string' && a.trim().length > 0 && a.length <= 200)
  )
    out.authors = s.authors as string[]
  // The router JSON-parses unquoted numeric query values. ISBNs are identifiers, so turn a
  // losslessly parsed, valid numeric ISBN back into text; never reconstruct missing digits.
  // Explicitly clear invalid supplied values so the raw query cannot leak through route merging.
  if ('isbn' in s)
    out.isbn =
      typeof s.isbn === 'number' && Number.isSafeInteger(s.isbn) && normalizeIsbn(String(s.isbn))
        ? String(s.isbn)
        : (str(s.isbn) ?? '')
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
