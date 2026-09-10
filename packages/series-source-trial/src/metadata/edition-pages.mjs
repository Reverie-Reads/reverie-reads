import { createHash } from 'node:crypto'
import { validateBenchmark } from './benchmark.mjs'
import { canonicalIsbn, exactIdentity, identityReviewReason, validateInput } from './supplement.mjs'
import {
  createEditionDiagnostics,
  countEditionDiagnostics,
  hasRepeatedGoogleSubtitle,
} from './edition-page-diagnostics.mjs'

export const validPages = (v) => Number.isInteger(v) && v > 0 && v <= 20000
export const validVolumeId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v)
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const review = (reason) => ({ status: 'identity_review', reason })

/** Strict full-title/full-author admission; no subtitle stripping or approximate match. */
export function admitGoogleVolume(volume, identity) {
  const b = volume?.volumeInfo
  if (!object(b) || !validVolumeId(volume.id)) return review('malformed_record')
  if (b.subtitle != null && typeof b.subtitle !== 'string') return review('malformed_subtitle')
  if (!Array.isArray(b.industryIdentifiers)) return review('invalid_isbn')
  const identifiers = b.industryIdentifiers.filter((i) => ['ISBN_10', 'ISBN_13'].includes(i?.type))
  if (!identifiers.length || identifiers.some((i) => !canonicalIsbn(i.identifier)))
    return review('invalid_isbn')
  const record = {
    source: 'google',
    isbns: identifiers.map((i) => i.identifier),
    title: b.subtitle?.trim() ? `${b.title}: ${b.subtitle}` : b.title,
    authors: b.authors,
    pages: validPages(b.pageCount) ? b.pageCount : null,
    editionFormat: null,
  }
  try {
    validateInput({
      version: 1,
      purpose: 'development',
      cases: [{ identity, current: {}, baseline: [record] }],
    })
    const reason = identityReviewReason(record, identity)
    if (reason) {
      const result = review(reason)
      if (
        reason === 'title_mismatch' &&
        hasRepeatedGoogleSubtitle(b.title, b.subtitle, identity.title)
      )
        result.titleDiagnostic = 'repeated_subtitle'
      return result
    }
    if (b.language != null && (typeof b.language !== 'string' || !/^[a-z]{2}$/.test(b.language)))
      return review('malformed_language')
    if (identity.language && b.language && identity.language !== b.language)
      return review('language_mismatch')
    return { status: 'matched', record, volumeId: volume.id, language: b.language ?? null }
  } catch {
    return review('malformed_record')
  }
}

/** Select exactly one candidate by returned ISBN before title validation or any detail request. */
export function selectGoogleEdition(body, identity) {
  if (
    !object(body) ||
    body.error ||
    !Number.isSafeInteger(body.totalItems) ||
    body.totalItems < 0 ||
    body.totalItems < (body.items?.length ?? 0) ||
    (body.items != null && !Array.isArray(body.items)) ||
    (!body.items && body.totalItems !== 0) ||
    (body.items?.length ?? 0) > 10
  )
    return { status: 'invalid_shape' }
  if (body.totalItems > 10) return review('truncated_results')
  const matches = (body.items ?? []).filter(
    (v) =>
      Array.isArray(v?.volumeInfo?.industryIdentifiers) &&
      v.volumeInfo.industryIdentifiers.some(
        (i) =>
          ['ISBN_10', 'ISBN_13'].includes(i?.type) &&
          canonicalIsbn(i.identifier) === canonicalIsbn(identity.isbn),
      ),
  )
  if (matches.length > 1) return review('ambiguous_records')
  if (!matches.length) return { status: body.totalItems === 0 ? 'not_found' : 'no_exact_isbn' }
  return admitGoogleVolume(matches[0], identity)
}

export function validateEditionPages(input) {
  if (input?.purpose !== 'development-edition-pages') throw new Error('invalid_edition_pages')
  validateBenchmark({ ...input, purpose: 'development-edition-benchmark' })
  return input
}

const complete = new Set([
  'matched',
  'not_found',
  'no_exact_isbn',
  'identity_review',
  'edition_review',
])
const providers = ['google', 'openlibrary']

