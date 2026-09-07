import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mayIngestCover, type CoverMeasurement } from '@reverie/core'
import { useAuth } from '../auth/AuthProvider'
import { fetchEditions, ingestCorpusCover, type EditionOption } from '../lib/covers'
import { supabase } from '../lib/supabase'
import { sortCoverEditions } from './coverSheet'

export type ReviewState = 'attention' | 'deferred' | 'approved' | 'all'
export type CoverConcern = 'identity' | 'artwork' | 'broken' | 'soft'
export const COVER_CONCERNS: Record<CoverConcern, string> = {
  identity: 'Title or author needs checking',
  artwork: 'Not cover artwork',
  broken: 'Image unavailable',
  soft: 'May look soft',
}
export interface CatalogCoverWork {
  id: string
  title: string
  author: string
  isbns: string[]
  cover: string | null
  source: string | null
  sourceUrl: string | null
  confidence: string | null
  fingerprint: string
  revision: number
  state: 'unreviewed' | 'flagged' | 'deferred' | 'approved'
  reason: CoverConcern | null
  note: string
  measurement: CoverMeasurement | null
  reviewedAt: string | null
}
export interface CoverQueue {
  items: CatalogCoverWork[]
  total: number
}
export const COVER_REVIEW_PAGE_SIZE = 20
export const catalogCoverReviewKey = ['catalog-cover-review'] as const

export async function fetchCatalogCoverQueue(input: {
  state: ReviewState
  query: string
  offset: number
  workId?: string
}): Promise<CoverQueue> {
  const { data, error } = await supabase.rpc('admin_list_corpus_cover_reviews', {
    p_state: input.state,
    p_query: input.query,
    p_offset: input.offset,
    p_limit: COVER_REVIEW_PAGE_SIZE,
    p_work: input.workId ?? null,
  })
  if (error) throw error
  return data as CoverQueue
}

export function useCatalogCoverQueue(
  input: {
    state: ReviewState
    query: string
    offset: number
    workId?: string
  },
  enabled: boolean,
) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...catalogCoverReviewKey, session?.user.id, 'queue', input],
    queryFn: () => fetchCatalogCoverQueue(input),
    enabled: enabled && !!session,
    staleTime: 0,
  })
}

export interface CoverReviewEvent {
  id: string
  action: 'keep' | 'replace' | 'flag' | 'defer' | 'reopen'
  created_at: string
  next_value: { review: { note: string; reason: CoverConcern | null }; identityConfirmed: boolean }
}
export function useCatalogCoverHistory(workId: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...catalogCoverReviewKey, session?.user.id, 'history', workId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corpus_cover_review_events')
        .select('id, action, created_at, next_value')
        .eq('work_id', workId)
        .order('created_at', { ascending: false })
        .order('id')
        .limit(10)
      if (error) throw error
      return data as CoverReviewEvent[]
    },
    enabled: !!session,
    staleTime: 0,
  })
}

export function useCatalogCoverAlternatives(
  work: CatalogCoverWork,
  isbn: string,
  enabled: boolean,
) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...catalogCoverReviewKey, session?.user.id, 'alternatives', work.fingerprint, isbn],
    queryFn: async () =>
      sortCoverEditions(
        await fetchEditions(
          {
            title: work.title,
            author: work.author,
            isbn: isbn || undefined,
          },
          { throwOnError: true },
        ),
        isbn,
      ).slice(0, 24),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export interface CoverReviewInput {
  work: CatalogCoverWork
  action: CoverReviewEvent['action']
  note: string
  reason: CoverConcern | null
  measurement: CoverMeasurement | null
  identityConfirmed: boolean
  candidate?: EditionOption
}

/** The image may be staged in Storage first; only this stale-checked RPC selects it for the work. */
export async function saveCatalogCoverReview(input: CoverReviewInput): Promise<string> {
  let candidate: { url: string; source: string; sourceUrl?: string; color?: string | null } | null =
    null
  if (input.action === 'replace') {
    if (!input.candidate || !input.measurement || !input.identityConfirmed)
      throw new Error('Choose and confirm a replacement cover first.')
    const e = input.candidate
    candidate = { url: input.measurement.url, source: e.source, sourceUrl: input.measurement.url }
    if (mayIngestCover(e.source, candidate.url)) {
      const result = await ingestCorpusCover({
        workId: input.work.id,
        source: e.source,
        url: candidate.url,
        sourceUrl: candidate.sourceUrl,
      })
      if (result.status === 'error')
        throw new Error(`The cover could not be saved (${result.code}).`)
      candidate = { ...candidate, url: result.data.cover, color: result.data.color }
    }
  }
  const { data, error } = await supabase.rpc('admin_review_corpus_cover', {
    p_work: input.work.id,
    p_expected_fingerprint: input.work.fingerprint,
    p_expected_revision: input.work.revision,
    p_action: input.action,
    p_note: input.note,
    p_reason: input.reason,
    p_measurement: input.measurement,
    p_identity_confirmed: input.identityConfirmed,
    p_candidate: candidate,
  })
  if (error) throw error
  return data as string
}

export function useSaveCatalogCoverReview() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: saveCatalogCoverReview,
    networkMode: 'always', // Never queue an administrator approval for an unseen later state.
    retry: false,
    meta: { action: 'The shared cover review' },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: catalogCoverReviewKey }),
        client.invalidateQueries({ queryKey: ['works'] }),
        client.invalidateQueries({ queryKey: ['works-browse'] }),
        client.invalidateQueries({ queryKey: ['works-lookup'] }),
        client.invalidateQueries({ queryKey: ['works-lookup-isbns'] }),
        client.invalidateQueries({ queryKey: ['household'] }),
      ])
    },
  })
}
