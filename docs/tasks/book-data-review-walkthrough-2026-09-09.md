# Book-data review walkthrough

Date: September 9, 2026. Code inspected at public main
`afcb2a7543a4fce2fb0a9f315c8248bb506dd612`.

## Result

The existing resolver can keep a supported membership while withholding disputed order. The
existing administrator interface already supports source inspection, accept/dismiss and manual
slot editing. The useful next change is **source attribution for a manual order correction**,
not a new database, importer, provider panel or review queue.

This walkthrough stops at the source-review and component-test boundary. It does not claim an
end-to-end persisted correction, a production-qualified model or a new live app feature.

## One development case, no new model call

Selected `gold-a-court-of-silver-flames`, a case already published in development gold and the
September 4 resolver pilot. No qualification identity or private holdout truth was inspected.

Reused the saved development report `resolver-shadow-gold-97-cleaned.json` from the main local
checkout. Its SHA-256 is
`25f169f30546757d87b9fb8e63542cc433f6562a8714250ffc18daaa8daef3eb`.
Only the selected packet and decision were evaluated. The report, model cache, truth and attempt
state were not changed; the original provider output was not copied into this document.

Recomputed evidence grades and provider profiles with the current source cleaner, then ran the
current canonicalizer and validator on the saved decision:

- Membership remained eligible within the trial; position remained unknown.
- Validation passed with all seven cited evidence references present and no policy violations.
- Both in-memory negative controls, forcing position 4 or position 5, were refused by the policy
  validator. A supported membership therefore did not allow the disputed order to slip through.
- These are checks of a saved development packet, not fresh provider measurements or a new
  accuracy estimate. Trial eligibility does not grant production source-use permission.

## Independent human source check

The [publisher's exact edition page](https://www.bloomsbury.com/uk/court-of-silver-flames-9781526602305/)
identifies _A Court of Silver Flames_, Sarah J. Maas and ISBN 9781526602305. Its product details
name _A Court of Thorns and Roses_ as the series; its own title/description identifies this book
as the fifth installment. This is direct publisher content, not a quoted reviewer endorsement.

That supports a human-reviewed membership and publisher-numbered position 5 for this work.
It does not establish a completed series length, resolve every alternative reading-order
convention, or retroactively add a source to the model's saved packet. No catalog value was changed.

## Existing review flow and demonstrated gap

`ReviewRoute.tsx` already displays current/proposed values, separate confidence dimensions,
reasons and evidence links. Its accept/dismiss action reviews an existing stored suggestion; it
cannot import a resolver report or change only part of a proposed tuple.

`CatalogSlotEditor` in `CorpusSeriesCatalog.tsx` already edits a linked work's position and
reading-order label. `useSaveCorpusSeriesEntry` passes the series revision to
`save_corpus_series_entry`. The RPC checks administrator authority and revision, and records
before/after values. Its interface has **no source-URL or review-rationale parameter** for the new
order claim. An editor identity and change audit are not the citation supporting that correction.
The reading-order label is display copy, not a substitute evidence field.

Two existing component-test files passed all five tests: corpus-series review and shared-series
catalog interfaces. They exercise evidence-link rendering, explicit accept/dismiss, revision-bearing
slot-edit dispatch, reader read-only controls and explicit archive confirmation. They use mocked
mutations; they do not prove database persistence, stale-transaction refusal or reader-choice
protection in a live browser. No actual publisher data was sent to those mocks or to Supabase.

## Narrow follow-up

Add a cited-source URL and short review rationale to the existing administrator order-correction
flow, bound to the exact entry, new value and expected revision. Preserve membership provenance
separately from the changed position; reuse existing claim/audit structures where suitable.
Render the attribution safely for later review rather than hiding it in a reading-order label.
Do not treat a supplied URL as verified merely because it parses, or fetch it on the server.

Before shipping that change, test persisted attribution, stale edits, non-admin refusal, null
positions, personal reader/import protections and the actual browser flow. A write-behavior
migration remains owner-deployed. This follow-up is identified, **not implemented by this report**.

No paid provider/model call, qualification run, production read/write, migration, deployment or
billing change occurred. Pro edition comparison remains with the other thread.
