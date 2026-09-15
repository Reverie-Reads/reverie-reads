import { classifySeriesMembership, type SeriesClassification } from '@reverie/core'
import { hardcoverSeriesLookupTarget } from './seriesLookup'

export const SERIES_RECOVERY_EXCLUSION_COUNT = 23
export const SERIES_RECOVERY_BATCH_SIZE = 25

export interface SeriesRecoveryManifest {
  version: 1
  project: string
  works: { id: string; fingerprint: string; reason: string }[]
}

export interface SeriesRecoveryWork {
  id: string
  title: string
  author_text: string | null
  series: string | null
  position: number | string | null
  work_id: string | null
  enrichment_confidence: 'high' | 'medium' | 'low' | 'none' | null
  fingerprint: string
}

export interface SeriesRecoveryPayload {
  name?: string
  sourceRef?: string | null
  memberCount?: number | null
  entries?: { position?: number | null; title?: string; author?: string }[]
  membershipEntries?: { position?: number | null; title?: string; author?: string }[]
  unavailable?: boolean
  failureCode?: string
  httpStatus?: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MD5 = /^[a-f0-9]{32}$/
const deferrable = new Set([
  'ambiguous_relationship',
  'identity_mismatch',
  'not_found',
  'empty_relationship',
  'relationship_limit',
])

export function parseSeriesRecoveryManifest(
  value: unknown,
  expectedProject: string,
): SeriesRecoveryManifest {
  const manifest = value as Partial<SeriesRecoveryManifest> | null
  if (
    !manifest ||
    manifest.version !== 1 ||
    manifest.project !== expectedProject ||
    !Array.isArray(manifest.works) ||
    manifest.works.length !== SERIES_RECOVERY_EXCLUSION_COUNT
  ) {
    throw new Error('Choose the reviewed 23-work recovery exclusion file for this project')
  }
  const seen = new Set<string>()
  for (const entry of manifest.works) {
    if (
      !entry ||
      !UUID.test(entry.id) ||
      !MD5.test(entry.fingerprint) ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim() ||
      entry.reason.length > 240 ||
      seen.has(entry.id)
    ) {
      throw new Error('The recovery exclusion file is invalid or contains duplicate works')
    }
    seen.add(entry.id)
  }
  return manifest as SeriesRecoveryManifest
}

export function seriesRecoveryLookupBody(work: SeriesRecoveryWork) {
  const title = work.title.trim()
  const author = work.author_text?.trim() ?? ''
  const series = work.series?.trim() ?? ''
  const target = hardcoverSeriesLookupTarget(title, author, work.work_id ?? undefined)
  if (!target || !series || work.enrichment_confidence !== 'high') return null
  return { name: series, author, ...target }
}

const key = (value: string): string =>
  value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')

export function classifySeriesRecoveryPayload(
  work: SeriesRecoveryWork,
  payload: SeriesRecoveryPayload,
): { deferred: string } | { result: SeriesClassification } {
  if (payload?.unavailable === true) {
    if (payload.httpStatus === 200 && payload.failureCode && deferrable.has(payload.failureCode)) {
      return { deferred: payload.failureCode }
    }
    throw new Error('provider_unavailable_stop')
  }
  const entries = payload.membershipEntries ?? payload.entries
  if (
    !payload ||
    typeof payload.name !== 'string' ||
    !payload.name.trim() ||
    typeof payload.sourceRef !== 'string' ||
    !/^[1-9]\d*$/.test(payload.sourceRef) ||
    payload.memberCount !== null ||
    !Array.isArray(entries) ||
    entries.length >= 201 ||
    entries.some(
      (entry) =>
        !entry ||
        typeof entry.title !== 'string' ||
        typeof entry.author !== 'string' ||
        (entry.position !== null &&
          entry.position !== undefined &&
          (typeof entry.position !== 'number' ||
            !Number.isFinite(entry.position) ||
            entry.position < 0)),
    )
  ) {
    throw new Error('relationship_contract_changed')
  }
  const author = work.author_text?.trim() ?? ''
  const exact = entries.filter(
    (entry) =>
      key(entry.title ?? '') === key(work.title) && key(entry.author ?? '') === key(author),
  )
  if (exact.length !== 1) {
    return { deferred: exact.length ? 'ambiguous_exact_membership' : 'no_exact_membership' }
  }
  const normalizedEntries = entries.map((entry) => {
    const position = Number(entry.position)
    return {
      title: entry.title ?? '',
      author: entry.author ?? '',
      position: Number.isFinite(position) && position > 0 ? position : null,
    }
  })
  const candidatePosition = work.position === null ? null : Number(work.position)
  const result = classifySeriesMembership({
    title: work.title,
    author,
    candidateSeries: work.series?.trim() ?? '',
    candidatePosition: Number.isFinite(candidatePosition) ? candidatePosition : null,
    candidateSource: 'hardcover',
    candidateSourceRef: work.work_id,
    identityConfidence: work.enrichment_confidence ?? 'none',
    snapshots: [
      {
        source: 'hardcover',
        series: payload.name.trim(),
        sourceRef: payload.sourceRef,
        memberCount: null,
        entries: normalizedEntries,
      },
    ],
  })
  const exactPosition = Number(exact[0]!.position)
  const normalizedExactPosition =
    Number.isFinite(exactPosition) && exactPosition > 0 ? exactPosition : null
  if (result.position !== normalizedExactPosition) return { deferred: 'ambiguous_exact_membership' }
  if (result.position === null && work.position !== null)
    return { deferred: 'missing_position_evidence' }
  if (
    !['found', 'review'].includes(result.outcome) ||
    result.count !== null ||
    result.sourceRef !== payload.sourceRef ||
    !result.evidence.some((evidence) => evidence.kind === 'relational_membership')
  ) {
    throw new Error('unexpected_classification')
  }
  return { result }
}
