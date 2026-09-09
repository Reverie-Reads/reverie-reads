import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatPartialDate, type Book, type PartialDate } from '@reverie/core'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import { isOwned, ownedKeys, type DiscoverHit } from '../lib/discover'

// Releases / author-following (owner-approved run). The library DERIVES "your authors" — anyone
// behind a loved book (rating ≥ 4 or fave) or two-plus shelved books; author_follows rows pin an
// author in ('followed') or out ('muted'). The releases fn serves each author's recent + upcoming
// shelf from the global cache; the client accumulates across calls (cached names are free,
// upstream fetches are budgeted per request), then windows/dedupes/owner-filters locally.

export type FollowState = 'followed' | 'muted'
export type ReleaseSource = 'prh' | 'hardcover' | 'google'

export interface ReleaseInfo {
  source: ReleaseSource
  precision: 'year' | 'month' | 'day'
  sourceUrl?: string
  publisher?: string
  formats?: string[]
  territory?: string
  kind?: 'new_work' | 'new_edition'
  checkedAt: string
  confirmedBy?: ReleaseSource[]
}

export interface ReleaseHit extends DiscoverHit {
  /** Absent only on cached responses from the retired Google-only release shape. */
  release?: ReleaseInfo
}

const primaryAuthor = (b: Book): string =>
  (b.contributors[0]?.name ?? [b.first, b.last].filter(Boolean).join(' ')).trim()

/** The derived author list, follows applied, alphabetical. Capped — a 300-book library can name
 *  dozens of authors; the cap keeps fn round-trips sane and the rail readable. */
export function yourAuthors(books: readonly Book[], follows: Record<string, FollowState>, cap = 20): string[] {
  const stats = new Map<string, { count: number; loved: boolean }>()
  for (const b of books) {
    const name = primaryAuthor(b)
    if (!name) continue
    const s = stats.get(name) ?? { count: 0, loved: false }
    s.count += 1
    if (b.rating >= 4 || b.fave) s.loved = true
    stats.set(name, s)
  }
  const derived = [...stats.entries()].filter(([, s]) => s.loved || s.count >= 2)
  const set = new Map(derived)
  for (const [name, state] of Object.entries(follows)) {
    if (state === 'followed') set.set(name, set.get(name) ?? { count: 99, loved: true }) // pinned
    else set.delete(name)
  }
  // the cap keeps the reader's STRONGEST authors (loved, then shelf depth), not the alphabet's
  return [...set.entries()]
    .sort(([an, a], [bn, b]) => Number(b.loved) - Number(a.loved) || b.count - a.count || an.localeCompare(bn))
    .slice(0, cap)
    .map(([n]) => n)
    .sort((a, b) => a.localeCompare(b))
}

export interface AuthorRelease extends ReleaseHit {
  author: string
}

/** Parse only the flexible date shapes the product can represent. Calendar-invalid days are
 * rejected instead of rolling into the next month through Date.parse. */
export function parseReleasePub(value: string): PartialDate | null {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const y = Number(match[1])
  const m = match[2] ? Number(match[2]) : null
  const d = match[3] ? Number(match[3]) : null
  if (y < 1000 || y > 9999 || (m != null && (m < 1 || m > 12)) || (d != null && m == null))
    return null
  if (d != null) {
    const date = new Date(Date.UTC(y, (m ?? 1) - 1, d))
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== (m ?? 1) - 1 || date.getUTCDate() !== d)
      return null
  }
  return { y, m, d }
}

export function releaseDateLabel(value: string): string {
  return formatPartialDate(parseReleasePub(value))
}

function partialDateBounds(pub: PartialDate | null): { first: number; last: number } | null {
  if (!pub?.y) return null
  const month = pub.m ?? 1
  const day = pub.d ?? 1
  const first = Date.UTC(pub.y, month - 1, day)
  const last =
    pub.d != null
      ? first
      : pub.m != null
        ? Date.UTC(pub.y, month, 0, 23, 59, 59, 999)
        : Date.UTC(pub.y, 11, 31, 23, 59, 59, 999)
  return { first, last }
}

