import { bookBarcode } from '@reverie/core'
import { enrichBookOutcome } from '../lib/enrich'
import { useCallback, useEffect, useRef, useState } from 'react'
import { partitionSearchResults, searchEverywhere, type SearchResult } from '../lib/search'

/** Shared by single-book and bulk Add; search hits never establish series membership. */
export async function searchAddCatalog(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const isbn = bookBarcode(query)
  let editionUnavailable = false
  if (isbn) {
    const outcome = await enrichBookOutcome({ isbn }, signal)
    if (signal?.aborted) return []
    editionUnavailable = outcome.status === 'failed' || outcome.status === 'rate_limited'
    if (outcome.status === 'ok' && outcome.data.isbn13 === isbn) {
      const r = outcome.data
      const source = r.provenance?.isbn13?.source === 'hardcover' ? 'hardcover' : 'openlibrary'
      return [{ source, title: r.title, authors: r.authors, isbn, editionIsbn: isbn, cover: r.cover, year: r.pubY ? String(r.pubY) : '' }]
    }
  }
  const hits = await searchEverywhere(query, signal)
  if (editionUnavailable && !hits.some((hit) => hit.title))
    throw new Error('Edition lookup was unavailable; absence is unconfirmed')
  const sections = partitionSearchResults(hits.filter((hit) => hit.title))
  // Limit catalog matches only; preserve Google's complete attributed result order.
  return [...sections.catalog.slice(0, 8), ...sections.google]
}

/** Explicit Add searches, scoped to the latest submission or manual-entry choice. */
export function useAddSearch() {
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searched, setSearched] = useState('')
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState<'unavailable' | 'short' | null>(null)
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => request.current?.abort(), [])

  const cancel = useCallback(() => {
    request.current?.abort()
    request.current = null
    setBusy(false)
    setIssue(null)
  }, [])

  const search = useCallback(async (term: string) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const query = term.trim()
    setResults(null)
    setIssue(null)
    setBusy(false)
    setSearched('')
    if (query.length < 3) {
      setIssue('short')
      return
    }
    setBusy(true)
    // Starts the local corpus lookup alongside the remote search, not after it.
    setSearched(query)
    try {
      const hits = await searchAddCatalog(query, controller.signal)
      if (!controller.signal.aborted) setResults(hits)
    } catch {
      if (!controller.signal.aborted) setIssue('unavailable')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }, [])

  return { results, searched, busy, issue, search, cancel }
}
