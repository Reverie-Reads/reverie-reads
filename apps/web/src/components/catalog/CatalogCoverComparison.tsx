import { useState } from 'react'
import { coverResolutionLabel, type CoverMeasurement } from '@reverie/core'
import { Button } from '../Button'
import { CoverImage } from '../CoverImage'
import { CoverEditionOption } from '../CoverEditionOption'
import { Surface } from '../Surface'
import {
  COVER_CONCERNS,
  useCatalogCoverAlternatives,
  useCatalogCoverHistory,
  useSaveCatalogCoverReview,
  type CatalogCoverWork,
  type CoverConcern,
  type CoverReviewEvent,
} from '../../data/corpusCoverReview'
import type { EditionOption } from '../../lib/covers'

const ACTIONS: Record<CoverReviewEvent['action'], string> = {
  keep: 'Current cover approved',
  replace: 'Shared cover replaced',
  flag: 'Concern recorded',
  defer: 'Set aside for later',
  reopen: 'Returned to review',
}

function sourceLink(url: string | null): string | null {
  try {
    const parsed = new URL(url ?? '')
    if (!['https:', 'http:'].includes(parsed.protocol)) return null
    if (parsed.hostname === 'books.google.com' && parsed.searchParams.get('id'))
      return `https://books.google.com/books?id=${encodeURIComponent(parsed.searchParams.get('id')!)}`
    return parsed.href
  } catch {
    return null
  }
}

function MeasuredCover({
  title,
  cover,
  source,
  sourceUrl,
  label,
  onMeasured,
}: {
  title: string
  cover: string | null
  source: string | null
  sourceUrl: string | null
  label: string
  onMeasured: (image: CoverMeasurement | null) => void
}) {
  const [image, setImage] = useState<CoverMeasurement | null>(null)
  const [broken, setBroken] = useState(false)
  const link = sourceLink(source === 'google' ? cover : sourceUrl)
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 text-sm font-semibold text-ink">{label}</figcaption>
      <div
        className="mx-auto aspect-[2/3] w-full max-w-[200px] overflow-hidden border border-line"
        style={{ background: 'var(--field)' }}
      >
        <CoverImage
          book={{ title, cover }}
          reportErrors={false}
          className="h-full w-full object-contain"
          onResolved={(value) => {
            const valid = coverResolutionLabel(value) !== 'Image unavailable'
            setBroken(!valid)
            setImage(valid ? value : null)
            onMeasured(valid ? value : null)
          }}
          onExhausted={() => {
            setBroken(true)
            setImage(null)
            onMeasured(null)
          }}
        />
      </div>
      <p className="mt-3 text-sm text-ink">
        {!cover
          ? 'No cover yet'
          : broken
            ? 'Image unavailable'
            : image
              ? coverResolutionLabel(image)
              : 'Checking image…'}
      </p>
      {image && (
        <p className="text-xs text-muted">
          {image.width} × {image.height} pixels
        </p>
      )}
      <p className="mt-1 text-xs text-muted">
        {source === 'google' ? 'Google Books · Linked image' : source || 'Source not recorded'}
      </p>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block break-words text-sm text-ink underline underline-offset-4"
        >
          {source === 'google' ? 'View on Google Books' : 'View source'}
        </a>
      )}
    </figure>
  )
}

