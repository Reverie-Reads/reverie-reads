import {
  isIngestibleCoverUrl,
  type SeriesEvidenceRecord,
} from '@reverie/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { enrichBookOutcome, type EnrichResult } from '../lib/enrich'
import { classifyEnrichedSeries } from '../lib/seriesClassification'
import { ingestCorpusCover } from '../lib/covers'
import { supabase } from '../lib/supabase'
import {
  CORPUS_SWEEP_COVER_BATCH_SIZE,
  CORPUS_SWEEP_MAX_WORKS,
  corpusCoverNeedsDurableOwnership,
  corpusCoverSourceOf,
  corpusEnrichmentSelect,
  corpusPatchFromEnrichment,
  corpusSeriesCheckDue,
  corpusSweepCandidateSnapshot,
  corpusWorkFromRow,
  corpusWorkIsIncomplete,
  corpusWorkShouldCheck,
  type CorpusEnrichmentRow,
  type CorpusEnrichmentWork,
  type CorpusMetadataPatch,
} from '../lib/corpusSweepPolicy'
import { pageAll } from './paging'

export {
  corpusCoverNeedsDurableOwnership,
  corpusPatchFromEnrichment,
  corpusSeriesCheckDue,
  corpusSweepCandidateSnapshot,
  corpusWorkIsIncomplete,
  corpusWorkShouldCheck,
}
export type { CorpusEnrichmentWork, CorpusMetadataPatch }

const CORPUS_PIPELINE_BATCH_LIMIT = Math.ceil(
  CORPUS_SWEEP_MAX_WORKS / CORPUS_SWEEP_COVER_BATCH_SIZE,
)
const FAILURE_STREAK_LIMIT = 5

export async function fetchCorpusAdminStatus(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_corpus_admin')
  if (error) throw error
  return data === true
}

export const corpusAdminKey = ['corpus-admin'] as const
export const corpusEnrichmentCandidatesKey = ['corpus-enrichment-candidates'] as const
export const corpusSeriesSuggestionsKey = ['corpus-series-suggestions'] as const
export const personalCoverCorpusReviewKey = (
  bookId: string,
  workId: string,
  coverUrl: string,
) => ['personal-cover-corpus-review', bookId, workId, coverUrl] as const

export function personalCoverIsReviewed(options: unknown, coverUrl: string): boolean {
  return (
    !!coverUrl &&
    Array.isArray(options) &&
    options.some(
      (option) =>
        !!option &&
        typeof option === 'object' &&
        (option as { url?: unknown }).url === coverUrl,
    )
  )
}

export function useCorpusAdminStatus() {
  return useQuery({ queryKey: corpusAdminKey, queryFn: fetchCorpusAdminStatus, staleTime: 60_000 })
}

export interface CorpusSeriesSuggestion {
  id: string
  workId: string
  title: string
  author: string
  currentSeries: string
  currentPosition: number | null
  proposedSeries: string
  proposedPosition: number | null
  proposedCount: number | null
  source: string
  identityConfidence: 'high' | 'medium' | 'low' | 'none'
  membershipConfidence: 'high' | 'medium'
  reason: string
  evidence: SeriesEvidenceRecord[]
  checkedAt: string
}

interface CorpusSeriesSuggestionRow {
  id: string
  work_id: string
  proposed_series: string
  proposed_position: number | string | null
  proposed_count: number | null
  source: string
  identity_confidence: 'high' | 'medium' | 'low' | 'none'
  confidence: 'high' | 'medium'
  reason: string | null
  evidence: unknown
  checked_at: string
  works:
    | { title: string; author_text: string | null; series: string | null; position: number | string | null }
    | { title: string; author_text: string | null; series: string | null; position: number | string | null }[]
}

