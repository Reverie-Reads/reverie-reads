import { useState } from 'react'
import type { Book } from '@reverie/core'
import { Modal } from './Modal'
import { SearchSaveNotice } from './SearchSaveNotice'
import { SearchResults } from './SearchResults'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useSearchEverywhere, useAddFromSearch } from '../data/search'
import { useVoice } from '../skin/labels'
import type { SearchResult } from '../lib/search'

// The shelf picker's "search everywhere" surface (task §3) — the SAME search backend + results
// component as Discover, in a modal bound to one shelf. Picking a result adds it as an UNOWNED copy
// (a wanting context) and places it on this shelf. One search implementation, two surfaces.

export function ExternalSearchSheet({
  listId,
  listName,
  books,
  onClose,
}: {
  listId: string
  listName: string
  books: Book[]
  onClose: () => void
}) {
  const voice = useVoice()
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 400)
  const searching = debounced.trim().length >= 3
  const q = useSearchEverywhere(debounced)
  const add = useAddFromSearch()

  return (
    <Modal title={`Search everywhere · ${listName}`} onClose={onClose}>
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search title, author, or ISBN…"
        aria-label="Search the wider catalog"
        className="h-11 w-full skin-card border border-line px-3 text-[14px] text-ink outline-none"
        style={{ background: 'var(--field)' }}
      />

      <SearchSaveNotice add={add} />
      {add.isSuccess && add.variables?.listId && add.data.bookId && (
        <p role="status" className="mt-2 text-sm text-ink">
          Added to {listName}.
        </p>
      )}
      <div className="mt-3 max-h-[52vh] overflow-y-auto">
        {!searching && (
          <p className="px-1 py-3 text-[13px] text-muted">
            Type a title, author, or ISBN to find books beyond your library — they’ll land on{' '}
            {listName} as wishlist.
          </p>
        )}
        {searching && q.isPending && (
          <p className="px-1 py-3 text-[13px] text-muted">{voice.loading}</p>
        )}
        {searching && q.isError && (
          <p className="px-1 py-3 text-[13px] text-primary">
            Search isn’t answering — usually a rate limit. Try again shortly.
          </p>
        )}
        {searching && q.isSuccess && q.data.length === 0 && (
          <p className="px-1 py-3 text-[13px] text-muted">
            Nothing found — try another spelling or an ISBN.
          </p>
        )}
        {searching && q.isSuccess && q.data.length > 0 && (
          <SearchResults
            results={q.data}
            books={books}
            layout="list"
            renderActions={(r: SearchResult, existing) =>
              existing ? null : (
                <button
                  type="button"
                  disabled={add.isPending}
                  onClick={() => add.mutate({ result: r, possession: 'wishlist', listId })}
                  className="skin-control border border-line px-3 py-1 text-[12px] font-semibold text-ink disabled:opacity-50"
                  style={{ background: 'var(--chip)' }}
                >
                  ＋ Add
                </button>
              )
            }
          />
        )}
      </div>
    </Modal>
  )
}
