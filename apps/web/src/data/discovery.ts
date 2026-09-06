import {
  DISCOVERY_MOOD_TERMS,
  DISCOVERY_POOL_LIMIT,
  dedupeDiscoveryBooks,
  discoveryCandidatePool,
  discoveryIntentText,
  discoveryKey,
  discoveryShortlist,
  genreKey,
  parseDiscoveryBook,
  type Book,
  type DiscoveryBook,
  type DiscoveryIntent,
  type DiscoverySession,
} from '@reverie/core'
import { supabase } from '../lib/supabase'
import { fetchDiscover } from '../lib/discover'
import { fetchDiscoveryDetails, plainDescription } from '../lib/discoveryDetails'
import { workToHit, type WorkRow } from './works'

const columns =
  'id,work_key,title,contributors,isbns,series,position,cover_url,genre,tags,pub_y,pub_m,pub_d,description'
const clean = (book: DiscoveryBook): DiscoveryBook => ({
  ...book,
  genre: genreKey(book.genre ?? ''),
  genres: book.genres?.map(genreKey),
  description: plainDescription(book.description ?? '').slice(0, 2500),
})

/** Each query is capped. Mood terms are a fixed vocabulary, never interpolated reader input. */
async function catalogPool(intent: DiscoveryIntent, signal: AbortSignal): Promise<DiscoveryBook[][]> {
  const base = () =>
    supabase
      .from('works')
      .select(columns)
      .order('title')
      .order('id')
      .limit(DISCOVERY_POOL_LIMIT)
      .abortSignal(signal)
  let queries
  if (intent.kind === 'anchor') {
    queries = intent.anchor.authors
      .slice(0, 2)
      .map((name) => base().contains('contributors', JSON.stringify([{ name }])))
    if (intent.anchor.genre) queries.push(base().eq('genre', genreKey(intent.anchor.genre)))
  } else if (intent.kind === 'genre') queries = [base().eq('genre', genreKey(intent.genre))]
  else {
    let query = base()
    for (const mood of intent.moods) {
      query = query.or(
        DISCOVERY_MOOD_TERMS[mood]
          .flatMap((term) => [
            `description.ilike.%${term}%`,
            `genre.eq.${term}`,
            `tags.cs.{${term}}`,
          ])
          .join(','),
      )
    }
    queries = [query]
  }
  const results = await Promise.all(
    queries.map(async (query) => {
      const { data, error } = await query
      if (error) throw error
      return ((data as unknown as WorkRow[]) ?? []).map((row) => clean({
        ...workToHit(row),
        // A shared work can describe many editions. No reader has chosen one on this path.
        isbn: row.isbns.length === 1 ? row.isbns[0]! : '',
      }))
    }),
  )
  return results.map(dedupeDiscoveryBooks)
}

/** Optional semantic ordering against THIS intent. No personal notes, ratings, or history leave here.
 * Partial model results are bounded to four requests and a 12-second total deadline. */
export async function rankDiscoveryIntent(
  pool: DiscoveryBook[],
  intent: DiscoveryIntent,
  signal: AbortSignal,
): Promise<Record<string, number>> {
  const scores: Record<string, number> = {}
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) controller.abort()
  const timeout = setTimeout(abort, 12_000)
  try {
    let remaining = pool.slice(0, DISCOVERY_POOL_LIMIT).map((book) => ({
      key: discoveryKey(book),
      text: [book.title, book.authors.join(', '), book.genre, book.description]
        .filter(Boolean)
        .join('. ')
        .slice(0, 1600),
    }))
    for (let call = 0; call < 4 && remaining.length && !controller.signal.aborted; call++) {
      const batch = remaining.slice(0, 12)
      const { data, error } = await supabase.functions.invoke('embed', {
        body: { mode: 'intent', query: discoveryIntentText(intent), items: batch },
        signal: controller.signal,
      })
      if (error || !Array.isArray(data?.scores)) break
      let progress = 0
      for (const row of data.scores) {
        if (
          batch.some((item) => item.key === row.key) &&
          typeof row.score === 'number' &&
          Number.isFinite(row.score) &&
          row.score >= -1 &&
          row.score <= 1
        ) {
          scores[row.key] = row.score
          progress++
        }
      }
      if (!progress) break
      remaining = remaining.filter((item) => scores[item.key] === undefined)
    }
  } catch {
    /* Stable catalog evidence remains usable when ranking is unavailable. */
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
  return scores
}

export async function createDiscoverySession(
  intent: DiscoveryIntent,
  library: readonly Book[],
  signal: AbortSignal,
): Promise<DiscoverySession> {
  let resolved = intent
  if (intent.kind === 'anchor' && !intent.anchor.description) {
    // Details are advisory: a provider failure still permits the exact author/genre path.
    const details = await fetchDiscoveryDetails(intent.anchor).catch(() => ({
      description: '',
      genre: '',
      genres: [] as string[],
    }))
    resolved = {
      ...intent,
      anchor: clean({
        ...intent.anchor,
        description: details.description ?? '',
        genre: intent.anchor.genre || details.genre,
        genres: intent.anchor.genres?.length ? intent.anchor.genres : details.genres,
      }),
    }
  }
  signal.throwIfAborted()
  const genre =
    resolved.kind === 'genre'
      ? resolved.genre
      : resolved.kind === 'anchor'
        ? resolved.anchor.genre
        : ''
  const [corpus, external] = await Promise.all([
    catalogPool(resolved, signal),
    genre ? fetchDiscover(genre, signal) : Promise.resolve([]),
  ])
  signal.throwIfAborted()
  const externalBooks = external
    .map((hit) =>
      parseDiscoveryBook({
        ...hit,
        catalogSource: hit.curated ? 'curated' : 'catalog',
        genre: hit.curated ? genreKey(genre ?? '') : hit.genre,
      }),
    )
    .filter((book): book is DiscoveryBook => !!book)
    .map(clean)
  const eligible = discoveryCandidatePool([...corpus, externalBooks], resolved, library)
  const scores = eligible.length ? await rankDiscoveryIntent(eligible, resolved, signal) : {}
  signal.throwIfAborted()
  return {
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    intent: resolved,
    picks: discoveryShortlist(eligible, resolved, scores),
    dismissed: [],
  }
}