function dateBounds(value: string): { first: number; last: number } | null {
  return partialDateBounds(parseReleasePub(value))
}

/** Keep the reader's own release horizon useful and finite. Old backlist and unknown dates belong
 * on the book screen; this view is for arrivals. A partial date spanning today remains uncertain
 * instead of being forced into upcoming or released. */
export function personalReleaseWindow(
  books: readonly Book[],
  now: number,
): { upcoming: Book[]; recent: Book[]; uncertain: Book[] } {
  const sixMonthsAgo = now - 183 * 864e5
  const upcoming: { book: Book; time: number }[] = []
  const recent: { book: Book; time: number }[] = []
  const uncertain: { book: Book; time: number }[] = []

  for (const book of books) {
    const bounds = partialDateBounds(book.pub)
    if (!bounds || bounds.last < sixMonthsAgo) continue
    const entry = { book, time: bounds.first }
    if (bounds.first > now) upcoming.push(entry)
    else if (bounds.last >= now && (book.pub.m == null || book.pub.d == null)) {
      uncertain.push(entry)
    } else {
      recent.push({ book, time: bounds.last })
    }
  }

  upcoming.sort((a, b) => a.time - b.time || a.book.title.localeCompare(b.book.title))
  recent.sort((a, b) => b.time - a.time || a.book.title.localeCompare(b.book.title))
  uncertain.sort((a, b) => a.time - b.time || a.book.title.localeCompare(b.book.title))
  return {
    upcoming: upcoming.map(({ book }) => book),
    recent: recent.map(({ book }) => book),
    uncertain: uncertain.map(({ book }) => book),
  }
}

/** Window an author-shelf map into the Planner's external sections. A month or year that spans
 * today is uncertain: Reverie keeps it in "date taking shape" rather than inventing a last day. */
export function releaseWindow(
  shelves: Record<string, ReleaseHit[]>,
  books: readonly Book[],
  now: number,
): { upcoming: AuthorRelease[]; recent: AuthorRelease[]; uncertain: AuthorRelease[] } {
  const owned = ownedKeys(books)
  const seen = new Set<string>()
  const sixMonthsAgo = now - 183 * 864e5
  const upcoming: { r: AuthorRelease; t: number }[] = []
  const recent: { r: AuthorRelease; t: number }[] = []
  const uncertain: { r: AuthorRelease; t: number }[] = []
  for (const [author, hits] of Object.entries(shelves)) {
    for (const h of hits) {
      const bounds = dateBounds(h.pub)
      if (!bounds || bounds.last < sixMonthsAgo) continue
      if (isOwned(h, owned)) continue
      const k = `${h.title.toLowerCase()}|${(h.authors[0] ?? '').toLowerCase()}`
      if (seen.has(k)) continue
      seen.add(k)
      const entry = { r: { ...h, author }, t: bounds.first }
      if (bounds.first > now) upcoming.push(entry)
      else if (bounds.last >= now) uncertain.push(entry)
      else recent.push({ ...entry, t: bounds.last })
    }
  }
  upcoming.sort((a, b) => a.t - b.t)
  recent.sort((a, b) => b.t - a.t)
  uncertain.sort((a, b) => a.t - b.t)
  return {
    upcoming: upcoming.map((x) => x.r),
    recent: recent.map((x) => x.r),
    uncertain: uncertain.map((x) => x.r),
  }
}

export const followsKey = ['author-follows'] as const

export function useAuthorFollows() {
  return useQuery({
    queryKey: followsKey,
    queryFn: async (): Promise<Record<string, FollowState>> => {
      const data = await pageAll<{ author_name: string; state: FollowState }>(
        'author_follows',
        (from, to) =>
          supabase
            .from('author_follows')
            .select('author_name, state', { count: 'exact' })
            .order('author_name')
            .range(from, to),
      )
      return Object.fromEntries(data.map((r) => [r.author_name, r.state]))
    },
  })
}

