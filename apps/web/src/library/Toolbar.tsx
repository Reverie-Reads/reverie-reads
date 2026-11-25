import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  activeFilterCount,
  matchesLibraryQuery,
  formatAuthors,
  type Book,
  type LibrarySort,
} from '@reverie/core'
import { useBooks } from '../data/books'
import { useFilters } from './filterStore'
import { SORTS } from './constants'
import { Frame } from '../components/Structure'

/** The deployed search-results panel (chunk-4: Aphelion "records panel, shown deployed"; Almanac
 *  "results filed in" — `2 ENTRIES // 0.2S · ESC CLOSES`). Composed for all nine from existing
 *  slots: a Frame under the search line, the top matches as rows, a skin-numeral count line, the
 *  Esc hint in the label voice. The grid keeps filtering live behind it. */
function SearchResultsPanel({ q, onPick }: { q: string; onPick: (b: Book) => void }) {
  const { data: books } = useBooks()
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle || !books) return []
    return books.filter((book) => matchesLibraryQuery(book, needle))
  }, [books, q])
  if (!q.trim()) return null
  return (
    <Frame
      // INLINE, AND NOW THE SOURCE SAYS SO. This carried `absolute left-0 right-0
      // top-[calc(100%+6px)] z-30` and rendered none of it. Frame hardcodes `relative` ahead of the
      // className it is passed, Tailwind emits `relative` after `absolute`, and the class attribute's
      // order does not decide a cascade — so the panel has always been IN FLOW, pushing the grid
      // down rather than floating over it.
      //
      // The offset was dead in a way that actively misleads: `getComputedStyle().top` read 156px on
      // a two-result panel, which is the containing block's own height (150 = 40px input + 110px
      // panel) plus 6 — self-referential, because the panel is what makes that block 150 tall. A
      // percentage `top` on a relatively-positioned element in an auto-height block computes to
      // `auto`, so nothing was applied; devtools showed a live-looking number for an offset that
      // never moved anything.
      //
      // `mt-1.5` is the 6px the dead calc was asking for, taken through a property that works in
      // flow. Deliberately NOT an overlay: making the panel truly absolute needs `.skin-plate`
      // changed too (it sets `position: relative` in skin-kit.css, so Frame alone leaves tryst
      // in flow while the other eight skins float) and would cover the withheld-matches line.
      // The guard in search-withheld-matches.spec.ts keeps that layout decision visible.
      className="mt-1.5 overflow-hidden p-2 shadow-lg"
      style={{ boxShadow: 'var(--shadow)' }}
    >
      <ul className="flex flex-col">
        {matches.slice(0, 6).map((b) => (
          <li key={b.id}>
            <button
              type="button"
              // mousedown so the pick lands before the input's blur closes the panel
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(b)}
              className="flex w-full items-baseline justify-between gap-3 px-2 py-1.5 text-left hover:bg-[var(--chip)]"
              style={{ borderRadius: 'calc(var(--radius-control) / 3)' }}
            >
              <span className="min-w-0 flex-1 break-words text-[13.5px] font-semibold text-ink">
                {b.title}
                {b.copyInventory?.editions
                  .filter(
                    (edition) =>
                      edition.label && edition.label.toLowerCase().includes(q.trim().toLowerCase()),
                  )
                  .map((edition) => (
                    <span key={edition.id} className="block text-xs text-muted">
                      {edition.label}
                    </span>
                  ))}
              </span>
              <span className="skin-label min-w-0 max-w-[45%] break-words text-right text-[11px] text-muted">
                {formatAuthors(b.contributors) || [b.first, b.last].filter(Boolean).join(' ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-baseline justify-between border-t border-line px-2 pt-1.5">
        <span
          className="skin-numeral text-[11px] font-semibold"
          style={{ color: 'var(--accent-ink)' }}
        >
          {matches.length} {matches.length === 1 ? 'match' : 'matches'}
        </span>
        <span className="skin-label text-[9.5px] text-muted">Esc closes</span>
      </div>
    </Frame>
  )
}

export function Toolbar({ filterToggleClass = '' }: { filterToggleClass?: string }) {
  const filters = useFilters((s) => s.filters)
  const setQuery = useFilters((s) => s.setQuery)
  const setSort = useFilters((s) => s.setSort)
  const togglePanel = useFilters((s) => s.togglePanel)
  const panelOpen = useFilters((s) => s.panelOpen)
  const setAuthor = useFilters((s) => s.setAuthor)
  const count = activeFilterCount(filters)
  const [searchFocused, setSearchFocused] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="relative min-w-[200px] flex-1"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSearchFocused(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSearchFocused(false)
          }}
        >
          <input
            type="search"
            value={filters.q}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
            }}
            placeholder="Search title, author, edition, series, tag…"
            aria-label="Search your library"
            className="skin-field h-10 w-full border border-line px-4 text-[14px] text-ink outline-none"
            style={{ background: 'var(--field)' }}
          />
          {searchFocused && (
            <SearchResultsPanel
              q={filters.q}
              onPick={(b) => navigate({ to: '/book/$bookId', params: { bookId: b.id } })}
            />
          )}
        </div>

        <button
          type="button"
          // Keep the in-flow search panel mounted for the whole pointer gesture. Otherwise the
          // input blurs on mousedown, the panel collapses, and this button moves before mouseup so
          // the browser never dispatches its click (the same geometry as the hidden-match reveal).
          onMouseDown={(e) => e.preventDefault()}
          onClick={togglePanel}
          aria-expanded={panelOpen}
          className={`skin-control flex h-10 items-center gap-1.5 border border-line px-4 text-[13px] text-ink ${filterToggleClass}`}
          style={{ background: 'var(--card)' }}
        >
          Filters{count > 0 && <span className="text-gold">({count})</span>}
        </button>

        <label className="sr-only" htmlFor="lib-sort">
          Sort
        </label>
        <select
          id="lib-sort"
          value={filters.sort}
          onChange={(e) => setSort(e.target.value as LibrarySort)}
          className="skin-control h-10 border border-line px-3 text-[13px] text-ink outline-none"
          style={{ background: 'var(--card)' }}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {filters.author && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="skin-control-quiet inline-flex items-center gap-1.5 border border-line px-3 py-1 text-[12.5px] text-ink"
            style={{
              background: 'var(--chip)',
            }}
          >
            Author: {filters.author}
            <button
              type="button"
              onClick={() => setAuthor('')}
              aria-label={`Clear author filter ${filters.author}`}
              className="text-muted hover:text-ink"
            >
              ✕
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