const normalizeSeriesEvidence = (value: unknown): SeriesEvidenceRecord[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const kind = row.kind
    if (
      kind !== 'relational_membership' &&
      kind !== 'candidate_label' &&
      kind !== 'provider_unavailable'
    )
      return []
    const source = typeof row.source === 'string' ? row.source.trim() : ''
    if (!source) return []
    const position = Number(row.position)
    const memberCount = Number(row.memberCount)
    const orderType =
      row.orderType === 'publication' ||
      row.orderType === 'recommended' ||
      row.orderType === 'narrative'
        ? row.orderType
        : 'unspecified'
    return [
      {
        source,
        kind,
        sourceRef: typeof row.sourceRef === 'string' ? row.sourceRef : null,
        series: typeof row.series === 'string' ? row.series : null,
        position: Number.isFinite(position) && position > 0 ? position : null,
        memberCount: Number.isInteger(memberCount) && memberCount > 0 ? memberCount : null,
        orderType,
      },
    ]
  })
}

export async function fetchCorpusSeriesSuggestions(): Promise<CorpusSeriesSuggestion[]> {
  const rows = await pageAll<CorpusSeriesSuggestionRow>('corpus series suggestions', (from, to) =>
    supabase
      .from('work_series_suggestions')
      .select(
        'id, work_id, proposed_series, proposed_position, proposed_count, source, identity_confidence, confidence, reason, evidence, checked_at, works:work_id(title, author_text, series, position)',
        { count: 'exact' },
      )
      .eq('status', 'pending')
      .order('checked_at')
      .order('id')
      .range(from, to),
  )
  return rows.flatMap((row) => {
    const work = Array.isArray(row.works) ? row.works[0] : row.works
    if (!work) return []
    return [
      {
        id: row.id,
        workId: row.work_id,
        title: work.title,
        author: work.author_text?.trim() ?? '',
        currentSeries: work.series?.trim() ?? '',
        currentPosition: work.position == null ? null : Number(work.position),
        proposedSeries: row.proposed_series,
        proposedPosition: row.proposed_position == null ? null : Number(row.proposed_position),
        proposedCount: row.proposed_count,
        source: row.source,
        identityConfidence: row.identity_confidence,
        membershipConfidence: row.confidence,
        reason: row.reason?.trim() ?? '',
        evidence: normalizeSeriesEvidence(row.evidence),
        checkedAt: row.checked_at,
      },
    ]
  })
}

export function useCorpusSeriesSuggestions(enabled: boolean) {
  return useQuery({
    queryKey: corpusSeriesSuggestionsKey,
    enabled,
    queryFn: fetchCorpusSeriesSuggestions,
    staleTime: 30_000,
  })
}

export function useReviewCorpusSeriesSuggestion() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'The corpus series review' },
    mutationFn: async (input: { suggestionId: string; decision: 'accept' | 'dismiss' }) => {
      const { error } = await supabase.rpc('review_corpus_series_suggestion', {
        p_suggestion: input.suggestionId,
        p_decision: input.decision,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: corpusSeriesSuggestionsKey }),
        queryClient.invalidateQueries({ queryKey: corpusEnrichmentCandidatesKey }),
        queryClient.invalidateQueries({ queryKey: ['works'] }),
        queryClient.invalidateQueries({ queryKey: ['household'] }),
      ])
    },
  })
}

/** A personal cover is reviewed only when its exact URL is already an accepted corpus option. */
export function usePersonalCoverCorpusReview({
  bookId,
  workId,
  coverUrl,
  enabled,
}: {
  bookId: string
  workId: string
  coverUrl: string
  enabled: boolean
}) {
  return useQuery({
    queryKey: personalCoverCorpusReviewKey(bookId, workId, coverUrl),
    enabled: enabled && !!bookId && !!workId && !!coverUrl,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('works')
        .select('cover_options')
        .eq('id', workId)
        .single()
      if (error) throw error
      const options = (data as { cover_options?: unknown }).cover_options
      return personalCoverIsReviewed(options, coverUrl)
    },
  })
}

export function useAdminReviewPersonalCoverForCorpus() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Reviewing a personal cover for the corpus' },
    mutationFn: async ({
      bookId,
      workId,
      coverUrl,
    }: {
      bookId: string
      workId: string
      coverUrl: string
    }): Promise<string> => {
      const { data, error } = await supabase.rpc('admin_review_personal_cover_for_corpus', {
        p_book: bookId,
        p_expected_work: workId,
        p_expected_cover_url: coverUrl,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['personal-cover-corpus-review'] }),
        queryClient.invalidateQueries({ queryKey: ['household'] }),
        queryClient.invalidateQueries({ queryKey: ['works-browse'] }),
        queryClient.invalidateQueries({ queryKey: ['works-lookup'] }),
        queryClient.invalidateQueries({ queryKey: ['works-lookup-isbns'] }),
        queryClient.invalidateQueries({ queryKey: corpusEnrichmentCandidatesKey }),
      ])
    },
  })
}

