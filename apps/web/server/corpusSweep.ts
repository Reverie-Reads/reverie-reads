import {
  classifySeriesMembership,
  isGoogleContentCover,
  isIngestibleCoverUrl,
  type SeriesCatalogSnapshot,
} from '@reverie/core'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { RetryableError } from 'workflow'
import {
  CORPUS_SWEEP_COVER_BATCH_SIZE,
  corpusCoverNeedsDurableOwnership,
  corpusCoverSourceOf,
  corpusEnrichmentSelect,
  corpusPatchFromEnrichment,
  corpusSweepCandidateSnapshot,
  corpusWorkFromRow,
  type CorpusEnrichmentRow,
  type CorpusMetadataPatch,
} from '../src/lib/corpusSweepPolicy'
import type { EnrichResult } from '../src/lib/enrich'
import { hardcoverSeriesLookupTarget } from '../src/lib/seriesLookup'

const PAGE_SIZE = 1_000
const PROVIDER_TIMEOUT_MS = 20_000

type JsonObject = Record<string, unknown>

interface SeriesFunctionPayload {
  name?: string
  sourceRef?: string | null
  memberCount?: number | null
  entries?: { position?: number | null; title?: string; author?: string }[]
  membershipEntries?: { position?: number | null; title?: string; author?: string }[]
  unavailable?: boolean
}

interface IngestResult {
  cover?: string
  color?: string | null
  sourceUrl?: string | null
  error?: string
}

class FunctionHttpError extends Error {
  constructor(
    readonly functionName: string,
    readonly status: number,
    message: string,
  ) {
    super(`${functionName} ${status}${message ? `: ${message.slice(0, 200)}` : ''}`)
    this.name = 'FunctionHttpError'
  }
}

function requiredEnv(name: string, ...fallbackNames: string[]): string {
  for (const candidate of [name, ...fallbackNames]) {
    const value = process.env[candidate]?.trim()
    if (value) return value
  }
  throw new Error(`${name} is required for durable corpus sweeps`)
}

