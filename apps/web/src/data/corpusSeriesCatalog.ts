import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SeriesStatus } from '@reverie/core'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import { booksKey } from './books'

export type CorpusSeriesStatus = Exclude<SeriesStatus, 'standalone'>

export interface CorpusSeriesWork {
  id: string
  title: string
  author: string
  cover: string
}

export interface CorpusSeriesEntry {
  id: string
  workId: string | null
  position: number | null
  label: string
  title: string
  author: string
  primary: boolean
  source: string
  evidence: unknown[]
  work: CorpusSeriesWork | null
}

export interface CorpusSeriesCatalogRow {
  id: string
  name: string
  creatorKey: string
  status: CorpusSeriesStatus | null
  declaredCount: number | null
  state: 'confirmed' | 'review'
  revision: number
  aliases: string[]
  sources: { source: string; sourceRef: string }[]
  entries: CorpusSeriesEntry[]
}

export interface ArchivedCorpusSeries {
  id: string
  name: string
  creatorKey: string
  status: CorpusSeriesStatus | null
  declaredCount: number | null
  revision: number
  archivedAt: string
  mergedInto: string | null
  entryCount: number
  linkedWorkCount: number
}

interface SeriesRow {
  id: string
  name: string
  creator_key: string
  status: CorpusSeriesStatus | null
  declared_count: number | null
  catalog_state: 'confirmed' | 'review'
  revision: number | string
}

interface NameRow {
  id: string
  series_id: string
  name: string
  kind: 'canonical' | 'alias'
}

interface SourceRow {
  id: string
  series_id: string
  source: string
  source_ref: string
}

interface EntryRow {
  id: string
  series_id: string
  work_id: string | null
  position: number | string | null
  label: string | null
  title: string
  author_text: string
  is_primary: boolean
  source: string
  evidence: unknown
  works:
    | {
        id: string
        title: string
        author_text: string | null
        cover_url: string | null
      }
    | {
        id: string
        title: string
        author_text: string | null
        cover_url: string | null
      }[]
    | null
}

export const corpusSeriesCatalogKey = ['corpus-series-catalog'] as const
export const archivedCorpusSeriesKey = ['archived-corpus-series'] as const

/** Link hygiene, not a claim of authority. Matches the order-review RPC; never fetched here. */
export const isOrderSourceUrl = (value: string): boolean =>
  value.length <= 2000 &&
  [...value].every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127) &&
  /^https:\/\/([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(\/[^\s?#\\]*)?$/.test(value)

export function useSeriesOrderReview(seriesId: string, entryId?: string) {
  return useQuery({
    // Administrator rationale must never enter the offline library cache.
    queryKey: ['catalog-metadata-review', 'series-order', seriesId, entryId],
    enabled: !!entryId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corpus_series_edits')
        .select('next_value')
        .eq('series_id', seriesId)
        .eq('action', 'entry_update')
        .eq('next_value->>id', entryId!)
        .not('next_value->orderReview', 'is', null)
        .order('created_at', { ascending: false })
        .order('id')
        .limit(1)
      if (error) throw error
      const review = data?.[0]?.next_value?.orderReview as Record<string, unknown> | undefined
      if (
        !review ||
        typeof review.sourceUrl !== 'string' ||
        !isOrderSourceUrl(review.sourceUrl) ||
        typeof review.note !== 'string' ||
        review.note.length > 1000 ||
        (review.position !== null &&
          (typeof review.position !== 'number' || !Number.isFinite(review.position)))
      )
        return null
      return {
        sourceUrl: review.sourceUrl,
        note: review.note,
        position: review.position as number | null,
      }
    },
    retry: false,
    gcTime: 0,
  })
}

const relatedWork = (value: EntryRow['works']): CorpusSeriesWork | null => {
  const row = Array.isArray(value) ? value[0] : value
  return row
    ? {
        id: row.id,
        title: row.title,
        author: row.author_text?.trim() ?? '',
        cover: row.cover_url?.trim() ?? '',
      }
    : null
}

export async function fetchCorpusSeriesCatalog(): Promise<CorpusSeriesCatalogRow[]> {
  const [seriesRows, nameRows, sourceRows, entryRows] = await Promise.all([
    pageAll<SeriesRow>('corpus series', (from, to) =>
      supabase
        .from('corpus_series')
        .select('id, name, creator_key, status, declared_count, catalog_state, revision', {
          count: 'exact',
        })
        .order('id')
        .range(from, to),
    ),
    pageAll<NameRow>('corpus series names', (from, to) =>
      supabase
        .from('corpus_series_names')
        .select('id, series_id, name, kind', { count: 'exact' })
        .order('id')
        .range(from, to),
    ),
    pageAll<SourceRow>('corpus series sources', (from, to) =>
      supabase
        .from('corpus_series_sources')
        .select('id, series_id, source, source_ref', { count: 'exact' })
        .order('id')
        .range(from, to),
    ),
    pageAll<EntryRow>('corpus series entries', (from, to) =>
      supabase
        .from('corpus_series_entries')
        .select(
          'id, series_id, work_id, position, label, title, author_text, is_primary, source, evidence, works:work_id(id, title, author_text, cover_url)',
          { count: 'exact' },
        )
        .is('removed_at', null)
        .order('id')
        .range(from, to),
    ),
  ])

  const byId = new Map<string, CorpusSeriesCatalogRow>()
  for (const row of seriesRows) {
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      creatorKey: row.creator_key,
      status: row.status,
      declaredCount: row.declared_count,
      state: row.catalog_state,
      revision: Number(row.revision),
      aliases: [],
      sources: [],
      entries: [],
    })
  }
  for (const row of nameRows) {
    if (row.kind === 'alias') byId.get(row.series_id)?.aliases.push(row.name)
  }
  for (const row of sourceRows) {
    byId.get(row.series_id)?.sources.push({ source: row.source, sourceRef: row.source_ref })
  }
  for (const row of entryRows) {
    const series = byId.get(row.series_id)
    if (!series) continue
    const work = relatedWork(row.works)
    series.entries.push({
      id: row.id,
      workId: row.work_id,
      position: row.position == null ? null : Number(row.position),
      label: row.label?.trim() ?? '',
      title: work?.title ?? row.title,
      author: work?.author ?? row.author_text,
      primary: row.is_primary,
      source: row.source,
      evidence: Array.isArray(row.evidence) ? row.evidence : [],
      work,
    })
  }
  for (const row of byId.values()) {
    row.aliases.sort((a, b) => a.localeCompare(b))
    row.entries.sort(
      (a, b) =>
        (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    )
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function useCorpusSeriesCatalog(enabled = true) {
  return useQuery({
    queryKey: corpusSeriesCatalogKey,
    enabled,
    queryFn: fetchCorpusSeriesCatalog,
    staleTime: 30_000,
  })
}

export function useArchivedCorpusSeries(enabled: boolean) {
  return useQuery({
    queryKey: archivedCorpusSeriesKey,
    enabled,
    queryFn: async (): Promise<ArchivedCorpusSeries[]> => {
      const { data, error } = await supabase.rpc('list_archived_corpus_series')
      if (error) throw error
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        creatorKey: String(row.creator_key ?? ''),
        status: (row.status as CorpusSeriesStatus | null) ?? null,
        declaredCount: row.declared_count == null ? null : Number(row.declared_count),
        revision: Number(row.revision),
        archivedAt: String(row.archived_at),
        mergedInto: row.merged_into == null ? null : String(row.merged_into),
        entryCount: Number(row.entry_count),
        linkedWorkCount: Number(row.linked_work_count),
      }))
    },
    staleTime: 30_000,
  })
}

function useCatalogMutation<TInput>(
  action: string,
  mutationFn: (input: TInput) => Promise<unknown>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action },
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: corpusSeriesCatalogKey }),
        queryClient.invalidateQueries({ queryKey: archivedCorpusSeriesKey }),
        queryClient.invalidateQueries({ queryKey: booksKey }),
        queryClient.invalidateQueries({ queryKey: ['works'] }),
        queryClient.invalidateQueries({ queryKey: ['household'] }),
        queryClient.invalidateQueries({ queryKey: ['seriesList'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-metadata-review', 'series-order'] }),
      ])
    },
  })
}

