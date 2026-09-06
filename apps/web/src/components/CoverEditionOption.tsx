import { useState } from 'react'
import { mayIngestCover } from '@reverie/core'
import { matchesCoverEdition } from '../data/coverSheet'
import type { EditionOption } from '../lib/covers'
import { CoverImage } from './CoverImage'

/** Measure the actual fallback image, not a provider's claimed size or the thumbnail box. */
export function CoverEditionOption({
  edition,
  isbn,
  disabled,
  onSelect,
}: {
  edition: EditionOption
  isbn: string
  disabled: boolean
  onSelect: (edition: EditionOption) => void
}) {
  const [image, setImage] = useState<{ url: string; width: number; height: number } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const quality = !image
    ? 'Checking image…'
    : image.width >= 800 && image.height >= 1200
      ? 'Sharp in detail'
      : image.width >= 480 && image.height >= 720
        ? 'Sharp on cards'
        : 'May look soft'
  return (
    <button
      type="button"
      disabled={disabled || unavailable || !image}
      onClick={() => image && onSelect({ ...edition, cover: image.url })}
      className="flex w-full items-center gap-3 skin-tile border border-line p-3 text-left disabled:opacity-70"
      style={{ background: 'var(--field)' }}
    >
      <span
        className="block w-12 flex-none overflow-hidden rounded border border-line"
        style={{ aspectRatio: '2 / 3' }}
      >
        <CoverImage
          book={{ title: edition.title, cover: edition.cover }}
          reportErrors={false}
          onResolved={(resolved) => {
            // Match the ingest floor: tracking pixels and tiny source plates are not covers.
            if (resolved.width < 50 || resolved.height < 50) setUnavailable(true)
            else setImage(resolved)
          }}
          onExhausted={() => setUnavailable(true)}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-semibold text-ink">
          {[edition.format, edition.year].filter(Boolean).join(' · ') || edition.title || 'Edition'}
        </span>
        <span className="block break-words text-xs text-muted">
          {[edition.publisher, edition.pages ? `${edition.pages} pp` : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="mt-1 block text-xs text-ink">
          {matchesCoverEdition(edition, isbn)
            ? 'Matches your ISBN'
            : edition.isbn13 || edition.isbn10 || 'ISBN not listed'}
        </span>
        <span className="mt-1 block text-xs text-muted">
          {unavailable ? 'Image unavailable' : quality}
          {image && ` · ${image.width} × ${image.height}`}
        </span>
        <span className="mt-1 block text-xs text-muted">
          {edition.source === 'google' ? 'Google Books' : 'Hardcover'}
          {!mayIngestCover(edition.source, edition.cover) && ' · Linked image'}
        </span>
      </span>
    </button>
  )
}
