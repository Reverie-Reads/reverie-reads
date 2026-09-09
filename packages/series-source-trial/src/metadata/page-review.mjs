import { createHash } from 'node:crypto'
import { validateBenchmark } from './benchmark.mjs'
import { baselineReasonCode } from './field-evidence.mjs'
import { buildMetadataReviewPacket } from './review-packet.mjs'

const fields = ['pages', 'editionFormat']
const providers = ['google', 'openlibrary', 'isbndb']
const tally = () => ({ available: 0, agrees: 0, differs: 0, unscored: 0 })
const count = (into, key) => {
  into[key] = (into[key] ?? 0) + 1
}
const score = (into, value, reference) => {
  into.available++
  into[reference == null ? 'unscored' : value === reference ? 'agrees' : 'differs']++
}

export function validatePageReview(input) {
  if (input?.purpose !== 'development-page-review') throw new Error('invalid_page_review')
  validateBenchmark({ ...input, purpose: 'development-edition-benchmark' })
  return input
}

/** An explicitly separate paid comparison path. Reference truth is used only after routing/admission. */
export async function runMetadataPageReview(
  input,
  { live = false, baselineClient, isbndbClient } = {},
) {
  validatePageReview(input)
  const summary = {
    version: 1,
    experiment: 'page_review',
    mode: live ? 'live' : 'dry_run',
    cases: input.cases.length,
    frameSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    plans: {},
    baselineReviewReasons: { google: {}, openlibrary: {} },
    supplementOutcomes: {},
    supplementReasons: {},
    fieldStates: { pages: {}, editionFormat: {} },
    protectedCurrent: { pages: 0, editionFormat: 0 },
    observations: Object.fromEntries(
      providers.map((p) => [p, Object.fromEntries(fields.map((f) => [f, tally()]))]),
    ),
    proposals: Object.fromEntries(fields.map((f) => [f, tally()])),
    pairedPages: { google: {}, openlibrary: {} },
    transport: null,
    productionWrites: 0,
    modelCalls: 0,
    retention: 'aggregate_only',
  }
  if (!live) return summary
  for (const c of input.cases) {
    const acquired = await baselineClient.acquire(structuredClone(c.identity))
    // No reference or reference URL enters the packet, identity acquisition, or lookup decision.
    const target = { identity: c.identity, current: c.current }
    let packet = buildMetadataReviewPacket(target, acquired)
    count(summary.plans, packet.decision)
    for (const p of ['google', 'openlibrary'])
      if (
        ['identity_review', 'edition_review', 'incomplete_authors'].includes(acquired?.[p]?.status)
      )
        count(summary.baselineReviewReasons[p], baselineReasonCode(acquired[p].reason))
    if (packet.decision === 'lookup') {
      const response = await isbndbClient.lookup(c.identity.isbn)
      packet = buildMetadataReviewPacket(target, acquired, response)
    }
    count(summary.supplementOutcomes, packet.supplement.status)
    if (packet.supplement.reason) count(summary.supplementReasons, packet.supplement.reason)
    for (const f of fields) {
      const field = packet.fields[f]
      count(summary.fieldStates[f], field.state)
      if (field.current.protected) summary.protectedCurrent[f]++
      // Format uncertainty/audio can invalidate page comparisons even if a provider returns a number.
      if (['not_applicable', 'edition_conflict'].includes(field.state)) continue
      for (const o of field.observations)
        score(summary.observations[o.source][f], o.value, c.reference[f])
      if (field.proposedFill) score(summary.proposals[f], field.proposedFill.value, c.reference[f])
    }
    const pageField = packet.fields.pages
    if (['not_applicable', 'edition_conflict'].includes(pageField.state)) continue
    const supplementPage = pageField.observations.find((o) => o.source === 'isbndb')
    if (!supplementPage) continue
    for (const p of ['google', 'openlibrary']) {
      const baselinePage = pageField.observations.find((o) => o.source === p)
      if (!baselinePage) continue
      const reference = c.reference.pages
      count(
        summary.pairedPages[p],
        reference == null
          ? 'unscored'
          : baselinePage.value === reference
            ? supplementPage.value === reference
              ? 'both_agree'
              : 'baseline_only_agrees'
            : supplementPage.value === reference
              ? 'isbndb_only_agrees'
              : 'neither_agrees',
      )
    }
  }
  summary.transport = {
    google: structuredClone(baselineClient.stats.google),
    openlibrary: structuredClone(baselineClient.stats.openlibrary),
    isbndb: structuredClone(isbndbClient.stats),
  }
  return summary
}
