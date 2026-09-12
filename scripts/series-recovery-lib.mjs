// Incident-specific policy. No network, credentials, or database writer in this module.
import { createHash } from 'node:crypto'
import { classifySeriesMembership } from '../packages/core/src/seriesClassification.ts'
import { hardcoverSeriesLookupTarget } from '../apps/web/src/lib/seriesLookup.ts'

export const BATCH_SIZE = 25
export const MAX_WORKS = 1000
export const OUTAGE_REASON =
  'The relational series source was unavailable; the search label was not accepted by itself.'
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const deferrable = new Set([
  'ambiguous_relationship',
  'identity_mismatch',
  'not_found',
  'empty_relationship',
  'relationship_limit',
])
export const stable = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  )
export const hash = (value) => createHash('sha256').update(stable(value)).digest('hex')
export const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'"
export function requireThat(condition, code) {
  if (!condition) throw new Error(code)
}

export const inventoryPredicate = `w.series_check_state = 'no_series'
 and w.series_checked_at < timestamptz '2026-09-10T00:00:00Z'
 and w.series_check_reason = ${quote(OUTAGE_REASON)}
 and w.series_check_evidence @> '[{"source":"hardcover","kind":"provider_unavailable"}]'::jsonb
 and not exists (select 1 from public.corpus_series_entries e where e.work_id=w.id and e.removed_at is null)
 and not exists (select 1 from public.work_series_suggestions s where s.work_id=w.id and s.status='pending')`

export function validatePlan(plan) {
  const { digest, ...body } = plan
  requireThat(digest === hash(body) && plan.version === 1, 'plan_hash_mismatch')
  requireThat(UUID.test(plan.actor) && /^[a-z]{20}$/.test(plan.project), 'invalid_project_or_actor')
  requireThat(/^[a-f0-9]{40}$/.test(plan.revision), 'invalid_revision')
  requireThat(
    /^[a-f0-9]{64}$/.test(plan.runtime) &&
      /^v\d+\.\d+\.\d+/.test(plan.node) &&
      /^[a-f0-9]{12}$/.test(plan.build) &&
      Number.isInteger(plan.seriesDeployment?.version) &&
      /^[a-f0-9]{64}$/.test(plan.seriesDeployment?.hash),
    'invalid_runtime_lock',
  )
  requireThat(
    Array.isArray(plan.works) && plan.works.length > 0 && plan.works.length <= MAX_WORKS,
    'invalid_plan_size',
  )
  requireThat(new Set(plan.works.map((w) => w.id)).size === plan.works.length, 'duplicate_targets')
  requireThat(
    stable(plan.works.map((w) => w.id)) === stable(plan.works.map((w) => w.id).sort()),
    'unordered_targets',
  )
  for (const work of plan.works) {
    requireThat(
      UUID.test(work.id) && /^[a-f0-9]{32}$/.test(work.fingerprint),
      'invalid_target_fingerprint',
    )
    requireThat(
      typeof work.title === 'string' &&
        (work.author_text === null || typeof work.author_text === 'string'),
      'invalid_identity',
    )
  }
  return plan
}

export function lookupBody(work) {
  const target = hardcoverSeriesLookupTarget(work.title, work.author_text ?? '', work.work_id)
  if (!target || !work.series?.trim() || work.enrichment_confidence !== 'high') return null
  return { name: work.series.trim(), author: work.author_text.trim(), ...target }
}

/** Successful capped/malformed responses are systemic contract failures, never usable evidence.
 * Explicit HTTP-200 relationship failures are data deferrals, not a reason to retry/paginate. */