export function useAdminAddCorpusWorkTrope() {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { action: 'Adding a shared corpus trope' },
    mutationFn: async ({ workId, name }: { workId: string; name: string }): Promise<string> => {
      const { data, error } = await supabase.rpc('admin_add_corpus_work_trope', {
        p_work: workId,
        p_name: name,
        p_facet: 'vibe',
      })
      if (error) throw error
      return data as string
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['household'] }),
        queryClient.invalidateQueries({ queryKey: ['tropes'] }),
        queryClient.invalidateQueries({ queryKey: ['works'] }),
      ])
    },
  })
}

export async function fetchCorpusEnrichmentCandidates(): Promise<CorpusEnrichmentWork[]> {
  const rows = await pageAll<CorpusEnrichmentRow>('corpus enrichment candidates', (from, to) =>
    supabase
      .from('works')
      .select(corpusEnrichmentSelect, { count: 'exact' })
      .order('id')
      .range(from, to),
  )
  return rows.map(corpusWorkFromRow).filter((work) => corpusWorkShouldCheck(work))
}

/** Re-read only the next bounded group after cover recovery. This prevents the classifier from
 * working from the stale pre-recovery snapshot while keeping the query below URL-size limits. */
export async function fetchCorpusEnrichmentWorksByIds(
  ids: readonly string[],
): Promise<CorpusEnrichmentWork[]> {
  if (!ids.length) return []
  if (ids.length > CORPUS_SWEEP_COVER_BATCH_SIZE) {
    throw new Error(`corpus refresh is limited to ${CORPUS_SWEEP_COVER_BATCH_SIZE} works`)
  }
  const { data, error } = await supabase
    .from('works')
    .select(corpusEnrichmentSelect)
    .in('id', [...ids])
    .order('id')
    .limit(CORPUS_SWEEP_COVER_BATCH_SIZE)
  if (error) throw error
  const byId = new Map(
    ((data ?? []) as CorpusEnrichmentRow[]).map((row) => {
      const normalized = corpusWorkFromRow(row)
      return [normalized.id, normalized] as const
    }),
  )
  return ids.flatMap((id) => {
    const refreshed = byId.get(id)
    return refreshed ? [refreshed] : []
  })
}

export function useCorpusEnrichmentCandidates(enabled: boolean) {
  return useQuery({
    queryKey: corpusEnrichmentCandidatesKey,
    enabled,
    queryFn: fetchCorpusEnrichmentCandidates,
    staleTime: 30_000,
  })
}

export interface CorpusBulkProgress {
  scanned: number
  total: number
  filled: number
  recoveryScanned: number
  /** Durable-run failures are deferred for a later run, not included in `scanned`. */
  failed?: number
  recoveryFailed?: number
  recoveryFailedBatches?: number
  errorMessage?: string | null
  phase: 'recovering' | 'classifying'
}

export type CorpusBulkStopReason = 'done' | 'user' | 'rate_limited' | 'limit' | 'error'

export interface CorpusBulkResult extends CorpusBulkProgress {
  failed: number
  nothing: number
  stopReason: CorpusBulkStopReason
  errorMessage?: string
}

export interface CorpusCoverRecoveryResult {
  scanned: number
  failed: number
  failedBatches: number
  recoveredCovers: number
  recoveredOptions: number
  maybeMore: boolean
  errorMessage?: string
}

