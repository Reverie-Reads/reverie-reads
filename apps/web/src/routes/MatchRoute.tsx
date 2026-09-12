import { ReadingTips } from '../components/ReadingTips'
import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createRoute, useNavigate } from '@tanstack/react-router'
import {
  beginReadingPatch,
  buildMatchContext,
  isBookRead,
  nextReadCandidates,
  type NextReadOptions,
  type NextReadScope,
  CORE_GENRES,
  scoreMatch,
  type Book,
  type MatchProfile,
  type MatchReason,
} from '@reverie/core'
import { Surface } from '../components/Surface'
import { rootRoute } from './RootRoute'
import { NextReadCardView } from '../components/NextReadCardView'
import { useUpdateBook } from '../data/books'
import { useReaderBooks } from '../data/readerBooks'
import { useCreateList, useLists } from '../data/lists'
import { useAddBooksToList } from '../data/listItems'
import { useDismissed, useDismissBook, useLegacyDismissalSync } from '../data/matchFeedback'
import { useEnsureEmbeddings, useVibeSearch, type SimilarHit } from '../data/similar'
import {
  applyAnswer,
  buildQuizProfile,
  emptyAnswers,
  HEAT,
  INTENSITY,
  QUIZ,
  type QuizAnswers,
} from '../library/quiz'

export interface Pick {
  b: Book
  s: number
  isRead: boolean
  /** the pick's top reason, already worded (Tier 0: every score is explainable) */
  why: string
}

/** One human line from the structured reasons — series momentum first (the strongest story),
 *  then matched cravings, then world/heat fit. */
function whyLine(reasons: MatchReason[]): string {
  const series = reasons.find((r) => r.key === 'series')
  if (series?.series?.lovedEarlier) return `Next in ${series.series.name} — a series you love`
  const tags = reasons.find((r) => r.key === 'tags')
  if (tags?.matchedTags?.length) return `Matches ${tags.matchedTags.slice(0, 2).join(' · ')}`
  const taste = reasons.find((r) => r.key === 'tasteTags')
  if (taste?.lovedTags?.length)
    return `Close to your loves: ${taste.lovedTags.slice(0, 2).join(' · ')}`
  const sub = reasons.find((r) => r.key === 'subgenre')
  if (sub && sub.value >= 0.9) return 'Squarely your world'
  // The quiz scores DARKNESS since the axis split, so this line no longer describes heat.
  const dark = reasons.find((r) => r.key === 'darkness')
  if (dark && dark.value >= 0.9) return 'Pitched right for how heavy you want it'
  return 'From your personal library'
}

/** Title-case a lowercased primary-genre key back to its CORE_GENRES display spelling. */
const genreLabel = (key: string): string =>
  CORE_GENRES.find((g) => g.toLowerCase() === key) ?? key.replace(/\b\w/g, (c) => c.toUpperCase())

const modeOf = (m: Map<string, number>): string | undefined =>
  [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]

/** Result vocabulary drawn from the MATCHED books, not a fixed romance script (task §3). The headline
 *  and pills describe what was actually surfaced — the dominant subgenre/genre, its real tropes, and
 *  a representative level — so a horror result reads like horror and a literary one like literary.
 *
 *  THE LEVEL PILL READS WHICHEVER AXIS IT IS ABOUT TO NAME. A romance-leaning result shows spice
 *  (🌶️ + a HEAT word) and therefore reads `intensity`; every other result shows a neutral
 *  INTENSITY word and therefore reads `darkness`. Before the axis split (#330) there was one column
 *  and one source, and this function kept reading `intensity` for both — so a non-romance result
 *  picked a darkness word and fed it a median of SPICE values, describing books by an axis it was
 *  not naming. Which field to read depends on `domGenreKey`, so the genre mode is computed FIRST,
 *  in its own pass, and the collection pass below uses it. */
