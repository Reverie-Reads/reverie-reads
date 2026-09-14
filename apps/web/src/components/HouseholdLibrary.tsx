import { useState } from 'react'
import {
  CORE_GENRES,
  PUB_DAY,
  PUB_MONTH,
  PUB_YEAR,
  SERIES_COUNT,
  SERIES_POSITION,
  SERIES_STATUS_LABELS,
  SERIES_STATUS_VALUES,
  coverCandidates,
  isDegenerateGoogleCoverRender,
  parseNumericFields,
  type SeriesStatus,
} from '@reverie/core'
import type { HouseholdBook, HouseholdBookOwner } from '../data/household'
import { subgenreGradient } from '../library/constants'
import { CoverPlaceholder } from './CoverPlaceholder'
import { CorpusCoverReviewToggle } from './CorpusCoverReviewToggle'
import { Modal } from './Modal'
import { Nameplate } from './Nameplate'
import { Surface } from './Surface'
import { publicationDateError } from '../lib/publicationDate'

export type LibraryScope = 'personal' | 'household'

export function LibraryScopeControl({
  scope,
  onChange,
}: {
  scope: LibraryScope
  onChange: (scope: LibraryScope) => void
}) {
  return (
    <Surface
      radius="control"
      tone="card"
      pad={1}
      role="group"
      aria-label="Library scope"
      className="flex shrink-0"
    >
      {(['personal', 'household'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={scope === value}
          className="skin-control min-h-11 px-3 text-[13px] font-semibold"
          // A profile-driven skin/mode change repaints the parent card immediately. Letting
          // skin-control animate the old label colour over that new card creates a brief sub-AA
          // pairing, so this two-state control switches its already-guarded token pairs atomically.
          style={
            scope === value
              ? {
                  background: 'var(--accent-fill)',
                  color: 'var(--on-primary)',
                  transition: 'none',
                }
              : { background: 'transparent', color: 'var(--ink)', transition: 'none' }
          }
        >
          {value === 'personal' ? 'My library' : 'Household library'}
        </button>
      ))}
    </Surface>
  )
}

function HouseholdCover({ book, thumb = false }: { book: HouseholdBook; thumb?: boolean }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const chain = coverCandidates(book.cover, {
    size: thumb ? 'thumb' : 'full',
  })
  const src = chain.find((candidate) => !failed.has(candidate))
  if (!src) {
    return (
      <CoverPlaceholder
        book={{ id: book.id, title: book.title, first: '', last: book.author }}
        className="h-full w-full"
      />
    )
  }

  const fail = () => setFailed((current) => new Set(current).add(src))
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className="h-full w-full object-cover"
      onError={fail}
      onLoad={(event) => {
        const image = event.currentTarget
        if (isDegenerateGoogleCoverRender(src, image.naturalWidth, image.naturalHeight)) fail()
      }}
    />
  )
}

const titleCase = (value: string): string =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

function householdPossessionLabels(owner: HouseholdBookOwner): string[] {
  const labels: string[] = []
  if (owner.ownership === 'owned') labels.push('Owned')
  if (owner.borrowed) labels.push('Borrowed')
  return labels
}

function householdFormatLabels(owner: HouseholdBookOwner): string[] {
  const formats: string[] = []
  if (owner.ownedPhysical) {
    formats.push(owner.ownedPhysical === 'yes' ? 'Physical' : titleCase(owner.ownedPhysical))
  }
  if (owner.ownedEbook) formats.push('Ebook')
  if (owner.ownedAudiobook) formats.push('Audiobook')
  return formats
}

const ownerLabel = (owner: HouseholdBookOwner, currentReaderId: string): string =>
  `${owner.displayName}${owner.userId === currentReaderId ? ' (you)' : ''}`

const ownerSummary = (book: HouseholdBook, currentReaderId: string): string =>
  book.owners.length
    ? book.owners.map((owner) => ownerLabel(owner, currentReaderId)).join(', ')
    : 'Household copy'

