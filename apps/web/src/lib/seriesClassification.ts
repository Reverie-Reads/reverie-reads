import {
  classifySeriesMembership,
  type SeriesCatalogSnapshot,
  type SeriesClassification,
} from '@reverie/core'
import { supabase } from './supabase'
import type { EnrichResult } from './enrich'
import { hardcoverSeriesLookupTarget } from './seriesLookup'

interface SeriesFunctionPayload {
  name?: string
  sourceRef?: string | null
  memberCount?: number | null
  entries?: { position?: number | null; title?: string; author?: string }[]
  membershipEntries?: { position?: number | null; title?: string; author?: string }[]
  unavailable?: boolean
}

/** Load the provider's relationship graph for one candidate. Search labels never pass directly
 * through this boundary as evidence. Fantastic Fiction is intentionally absent: without a public
 * API/permission it may be recorded only as administrator-supplied corroboration. */
export async function fetchCatalogSeriesSnapshot(
  name: string,
  author: string,
  target?: { title: string; workId?: string },
): Promise<SeriesCatalogSnapshot> {
  const { data, error } = await supabase.functions.invoke('series', {
    body: {
      name,
      author,
      ...(target ? hardcoverSeriesLookupTarget(target.title, author, target.workId) : undefined),
    },
  })
  if (error) {
    return {
      source: 'hardcover',
      series: name,
      sourceRef: null,
      memberCount: null,
      entries: [],
      unavailable: true,
    }
  }
  const payload = (data ?? {}) as SeriesFunctionPayload
  return {
    source: 'hardcover',
    series: payload.name?.trim() || name,
    sourceRef: payload.sourceRef ?? null,
    memberCount: null,
    entries: (payload.membershipEntries ?? payload.entries ?? []).flatMap((entry) => {
      const title = entry.title?.trim() ?? ''
      if (!title) return []
      const position = Number(entry.position)
      return [
        {
          title,
          author: entry.author?.trim() ?? '',
          position: Number.isFinite(position) && position > 0 ? position : null,
        },
      ]
    }),
    unavailable: !!payload.unavailable,
  }
}

export async function classifyEnrichedSeries(input: {
  title: string
  author: string
  result: EnrichResult
}): Promise<SeriesClassification> {
  const candidate = input.result.series?.trim() ?? ''
  const source = input.result.provenance?.series?.source ?? input.result.source ?? 'catalog'
  const snapshots = candidate
    ? [
        await fetchCatalogSeriesSnapshot(candidate, input.author, {
          title: input.title,
          workId: input.result.workId,
        }),
      ]
    : []
  return classifySeriesMembership({
    title: input.title,
    author: input.author,
    candidateSeries: candidate,
    candidatePosition: input.result.seriesPosition,
    candidateSource: source,
    candidateSourceRef: input.result.workId || input.result.editionId || null,
    identityConfidence: input.result.confidence ?? 'none',
    snapshots,
  })
}
