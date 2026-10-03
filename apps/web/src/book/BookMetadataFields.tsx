import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  CORE_GENRES,
  SERIES_STATUS_LABELS,
  SERIES_STATUS_VALUES,
  type Contributor,
  type Book,
} from '@reverie/core'
import { ContributorEditor } from './ContributorEditor'
import { Stars } from '../components/Stars'
import { Chip } from '../components/Chip'
import {
  FORMATS,
  READ_STATUS_OPTIONS,
  readStatusLabel,
  otherGenreSubgenres,
  subgenresForGenre,
} from '../library/constants'
import './bookEditor.css'

export type BookEditorSectionId =
  | 'identity'
  | 'classification'
  | 'edition'
  | 'series'
  | 'reading'
  | 'copies'
export interface BookMetadataDraft {
  title: string
  isbn: string
  genre: string
  format: string
  pages: string
  series: string
  position: string
  seriesCount: string
  status: string
  pubY: string
  pubM: string
  pubD: string
}
export type BookMetadataErrors = Partial<Record<keyof BookMetadataDraft, string | undefined>>

export const bookFieldClass = 'book-editor-field skin-field'
export function BookField({
  label,
  error,
  errorId,
  children,
}: {
  label: string
  error?: string
  errorId?: string
  children: ReactNode
}) {
  return (
    <label className="book-editor-label">
      <span>{label}</span>
      {children}
      {error && (
        <span id={errorId} role="alert" className="book-editor-error">
          {error}
        </span>
      )}
    </label>
  )
}

export function BookEditorSection({
  id,
  title,
  children,
}: {
  id: BookEditorSectionId
  title: string
  children: ReactNode
}) {
  const heading = useId()
  return (
    <section
      data-book-editor-section={id}
      aria-labelledby={heading}
      className="book-editor-section"
    >
      <h3 id={heading} tabIndex={-1}>
        {title}
      </h3>
      <div className="book-editor-section-body">{children}</div>
    </section>
  )
}

