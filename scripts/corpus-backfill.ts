import { assertNoCrossWorkIsbnCollisions } from './corpus-import-lib'
import { workIdentityPart } from '../packages/core/src/normalize'
import { sourceTitleMatches } from '../packages/core/src/enrichAdmission'
import { enrichmentCacheKey } from '../supabase/functions/enrich/cacheKey'

export interface BackfillWork {
  work_key: string
  work_id: string | null
  cover_url: string | null
  isbns: string[]
}

export interface BackfillHit {
  confidence?: string | null
  complete?: boolean
  fetched_at?: string
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

const stringValue = (value: unknown): string => (typeof value === 'string' ? value : '')

export function backfillPatch(w: BackfillWork, hit: BackfillHit): BackfillPatch {
  const rec = hit.record ?? {}
  const identity = rec.admissionIdentity as { title?: string; author?: string } | undefined
  const age = Date.now() - Date.parse(hit.fetched_at ?? '')
  if (
    rec.admissionVersion !== 2 ||
    hit.confidence !== 'high' ||
    !Number.isFinite(age) ||
    age < 0 ||
    age >= (hit.complete ? 30 : 3) * 86400000 ||
    typeof identity?.title !== 'string' ||
    !identity.title ||
    typeof identity.author !== 'string' ||
    !identity.author ||
    `${workIdentityPart(identity.title)}|${workIdentityPart(identity.author)}` !== w.work_key ||
    typeof rec.title !== 'string' ||
    !sourceTitleMatches(identity.title, { title: rec.title }) ||
    !Array.isArray(rec.authors) ||
    !rec.authors.some(
      (author) =>
        typeof author === 'string' &&
        workIdentityPart(author) === workIdentityPart(identity.author!),
    )
  )
    return {}
  const patch: BackfillPatch = {}
  const recordWorkId = stringValue(rec.workId)
  if (hit.work_id && recordWorkId && hit.work_id !== recordWorkId) return {}
  if (!w.work_id && /^(hardcover|openlibrary):/.test(recordWorkId)) patch.work_id = recordWorkId

  const cover = stringValue(rec.cover)
  if (!w.cover_url && cover) {
    const provenance = rec.provenance
    if (provenance && typeof provenance === 'object') {
      const coverProvenance = (provenance as { cover?: unknown }).cover
      if (coverProvenance && typeof coverProvenance === 'object') {
        const source = stringValue((coverProvenance as { source?: unknown }).source)
        if (source === 'openlibrary' || source === 'hardcover') {
          patch.cover_url = cover
          patch.cover_source = source
        }
      }
    }
  }

  // A title/author cache entry identifies a work, never a selected edition. Preserve its ISBNs.
  return patch
}

/**
 * Repeatable, fill-only work promotion from freshly admitted cache records. This path can fill
 * a missing cover or provider work locator, never edition ISBNs. Existing ISBN sets are still
 * collision-checked before the first update so an unresolved catalog collision stops the run.
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