export function useUpdateCorpusSeries() {
  return useCatalogMutation(
    'The shared series',
    async (input: {
      id: string
      revision: number
      name: string
      status: CorpusSeriesStatus | null
      declaredCount: number | null
      aliases: string[]
    }) => {
      const { data, error } = await supabase.rpc('update_corpus_series', {
        p_series: input.id,
        p_expected_revision: input.revision,
        p_name: input.name,
        p_status: input.status,
        p_declared_count: input.declaredCount,
        p_aliases: input.aliases,
      })
      if (error) throw error
      return data
    },
  )
}

export function useMergeCorpusSeries() {
  return useCatalogMutation(
    'The shared series merge',
    async (input: { target: CorpusSeriesCatalogRow; source: CorpusSeriesCatalogRow }) => {
      const { data, error } = await supabase.rpc('merge_corpus_series', {
        p_target: input.target.id,
        p_source: input.source.id,
        p_expected_target_revision: input.target.revision,
        p_expected_source_revision: input.source.revision,
      })
      if (error) throw error
      return data
    },
  )
}

export function useArchiveCorpusSeries() {
  return useCatalogMutation(
    'The shared series archive',
    async (input: { id: string; revision: number }) => {
      const { data, error } = await supabase.rpc('archive_corpus_series', {
        p_series: input.id,
        p_expected_revision: input.revision,
      })
      if (error) throw error
      return data
    },
  )
}

export function useSaveCorpusSeriesEntry() {
  return useCatalogMutation(
    'The shared series slot',
    async (input: {
      seriesId: string
      revision: number
      entryId: string | null
      title: string
      author: string
      position: number | null
      label: string
      sourceUrl?: string
      reviewNote?: string
    }) => {
      if (input.entryId) {
        const { data, error } = await supabase.rpc('review_corpus_series_entry_order', {
          p_series: input.seriesId,
          p_expected_revision: input.revision,
          p_entry: input.entryId,
          p_position: input.position,
          p_label: input.label,
          p_source_url: input.sourceUrl?.trim() || null,
          p_note: input.reviewNote?.trim() || null,
          p_title: input.title,
          p_author: input.author,
        })
        if (error) throw error
        return data
      }
      const { data, error } = await supabase.rpc('save_corpus_series_entry', {
        p_series: input.seriesId,
        p_expected_revision: input.revision,
        p_entry: input.entryId,
        p_title: input.title,
        p_author: input.author,
        p_position: input.position,
        p_label: input.label,
      })
      if (error) throw error
      return data
    },
  )
}

export function useRemoveCorpusSeriesEntry() {
  return useCatalogMutation(
    'The shared series slot removal',
    async (input: { entryId: string; revision: number }) => {
      const { data, error } = await supabase.rpc('remove_corpus_series_entry', {
        p_entry: input.entryId,
        p_expected_revision: input.revision,
      })
      if (error) throw error
      return data
    },
  )
}

export function useRestoreCorpusSeries() {
  return useCatalogMutation(
    'The shared series restore',
    async (input: { id: string; revision: number }) => {
      const { data, error } = await supabase.rpc('restore_corpus_series', {
        p_series: input.id,
        p_expected_revision: input.revision,
      })
      if (error) throw error
      return data
    },
  )
}