/** Memory-only, no patch and no automatic eligibility. Provider agreement is not proven lineage independence. */
export function buildEditionPagePacket({ identity, current }, acquired) {
  validateInput({
    version: 1,
    purpose: 'development',
    cases: [{ identity, current, baseline: [] }],
  })
  const records = []
  let blocked = null
  if (
    !object(acquired) ||
    Object.keys(acquired).some((p) => !providers.includes(p)) ||
    providers.some((p) => !complete.has(acquired[p]?.status))
  )
    blocked = 'unavailable'
  else if (
    providers.some((p) => ['identity_review', 'edition_review'].includes(acquired[p].status))
  )
    blocked = 'identity_review'
  if (!blocked) {
    for (const source of providers) {
      const result = acquired[source]
      if (result.status !== 'matched') continue
      try {
        validateInput({
          version: 1,
          purpose: 'development',
          cases: [{ identity, current, baseline: [result.record] }],
        })
        if (
          result.record.source !== source ||
          !exactIdentity(result.record, identity) ||
          result.endpoint !== (source === 'google' ? 'volume_detail' : 'isbn_edition') ||
          canonicalIsbn(result.targetIsbn) !== canonicalIsbn(identity.isbn) ||
          !Number.isFinite(Date.parse(result.observedAt)) ||
          (source === 'google' && !validVolumeId(result.sourceId)) ||
          (source === 'openlibrary' && result.sourceId !== canonicalIsbn(identity.isbn))
        )
          throw new Error('invalid_evidence')
        records.push(result)
      } catch {
        blocked = 'identity_review'
      }
    }
  }
  const formats = [
    ...new Set(
      [current.editionFormat, ...records.map((r) => r.record.editionFormat)].filter(Boolean),
    ),
  ]
  const observations = blocked
    ? []
    : records
        .filter((r) => validPages(r.record.pages))
        .map((r) => ({
          source: r.record.source,
          endpoint: r.endpoint,
          sourceId: r.sourceId,
          targetIsbn: canonicalIsbn(identity.isbn),
          observedAt: r.observedAt,
          value: r.record.pages,
        }))
  const values = [...new Set(observations.map((o) => o.value))]
  const state =
    blocked ??
    (formats.length > 1
      ? 'edition_conflict'
      : formats[0] === 'audiobook'
        ? 'not_applicable'
        : values.length > 1 || (current.pages != null && values.some((v) => v !== current.pages))
          ? 'conflict'
          : !values.length
            ? 'source_missing'
            : observations.length === 1
              ? 'candidate'
              : 'cross_provider_agreement')
  const eligible = ['candidate', 'cross_provider_agreement'].includes(state)
  const packet = {
    version: 1,
    retention: 'memory_only',
    automatic: false,
    identity: structuredClone(identity),
    state,
    observations: ['edition_conflict', 'not_applicable'].includes(state) ? [] : observations,
    current: { value: current.pages ?? null, protected: current.pages != null },
    candidateValue: eligible && current.pages == null ? values[0] : null,
    // Provider/current format evidence only; never take format from benchmark reference truth.
    formatEvidence: blocked
      ? 'unavailable'
      : formats.length > 1
        ? 'conflicting'
        : (formats[0] ?? 'unknown'),
    independentLineageEstablished: false,
  }
  Object.defineProperty(packet, 'toJSON', {
    value() {
      throw new Error('edition_page_packet_is_memory_only')
    },
  })
  return packet
}

const statuses = new Set([
  ...complete,
  'missing_key',
  'not_attempted',
  'invalid_shape',
  'invalid_json',
  'authentication_or_access',
  'rate_limited',
  'server_error',
  'redirect_refused',
  'http_error',
  'timeout',
  'response_too_large',
  'network_error',
  'incomplete_authors',
])
const tally = () => ({ available: 0, agrees: 0, differs: 0, unscored: 0 })
const score = (t, value, reference) => {
  if (!validPages(value)) return
  t.available++
  t[reference == null ? 'unscored' : value === reference ? 'agrees' : 'differs']++
}
const bump = (t, key) => {
  t[key] = (t[key] ?? 0) + 1
}

export async function runEditionPages(input, { client } = {}) {
  validateEditionPages(input)
  const report = {
    version: 3,
    experiment: 'edition_pages',
    mode: client ? 'live' : 'dry_run',
    cases: input.cases.length,
    frameSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    outcomes: { google: {}, openlibrary: {} },
    states: {},
    diagnostics: createEditionDiagnostics(),
    protectedCurrent: 0,
    observations: { google: tally(), openlibrary: tally() },
    candidates: tally(),
    automaticFills: 0,
    productionWrites: 0,
    modelCalls: 0,
    retention: 'aggregate_only',
    acquisitionWallMs: null,
    transport: null,
  }
  if (!client) return report
  const started = Date.now()
  for (const c of input.cases) {
    // Reference facts and current values never enter provider selection or requests.
    const acquired = await client.acquire(structuredClone(c.identity))
    const packet = buildEditionPagePacket({ identity: c.identity, current: c.current }, acquired)
    countEditionDiagnostics(report.diagnostics, acquired, packet)
    for (const p of providers)
      bump(
        report.outcomes[p],
        statuses.has(acquired?.[p]?.status) ? acquired[p].status : 'unknown_status',
      )
    bump(report.states, packet.state)
    if (packet.current.protected) report.protectedCurrent++
    for (const observation of packet.observations)
      score(report.observations[observation.source], observation.value, c.reference.pages)
    score(report.candidates, packet.candidateValue, c.reference.pages)
  }
  report.transport = structuredClone(client.stats)
  report.acquisitionWallMs = Math.max(0, Date.now() - started)
  return report
}