/** Cycle an author: derived → muted → derived (or, for a non-derived name, followed → gone). */
export function useSetFollow() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'Release tracking' },
    mutationFn: async ({ name, state }: { name: string; state: FollowState | null }): Promise<void> => {
      const { data: auth } = await supabase.auth.getUser()
      const userId = auth.user?.id
      if (!userId) throw new Error('Not signed in')
      if (state === null) {
        const { error } = await supabase.from('author_follows').delete().eq('user_id', userId).eq('author_name', name)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('author_follows')
          .upsert({ user_id: userId, author_name: name, state }, { onConflict: 'user_id,author_name' })
        if (error) throw error
      }
    },
    onMutate: async ({ name, state }) => {
      await qc.cancelQueries({ queryKey: followsKey })
      const previous = qc.getQueryData<Record<string, FollowState>>(followsKey)
      qc.setQueryData<Record<string, FollowState>>(followsKey, (old) => {
        const next = { ...(old ?? {}) }
        if (state === null) delete next[name]
        else next[name] = state
        return next
      })
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(followsKey, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: followsKey }),
  })
}

/** Per-author shelves via the releases fn — accumulates until nothing is pending (cached names
 *  return instantly; each call spends a small upstream budget). Progressive: partial shelves
 *  render as they land, while status keeps loading and provider unavailability explicit. */
export type AuthorReleaseStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

export function useAuthorReleases(names: readonly string[]) {
  const [result, setResult] = useState<{
    key: string
    shelves: Record<string, ReleaseHit[]>
    status: AuthorReleaseStatus
  }>({ key: '', shelves: {}, status: 'idle' })
  const namesKey = names.join('|')
  const running = useRef<string | null>(null)

  // Keyed on namesKey ONLY: `names` is a fresh array identity every render, and depending on it
  // makes any re-render mid-loop run the cleanup (cancelling the run) while the running guard
  // blocks a restart — the shelves silently never fill. The key carries the same information.
  useEffect(() => {
    const keyNames = namesKey ? namesKey.split('|') : []
    if (!keyNames.length) {
      setResult({ key: '', shelves: {}, status: 'idle' })
      return
    }
    if (running.current === namesKey) return
    running.current = namesKey
    setResult({ key: namesKey, shelves: {}, status: 'loading' })
    let cancelled = false
    void (async () => {
      let remaining = keyNames
      let misses = 0
      for (let call = 0; call < 10 && remaining.length && !cancelled; call++) {
        try {
          const { data, error } = await supabase.functions.invoke('releases', { body: { mode: 'authors', names: remaining } })
          // one flaky call must not discard the run — skip it and let the next call retry
          if (error || !(data as { authors?: unknown })?.authors) {
            if (++misses >= 3) {
              setResult((old) =>
                old.key === namesKey ? { ...old, status: 'unavailable' } : old,
              )
              return
            }
            continue
          }
          const d = data as { authors: Record<string, ReleaseHit[]>; pending?: string[] }
          if (!cancelled) {
            setResult((old) =>
              old.key === namesKey
                ? { ...old, shelves: { ...old.shelves, ...d.authors } }
                : old,
            )
          }
          remaining = d.pending ?? []
        } catch {
          if (++misses >= 3) {
            setResult((old) =>
              old.key === namesKey ? { ...old, status: 'unavailable' } : old,
            )
            return // enhancement only
          }
        }
      }
      if (!cancelled) {
        setResult((old) => (old.key === namesKey ? { ...old, status: 'ready' } : old))
      }
    })()
    return () => {
      // reset the guard too: a cancelled run must not tombstone its key, or a remount with the
      // same names (StrictMode's double-mount, tab away/back) can never start a fresh loop
      cancelled = true
      running.current = null
    }
  }, [namesKey])

  return useMemo(
    () =>
      result.key === namesKey
        ? { shelves: result.shelves, status: result.status }
        : { shelves: {}, status: namesKey ? ('loading' as const) : ('idle' as const) },
    [namesKey, result],
  )
}