// Exported for `matchPill.test.ts`. NOT the dead-export-wearing-tests shape AGENTS.md warns about:
// it has a live intra-file caller (`score`, below), so exporting adds a test seam rather than
// creating an unreachable symbol. The alternative — asserting the pill through the route in e2e —
// could not isolate WHICH column fed the number, which is the whole defect.
export function describeMatches(
  picks: Pick[],
  a: QuizAnswers,
): { headline: string; sub: string; tags: string[] } {
  const top = picks.slice(0, 8).map((p) => p.b)
  if (!top.length) {
    return {
      headline: 'Nothing quite fits tonight',
      sub: 'Try a different mood or retake the quiz',
      tags: [],
    }
  }
  // Pass 1 — genre mode only, because the pass below needs it to know which axis it is sampling.
  // `top` is at most 8 books, so a second walk costs nothing.
  const genreCount = new Map<string, number>()
  for (const b of top) if (b.genre) genreCount.set(b.genre, (genreCount.get(b.genre) ?? 0) + 1)
  const domGenreKey = modeOf(genreCount)

  // Pass 2 — everything else, now that the axis is known.
  const subCount = new Map<string, number>()
  const tropeCount = new Map<string, number>()
  const levels: number[] = []
  for (const b of top) {
    if (b.subgenre) subCount.set(b.subgenre, (subCount.get(b.subgenre) ?? 0) + 1)
    for (const t of b.tropes) tropeCount.set(t.name, (tropeCount.get(t.name) ?? 0) + 1)
    // Spice for a romance result, darkness for everything else — the same condition that picks the
    // WORD below, so the number and the vocabulary can never come from different columns.
    const v = domGenreKey === 'romance' ? b.intensity : b.darkness
    if (v != null) levels.push(v)
  }
  const domSub = modeOf(subCount)
  const domGenreLabel = domGenreKey ? genreLabel(domGenreKey) : undefined
  const headline = `${a.pace === 'slow' ? 'Slow-burn ' : ''}${domSub ?? domGenreLabel ?? 'Your shelves'}`

  const topTropes = [...tropeCount.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([t]) => t)
  const tags: string[] = []
  const sorted = [...levels].sort((x, y) => x - y)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (median != null) {
    const iv = Math.max(0, Math.min(5, Math.round(median)))
    const word = (domGenreKey === 'romance' ? HEAT[iv] : INTENSITY[iv]) ?? ''
    if (iv > 0 && word) tags.push(domGenreKey === 'romance' ? `${'🌶️'.repeat(iv)} ${word}` : word)
  }
  // add the parent genre only when the headline led with a subgenre (avoid echoing it)
  if (domGenreLabel && domGenreLabel.toLowerCase() !== headline.toLowerCase())
    tags.push(domGenreLabel)
  tags.push(...topTropes)
  return { headline, sub: 'Picked for your mood tonight', tags: [...new Set(tags)] }
}

export function rankNextReads(
  books: Book[],
  a: QuizAnswers,
  opts: NextReadOptions & { tasteOnly?: boolean; dismissedAt?: Record<string, number> } = {},
): { picks: Pick[]; headline: string; sub: string; tags: string[] } {
  // Build a genre-neutral profile from the quiz, then score with the core vibe matcher over the
  // library-derived context (tag rarity + series momentum + the LEARNED taste). The genre lean is
  // keyed off the lowercased primary-genre keys, so it steers any of the nine genres (the matcher
  // resolves subWeights[book.subgenre] ?? subWeights[book.genre]). Taste-only mode (Tier 1) skips
  // the quiz entirely: a mood-neutral profile over the standing taste.
  const profile: MatchProfile = opts.tasteOnly
    ? { subWeights: {}, wantTags: [], targetDarkness: null }
    : buildQuizProfile(a)
  const ctx = buildMatchContext(books, { dismissedAt: opts.dismissedAt })

  const scored: Pick[] = nextReadCandidates(books, opts)
    .map((b) => {
      const { score: s, reasons } = scoreMatch(b, profile, ctx)
      const isRead = isBookRead(b)
      return { b, s, isRead, why: whyLine(reasons) }
    })
    .sort((x, y) => y.s - x.s)

  const picks = scored.slice(0, 12)

  if (opts.tasteOnly) {
    // headline chips = the standing loves the profile actually learned
    const loves = Object.entries(ctx.taste?.tagAffinity ?? {})
      .filter(([, a2]) => a2 >= 0.3)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([t]) => t.replace(/\b\w/g, (c) => c.toUpperCase()))
    return {
      picks,
      headline: ctx.taste?.signalCount ? 'Chosen from your library' : 'A place to start',
      sub: ctx.taste?.signalCount
        ? 'Your reading history and preferences help order these picks.'
        : 'These are starting points. Add a mood or rate a past read to help narrow them down.',
      tags: loves,
    }
  }

  return { picks, ...describeMatches(picks, a) }
}

/** The service returns a bounded global shortlist. Scope it locally, preserve feedback, and
 * supplement it with explicitly identified library picks rather than imply an exhaustive search. */
