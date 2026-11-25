import { useMemo, useState, type ReactNode } from 'react'
import type { Book, LibraryShelfLink, SeriesLenBucket } from '@reverie/core'
import {
  bookGenres,
  bookSubgenres,
  LIBRARY_GENRES,
  subgenreLabel,
  bookTropeNames,
  SERIES_STATUS_LABELS,
  SERIES_STATUS_VALUES,
} from '@reverie/core'
import { useFilters } from './filterStore'
import { Chip } from '../components/Chip'
import { FORMATS, READ_STATUSES } from './constants'
import { useLabels } from '../skin/labels'
import { useHideIntensity } from '../data/profile'
import { Surface } from '../components/Surface'

const LEN_BUCKETS: SeriesLenBucket[] = ['Any', '1', '2', '3', '4', '5+', 'Unknown']
/*
 * The selectable intensity values, and there are SEVEN, not five.
 *
 * 1–5 alone left two large populations unreachable by any intensity filter: books assessed as
 * having none (0) and books nobody has assessed (null). Measured on the live database when this
 * was fixed: 535 at 0 and 179 at null, against 49 across levels 3–5. `null` is listed here as
 * itself rather than as a stand-in number precisely so the two can never be collapsed into one
 * chip — that collapse is the defect this replaces.
 */