export function classify(work, payload) {
  if (payload?.unavailable === true) {
    if (payload.httpStatus === 200 && deferrable.has(payload.failureCode))
      return { deferred: payload.failureCode }
    throw new Error('provider_unavailable_stop')
  }
  requireThat(
    payload &&
      typeof payload.name === 'string' &&
      payload.name.trim() &&
      typeof payload.sourceRef === 'string' &&
      /^[1-9]\d*$/.test(payload.sourceRef) &&
      payload.memberCount === null &&
      Array.isArray(payload.membershipEntries) &&
      payload.membershipEntries.length < 201 &&
      payload.membershipEntries.every(
        (e) =>
          e &&
          typeof e.title === 'string' &&
          typeof e.author === 'string' &&
          (e.position === null ||
            (typeof e.position === 'number' && Number.isFinite(e.position) && e.position >= 0)),
      ),
    'relationship_contract_changed',
  )
  const key = (s) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
  const exact = payload.membershipEntries.filter(
    (e) => key(e.title) === key(work.title) && key(e.author) === key(work.author_text),
  )
  if (exact.length !== 1)
    return { deferred: exact.length ? 'ambiguous_exact_membership' : 'no_exact_membership' }
  const result = classifySeriesMembership({
    title: work.title,
    author: work.author_text,
    candidateSeries: work.series,
    candidatePosition: work.position === null ? null : Number(work.position),
    candidateSource: 'hardcover',
    candidateSourceRef: work.work_id,
    identityConfidence: work.enrichment_confidence,
    snapshots: [
      {
        source: 'hardcover',
        series: payload.name.trim(),
        sourceRef: payload.sourceRef,
        memberCount: null,
        entries: payload.membershipEntries.map((e) => ({
          ...e,
          position: e.position > 0 ? e.position : null,
        })),
      },
    ],
  })
  // The shared classifier normalizes punctuation more broadly than this frozen exact-work gate.
  // A competing normalized title must not supply a different ordinal for the admitted work.
  if (result.position !== (exact[0].position > 0 ? exact[0].position : null))
    return { deferred: 'ambiguous_exact_membership' }
  if (result.position === null && work.position !== null)
    return { deferred: 'missing_position_evidence' }
  requireThat(
    ['found', 'review'].includes(result.outcome) &&
      result.count === null &&
      result.sourceRef === payload.sourceRef &&
      result.evidence.some((e) => e.kind === 'relational_membership'),
    'unexpected_classification',
  )
  return { result }
}

/** All personal fields except the existing RPC's series projection/provenance are fingerprinted.
 * Reviewer-owned/imported and nonconfirmed personal rows are additionally checked in full. */
export function snapshotSql(ids) {
  requireThat(
    ids.length > 0 && ids.length <= BATCH_SIZE && ids.every((id) => UUID.test(id)),
    'invalid_snapshot_scope',
  )
  return `select w.id, md5(to_jsonb(w)::text) as fingerprint, to_jsonb(w) as work,
   md5((to_jsonb(w)-array['updated_at','series_check_state','series_checked_at','series_check_source','series_check_evidence','series_check_reason','series','position','metadata_provenance'])::text) as protected,
   md5((coalesce(w.metadata_provenance,'{}'::jsonb)-'series')::text) as other_provenance,
   (select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'full',md5(to_jsonb(b)::text),
    'protected',md5((to_jsonb(b)-array['series','position','series_count','status','series_user_chosen','series_claim','updated_at'])::text),
    'series',b.series,'position',b.position,'count',b.series_count,'claim',b.series_claim,'chosen',b.series_user_chosen,'removed',b.removed_at) order by b.id),'[]'::jsonb)
    from public.books b where b.corpus_work_id=w.id) as copies,
   (select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb)::text) from public.reads r join public.books b on b.id=r.book_id where b.corpus_work_id=w.id) as reads,
   (select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.corpus_series_entries e where e.work_id=w.id) as shared,
   (select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.series_entries e join public.books b on b.id=e.book_id where b.corpus_work_id=w.id) as personal,
   (select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from public.work_series_suggestions s where s.work_id=w.id and s.status='pending') as suggestions
   from public.works w where w.id in (${ids.map(quote).join(',')}) order by w.id;`
}

export function verifyReset(before, after) {
  const expected = { ...before.work, series_check_state: 'unresolved', series_checked_at: null }
  const withoutClock = (work) =>
    Object.fromEntries(Object.entries(work).filter(([key]) => key !== 'updated_at'))
  requireThat(
    after?.id === before.id &&
      stable(withoutClock(after.work)) === stable(withoutClock(expected)) &&
      ['copies', 'reads', 'shared', 'personal', 'suggestions'].every(
        (key) => stable(before[key]) === stable(after[key]),
      ),
    'reset_verification_failed',
  )
}

export function resumeAction(latest) {
  if (!latest) return 'process'
  if (['verified', 'deferred'].includes(latest.type)) return 'skip'
  requireThat(latest.type !== 'save_started', 'uncertain_save_requires_verification')
  requireThat(['lookup_started', 'proposal'].includes(latest.type), 'unexpected_checkpoint_stop')
  return 'defer'
}