export function rankMoodPicks(
  books: Book[],
  candidates: Book[],
  hits: SimilarHit[],
  dismissedAt: Record<string, number>,
): Pick[] {
  const byId = new Map(candidates.map((book) => [book.id, book]))
  const profile: MatchProfile = { subWeights: {}, wantTags: [], targetDarkness: null }
  const context = buildMatchContext(books)
  const feedbackContext = { ...context, dismissedAt }
  const seen = new Set<string>()
  return hits
    .flatMap((hit): Pick[] => {
      const book = byId.get(hit.book_id)
      if (!book || !Number.isFinite(hit.similarity) || seen.has(book.id)) return []
      seen.add(book.id)
      const penalty =
        scoreMatch(book, profile, context).score - scoreMatch(book, profile, feedbackContext).score
      return [
        {
          b: book,
          s: hit.similarity * 100 - penalty,
          isRead: isBookRead(book),
          why: 'Related to the mood you described',
        },
      ]
    })
    .sort((a, b) => b.s - a.s)
}

const moodCacheKey = (query: string) => ['next-read-mood', query] as const

export function validateMood(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d(?:\.\d){4}$/.test(value)) return undefined
  const choices = value.split('.').map(Number)
  return choices.every((choice, index) => !!QUIZ[index]?.opts[choice]) ? value : undefined
}

function restoredAnswers(mood: string | undefined): QuizAnswers {
  if (!mood) return emptyAnswers()
  return mood
    .split('.')
    .reduce(
      (answers, choice, index) => applyAnswer(answers, QUIZ[index]!.opts[Number(choice)]!),
      emptyAnswers(),
    )
}

const SCOPES: { value: NextReadScope; label: string; description: string }[] = [
  {
    value: 'available',
    label: 'Available to read',
    description: 'Books you own or have borrowed.',
  },
  {
    value: 'wishlist',
    label: 'Wishlist',
    description: 'Books you want, including other editions of books you own.',
  },
  {
    value: 'library',
    label: 'My whole library',
    description: 'All your saved books, whether you have a copy or not.',
  },
]
const quietButton =
  'skin-control min-h-11 border border-line px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50'
const primaryButton =
  'skin-control skin-btn-primary min-h-11 px-4 py-2 text-sm font-semibold disabled:opacity-50'

function NextReadCard({
  pick,
  save,
  saving,
  onStartError,
}: {
  pick: Pick
  save: (ids: string[]) => void
  saving: boolean
  onStartError: () => void
}) {
  const { b, why, isRead } = pick
  const navigate = useNavigate()
  const update = useUpdateBook(b.id)
  const open = () => void navigate({ to: '/book/$bookId', params: { bookId: b.id } })
  async function start() {
    try {
      // The optimistic patch removes this candidate, unmounting its mutation observer. Await
      // the promise so navigation still runs; per-call onSuccess is skipped after unmount.
      await update.mutateAsync({ id: b.id, patch: beginReadingPatch(b) })
      open()
    } catch {
      onStartError()
    }
  }
  return (
    <NextReadCardView
      book={b}
      reason={why}
      isRead={isRead}
      onOpen={open}
      onStart={() => void start()}
      onSave={() => save([b.id])}
      starting={update.isPending}
      saving={saving}
      startError={update.isError}
    />
  )
}