export function corpusCoverRecoverySummary(recovery: CorpusCoverRecoveryResult): string {
  const parts: string[] = []
  if (recovery.scanned) {
    parts.push(
      `checked ${recovery.scanned} local cover source${recovery.scanned === 1 ? '' : 's'}`,
    )
  }
  if (recovery.recoveredCovers) {
    parts.push(
      `filled ${recovery.recoveredCovers} missing corpus cover${recovery.recoveredCovers === 1 ? '' : 's'}`,
    )
  }
  if (recovery.recoveredOptions) {
    parts.push(
      `published ${recovery.recoveredOptions} household cover option${recovery.recoveredOptions === 1 ? '' : 's'}`,
    )
  }
  if (recovery.failed) {
    parts.push(
      `${recovery.failed} cover source${recovery.failed === 1 ? '' : 's'} deferred to retry`,
    )
  }
  if (recovery.failedBatches) {
    parts.push(
      `cover recovery paused${recovery.errorMessage ? `: ${recovery.errorMessage}` : ''}`,
    )
  }
  return parts.length ? ` · ${parts.join(' · ')}` : ''
}

/** Preserve the administrator's own covers plus safe, active copy covers from their household
 * before asking external sources for alternatives. The RPC remains household-scoped and validates
 * every stored object against the authenticated project's issuer. */
export async function recoverAdminHouseholdCorpusCovers(): Promise<CorpusCoverRecoveryResult> {
  const { data, error } = await supabase.rpc('admin_recover_corpus_cover_batch', {
    p_limit: CORPUS_SWEEP_COVER_BATCH_SIZE,
  })
  if (error) throw error
  const result = (data ?? {}) as Partial<CorpusCoverRecoveryResult>
  return {
    scanned: Number(result.scanned ?? 0),
    failed: Number(result.failed ?? 0),
    failedBatches: 0,
    recoveredCovers: Number(result.recoveredCovers ?? 0),
    recoveredOptions: Number(result.recoveredOptions ?? 0),
    maybeMore: result.maybeMore === true,
    ...(typeof result.errorMessage === 'string' && result.errorMessage
      ? { errorMessage: result.errorMessage }
      : {}),
  }
}

const writeCorpusPatch = async (
  workId: string,
  patch: CorpusMetadataPatch,
  checkedAt: string | null,
): Promise<void> => {
  const { error } = await supabase.rpc('complete_corpus_work_metadata', {
    p_work: workId,
    p_patch: patch,
    p_checked_at: checkedAt,
  })
  if (error) throw error
}

export interface CorpusSeriesDiscoveryResult {
  outcome: 'applied' | 'confirmed' | 'review' | 'no_series' | 'unresolved'
  suggestion_id?: string
}

/** Series membership is classified independently from the title/author match. The relational
 * source's position and count replace the search document's hints only after it contains this
 * exact book. */
export async function corpusSeriesDiscoveryPayload(
  work: Pick<CorpusEnrichmentWork, 'title' | 'authorText'>,
  result: EnrichResult,
): Promise<Record<string, unknown>> {
  const classification = await classifyEnrichedSeries({
    title: work.title,
    author: work.authorText,
    result,
  })
  return { ...classification }
}

async function recordCorpusSeriesDiscovery(
  workId: string,
  payload: Record<string, unknown>,
  checkedAt: string,
): Promise<CorpusSeriesDiscoveryResult> {
  const { data, error } = await supabase.rpc('record_corpus_series_discovery', {
    p_work: workId,
    p_result: payload,
    p_checked_at: checkedAt,
  })
  if (error) throw error
  return data as CorpusSeriesDiscoveryResult
}

