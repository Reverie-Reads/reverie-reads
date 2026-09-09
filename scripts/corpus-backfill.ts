import { assertNoCrossWorkIsbnCollisions, canonicalIsbns } from './corpus-import-lib'
import { enrichmentCacheKey } from '../supabase/functions/enrich/cacheKey'

export interface BackfillWork {
  work_key: string
  work_id: string | null
  cover_url: string | null
  isbns: string[]
}

export interface BackfillHit {
  key: string
  work_id: string | null
  record: Record<string, unknown> | null
}

export interface BackfillPatch {
  work_id?: string
  cover_url?: string
  cover_source?: string
  isbns?: string[]
}

export interface CorpusBackfillStore {
  fetchWorks(): Promise<BackfillWork[]>
  fetchEnrichments(keys: readonly string[]): Promise<BackfillHit[]>
  updateWork(workKey: string, patch: BackfillPatch): Promise<void>
}

const sameStrings = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i])

const stringValue = (value: unknown): string => (typeof value === 'string' ? value : '')

export function backfillPatch(w: BackfillWork, hit: BackfillHit): BackfillPatch {
  const rec = hit.record ?? {}
  const patch: BackfillPatch = {}
  const recordWorkId = stringValue(rec.workId)
  if (!w.work_id && (hit.work_id || recordWorkId)) patch.work_id = hit.work_id || recordWorkId

  const cover = stringValue(rec.cover)
  if (!w.cover_url && cover) {
    patch.cover_url = cover
    const provenance = rec.provenance
    if (provenance && typeof provenance === 'object') {
      const coverProvenance = (provenance as { cover?: unknown }).cover
      if (coverProvenance && typeof coverProvenance === 'object') {
        const source = stringValue((coverProvenance as { source?: unknown }).source)
        if (source) patch.cover_source = source
      }
    }
  }

  const recordIsbns = Array.isArray(rec.isbns) ? rec.isbns.map(stringValue) : []
  const isbns = canonicalIsbns([
    ...w.isbns,
    stringValue(rec.isbn),
    stringValue(rec.isbn13),
    stringValue(rec.isbn10),
    ...recordIsbns,
  ])
  if (!sameStrings(w.isbns, isbns)) patch.isbns = isbns
  return patch
}

/**
 * Repeatable corpus enrichment promotion. Every work is inspected on every run because a cache
 * record may learn a new edition after its cover and work_id were already complete. All proposed
 * ISBN sets are collision-checked together before the first update, so a bad cache result cannot
 * leave a half-written run behind.
 */
export async function runBackfill(store: CorpusBackfillStore): Promise<{
  examined: number
  cacheHits: number
  updated: number
}> {
  const works = await store.fetchWorks()
  const keys = works.map((w) => enrichmentCacheKey(`ta:${w.work_key}`))
  const allowedKeys = new Set(keys)
  const hits = (await store.fetchEnrichments(keys)).filter((hit) => allowedKeys.has(hit.key))
  const byKey = new Map(hits.map((hit) => [hit.key, hit]))
  const planned: { work: BackfillWork; patch: BackfillPatch }[] = []

  for (const work of works) {
    const hit = byKey.get(enrichmentCacheKey(`ta:${work.work_key}`))
    if (!hit) continue
    const patch = backfillPatch(work, hit)
    if (Object.keys(patch).length) planned.push({ work, patch })
  }

  assertNoCrossWorkIsbnCollisions(
    works.map((work) => {
      const plannedPatch = planned.find((entry) => entry.work.work_key === work.work_key)?.patch
      return { workKey: work.work_key, isbns: plannedPatch?.isbns ?? work.isbns }
    }),
  )

  for (const { work, patch } of planned) await store.updateWork(work.work_key, patch)
  return { examined: works.length, cacheHits: hits.length, updated: planned.length }
}