function MatchScreen() {
  const navigate = useNavigate()
  const search = matchRoute.useSearch()
  const queryClient = useQueryClient()
  const booksQ = useReaderBooks()
  const books = booksQ.data
  const listsQ = useLists()
  const createList = useCreateList()
  const addToList = useAddBooksToList()
  const [answers, setAnswers] = useState<QuizAnswers>(() => restoredAnswers(search.mood))
  const [step, setStep] = useState(0)
  const [quizOpen, setQuizOpen] = useState(false)
  const [tasteOnly, setTasteOnly] = useState(!search.mood)
  const [moodChoices, setMoodChoices] = useState<number[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [saveError, setSaveError] = useState(false)
  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)
  const createdPriority = useRef<{ id: string; name: string } | null>(null)
  const [showMore, setShowMore] = useState(false)
  const dismissedQ = useDismissed()
  const dismissed = useMemo(() => dismissedQ.data ?? {}, [dismissedQ.data])
  const dismissBook = useDismissBook()
  const libraryIds = useMemo(() => (books ? new Set(books.map((b) => b.id)) : null), [books])
  useLegacyDismissalSync(libraryIds)
  useEnsureEmbeddings()
  const vibeSearch = useVibeSearch()
  const [vibeQ, setVibeQ] = useState(search.vibeQ ?? '')
  const [vibe, setVibe] = useState<{ query: string; hits: SimilarHit[] } | null>(() => {
    const query = search.vibeQ
    const hits = query ? queryClient.getQueryData<SimilarHit[]>(moodCacheKey(query)) : undefined
    return query && hits ? { query, hits } : null
  })
  const vibeRequest = useRef(0)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const scope = search.scope ?? 'available'
  const includeRereads = search.rereads ?? false
  const includeDnf = search.dnf ?? false
  const candidates = useMemo(
    () => nextReadCandidates(books ?? [], { scope, includeRereads, includeDnf }),
    [books, scope, includeRereads, includeDnf],
  )
  const result = useMemo(
    () =>
      rankNextReads(books ?? [], answers, {
        scope,
        includeRereads,
        includeDnf,
        tasteOnly,
        dismissedAt: dismissed,
      }),
    [books, answers, scope, includeRereads, includeDnf, tasteOnly, dismissed],
  )
  const vibePicks = useMemo(
    () => rankMoodPicks(books ?? [], candidates, vibe?.hits ?? [], dismissed),
    [books, candidates, vibe, dismissed],
  )
  const moodIds = new Set(vibePicks.map((pick) => pick.b.id))
  const fallbackPicks = result.picks.filter((pick) => !moodIds.has(pick.b.id))
  const visiblePicks = (vibe ? [...vibePicks, ...fallbackPicks].slice(0, 12) : result.picks).filter(
    (pick) => !hidden.has(pick.b.id),
  )
  const displayed = showMore ? visiblePicks : visiblePicks.slice(0, 3)
  const changeScope = (patch: Partial<typeof search>) => {
    setShowMore(false)
    void navigate({ to: '/match', search: { ...search, ...patch }, replace: true })
  }
  const clearMood = () => {
    vibeRequest.current++
    setVibe(null)
    setVibeQ('')
    vibeSearch.reset()
    setTasteOnly(true)
    setAnswers(emptyAnswers())
    setMoodChoices([])
    setStep(0)
    setQuizOpen(false)
    changeScope({ vibeQ: undefined, mood: undefined })
  }
  async function save(ids: string[]) {
    if (saveLock.current || !ids.length || !listsQ.isSuccess) return
    saveLock.current = true
    setSaving(true)
    setNotice(null)
    setSaveError(false)
    try {
      let priority =
        listsQ.data.find((list) => list.kind === 'tbr' && list.priority) ?? createdPriority.current
      if (!priority) {
        priority = await createList.mutateAsync({
          name: 'Priority TBR',
          kind: 'tbr',
          isPriority: true,
        })
        createdPriority.current = priority
      }
      await addToList.mutateAsync({ listId: priority.id, bookIds: ids })
      setNotice(`Saved to ${priority.name}. Find it in Library → Shelves.`)
    } catch {
      setSaveError(true)
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }
  const q = QUIZ[step]
  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
        Next read
      </h1>
      <ReadingTips>
        <p className="mt-2 text-base text-muted">Find something you want to open.</p>
      </ReadingTips>
      <fieldset className="mt-6">
        <legend className="mb-2 text-sm font-semibold text-ink">Choose from</legend>
        <select
          aria-label="Choose from"
          value={scope}
          onChange={(e) => changeScope({ scope: e.target.value as NextReadScope })}
          className="skin-field min-h-11 w-full border border-line bg-[color:var(--field)] px-3 text-base text-ink md:hidden"
        >
          {SCOPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="hidden flex-wrap gap-2 md:flex">
          {SCOPES.map((option) => (
            <label
              key={option.value}
              className={`${quietButton} flex cursor-pointer items-center gap-2 ${scope === option.value ? 'bg-[color:var(--chip)]' : ''}`}
            >
              <input
                type="radio"
                name="next-read-scope"
                value={option.value}
                checked={scope === option.value}
                onChange={() => changeScope({ scope: option.value })}
              />
              {option.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">
          {SCOPES.find((option) => option.value === scope)?.description}
        </p>
      </fieldset>
      <details className="mt-4 rounded-xl border border-line p-4">
        <summary className="min-h-11 cursor-pointer py-2 text-[13px] font-medium leading-5 text-ink">
          Refine choices
        </summary>
        <div className="mt-2 flex flex-wrap gap-x-5">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={includeRereads}
              onChange={(e) => changeScope({ rereads: e.target.checked || undefined })}
            />
            Include rereads
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={includeDnf}
              onChange={(e) => changeScope({ dnf: e.target.checked || undefined })}
            />
            Include books I stopped reading
          </label>
        </div>

        <form
          className="mt-2 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            const query = vibeQ.trim()
            if (!query || vibeSearch.isPending) return
            const request = ++vibeRequest.current
            setVibe(null)
            changeScope({ vibeQ: query, mood: undefined })
            vibeSearch.mutate(query, {
              onSuccess: (hits) => {
                if (request === vibeRequest.current) {
                  queryClient.setQueryData(moodCacheKey(query), hits)
                  setVibe({ query, hits })
                  setShowMore(false)
                }
              },
            })
          }}
        >
          <input
            value={vibeQ}
            onChange={(e) => setVibeQ(e.target.value)}
            placeholder="A quiet mystery, or an adventure far from home"
            aria-label="Describe tonight’s vibe"
            className="min-h-11 min-w-0 flex-1 skin-field border border-line bg-[color:var(--field)] px-3 text-base text-ink"
          />
          <button
            type="submit"
            disabled={vibeSearch.isPending || !vibeQ.trim()}
            className={quietButton}
          >
            {vibeSearch.isPending ? 'Finding picks…' : 'Find this mood'}
          </button>
        </form>
        {vibeSearch.isError && (
          <p role="alert" className="mt-2 text-sm text-muted">
            Mood search is unavailable. Your library picks are still here; try again or use the
            questions below.
          </p>
        )}
        <button
          type="button"
          className={`${quietButton} mt-3`}
          onClick={() => {
            vibeRequest.current++
            setQuizOpen(!quizOpen)
            setStep(0)
            setAnswers(emptyAnswers())
            setMoodChoices([])
            setTasteOnly(true)
            changeScope({ vibeQ: undefined, mood: undefined })
            setVibe(null)
          }}
        >
          Use mood questions
        </button>
        {quizOpen && q && (
          <div className="mt-4">
            <p className="text-sm text-muted">
              Question {step + 1} of {QUIZ.length}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-ink">{q.q}</h2>
            <div className="mt-3 flex flex-col gap-2">
              {q.opts.map((option, optionIndex) => (
                <button
                  key={option.t}
                  type="button"
                  className={`${quietButton} bg-[color:var(--field)] text-left`}
                  onClick={() => {
                    setAnswers((a) => applyAnswer(a, option))
                    const choices = [...moodChoices, optionIndex]
                    setMoodChoices(choices)
                    setStep((s) => s + 1)
                    if (step === QUIZ.length - 1) {
                      changeScope({ mood: choices.join('.'), vibeQ: undefined })
                      setTasteOnly(false)
                      setQuizOpen(false)
                      setShowMore(false)
                    }
                  }}
                >
                  {option.t}
                </button>
              ))}
            </div>
          </div>
        )}
      </details>
      {search.vibeQ && !vibe && !vibeSearch.isPending && tasteOnly && (
        <p className="mt-4 text-sm text-ink">
          Your saved mood is “{search.vibeQ}”. Open Refine choices to run it again.
        </p>
      )}
      {(vibe || !tasteOnly) && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink">Mood: {vibe?.query ?? result.headline}</p>
          <button type="button" className={quietButton} onClick={clearMood}>
            Clear mood
          </button>
        </div>
      )}
      {booksQ.isPending ? (
        <p role="status" className="mt-8 text-muted">
          Loading your library…
        </p>
      ) : booksQ.isError ? (
        <div className="mt-8">
          <p role="alert" className="text-ink">
            Your library could not be loaded.
          </p>
          <button
            type="button"
            className={`${quietButton} mt-3`}
            onClick={() => void booksQ.refetch()}
          >
            Try again
          </button>
        </div>
      ) : !books?.length ? (
        <Surface tone="card" radius="panel" pad={5} className="mt-6">
          <h2 className="text-xl font-semibold text-ink">Start with a book</h2>
          <p className="mt-2 text-muted">
            Add a book or import your reading history. Then choose your next read here.
          </p>
          <button
            type="button"
            className={`${primaryButton} mt-4`}
            onClick={() => void navigate({ to: '/add' })}
          >
            Add books
          </button>
        </Surface>
      ) : (
        <>
          <div className="mt-7 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-ink">
                {vibe && vibePicks.length ? 'Picks for your mood' : result.headline}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted">
                {vibe
                  ? vibePicks.length
                    ? 'Returned mood matches come first, with other library picks after them. Your scope and feedback apply to both.'
                    : 'No returned mood matches are in this selection. These are your library picks; try other words or a wider scope.'
                  : result.sub}
              </p>
            </div>
            {visiblePicks.length > 1 && (
              <button
                type="button"
                className={quietButton}
                disabled={saving || !listsQ.isSuccess}
                onClick={() => void save(visiblePicks.slice(0, 3).map((pick) => pick.b.id))}
              >
                Save top {Math.min(3, visiblePicks.length)} for later
              </button>
            )}
          </div>
          {!visiblePicks.length && (
            <Surface tone="card" radius="panel" pad={5} className="mt-4">
              <h3 className="text-lg font-semibold text-ink">
                {!candidates.length
                  ? 'No books ready in this selection'
                  : 'No picks for this selection'}
              </h3>
              <p className="mt-2 text-muted">
                {!candidates.length
                  ? 'Try another scope, include rereads, or mark a book as owned or borrowed. Books you are reading stay on Home.'
                  : vibe
                    ? 'Try different words or clear the mood to see your library picks.'
                    : 'You have hidden this shortlist. Change the scope or restore these picks to choose again.'}
              </p>
              {!vibe && hidden.size > 0 && (
                <button
                  type="button"
                  className={`${quietButton} mt-3`}
                  onClick={() => setHidden(new Set())}
                >
                  Restore this shortlist
                </button>
              )}
            </Surface>
          )}
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {displayed.map((pick) => (
              <div key={pick.b.id} className="flex flex-col gap-2">
                <NextReadCard
                  pick={pick}
                  save={(ids) => void save(ids)}
                  saving={saving || !listsQ.isSuccess}
                  onStartError={() =>
                    setNotice('This read could not be started. Please try again.')
                  }
                />
                <button
                  type="button"
                  disabled={dismissBook.isPending}
                  className={`${quietButton} w-full`}
                  aria-label={`Show ${pick.b.title} less often`}
                  onClick={() => {
                    setHidden((h) => new Set([...h, pick.b.id]))
                    dismissBook.mutate(pick.b.id, {
                      onSuccess: () =>
                        setNotice(
                          'We will suggest this book less often, gradually returning it over 60 days.',
                        ),
                      onError: () => {
                        setHidden((h) => new Set([...h].filter((id) => id !== pick.b.id)))
                        setNotice('Your feedback could not be saved. Please try again.')
                      },
                    })
                  }}
                >
                  Show less often
                </button>
              </div>
            ))}
          </div>
          {visiblePicks.length > 3 && (
            <button
              type="button"
              className={`${quietButton} mt-4`}
              onClick={() => setShowMore(!showMore)}
            >
              {showMore
                ? 'Show shortlist'
                : `See ${visiblePicks.length - 3} more ${visiblePicks.length === 4 ? 'book' : 'books'}`}
            </button>
          )}
          <p className="mt-4 text-sm text-muted">
            “Show less often” reduces a book’s ranking for up to 60 days.
          </p>
        </>
      )}
      {notice && (
        <p role="status" className="mt-4 text-sm text-ink">
          {notice}
        </p>
      )}
      {(saveError || listsQ.isError) && (
        <p role="alert" className="mt-4 text-sm text-muted">
          {saveError
            ? 'Could not save these picks. Please try again.'
            : 'Your shelves could not be loaded. Reading still works.'}
          {listsQ.isError && (
            <button
              type="button"
              className={`${quietButton} ml-2`}
              onClick={() => void listsQ.refetch()}
            >
              Reload shelves
            </button>
          )}
        </p>
      )}
    </section>
  )
}

export const matchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'match',
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    vibeQ?: string
    scope?: NextReadScope
    rereads?: boolean
    dnf?: boolean
    mood?: string
  } => ({
    vibeQ: typeof search.vibeQ === 'string' && search.vibeQ.trim() ? search.vibeQ : undefined,
    scope:
      search.scope === 'wishlist' || search.scope === 'library' || search.scope === 'available'
        ? search.scope
        : undefined,
    rereads: search.rereads === true || search.rereads === 'true' ? true : undefined,
    mood: validateMood(search.mood),
    dnf: search.dnf === true || search.dnf === 'true' ? true : undefined,
  }),
  component: MatchScreen,
})