const SPICE_LEVELS: (number | null)[] = [0, 1, 2, 3, 4, 5, null]
// Mirrors ShelvesRoute's SECTION_LABEL — same words for the same shelf, wherever it's named.
const SHELF_LINK_LABEL: Record<Exclude<LibraryShelfLink, 'All'>, string> = {
  owned: 'Owned',
  borrowed: '⇄ Borrowed',
  read: 'Read',
  wishlist: '⊹ Wishlist',
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

export function FilterPanel({ books, bare = false }: { books: Book[]; bare?: boolean }) {
  const s = useFilters()
  const { filters } = s
  const labels = useLabels()
  const hideIntensity = useHideIntensity()
  const [showAllTags, setShowAllTags] = useState(false)

  // Derive the subgenre facets from the LIBRARY's own books (not a fixed romance list), so any
  // genre's subgenres — Epic Fantasy, Noir, Memoir — show up once a book uses them.
  const subs = useMemo(
    () => ['All', ...[...new Set(books.flatMap((b) => bookSubgenres(b)))].sort()],
    [books],
  )
  // Same derivation as subs, one level up: every genre any book actually carries, primary or
  // additional. bookGenres falls back to the single `genre`, so a library with no multi-genre books
  // yields exactly the facets it always would have.
  const genres = useMemo(
    () => ['All', ...[...new Set(books.flatMap((b) => bookGenres(b)))].sort()],
    [books],
  )
  const editions = useMemo(
    () =>
      [
        ...new Set(
          books.flatMap(
            (book) => book.copyInventory?.editions.map((e) => e.label.trim()).filter(Boolean) ?? [],
          ),
        ),
      ].sort(),
    [books],
  )
  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of books)
      for (const t of bookTropeNames(b)) counts.set(t, (counts.get(t) ?? 0) + 1)
    const sorted = [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
    return { all: sorted, shown: showAllTags ? sorted : sorted.slice(0, 14) }
  }, [books, showAllTags])

  return (
    <Surface
      tone={bare ? 'bare' : 'card'}
      radius={bare ? 'none' : 'card'}
      pad={bare ? 0 : 3}
      border={!bare}
      className={bare ? '' : 'mb-4 backdrop-blur'}
    >
      <Group label="Copies">
        <Chip active={!!filters.specialEdition} onClick={() => s.toggleCopyFacet('specialEdition')}>
          Special edition
        </Chip>
        <Chip
          active={!!filters.previouslyOwned}
          onClick={() => s.toggleCopyFacet('previouslyOwned')}
        >
          Previously owned
        </Chip>
      </Group>
      {editions.length > 0 && (
        <Group label="Edition">
          <select
            className="skin-field min-h-11 max-w-full"
            aria-label="Edition name"
            value={filters.editionLabel ?? ''}
            onChange={(event) => s.setEditionLabel(event.target.value)}
          >
            <option value="">All editions</option>
            {editions.map((edition) => (
              <option key={edition}>{edition}</option>
            ))}
          </select>
        </Group>
      )}
      <Group label="Genre">
        {genres.map((g) => (
          <Chip key={g} active={filters.genre === g} onClick={() => s.setGenre(g)}>
            {g === 'All' ? g : (LIBRARY_GENRES.find((cg) => cg.toLowerCase() === g) ?? g)}
          </Chip>
        ))}
      </Group>

      <Group label="Subgenre">
        {subs.map((sub) => (
          <Chip key={sub} active={filters.sub === sub} onClick={() => s.setSub(sub)}>
            {subgenreLabel(sub)}
          </Chip>
        ))}
      </Group>

      <Group label={labels.tags}>
        {tags.shown.map((t) => (
          <Chip key={t} active={filters.tags.includes(t)} onClick={() => s.toggleTag(t)}>
            {t}
          </Chip>
        ))}
        {tags.all.length > 14 && (
          <Chip onClick={() => setShowAllTags((v) => !v)}>
            {showAllTags ? 'show less' : 'show all'}
          </Chip>
        )}
      </Group>

      <Group label="Series status (completed?)">
        {(['All', ...SERIES_STATUS_VALUES] as const).map((v) => (
          <Chip key={v} active={filters.status === v} onClick={() => s.setStatus(v)}>
            {v === 'All' ? 'All' : SERIES_STATUS_LABELS[v]}
          </Chip>
        ))}
      </Group>

      <Group label="Books in series">
        {LEN_BUCKETS.map((v) => (
          <Chip key={v} active={filters.len === v} onClick={() => s.setLen(v)}>
            {v === 'Unknown' ? 'None set' : v}
          </Chip>
        ))}
      </Group>

      <Group label="Reading status">
        {(['All', ...READ_STATUSES] as const).map((v) => (
          <Chip key={v} active={filters.read === v} onClick={() => s.setRead(v)}>
            {v}
          </Chip>
        ))}
      </Group>

      <Group label="Format">
        {(['All', ...FORMATS] as const).map((v) => (
          <Chip key={v} active={filters.format === v} onClick={() => s.setFormat(v)}>
            {v}
          </Chip>
        ))}
      </Group>

      {/* Hidden readers get no group AND no live filter — `withIntensityHidden` clears any
          level they had selected before hiding, so the grid cannot stay constrained by a control
          that is no longer on screen. (#325)
          The chips inside are #326's: `null` is a selectable member meaning NOT ASSESSED, distinct
          from `0` meaning assessed-and-none, each with a name a screen reader can act on. Both
          halves are kept — hiding decides WHETHER the group renders, the chips decide WHAT it
          offers, and neither answer substitutes for the other. */}
      {!hideIntensity && (
        <Group label={labels.intensity}>
          {SPICE_LEVELS.map((lvl) => {
            // Each chip needs a NAME a screen reader can act on; a row of repeated glyphs (and,
            // for 0, an empty span) would leave three of the seven indistinguishable by name alone.
            const name =
              lvl === null
                ? `${labels.intensity} not assessed`
                : lvl === 0
                  ? `${labels.intensity} none`
                  : `${labels.intensity} ${lvl}`
            return (
              <Chip
                key={lvl === null ? 'unassessed' : lvl}
                active={filters.intensity.includes(lvl)}
                onClick={() => s.toggleIntensity(lvl)}
              >
                <span aria-label={name}>
                  {lvl === null ? '—' : lvl === 0 ? 'None' : labels.intensityGlyph.repeat(lvl)}
                </span>
              </Chip>
            )
          })}
        </Group>
      )}
      {/* Darkness — the OTHER axis, never gated by hide-spice: #325's toggle was scoped to
          intensity/Spice by product decision, and silently extending it here would hide a
          field the reader never asked to hide. */}
      <Group label={labels.darkness}>
        {SPICE_LEVELS.map((lvl) => {
          // Each chip needs a NAME a screen reader can act on; a row of repeated glyphs (and,
          // for 0, an empty span) would leave three of the seven indistinguishable by name alone.
          const name =
            lvl === null
              ? `${labels.darkness} not assessed`
              : lvl === 0
                ? `${labels.darkness} none`
                : `${labels.darkness} ${lvl}`
          return (
            <Chip
              key={lvl === null ? 'unassessed' : lvl}
              active={filters.darkness.includes(lvl)}
              onClick={() => s.toggleDarkness(lvl)}
            >
              <span aria-label={name}>
                {lvl === null ? '—' : lvl === 0 ? 'None' : labels.darknessGlyph.repeat(lvl)}
              </span>
            </Chip>
          )
        })}
      </Group>

      {filters.shelf !== 'All' && (
        <Group label="Shelf">
          <Chip active onClick={() => s.setShelf('All')}>
            {SHELF_LINK_LABEL[filters.shelf]} ✕
          </Chip>
        </Group>
      )}

      <Group label="Other">
        <Chip active={filters.fave} onClick={s.toggleFave}>
          ♥ Favorites only
        </Chip>
        {/* Default grid = what you have or have read; this lets the wishlist + unset-unread ghosts
            in alongside (docs/archive/task-ownership-v2.md). */}
        <Chip active={filters.wishlist} onClick={s.toggleWishlist}>
          ⊹ Show wishlist
        </Chip>
        <Chip onClick={s.clear}>Clear all</Chip>
      </Group>
    </Surface>
  )
}