export async function bulkCompleteCorpus(
  candidates: readonly CorpusEnrichmentWork[],
  onProgress: (progress: CorpusBulkProgress) => void,
  shouldStop: () => boolean,
): Promise<CorpusBulkResult> {
  const total = candidates.length
  let scanned = 0
  let filled = 0
  let failed = 0
  let nothing = 0
  let consecutiveFailures = 0
  let stopReason: CorpusBulkStopReason = 'done'
  let errorMessage: string | undefined
  onProgress({ scanned, total, filled, recoveryScanned: 0, phase: 'classifying' })

  for (const work of candidates) {
    if (shouldStop()) {
      stopReason = 'user'
      break
    }
    if (scanned >= CORPUS_SWEEP_MAX_WORKS) {
      stopReason = 'limit'
      break
    }

    // Rescue the exact established artwork before any provider lookup. A temporary provider
    // failure must not strand a reader-owned u/ object or upstream hotlink in the shared corpus.
    // Null checked_at keeps this work eligible for its still-needed metadata check.
    let relocatedCover = false
    if (corpusCoverNeedsDurableOwnership(work.cover)) {
      const ingest = await ingestCorpusCover({
        workId: work.id,
        source: 'url',
        url: work.cover,
        sourceUrl: work.cover,
      })
      if (ingest.status === 'ok') {
        const coverPatch: CorpusMetadataPatch = {
          coverUrl: ingest.data.cover,
          coverSource: 'url',
          coverSourceUrl: work.cover,
          ...(ingest.data.color ? { coverColor: ingest.data.color } : {}),
        }
        try {
          await writeCorpusPatch(work.id, coverPatch, null)
          relocatedCover = true
        } catch (error) {
          stopReason = 'error'
          errorMessage = error instanceof Error ? error.message : String(error)
          break
        }
      }
    }

    const outcome = await enrichBookOutcome({
      title: work.title,
      author: work.authorText,
      isbn: work.isbns[0],
    })
    if (outcome.status === 'rate_limited') {
      stopReason = 'rate_limited'
      break
    }
    if (outcome.status === 'failed') {
      failed++
      consecutiveFailures++
      errorMessage ??= outcome.reason
      if (consecutiveFailures >= FAILURE_STREAK_LIMIT) {
        stopReason = 'error'
        break
      }
      continue
    }
    consecutiveFailures = 0
    const checkedAt = new Date().toISOString()
    let patch: CorpusMetadataPatch = {}
    let seriesChanged = false
    let seriesPayload: Record<string, unknown> = {
      matched: false,
      confidence: 'none',
      source: 'catalog',
    }
    if (outcome.status === 'ok') {
      patch = corpusPatchFromEnrichment(outcome.data)
      seriesPayload = await corpusSeriesDiscoveryPayload(work, outcome.data)
      if (
        !relocatedCover &&
        outcome.data.cover &&
        (!work.cover || corpusCoverNeedsDurableOwnership(work.cover)) &&
        !patch.coverUrl
      ) {
        const source = corpusCoverSourceOf(outcome.data)
        if (isIngestibleCoverUrl(outcome.data.cover)) {
          const ingest = await ingestCorpusCover({
            workId: work.id,
            source,
            url: outcome.data.cover,
            sourceUrl: outcome.data.cover,
          })
          if (ingest.status === 'ok') {
            patch.coverUrl = ingest.data.cover
            patch.coverSource = source
            patch.coverSourceUrl = ingest.data.sourceUrl ?? outcome.data.cover
            if (ingest.data.color) patch.coverColor = ingest.data.color
          }
        }
      }
    }
    try {
      await writeCorpusPatch(work.id, patch, checkedAt)
      const seriesResult = await recordCorpusSeriesDiscovery(work.id, seriesPayload, checkedAt)
      // A confirmed tuple is still a material reconciliation: the database replays that trusted
      // default into eligible personal rows and materializes any missing structured membership.
      seriesChanged =
        seriesResult.outcome === 'applied' ||
        seriesResult.outcome === 'confirmed' ||
        seriesResult.outcome === 'review'
    } catch (error) {
      stopReason = 'error'
      errorMessage = error instanceof Error ? error.message : String(error)
      break
    }
    if (relocatedCover || Object.keys(patch).length || seriesChanged) filled++
    else nothing++
    scanned++
    onProgress({ scanned, total, filled, recoveryScanned: 0, phase: 'classifying' })
  }
  return {
    scanned,
    total,
    filled,
    failed,
    nothing,
    stopReason,
    errorMessage,
    recoveryScanned: 0,
    phase: 'classifying',
  }
}

export interface CorpusCompletionPipelineResult {
  recovery: CorpusCoverRecoveryResult
  result: CorpusBulkResult
}

interface CorpusCompletionPipelineDependencies {
  recover: () => Promise<CorpusCoverRecoveryResult>
  fetchCandidates: () => Promise<CorpusEnrichmentWork[]>
  refreshCandidates: (ids: readonly string[]) => Promise<CorpusEnrichmentWork[]>
  complete: typeof bulkCompleteCorpus
}

/**
 * Interleave bounded cover recovery with bounded metadata/series classification. Cover recovery
 * is useful even when no classification candidates remain, but an unavailable recovery batch must
 * never prevent classification from advancing. Each recovered chunk is re-read before providers
 * are queried so the classifier sees the newly preserved shared cover and objective fields.
 */
