// Tier 2 embeddings (owner-approved): gte-small runs IN the edge runtime (Supabase.ai) — no
// external API, no key, the reader's library never leaves the stack. Four modes:
//
//   { mode: 'sweep' }                 embed the caller's missing/stale books (sig-gated, capped
//                                     per call) → { embedded, remaining }
//   { mode: 'vibe', query, count? }   embed the reader's words, rank their library against it
//                                     via the vibe_books RPC → { hits: [{ book_id, similarity }] }
//   { mode: 'rank', items }           score EXTERNAL candidates ([{ key, text }]) against the
//                                     reader's taste centroid → { hasTaste, scores: [{key,score}] }
//   { mode: 'intent', query, items }  score catalog descriptions against a chosen starting book
//                                     or mood; no personal library read or write
//
// The caller is identified ONLY from their own access token (delete-account pattern), and every
// library REST call runs WITH that token — RLS scopes personal reads and writes.
// The intent limiter alone uses the shared service-role rate-limit helper.

import { captureEdgeError } from '../_shared/observe.ts'
import { embeddingSig, embeddingText, type EmbedSource } from './signature.ts'
import { cosineScore, parseIntentRankInput } from './intent.ts'
import { rateLimit, tooMany } from '../_shared/ratelimit.ts'

declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(input: string, opts?: Record<string, unknown>): Promise<number[]>
    }
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

/** Sweep batching is TIME-budgeted, not count-budgeted: edge requests live under a ~2s CPU cap
 *  (the supervisor kills the isolate hard), and per-inference cost varies wildly between hosted
 *  (preloaded, ~tens of ms) and local runtimes (hundreds of ms). Embedding until the wall budget
 *  is spent gives hosted a full batch and slow runtimes a small one — nobody gets killed. */
const SWEEP_MAX = 12
const SWEEP_WALL_MS = 1200

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

const session = new Supabase.ai.Session('gte-small')

async function embed(text: string): Promise<number[]> {
  const out = await session.run(text, { mean_pool: true, normalize: true })
  return Array.from(out as unknown as ArrayLike<number>)
}

interface BookRow {
  id: string
  title: string
  author_first: string | null
  author_last: string | null
  series: string | null
  subgenre: string | null
  genre: string | null
  genres: string[] | null
  tags: string[] | null
  intensity: number | null
}