export function CatalogCoverComparison({
  work,
  onSaved,
  onRefresh,
}: {
  work: CatalogCoverWork
  onSaved: (message: string) => void
  onRefresh: () => void
}) {
  const [isbn, setIsbn] = useState('')
  const [lookup, setLookup] = useState(false)
  const [candidate, setCandidate] = useState<EditionOption | null>(null)
  const [currentImage, setCurrentImage] = useState<CoverMeasurement | null>(null)
  const [candidateImage, setCandidateImage] = useState<CoverMeasurement | null>(null)
  const [identityConfirmed, setIdentityConfirmed] = useState(false)
  const [note, setNote] = useState(work.note)
  const [reason, setReason] = useState<CoverConcern | ''>(work.reason ?? '')
  const alternatives = useCatalogCoverAlternatives(work, isbn, lookup)
  const history = useCatalogCoverHistory(work.id)
  const save = useSaveCatalogCoverReview()
  const selectedImage = candidate ? candidateImage : currentImage
  const approve = identityConfirmed && !!selectedImage && !save.isPending
  const decide = async (action: CoverReviewEvent['action']) => {
    try {
      await save.mutateAsync({
        work,
        action,
        note,
        reason: action === 'flag' || action === 'defer' ? reason || null : null,
        identityConfirmed,
        measurement: action === 'replace' ? candidateImage : currentImage,
        candidate: candidate ?? undefined,
      })
      // The refreshed fingerprint remounts this form; a per-mutate callback would be dropped.
      onSaved(`${ACTIONS[action]}. Personal covers stay as their readers chose them.`)
    } catch {
      // The mutation's error state provides the visible retry/refresh action below.
    }
  }
  return (
    <Surface tone="card-solid" radius="panel" pad={5} className="min-w-0">
      <header className="border-b border-line pb-4">
        <p className="text-xs text-muted">
          SHARED CATALOG ·{' '}
          {work.state === 'approved'
            ? 'Reviewed'
            : work.state === 'deferred'
              ? 'For later'
              : 'Needs a look'}
        </p>
        <h2
          className="mt-2 break-words text-2xl leading-snug text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {work.title}
        </h2>
        <p className="mt-1 break-words text-sm text-muted">
          {work.author || 'Author not recorded'}
        </p>
        <p className="mt-3 text-xs text-muted">
          {work.isbns.length
            ? `Catalog ISBNs: ${work.isbns.join(' · ')}`
            : 'No catalog ISBN recorded.'}
        </p>
        {work.reason && <p className="mt-3 text-sm text-ink">{COVER_CONCERNS[work.reason]}</p>}
      </header>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:gap-6">
        <MeasuredCover
          key={`current-${work.fingerprint}`}
          title={work.title}
          cover={work.cover}
          source={work.source}
          sourceUrl={work.sourceUrl}
          label="Current shared cover"
          onMeasured={setCurrentImage}
        />
        {candidate ? (
          <MeasuredCover
            key={candidate.cover}
            title={work.title}
            cover={candidate.cover}
            source={candidate.source}
            sourceUrl={candidate.cover}
            label="Your proposed cover"
            onMeasured={setCandidateImage}
          />
        ) : (
          <div className="flex min-w-0 flex-col justify-center border border-dashed border-line p-3 text-sm leading-relaxed text-muted">
            Compare another edition here, or keep the current image if it belongs to this book.
          </div>
        )}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">
        Resolution describes the loaded image. Check the printed title, author, and edition
        yourself; more pixels do not establish a match.
      </p>
      {candidate && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm text-ink">
            {[candidate.format, candidate.year, candidate.isbn13 || candidate.isbn10]
              .filter(Boolean)
              .join(' · ') || 'Edition details not supplied'}
          </p>
          <Button
            variant="ghost"
            disabled={save.isPending}
            onClick={() => {
              setCandidate(null)
              setCandidateImage(null)
              setIdentityConfirmed(false)
            }}
          >
            Keep comparing
          </Button>
        </div>
      )}

      <details className="mt-5 border-y border-line py-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          Find an alternative cover
        </summary>
        <label className="mt-4 block text-sm text-ink">
          Edition to look up
          <select
            className="skin-field mt-2 min-h-11 w-full px-3 text-base"
            value={isbn}
            disabled={save.isPending}
            onChange={(e) => {
              setIsbn(e.target.value)
              setLookup(false)
              setCandidate(null)
              setCandidateImage(null)
              setIdentityConfirmed(false)
            }}
          >
            <option value="">Any edition of this work</option>
            {work.isbns.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="secondary"
          className="mt-3"
          disabled={save.isPending || alternatives.isFetching}
          onClick={() => {
            if (lookup) void alternatives.refetch()
            else setLookup(true)
          }}
        >
          {alternatives.isFetching
            ? 'Looking for covers…'
            : lookup
              ? 'Refresh alternatives'
              : 'Look for covers'}
        </Button>
        {alternatives.isError && (
          <p role="alert" className="mt-3 text-sm text-ink">
            The cover lookup could not be completed. Refresh alternatives to try again.
          </p>
        )}
        {lookup && alternatives.isSuccess && !alternatives.data.length && (
          <p className="mt-3 text-sm text-muted">
            No verified alternatives were returned. Try a listed ISBN, or set this book aside for
            another source.
          </p>
        )}
        {lookup && alternatives.data && (
          <div className="mt-4 grid gap-3 xl:grid-cols-2" aria-label="Alternative covers">
            {alternatives.data.map((edition) => (
              <CoverEditionOption
                key={`${edition.source}:${edition.cover}`}
                edition={edition}
                isbn={isbn}
                disabled={save.isPending}
                onSelect={(selected) => {
                  setCandidate(selected)
                  setCandidateImage(null)
                  setIdentityConfirmed(false)
                }}
              />
            ))}
          </div>
        )}
      </details>

      <fieldset disabled={save.isPending} className="mt-5 min-w-0">
        <legend className="text-base font-semibold text-ink">Make a deliberate choice</legend>
        <label className="mt-3 flex min-h-11 items-start gap-3 text-sm leading-relaxed text-ink">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 flex-none"
            checked={identityConfirmed}
            onChange={(e) => setIdentityConfirmed(e.target.checked)}
          />
          <span>
            I checked that this artwork belongs to the recorded title and author, and any edition
            details I am relying on.
          </span>
        </label>
        <label className="mt-4 block text-sm text-ink">
          Review note <span className="text-muted">(optional)</span>
          <textarea
            className="skin-field mt-2 block min-h-24 w-full px-3 py-3 text-base leading-relaxed"
            maxLength={600}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you verify, or what still needs a look?"
          />
        </label>
        <p className="mt-2 text-xs text-muted">
          Notes are shared with catalog administrators. This changes the shared catalog only;
          personal covers and edition details stay untouched.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={!approve} onClick={() => decide(candidate ? 'replace' : 'keep')}>
            {save.isPending
              ? 'Saving review…'
              : candidate
                ? 'Approve replacement'
                : 'Approve current cover'}
          </Button>
          {(work.state === 'approved' || work.state === 'deferred') && (
            <Button variant="secondary" onClick={() => decide('reopen')}>
              Return to review
            </Button>
          )}
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <label className="block text-sm text-ink">
            What needs attention?
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as CoverConcern | '')}
              className="skin-field mt-2 min-h-11 w-full px-3 text-base"
            >
              <option value="">Not specified</option>
              {Object.entries(COVER_CONCERNS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!reason} onClick={() => decide('flag')}>
              Flag for review
            </Button>
            <Button variant="ghost" onClick={() => decide('defer')}>
              Set aside for later
            </Button>
          </div>
        </div>
      </fieldset>
      {save.isError && (
        <div role="alert" className="mt-4 border border-line p-3 text-sm text-ink">
          <p>{save.error.message || 'The review could not be saved.'}</p>
          <Button variant="secondary" className="mt-2" onClick={onRefresh}>
            Refresh this record
          </Button>
        </div>
      )}
      <details className="mt-5 border-t border-line pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Review history</summary>
        {history.isPending ? (
          <p className="mt-3 text-sm text-muted">Loading review history…</p>
        ) : history.isError ? (
          <Button variant="secondary" className="mt-3" onClick={() => void history.refetch()}>
            Retry review history
          </Button>
        ) : !history.data.length ? (
          <p className="mt-3 text-sm text-muted">No saved reviews yet.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {history.data.map((event) => (
              <li key={event.id} className="text-sm text-ink">
                <p>
                  {ACTIONS[event.action]} ·{' '}
                  <time dateTime={event.created_at}>
                    {new Date(event.created_at).toLocaleDateString()}
                  </time>
                </p>
                {event.next_value.review.reason && (
                  <p className="mt-1 text-muted">
                    {COVER_CONCERNS[event.next_value.review.reason]}
                  </p>
                )}
                {event.next_value.review.note && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-muted">
                    {event.next_value.review.note}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </details>
    </Surface>
  )
}