export function serviceClient(): SupabaseClient {
  return createClient(
    requiredEnv('SUPABASE_URL', 'VITE_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

function functionHeaders(): HeadersInit {
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

async function invokeFunction<T>(name: string, body: JsonObject): Promise<T> {
  const base = requiredEnv('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    const response = await fetch(`${base}/functions/v1/${name}`, {
      method: 'POST',
      headers: functionHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'))
      throw new RetryableError(`${name} rate limited`, {
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : '1m',
      })
    }
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      if (response.status >= 500) {
        throw new RetryableError(
          `${name} unavailable (${response.status})${message ? `: ${message.slice(0, 200)}` : ''}`,
          { retryAfter: '30s' },
        )
      }
      throw new FunctionHttpError(name, response.status, message)
    }
    return (await response.json()) as T
  } catch (error) {
    if (RetryableError.is(error) || error instanceof FunctionHttpError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new RetryableError(`${name} unavailable: ${message}`, { retryAfter: '30s' })
  } finally {
    clearTimeout(timer)
  }
}

async function allCorpusWorks(client: SupabaseClient): Promise<CorpusEnrichmentRow[]> {
  const rows: CorpusEnrichmentRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('works')
      .select(corpusEnrichmentSelect)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as CorpusEnrichmentRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

export async function initializeCorpusSweep(runId: string): Promise<number> {
  'use step'

  const client = serviceClient()
  const candidates = corpusSweepCandidateSnapshot(await allCorpusWorks(client))
  const { data, error } = await client.rpc('service_begin_corpus_sweep', {
    p_run: runId,
    p_work_ids: candidates.workIds,
    p_total_count: candidates.total,
  })
  if (error) throw error
  return Number(data ?? 0)
}

export async function recoverCorpusSweepCovers(
  runId: string,
  batchNumber: number,
): Promise<boolean> {
  'use step'

  const { data, error } = await serviceClient().rpc('service_recover_corpus_sweep_covers', {
    p_run: runId,
    p_batch: batchNumber,
    p_limit: CORPUS_SWEEP_COVER_BATCH_SIZE,
  })
  if (error) throw error
  const result = (data ?? {}) as { cancelled?: boolean; maybeMore?: boolean }
  return !result.cancelled && result.maybeMore === true
}

export async function deferCorpusSweepCoverRecovery(
  runId: string,
  batchNumber: number,
  message: string,
): Promise<void> {
  'use step'

  const { error } = await serviceClient().rpc('service_defer_corpus_sweep_cover_recovery', {
    p_run: runId,
    p_batch: batchNumber,
    p_error: message,
  })
  if (error) throw error
}

export async function claimCorpusSweepWork(runId: string): Promise<string | null> {
  'use step'

  const { data, error } = await serviceClient().rpc('service_claim_corpus_sweep_item', {
    p_run: runId,
  })
  if (error) throw error
  return typeof data === 'string' && data ? data : null
}

async function currentItemIsRunning(
  client: SupabaseClient,
  runId: string,
  workId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('corpus_sweep_run_items')
    .select('status')
    .eq('run_id', runId)
    .eq('work_id', workId)
    .maybeSingle()
  if (error) throw error
  return data?.status === 'running'
}

export async function ingestCorpusCoverForSweep(input: {
  runId: string
  workId: string
  source: string
  url: string
}): Promise<IngestResult | null> {
  try {
    const result = await invokeFunction<IngestResult>('covers', {
      action: 'ingest',
      scope: 'corpus',
      sweepRunId: input.runId,
      workId: input.workId,
      source: input.source,
      url: input.url,
      sourceUrl: input.url,
    })
    return result.cover ? result : null
  } catch (error) {
    // Cover ingestion is best-effort in the established pipeline. That boundary includes an Edge
    // worker exhausting its memory or timing out: the separate recovery queue owns cover retries,
    // while this item must still reach metadata and series classification. Re-throwing a 5xx here
    // made one oversized image consume every Workflow retry and kept `scanned_count` at zero.
    const reason = error instanceof Error ? error.message : String(error)
    console.warn('Corpus sweep deferred non-blocking cover ingestion', {
      runId: input.runId,
      workId: input.workId,
      reason,
    })
    return null
  }
}

async function seriesSnapshot(
  runId: string,
  workId: string,
  name: string,
  author: string,
  title: string,
  providerWorkId?: string,
): Promise<SeriesCatalogSnapshot> {
  const payload = await invokeFunction<SeriesFunctionPayload>('series', {
    sweepRunId: runId,
    workId,
    name,
    author,
    ...hardcoverSeriesLookupTarget(title, author, providerWorkId),
  })
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
    unavailable: payload.unavailable === true,
  }
}

export async function processCorpusSweepWork(runId: string, workId: string): Promise<void> {
  'use step'

  const client = serviceClient()
  // If a completion response was lost, Workflow retries this step. The item checkpoint makes that
  // replay a no-op before any provider or storage side effect is repeated.
  if (!(await currentItemIsRunning(client, runId, workId))) return

  const { data, error } = await client
    .from('works')
    .select(corpusEnrichmentSelect)
    .eq('id', workId)
    .single()
  if (error) throw error
  const work = corpusWorkFromRow(data as CorpusEnrichmentRow)
  const patch: CorpusMetadataPatch = {}
  let relocatedCover = false

  if (corpusCoverNeedsDurableOwnership(work.cover)) {
    const ingest = await ingestCorpusCoverForSweep({
      runId,
      workId,
      source: 'url',
      url: work.cover,
    })
    if (ingest?.cover) {
      patch.coverUrl = ingest.cover
      patch.coverSource = 'url'
      patch.coverSourceUrl = work.cover
      if (ingest.color) patch.coverColor = ingest.color
      const { error: coverWriteError } = await client.rpc('service_apply_corpus_sweep_cover', {
        p_run: runId,
        p_work: workId,
        p_patch: patch,
      })
      if (coverWriteError) throw coverWriteError
      relocatedCover = true
    }
  }

  const result = await invokeFunction<
    EnrichResult & {
      rateLimited?: boolean
      sourcesFailed?: boolean
      sourcesAttempted?: number
    }
  >('enrich', {
    title: work.title,
    author: work.authorText,
    isbn: work.isbns[0],
    mode: 'full',
  })
  if (result.rateLimited)
    throw new RetryableError('enrichment providers rate limited', { retryAfter: '1m' })
  if (result.sourcesFailed) {
    throw new RetryableError(`all ${result.sourcesAttempted ?? 0} enrichment sources failed`, {
      retryAfter: '30s',
    })
  }

  Object.assign(patch, corpusPatchFromEnrichment(result))
  const candidateSeries = result.series?.trim() ?? ''
  const source = result.provenance?.series?.source ?? result.source ?? 'catalog'
  const snapshots = candidateSeries
    ? [
        await seriesSnapshot(
          runId,
          workId,
          candidateSeries,
          work.authorText,
          work.title,
          result.workId,
        ),
      ]
    : []
  const seriesResult = classifySeriesMembership({
    title: work.title,
    author: work.authorText,
    candidateSeries,
    candidatePosition: result.seriesPosition,
    candidateSource: source,
    candidateSourceRef: result.workId || result.editionId || null,
    identityConfidence: result.confidence ?? 'none',
    snapshots,
  })

  if (
    !relocatedCover &&
    result.cover &&
    (!work.cover || corpusCoverNeedsDurableOwnership(work.cover)) &&
    !patch.coverUrl
  ) {
    const coverSource = corpusCoverSourceOf(result)
    if (isIngestibleCoverUrl(result.cover)) {
      const ingest = await ingestCorpusCoverForSweep({
        runId,
        workId,
        source: coverSource,
        url: result.cover,
      })
      if (ingest?.cover) {
        patch.coverUrl = ingest.cover
        patch.coverSource = coverSource
        patch.coverSourceUrl = ingest.sourceUrl ?? result.cover
        if (ingest.color) patch.coverColor = ingest.color
      }
    } else if (coverSource === 'google' && isGoogleContentCover(result.cover)) {
      patch.coverUrl = result.cover
      patch.coverSource = 'google'
      patch.coverSourceUrl = result.cover
    }
  }

  const checkedAt = new Date().toISOString()
  const { error: writeError } = await client.rpc('service_complete_corpus_sweep_item', {
    p_run: runId,
    p_work: workId,
    p_patch: patch,
    p_series_result: seriesResult,
    p_checked_at: checkedAt,
    p_outcome: { provider: result.source ?? null, confidence: result.confidence ?? 'none' },
  })
  if (writeError) throw writeError
}

// Four retries cover brief Edge/remote-provider outages without letting one work terminate the run.
processCorpusSweepWork.maxRetries = 4

export async function deferCorpusSweepWork(
  runId: string,
  workId: string,
  message: string,
): Promise<void> {
  'use step'

  const { error } = await serviceClient().rpc('service_defer_corpus_sweep_item', {
    p_run: runId,
    p_work: workId,
    p_error: message,
    p_outcome: { deferred: true },
  })
  if (error) throw error
}

export async function finishCorpusSweep(runId: string, errorMessage?: string): Promise<void> {
  'use step'

  const { error } = await serviceClient().rpc('service_finish_corpus_sweep', {
    p_run: runId,
    p_error: errorMessage ?? null,
  })
  if (error) throw error
}