/** Same fields and order at every entry. Context only moves focus; it never replaces the draft. */
export function BookEditor({
  initialSection = 'identity',
  children,
}: {
  initialSection?: BookEditorSectionId
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState(initialSection)
  function focusSection(id: BookEditorSectionId) {
    setSelected(id)
    const heading = root.current?.querySelector<HTMLElement>(
      `[data-book-editor-section="${id}"] h3`,
    )
    heading?.focus({ preventScroll: true })
    heading?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  useEffect(() => {
    if (initialSection === 'identity') return
    const frame = requestAnimationFrame(() => {
      const heading = root.current?.querySelector<HTMLElement>(
        `[data-book-editor-section="${initialSection}"] h3`,
      )
      heading?.focus({ preventScroll: true })
      heading?.scrollIntoView({ block: 'start', behavior: 'instant' })
    })
    return () => cancelAnimationFrame(frame)
  }, [initialSection])
  return (
    <div className="book-editor" ref={root}>
      <nav aria-label="Book information sections" className="book-editor-nav">
        {(
          [
            ['identity', 'Book'],
            ['classification', 'Genres'],
            ['edition', 'Edition'],
            ['series', 'Series'],
            ['reading', 'Reading'],
            ['copies', 'Copies'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={selected === id ? 'location' : undefined}
            onClick={() => focusSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="book-editor-content">{children}</div>
    </div>
  )
}

export function BookRating({
  value,
  onChange,
  disabled = false,
}: {
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <div aria-disabled={disabled || undefined}>
      <p className="book-editor-caption">Your rating</p>
      <Stars value={value} step={0.5} onChange={disabled ? undefined : onChange} />
    </div>
  )
}

export function BookReadingStatus({
  value,
  onChange,
}: {
  value: Book['readStatus']
  onChange: (value: Book['readStatus']) => void
}) {
  return (
    <div role="group" aria-label="Reading status">
      <p className="book-editor-caption">Reading status</p>
      <div className="flex flex-wrap gap-2">
        {READ_STATUS_OPTIONS.map((status) => (
          <Chip key={status} active={value === status} onClick={() => onChange(status)}>
            {readStatusLabel(status)}
          </Chip>
        ))}
      </div>
    </div>
  )
}

export function BookMetadataFields({
  value: f,
  onChange: set,
  contributors,
  onContributorsChange,
  suggestions,
  subgenres: subs,
  onSubgenresChange,
  extraGenres,
  onExtraGenresChange,
  errors = {},
  validationAttempt = 0,
  cover,
  editionNotice,
}: {
  value: BookMetadataDraft
  onChange: (field: keyof BookMetadataDraft, value: string) => void
  contributors: Contributor[]
  onContributorsChange: (value: Contributor[]) => void
  suggestions: string[]
  subgenres: string[]
  onSubgenresChange: (value: string[]) => void
  extraGenres: string[]
  onExtraGenresChange: (value: string[]) => void
  errors?: BookMetadataErrors
  validationAttempt?: number
  cover?: ReactNode
  editionNotice?: ReactNode
}) {
  const fieldPrefix = useId()
  const fields = useRef<HTMLDivElement>(null)
  const errorSignature = JSON.stringify(errors)
  const focusedAttempt = useRef(-1)
  useEffect(() => {
    if (focusedAttempt.current === validationAttempt) return
    focusedAttempt.current = validationAttempt
    if (!Object.values(JSON.parse(errorSignature)).some(Boolean)) return
    const invalid = fields.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    invalid?.focus()
  }, [errorSignature, validationAttempt])
  const [showOtherSubs, setShowOtherSubs] = useState(false)
  const [showOtherGenres, setShowOtherGenres] = useState(false)
  const vocab = f.genre ? subgenresForGenre(f.genre) : []
  const options = [...subs.filter((s) => !vocab.includes(s)), ...vocab]
  const toggleSub = (s: string) =>
    onSubgenresChange(subs.includes(s) ? subs.filter((x) => x !== s) : [...subs, s])
  const toggleGenre = (g: string) =>
    onExtraGenresChange(
      extraGenres.includes(g) ? extraGenres.filter((x) => x !== g) : [...extraGenres, g],
    )
  const input = (
    field: keyof BookMetadataDraft,
    label: string,
    placeholder?: string,
    numeric = false,
  ) => (
    <BookField label={label} error={errors[field]} errorId={`${fieldPrefix}-${field}-error`}>
      <input
        value={f[field]}
        onChange={(e) => set(field, e.target.value)}
        placeholder={placeholder}
        inputMode={numeric ? (field === 'position' ? 'decimal' : 'numeric') : undefined}
        aria-label={label}
        aria-describedby={errors[field] ? `${fieldPrefix}-${field}-error` : undefined}
        aria-invalid={!!errors[field]}
        className={bookFieldClass}
      />
    </BookField>
  )
  return (
    <div ref={fields}>
      <BookEditorSection id="identity" title="Book information">
        <div className="book-editor-identity">
          {cover && <div className="book-editor-cover">{cover}</div>}
          <div className="min-w-0 space-y-4">
            {input('title', 'Title', 'Title')}
            <div>
              <p className="book-editor-caption">Contributors</p>
              <ContributorEditor
                value={contributors}
                onChange={onContributorsChange}
                suggestions={suggestions}
              />
            </div>
          </div>
        </div>
      </BookEditorSection>
      <BookEditorSection id="classification" title="Genres & subgenres">
        <BookField label="Genre">
          <select
            aria-label="Genre"
            value={f.genre}
            onChange={(e) => set('genre', e.target.value)}
            className={bookFieldClass}
          >
            <option value="">Genre — not set</option>
            {f.genre && !CORE_GENRES.some((g) => g.toLowerCase() === f.genre) && (
              <option value={f.genre}>{f.genre}</option>
            )}
            {CORE_GENRES.map((g) => (
              <option key={g} value={g.toLowerCase()}>
                {g}
              </option>
            ))}
          </select>
        </BookField>
        <div role="group" aria-label="Subgenres">
          <p className="book-editor-caption">Subgenres</p>
          {options.length ? (
            <div className="flex flex-wrap gap-2">
              {options.map((s) => (
                <Chip key={s} active={subs.includes(s)} onClick={() => toggleSub(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">
              Choose a genre to see its subgenres, or browse all subgenres below.
            </p>
          )}
          <button
            type="button"
            className="book-editor-disclosure"
            aria-expanded={showOtherSubs}
            onClick={() => setShowOtherSubs(!showOtherSubs)}
          >
            {showOtherSubs ? 'Hide other genres’ subgenres' : 'Other genres’ subgenres…'}
          </button>
          {showOtherSubs && (
            <div className="flex flex-wrap gap-2">
              {otherGenreSubgenres(f.genre)
                .filter((s) => !options.includes(s))
                .map((s) => (
                  <Chip key={s} active={subs.includes(s)} onClick={() => toggleSub(s)}>
                    {s}
                  </Chip>
                ))}
            </div>
          )}
        </div>
        <div>
          <button
            type="button"
            className="book-editor-disclosure"
            aria-expanded={showOtherGenres}
            onClick={() => setShowOtherGenres(!showOtherGenres)}
          >
            Also tag as{extraGenres.length ? ` · ${extraGenres.length} selected` : ''}
          </button>
          {(showOtherGenres || extraGenres.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {CORE_GENRES.filter(
                (g) =>
                  g.toLowerCase() !== f.genre &&
                  (showOtherGenres || extraGenres.includes(g.toLowerCase())),
              ).map((g) => (
                <Chip
                  key={g}
                  active={extraGenres.includes(g.toLowerCase())}
                  onClick={() => toggleGenre(g.toLowerCase())}
                >
                  {g}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </BookEditorSection>
      <BookEditorSection id="edition" title="Edition details">
        {editionNotice}
        <div className="book-editor-grid">
          {input('isbn', 'ISBN', 'None set')}
          <BookField label="Edition format">
            <select
              aria-label="Edition format"
              value={f.format}
              onChange={(e) => set('format', e.target.value)}
              className={bookFieldClass}
            >
              <option value="">Format unknown</option>
              <option value="Physical">Physical</option>
              {f.format &&
                f.format !== 'Physical' &&
                !FORMATS.some((format) => format === f.format) && <option>{f.format}</option>}
              {FORMATS.map((format) => (
                <option key={format}>{format}</option>
              ))}
            </select>
          </BookField>
          {input('pages', 'Pages', 'Unknown', true)}
        </div>
        <fieldset>
          <legend className="book-editor-caption">Publication date</legend>
          <p className="mb-2 text-sm text-muted">Enter only what you know.</p>
          <div className="grid grid-cols-3 gap-3">
            {input('pubY', 'Pub year', 'YYYY', true)}
            {input('pubM', 'Month', '1–12', true)}
            {input('pubD', 'Day', '1–31', true)}
          </div>
        </fieldset>
      </BookEditorSection>
      <BookEditorSection id="series" title="Series details">
        <div className="book-editor-grid">
          {input('series', 'Series', 'Series')}
          {input('position', 'Position', 'Book #', true)}
          {input('seriesCount', 'Series length', 'None set', true)}
          <BookField label="Series status">
            <select
              aria-label="Series status"
              value={f.status}
              onChange={(e) => set('status', e.target.value)}
              className={bookFieldClass}
            >
              {SERIES_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>
                  {SERIES_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </BookField>
        </div>
      </BookEditorSection>
    </div>
  )
}