export function HouseholdBookCard({
  book,
  currentReaderId,
  selected = false,
  onOpen,
}: {
  book: HouseholdBook
  currentReaderId: string
  selected?: boolean
  onOpen: () => void
}) {
  const [g0, g1] = subgenreGradient(book.subgenre, book.primaryGenre)
  const members = ownerSummary(book, currentReaderId)
  const possession = [...new Set(book.owners.flatMap((owner) => householdPossessionLabels(owner)))]

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${book.title} in the household library`}
      aria-current={selected ? 'true' : undefined}
      data-testid="household-book-card"
      data-owners={book.owners.map((owner) => owner.userId).join(' ')}
      className="group block w-full text-left"
    >
      <div
        className="skin-card relative aspect-[2/3] overflow-hidden border border-line transition-shadow motion-reduce:transition-none"
        style={{
          background: `linear-gradient(150deg, ${g0}, ${g1})`,
          ...(selected ? { boxShadow: '0 0 0 2.5px var(--primary), var(--shadow)' } : {}),
        }}
      >
        <HouseholdCover book={book} thumb />
        <span
          className="absolute left-1.5 top-1.5 max-w-[calc(100%-12px)] break-words px-2 py-1 text-center text-[10px] font-semibold leading-tight"
          style={{
            background: 'var(--card-solid)',
            color: 'var(--ink)',
            borderRadius: 'var(--mark-radius)',
            boxShadow: 'var(--shadow)',
          }}
        >
          {members}
        </span>
        {possession.length > 0 && (
          <span
            className="absolute bottom-1.5 right-1.5 max-w-[calc(100%-12px)] break-words px-2 py-1 text-center text-[10px] font-semibold leading-tight"
            style={{
              background: 'var(--card-solid)',
              color: 'var(--ink)',
              borderRadius: 'var(--mark-radius)',
            }}
          >
            {possession.join(' · ')}
          </span>
        )}
      </div>
      <span className="mt-2.5 block break-words text-[12.5px] font-semibold leading-5 text-ink">
        {book.title}
      </span>
      {book.author ? (
        <span className="block break-words text-[11.5px] leading-5 text-muted">{book.author}</span>
      ) : null}
      <span className="block break-words text-[11px] font-semibold leading-5 text-muted">
        {book.owners.length ? members : 'Kept in the household'}
      </span>
    </button>
  )
}

const publicationLabel = (book: HouseholdBook): string | null => {
  if (!book.publicationYear) return null
  return [book.publicationYear, book.publicationMonth, book.publicationDay]
    .filter((value): value is number => value !== null)
    .join('-')
}

export interface HouseholdCorpusEdit {
  series: string
  position: number | null
  seriesCount: number | null
  seriesStatus: SeriesStatus
  genre: string
  subgenre: string
  genres: string[]
  subgenres: string[]
  coverUrl: string
  coverOptions: HouseholdBook['coverOptions']
  publicationYear: number | null
  publicationMonth: number | null
  publicationDay: number | null
}

function CorpusEditForm({
  book,
  onSave,
  saving,
}: {
  book: HouseholdBook
  onSave: (patch: HouseholdCorpusEdit) => Promise<void>
  saving: boolean
}) {
  const [open, setOpen] = useState(false)
  const [series, setSeries] = useState(book.series)
  const [position, setPosition] = useState(book.position?.toString() ?? '')
  const [seriesCount, setSeriesCount] = useState(book.seriesCount?.toString() ?? '')
  const [seriesStatus, setSeriesStatus] = useState<SeriesStatus>(book.seriesStatus)
  const [genre, setGenre] = useState(book.primaryGenre)
  const [subgenre, setSubgenre] = useState(book.subgenre)
  const [publicationYear, setPublicationYear] = useState(book.publicationYear?.toString() ?? '')
  const [publicationMonth, setPublicationMonth] = useState(book.publicationMonth?.toString() ?? '')
  const [publicationDay, setPublicationDay] = useState(book.publicationDay?.toString() ?? '')
  const [coverUrl, setCoverUrl] = useState(book.corpusCover)
  const [validationError, setValidationError] = useState('')
  const coverChoices = book.coverOptions.filter(
    (option): option is typeof option & { url: string } => !!option.url,
  )
  const fieldClass =
    'skin-control h-10 w-full border border-line bg-field px-3 text-[13px] text-ink'

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => {
          setSeries(book.series)
          setPosition(book.position?.toString() ?? '')
          setSeriesCount(book.seriesCount?.toString() ?? '')
          setSeriesStatus(book.seriesStatus)
          setGenre(book.primaryGenre)
          setSubgenre(book.subgenre)
          setPublicationYear(book.publicationYear?.toString() ?? '')
          setPublicationMonth(book.publicationMonth?.toString() ?? '')
          setPublicationDay(book.publicationDay?.toString() ?? '')
          setCoverUrl(book.corpusCover)
          setValidationError('')
          setOpen(true)
        }}
        className="skin-control w-full border border-line px-3 py-2.5 text-left text-[12.5px] font-semibold text-primary"
        style={{ background: 'var(--field)' }}
      >
        Edit shared details
      </button>
      {open ? (
        <Modal title="Edit shared details" onClose={() => setOpen(false)} wide>
          <p className="text-[13px] font-semibold text-ink">{book.title}</p>
          <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-muted">
            Changes update the shared catalog. Verified series fills personal copies that still use
            an automatic default. Covers, genre, and publication details stay personal until their
            owner chooses the shared version.
          </p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              const parsed = parseNumericFields({
                position: { raw: position, spec: SERIES_POSITION },
                seriesCount: { raw: seriesCount, spec: SERIES_COUNT },
                publicationYear: { raw: publicationYear, spec: PUB_YEAR },
                publicationMonth: { raw: publicationMonth, spec: PUB_MONTH },
                publicationDay: { raw: publicationDay, spec: PUB_DAY },
              })
              if (!parsed.ok) {
                setValidationError(Object.values(parsed.errors)[0] ?? 'Check the numeric fields.')
                return
              }
              const publicationError = publicationDateError({
                y: parsed.values.publicationYear,
                m: parsed.values.publicationMonth,
                d: parsed.values.publicationDay,
              })
              if (publicationError) {
                setValidationError(publicationError.message)
                return
              }
              setValidationError('')
              const nextGenre = genre.trim()
              const nextSubgenre = subgenre.trim()
              void onSave({
                series: series.trim(),
                position: parsed.values.position,
                seriesCount: parsed.values.seriesCount,
                seriesStatus,
                genre: nextGenre,
                subgenre: nextSubgenre,
                genres: [nextGenre, ...book.genres.filter((value) => value !== book.primaryGenre)]
                  .filter(Boolean)
                  .filter((value, index, values) => values.indexOf(value) === index),
                subgenres: [
                  nextSubgenre,
                  ...book.subgenres.filter((value) => value !== book.subgenre),
                ]
                  .filter(Boolean)
                  .filter((value, index, values) => values.indexOf(value) === index),
                coverUrl,
                coverOptions: book.coverOptions,
                publicationYear: parsed.values.publicationYear,
                publicationMonth: parsed.values.publicationMonth,
                publicationDay: parsed.values.publicationDay,
              })
                .then(() => setOpen(false))
                .catch(() => undefined)
            }}
          >
            <fieldset>
              <legend className="mb-3 text-[11px] uppercase tracking-[0.18em] text-muted">
                Series
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className="mb-1.5 block text-[11.5px] font-semibold text-ink">
                    Series name
                  </span>
                  <input
                    value={series}
                    onChange={(event) => setSeries(event.target.value)}
                    placeholder="No series"
                    aria-label="Shared series"
                    className={fieldClass}
                  />
                </label>
                <label>
                  <span className="mb-1.5 block text-[11.5px] font-semibold text-ink">
                    Position
                  </span>
                  <input
                    value={position}
                    onChange={(event) => setPosition(event.target.value)}
                    inputMode="decimal"
                    placeholder="—"
                    aria-label="Shared series position"
                    className={fieldClass}
                  />
                </label>
                <label>
                  <span className="mb-1.5 block text-[11.5px] font-semibold text-ink">
                    Series length
                  </span>
                  <input
                    value={seriesCount}
                    onChange={(event) => setSeriesCount(event.target.value)}
                    inputMode="numeric"
                    placeholder="—"
                    aria-label="Shared series length"
                    className={fieldClass}
                  />
                </label>
                <label className="sm:col-span-2">
                  <span className="mb-1.5 block text-[11.5px] font-semibold text-ink">Status</span>
                  <select
                    value={seriesStatus}
                    onChange={(event) => setSeriesStatus(event.target.value as SeriesStatus)}
                    aria-label="Shared series status"
                    className={fieldClass}
                  >
                    {SERIES_STATUS_VALUES.map((status) => (
                      <option key={status} value={status}>
                        {SERIES_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-[11px] uppercase tracking-[0.18em] text-muted">
                Classification
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-[11.5px] font-semibold text-ink">
                    Primary genre
                  </span>
                  <select
                    value={genre}
                    onChange={(event) => setGenre(event.target.value)}
                    aria-label="Shared primary genre"
                    className={fieldClass}
                  >
                    <option value="">No primary genre</option>
                    {CORE_GENRES.map((value) => (
                      <option key={value} value={value.toLowerCase()}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="mb-1.5 block text-[11.5px] font-semibold text-ink">
                    Primary subgenre
                  </span>
                  <input
                    value={subgenre}
                    onChange={(event) => setSubgenre(event.target.value)}
                    placeholder="No subgenre"
                    aria-label="Shared primary subgenre"
                    className={fieldClass}
                  />
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-[11px] uppercase tracking-[0.18em] text-muted">
                Shared cover
              </legend>
              {coverChoices.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {coverChoices.map((option, index) => (
                    <div key={option.url}>
                      <input
                        id={`shared-cover-${book.id}-${index}`}
                        type="radio"
                        name={`shared-cover-${book.id}`}
                        value={option.url}
                        checked={coverUrl === option.url}
                        onChange={() => setCoverUrl(option.url)}
                        className="peer sr-only"
                      />
                      <label
                        htmlFor={`shared-cover-${book.id}-${index}`}
                        className="skin-control block cursor-pointer border border-line p-1.5 text-center text-[10.5px] text-muted peer-checked:border-primary peer-checked:ring-2 peer-checked:ring-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
                      >
                        <img
                          src={option.url}
                          alt=""
                          className="mx-auto aspect-[2/3] w-full rounded object-cover"
                        />
                        <span className="mt-1 block break-words">
                          {option.source ? titleCase(option.source) : 'Shared'} cover {index + 1}
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11.5px] text-muted">
                  No alternate shared covers are available for this record yet.
                </p>
              )}
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-[11px] uppercase tracking-[0.18em] text-muted">
                Publication date
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  value={publicationYear}
                  onChange={(event) => setPublicationYear(event.target.value)}
                  inputMode="numeric"
                  placeholder="Year"
                  aria-label="Shared publication year"
                  className={fieldClass}
                />
                <input
                  value={publicationMonth}
                  onChange={(event) => setPublicationMonth(event.target.value)}
                  inputMode="numeric"
                  placeholder="Month"
                  aria-label="Shared publication month"
                  className={fieldClass}
                />
                <input
                  value={publicationDay}
                  onChange={(event) => setPublicationDay(event.target.value)}
                  inputMode="numeric"
                  placeholder="Day"
                  aria-label="Shared publication day"
                  className={fieldClass}
                />
              </div>
            </fieldset>
            {validationError ? (
              <p role="alert" className="text-[12px] text-accent-ink">
                {validationError}
              </p>
            ) : null}
            <div
              className="sticky -bottom-5 flex justify-end gap-2 border-t border-line py-3"
              style={{ background: 'var(--card-solid)' }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="skin-control border border-line px-4 py-2.5 text-[12px] font-semibold text-ink"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="skin-control skin-btn-primary px-4 py-2.5 text-[12px] font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save shared details'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}

export function HouseholdBookDetail({
  book,
  currentReaderId,
  onRemove,
  removing = false,
  onAddCorpusTrope,
  addingCorpusTrope = false,
  onEditCorpus,
  editingCorpus = false,
  onReviewCover,
  reviewingCoverBookId = null,
}: {
  book: HouseholdBook | null
  currentReaderId: string
  onRemove?: () => void
  removing?: boolean
  onAddCorpusTrope?: (name: string) => Promise<void>
  addingCorpusTrope?: boolean
  onEditCorpus?: (patch: HouseholdCorpusEdit) => Promise<void>
  editingCorpus?: boolean
  onReviewCover?: (owner: HouseholdBookOwner) => Promise<void>
  reviewingCoverBookId?: string | null
}) {
  const [corpusTropeName, setCorpusTropeName] = useState('')
  if (!book) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted">
        <span aria-hidden className="text-[28px] opacity-50">
          ✶
        </span>
        <p className="mt-3 text-[13px]">Select a household book to see its shared details.</p>
      </div>
    )
  }

  const [g0, g1] = subgenreGradient(book.subgenre, book.primaryGenre)
  const published = publicationLabel(book)

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-5">
      <div
        className="mx-auto aspect-[2/3] w-36 overflow-hidden rounded-xl border border-line"
        style={{ background: `linear-gradient(150deg, ${g0}, ${g1})` }}
      >
        <HouseholdCover book={book} />
      </div>

      <Nameplate
        className="mt-4"
        eyebrow={
          book.series
            ? `${book.series}${book.position !== null ? ` · #${book.position}` : ''}`
            : undefined
        }
        title={book.title}
        subtitle={book.author || undefined}
      />

      <p className="mt-3 text-center text-[12.5px] font-semibold text-ink">
        In your household library
      </p>
      <p className="mt-1 text-center text-[12px] text-muted">
        {book.owners.length
          ? `Active copies: ${ownerSummary(book, currentReaderId)}`
          : 'Kept here independently of any personal copy'}
      </p>

      {book.owners.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">Copies</div>
          <div className="space-y-2">
            {book.owners.map((owner) => {
              const details = [...householdPossessionLabels(owner), ...householdFormatLabels(owner)]
              const reviewed =
                book.coverOptionsAvailable &&
                !!owner.cover &&
                book.coverOptions.some((option) => option.url === owner.cover)
              return (
                <Surface
                  key={owner.bookId}
                  tone="field"
                  radius="control"
                  pad={2}
                  data-household-copy-book-id={owner.bookId}
                >
                  <div className="flex items-start gap-2.5">
                    {owner.cover ? (
                      <img
                        src={owner.coverThumb || owner.cover}
                        alt=""
                        className="aspect-[2/3] w-10 shrink-0 rounded object-cover"
                      />
                    ) : null}
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-ink">
                        {ownerLabel(owner, currentReaderId)}
                      </div>
                      {details.length > 0 && (
                        <div className="mt-0.5 text-[11.5px] text-muted">{details.join(' · ')}</div>
                      )}
                    </div>
                  </div>
                  {onReviewCover && owner.cover ? (
                    <CorpusCoverReviewToggle
                      scope="household"
                      reviewed={reviewed}
                      loading={false}
                      unavailable={!book.coverOptionsAvailable}
                      saving={reviewingCoverBookId === owner.bookId}
                      onReview={() => void onReviewCover(owner).catch(() => undefined)}
                    />
                  ) : null}
                </Surface>
              )
            })}
          </div>
        </div>
      )}

      {(book.householdTags.length > 0 || book.householdTropes.length > 0) && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">
            Shared details
          </div>
          <div className="flex flex-wrap gap-1.5">
            {book.householdTags.map((tag) => (
              <span
                key={tag}
                className="skin-control px-2.5 py-1 text-[12px] font-semibold text-ink"
                style={{ background: 'var(--chip)' }}
              >
                {tag}
              </span>
            ))}
            {book.householdTropes.map((trope) => (
              <span
                key={trope.id ?? `${trope.name}:${trope.emphasis}`}
                className="skin-control px-2.5 py-1 text-[12px] font-semibold text-ink"
                style={{ background: 'var(--chip)' }}
              >
                {trope.emphasis === 'pinned' ? '✦ ' : ''}
                {trope.scope === 'corpus' ? 'Shared · ' : ''}
                {trope.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {(book.primaryGenre || published || book.isbns[0]) && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12.5px]">
          {book.primaryGenre && (
            <>
              <dt className="text-muted">Genre</dt>
              <dd className="text-ink">{titleCase(book.primaryGenre)}</dd>
            </>
          )}
          {published && (
            <>
              <dt className="text-muted">Published</dt>
              <dd className="text-ink">{published}</dd>
            </>
          )}
          {book.isbns[0] && (
            <>
              <dt className="text-muted">ISBN</dt>
              <dd className="break-all text-ink">{book.isbns[0]}</dd>
            </>
          )}
        </dl>
      )}

      {onAddCorpusTrope ? (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault()
            const name = corpusTropeName.trim()
            if (!name) return
            void onAddCorpusTrope(name)
              .then(() => setCorpusTropeName(''))
              .catch(() => undefined)
          }}
        >
          <label
            htmlFor={`corpus-trope-${book.id}`}
            className="mb-1.5 block text-[11px] uppercase tracking-[0.2em] text-muted"
          >
            Add a corpus trope
          </label>
          <p className="mb-2 text-[11.5px] text-muted">
            Administrator additions become shared catalog metadata and remain after a library
            removal.
          </p>
          <div className="flex gap-2">
            <input
              id={`corpus-trope-${book.id}`}
              value={corpusTropeName}
              onChange={(event) => setCorpusTropeName(event.target.value)}
              placeholder="Trope name"
              className="skin-control min-w-0 flex-1 border border-line bg-field px-3 py-2 text-[13px] text-ink"
            />
            <button
              type="submit"
              disabled={addingCorpusTrope || !corpusTropeName.trim()}
              className="skin-control skin-btn-primary px-3 py-2 text-[12px] font-semibold disabled:opacity-50"
            >
              {addingCorpusTrope ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      ) : null}

      {onEditCorpus ? (
        <CorpusEditForm key={book.id} book={book} onSave={onEditCorpus} saving={editingCorpus} />
      ) : null}

      <Surface tone="field" radius="control" pad={2} className="mt-auto text-[12px] text-muted">
        {book.owners.some((owner) => owner.ownership === 'owned')
          ? 'An owned personal copy keeps this work in the household. Change or remove that personal copy first.'
          : 'Removing this household entry never removes anyone’s personal book or the corpus record.'}
      </Surface>
      {onRemove && (
        <button
          type="button"
          disabled={removing}
          onClick={onRemove}
          className="skin-control mt-3 border border-line px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--card)', color: 'var(--accent-ink)' }}
        >
          {removing ? 'Removing…' : 'Remove from household'}
        </button>
      )}
    </div>
  )
}
