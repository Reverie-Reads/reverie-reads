# Intake title diagnostics — October 20, 2026

This is a review-reporting correction on top of merged #650 and #649. It does not change identity
admission, source qualification, intake writers or stored metadata. No book-provider acquisition,
consumed-frame replay, model call or production operation is needed for this correction.

## Supported diagnosis

`intakeIdentityDiagnostics` previously called joint `admitSourceRecord` with title and ISBN but
without an author. Two defects followed:

- Edition formatting alternatives that require a full creator anchor, such as a bounded descriptive
  suffix or ampersand, could appear as a title mismatch even when the actual full identity check
  accepted them.
- Work-level punctuation and declared subtitle comparisons could appear mismatched because joint
  admission also requires the missing creator. A conflicting ISBN could likewise contaminate a
  title-only diagnosis.

The real identity resolver already supplies the requested full contributors and applies its
Unicode-preserving guard. Its admission decisions are unchanged by this fix. Focused regressions
reproduce the contradictory old diagnostic and check the resulting resolver decisions as well as
the report, with synthetic bibliography rather than reader or provider records.

The title axis now calls the existing shared title comparator directly. Normalized punctuation and
declared subtitles remain separate from the existing edition-formatting alternatives. The latter
are reported as formatting only with a valid requested ISBN, an exact observed edition assignment
and a requested non-initial-only creator anchor. Contributor agreement is still a separate axis;
a formatting title with the wrong author remains an identity hold. Missing context is explicitly
`unconfirmed_edition_formatting`. Significant non-Latin marks remain protected.

`titleDetail` contains one fixed code: `not_requested`, `not_observed`, `literal`, `normalized`,
`declared_subtitle`, `edition_formatting`, `unconfirmed_edition_formatting`, `significant_marks`,
`additional_words` or `different_words`. Additional words mean only an observed word-prefix
relationship with at least two words. The code does not infer a sequel, edition, safe subtitle or
wrong book, and does not remove any words from an identity. No text, fragments, token lists or title
hashes enter aggregate diagnostics. Original text remains available only in the existing transient
review view. Existing shadow reports automatically receive the new fixed detail through their
normal diagnostic projection.

## Retained historical uncertainty

The Hexologists positive in the consumed October 19 comparison remains unresolved. Its raw Open
Library title was not retained. The separate identity decision was also held, so the reporting defect
fixed here does not explain or resolve that historical hold. Its exact cause still needs verified
text; an aggregate diagnostic is insufficient. This correction does not reclassify or rescore that
run. Its 0/1 positive and four held negatives remain historical results. No new matching or
population-accuracy estimate follows from synthetic regressions.

## Verification

Verification results will be recorded on the PR after the full gate and fresh-database,
single-worker, zero-retry browser run. The Mac initially had normal load but elevated memory
pressure; no reset or browser launch is permitted until the existing capacity controls admit it.
Original local data must be archived and verified after recovery under the pinned shared stack lock.

No schema, personal values, copy inventory, reading history, provider permissions or durable Luna
budget changes. Add/scanning/imports still use their existing paths; the new evidence resolver and
adapters remain review-only. The next source comparison needs genuinely new frozen references and
these diagnostics, without replaying consumed identities or treating an API agreement as independent
upstream evidence. The separate photo pipeline retains its physical-device and source-use gates.