const toSource = (b: BookRow): EmbedSource => ({
  title: b.title,
  author: [b.author_first, b.author_last].filter(Boolean).join(' '),
  series: b.series ?? undefined,
  genre: b.genre ?? b.genres?.[0] ?? undefined,
  subgenre: b.subgenre ?? undefined,
  tags: b.tags ?? [],
  spice: b.intensity,
})

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!DB_URL || !ANON) return json({ error: 'missing service env' }, 500)

  // the caller, from their own token only; all REST below runs AS them (RLS applies)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'not authenticated' }, 401)
  const ures = await fetch(`${DB_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
  if (!ures.ok) return json({ error: 'not authenticated' }, 401)
  const uid = ((await ures.json()) as { id?: string })?.id
  if (!uid) return json({ error: 'not authenticated' }, 401)
  const usr = { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  let body: { mode?: string; query?: string; count?: number; items?: unknown[] }
  try {
    const raw = await req.text()
    if (raw.length > 64_000) return json({ error: 'request too large' }, 413)
    body = JSON.parse(raw)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json({ error: 'bad request' }, 400)
  } catch {
    return json({ error: 'bad json' }, 400)
  }

  try {
    if (body.mode === 'intent') {
      const input = parseIntentRankInput(body)
      if (!input) return json({ error: 'invalid intent ranking request' }, 400)
      const limit = await rateLimit(req, 'discover-intent', 120, 60)
      if (!limit.allowed) return tooMany(limit.retryAfter, cors)
      const started = Date.now()
      const query = await embed(input.query)
      const scores: { key: string; score: number }[] = []
      for (const item of input.items) {
        if (scores.length && Date.now() - started > SWEEP_WALL_MS) break
        const score = cosineScore(query, await embed(item.text))
        if (score != null) scores.push({ key: item.key, score })
      }
      return json({ scores })
    }

    if (body.mode === 'sweep') {
      const cols = 'id,title,author_first,author_last,series,subgenre,genre,genres,tags,intensity'
      const [booksRes, embRes] = await Promise.all([
        fetch(`${DB_URL}/rest/v1/books?select=${cols}`, { headers: usr }),
        fetch(`${DB_URL}/rest/v1/book_embeddings?select=book_id,sig`, { headers: usr }),
      ])
      if (!booksRes.ok || !embRes.ok) {
        return json(
          {
            error: 'read failed',
            books: booksRes.status,
            embeddings: embRes.status,
            detail: (!booksRes.ok ? await booksRes.text() : await embRes.text()).slice(0, 300),
          },
          500,
        )
      }
      const books = (await booksRes.json()) as BookRow[]
      const have = new Map(
        ((await embRes.json()) as { book_id: string; sig: string }[]).map((e) => [
          e.book_id,
          e.sig,
        ]),
      )

      const stale = books
        .map((b) => ({ b, src: toSource(b) }))
        .map((x) => ({ ...x, sig: embeddingSig(x.src) }))
        .filter((x) => have.get(x.b.id) !== x.sig)

      const t0 = Date.now()
      const rows = []
      for (const { b, src, sig } of stale) {
        if (rows.length >= SWEEP_MAX || (rows.length > 0 && Date.now() - t0 > SWEEP_WALL_MS)) break
        const vec = await embed(embeddingText(src))
        rows.push({ book_id: b.id, owner_id: uid, sig, embedding: `[${vec.join(',')}]` })
      }
      if (rows.length) {
        const up = await fetch(`${DB_URL}/rest/v1/book_embeddings?on_conflict=book_id`, {
          method: 'POST',
          headers: { ...usr, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(rows),
        })
        if (!up.ok) return json({ error: `write failed: ${up.status} ${await up.text()}` }, 500)
      }
      return json({ embedded: rows.length, remaining: stale.length - rows.length })
    }

    if (body.mode === 'vibe') {
      const query = (body.query ?? '').trim()
      if (!query) return json({ error: 'empty query' }, 400)
      const vec = await embed(query.slice(0, 300))
      const count = Math.min(Math.max(body.count ?? 12, 1), 24)
      const rpc = await fetch(`${DB_URL}/rest/v1/rpc/vibe_books`, {
        method: 'POST',
        headers: usr,
        body: JSON.stringify({ p_query: `[${vec.join(',')}]`, p_count: count }),
      })
      if (!rpc.ok) return json({ error: `rank failed: ${rpc.status}` }, 500)
      return json({ hits: await rpc.json() })
    }

    if (body.mode === 'rank') {
      const items = (Array.isArray(body.items) ? body.items : [])
        .flatMap((x) => {
          const it = x as { key?: unknown; text?: unknown } | null
          return it && typeof it.key === 'string' && typeof it.text === 'string' && it.text.trim()
            ? [{ key: it.key, text: it.text }]
            : []
        })
        .slice(0, 16)
      if (!items.length) return json({ hasTaste: false, scores: [] })

      const cres = await fetch(`${DB_URL}/rest/v1/rpc/taste_centroid`, {
        method: 'POST',
        headers: usr,
        body: '{}',
      })
      if (!cres.ok) return json({ error: `centroid failed: ${cres.status}` }, 500)
      const raw = (await cres.json()) as string | null
      if (!raw) return json({ hasTaste: false, scores: [] }) // cold start — caller passes through
      const centroid = JSON.parse(raw) as number[]
      // avg() of unit vectors isn't unit-length — normalize so dot = cosine
      const cnorm = Math.sqrt(centroid.reduce((s, v) => s + v * v, 0)) || 1

      const t0 = Date.now()
      const scores: { key: string; score: number }[] = []
      for (const it of items) {
        if (scores.length > 0 && Date.now() - t0 > SWEEP_WALL_MS) break // same CPU-budget rule as sweep
        const vec = await embed(it.text.slice(0, 300))
        const dot = vec.reduce((s, v, i) => s + v * (centroid[i] ?? 0), 0) / cnorm
        scores.push({ key: it.key, score: dot })
      }
      return json({ hasTaste: true, scores })
    }

    return json({ error: 'unknown mode' }, 400)
  } catch (e) {
    captureEdgeError('embed', e)
    return json({ error: 'embed failed' }, 500)
  }
})