export async function runCorpusCompletionPipeline(
  onProgress: (progress: CorpusBulkProgress) => void,
  shouldStop: () => boolean,
  dependencies: CorpusCompletionPipelineDependencies = {
    recover: recoverAdminHouseholdCorpusCovers,
    fetchCandidates: fetchCorpusEnrichmentCandidates,
    refreshCandidates: fetchCorpusEnrichmentWorksByIds,
    complete: bulkCompleteCorpus,
  },
): Promise<CorpusCompletionPipelineResult> {
  const candidates = await dependencies.fetchCandidates()
  const scheduled = candidates.slice(0, CORPUS_SWEEP_MAX_WORKS)
  const recovery: CorpusCoverRecoveryResult = {
    scanned: 0,
    failed: 0,
    failedBatches: 0,
    recoveredCovers: 0,
    recoveredOptions: 0,
    maybeMore: true,
  }
  const result: CorpusBulkResult = {
    scanned: 0,
    total: candidates.length,
    filled: 0,
    failed: 0,
    nothing: 0,
    stopReason: 'done',
    recoveryScanned: 0,
    phase: 'classifying',
  }
  let candidateOffset = 0
  let recoveryActive = true
  let batchCount = 0

  while (
    batchCount < CORPUS_PIPELINE_BATCH_LIMIT &&
    (candidateOffset < scheduled.length || recoveryActive)
  ) {
    if (shouldStop()) {
      result.stopReason = 'user'
      break
    }

    if (recoveryActive) {
      onProgress({
        scanned: result.scanned,
        total: result.total,
        filled: result.filled,
        recoveryScanned: recovery.scanned,
        phase: 'recovering',
      })
      try {
        const batchRecovery = await dependencies.recover()
        recovery.scanned += batchRecovery.scanned
        recovery.failed += batchRecovery.failed
        recovery.recoveredCovers += batchRecovery.recoveredCovers
        recovery.recoveredOptions += batchRecovery.recoveredOptions
        recovery.maybeMore = batchRecovery.maybeMore
        recovery.errorMessage ??= batchRecovery.errorMessage
        recoveryActive = batchRecovery.maybeMore
      } catch (error) {
        recovery.failedBatches++
        recovery.maybeMore = true
        recovery.errorMessage ??= error instanceof Error ? error.message : String(error)
        // Do not hammer an unavailable recovery path in this run. Classification below still
        // advances, and the durable queue resumes from its marks on the next run.
        recoveryActive = false
      }
    }

    if (candidateOffset < scheduled.length) {
      const originalBatch = scheduled.slice(
        candidateOffset,
        candidateOffset + CORPUS_SWEEP_COVER_BATCH_SIZE,
      )
      let refreshedBatch = originalBatch
      try {
        const refreshed = await dependencies.refreshCandidates(originalBatch.map(({ id }) => id))
        const refreshedById = new Map(refreshed.map((work) => [work.id, work]))
        refreshedBatch = originalBatch.map((work) => refreshedById.get(work.id) ?? work)
      } catch {
        // Recovery and provider completion are independently useful. A transient refresh failure
        // falls back to the already fetched candidate snapshot instead of discarding the batch.
      }

      const batchResult = await dependencies.complete(
        refreshedBatch,
        (batchProgress) =>
          onProgress({
            scanned: result.scanned + batchProgress.scanned,
            total: result.total,
            filled: result.filled + batchProgress.filled,
            recoveryScanned: recovery.scanned,
            phase: 'classifying',
          }),
        shouldStop,
      )
      result.scanned += batchResult.scanned
      result.filled += batchResult.filled
      result.failed += batchResult.failed
      result.nothing += batchResult.nothing
      result.errorMessage ??= batchResult.errorMessage
      candidateOffset += originalBatch.length
      if (batchResult.stopReason !== 'done') {
        result.stopReason = batchResult.stopReason
        break
      }
    }

    batchCount++
  }

  if (
    result.stopReason === 'done' &&
    (candidates.length > scheduled.length || recoveryActive)
  ) {
    result.stopReason = 'limit'
  }
  return { recovery, result }
}