export function verifySaved(before, after, result, checkedAt, response) {
  requireThat(
    after &&
      after.id === before.id &&
      after.protected === before.protected &&
      after.other_provenance === before.other_provenance &&
      after.reads === before.reads,
    'protected_data_changed',
  )
  const confirmed = response.outcome === 'confirmed'
  requireThat(confirmed || response.outcome === 'review', 'unexpected_save_outcome')
  const w = after.work,
    old = before.work
  const evidence = result.evidence.map((e) =>
    Object.fromEntries(Object.entries(e).filter(([, v]) => v !== null)),
  )
  requireThat(
    w.series_check_state === (confirmed ? 'found' : 'review') &&
      w.series_check_source === result.source &&
      Date.parse(w.series_checked_at) === Date.parse(checkedAt) &&
      w.series_check_reason === result.reason &&
      stable(w.series_check_evidence) === stable(evidence),
    'classification_readback_failed',
  )
  requireThat(
    w.series === old.series &&
      (confirmed && old.position === null
        ? w.position === result.position
        : w.position === old.position),
    'existing_tuple_changed',
  )
  const live = after.shared.filter((e) => e.removed_at === null)
  if (confirmed) {
    const provenance = w.metadata_provenance?.series
    requireThat(
      provenance?.source === result.source &&
        provenance.sourceRef === result.sourceRef &&
        provenance.identityConfidence === result.identityConfidence &&
        provenance.membershipConfidence === result.membershipConfidence &&
        provenance.confidence === result.membershipConfidence &&
        Date.parse(provenance.at) === Date.parse(checkedAt) &&
        stable(provenance.evidence) === stable(evidence),
      'provenance_readback_failed',
    )
    requireThat(
      live.length === 1 &&
        live[0].is_primary &&
        live[0].source_ref === result.sourceRef &&
        live[0].position === w.position &&
        live[0].membership_claim?.sourceRef === result.sourceRef &&
        (w.position === null
          ? live[0].position_claim?.origin === 'unknown'
          : live[0].position_claim?.sourceRef === result.sourceRef) &&
        after.suggestions.length === 0,
      'shared_readback_failed',
    )
  } else {
    requireThat(
      stable(before.shared) === stable(after.shared) &&
        stable(old.metadata_provenance) === stable(w.metadata_provenance),
      'review_published_membership',
    )
    const s = after.suggestions[0]
    requireThat(
      after.suggestions.length === 1 &&
        s.id === response.suggestion_id &&
        s.proposed_series === result.series &&
        s.proposed_position === result.position &&
        s.proposed_count === null &&
        s.source_ref === result.sourceRef &&
        s.source === result.source &&
        s.identity_confidence === result.identityConfidence &&
        s.confidence === result.membershipConfidence &&
        s.reason === result.reason &&
        Date.parse(s.checked_at) === Date.parse(checkedAt) &&
        stable(s.evidence) === stable(evidence),
      'review_readback_failed',
    )
  }
  requireThat(
    stable(before.copies.map((c) => c.id)) === stable(after.copies.map((c) => c.id)),
    'copy_set_changed',
  )
  for (const copy of after.copies) {
    const oldCopy = before.copies.find((c) => c.id === copy.id)
    requireThat(copy.protected === oldCopy.protected, 'personal_data_changed')
    const eligible =
      confirmed &&
      !oldCopy.removed &&
      !oldCopy.chosen &&
      ['unknown', 'enrichment', 'corpus'].includes(oldCopy.claim?.origin)
    const entries = after.personal.filter((e) => e.book_id === copy.id)
    if (!eligible) {
      requireThat(
        copy.full === oldCopy.full &&
          stable(entries) === stable(before.personal.filter((e) => e.book_id === copy.id)),
        'reader_choice_changed',
      )
    } else {
      const primary = entries.filter((e) => e.removed_at === null && e.is_primary)
      requireThat(
        copy.series === w.series &&
          copy.position === w.position &&
          copy.count === w.series_count &&
          copy.claim?.origin === 'corpus' &&
          copy.chosen === false &&
          copy.claim.source === result.source &&
          copy.claim.sourceRef === result.sourceRef &&
          primary.length === 1 &&
          primary[0].position === w.position &&
          primary[0].membership_claim?.sourceRef === result.sourceRef,
        'personal_membership_readback_failed',
      )
    }
  }
}

/** Durable write-ahead state: no started/failed lookup or save is ever automatically replayed. */
export async function processItem(work, io) {
  await io.preflight()
  const before = await io.snapshot(work.id)
  requireThat(before.fingerprint === work.fingerprint, 'target_changed')
  const body = lookupBody(before.work)
  if (!body) {
    await io.record('deferred', { code: 'identity_requires_review' })
    return
  }
  await io.record('lookup_started', {})
  const payload = await io.lookup(body)
  const proposal = classify(before.work, payload)
  if (proposal.deferred) {
    await io.record('deferred', { code: proposal.deferred })
    return
  }
  const checkedAt = new Date().toISOString()
  await io.record('proposal', { result: proposal.result, checkedAt })
  await io.preflight()
  requireThat((await io.snapshot(work.id)).fingerprint === before.fingerprint, 'target_changed')
  await io.record('save_started', {})
  const response = await io.save(before, proposal.result, checkedAt)
  const after = await io.snapshot(work.id)
  verifySaved(before, after, proposal.result, checkedAt, response)
  await io.record('verified', { outcome: response.outcome, after })
}
