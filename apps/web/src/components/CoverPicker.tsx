import { useState } from 'react'
import { useCoverAlternates } from '../data/coverStudio'
import { useSetCover } from '../data/coverSheet'
import type { CoverAlternate } from '../lib/enrich'
import { Surface } from './Surface'

/**
 * Cover Studio — pick a found edition (the import-review surface). Expands to the E1 alternate
 * covers (fetched on demand); the pick flows through the SAME durable ingest pipeline as the cover
 * sheet (covers Edge Function → user-scoped Storage, provenance + user-chosen flag persisted).
 */
export function CoverPicker({
  book,
  onPicked,
}: {
  book: { id: string; title?: string; first?: string; last?: string }
  onPicked?: () => void
}) {
  const [open, setOpen] = useState(false)
  const setCover = useSetCover()
  const saving = setCover.isPending
  const { data: alternates, isLoading } = useCoverAlternates(book, open)

  const pick = (alt: CoverAlternate) => {
    if (!alt.cover || saving) return
    if (alt.source !== 'hardcover' && alt.source !== 'openlibrary') return
    setCover.mutate(
      { book, source: alt.source, url: alt.cover, sourceUrl: alt.cover },
      {
        onSettled: () => {
          setOpen(false)
          onPicked?.()
        },
      },
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="skin-control mt-1 w-full border border-line px-2 py-1 text-[11px] font-semibold text-ink"
        style={{ background: 'var(--field)' }}
      >
        Choose cover
      </button>
    )
  }

  // Old enrichment cache rows can still contain Google candidates. They are display-only search
  // results and never belong in a persistent cover picker.
  const alts = (alternates ?? []).filter(
    (alternate) => alternate.source === 'hardcover' || alternate.source === 'openlibrary',
  )
  return (
    <Surface tone="field" radius="card" pad={0} className="mt-1 p-2">
      {isLoading && <div className="text-[11px] text-muted">Finding editions…</div>}
      {saving && <div className="text-[11px] text-muted">Saving cover…</div>}
      {!isLoading && !saving && alts.length === 0 && (
        <div className="text-[11px] text-muted">No other editions found.</div>
      )}
      {alts.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {alts.map((a, i) => (
            <li key={a.isbn13 || a.cover || i}>
              <button
                type="button"
                onClick={() => pick(a)}
                disabled={saving}
                aria-label={`Use the ${a.source} edition cover`}
                className="block w-12 overflow-hidden rounded border border-line disabled:opacity-50"
                style={{ aspectRatio: '2 / 3' }}
              >
                <img src={a.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={saving}
        className="mt-1.5 text-[11px] text-muted underline disabled:opacity-50"
      >
        Cancel
      </button>
    </Surface>
  )
}
