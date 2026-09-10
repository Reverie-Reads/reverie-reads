# Google repeated-subtitle diagnostic

## Scope

Implements the Google-only diagnostic recommended by merged #515. This does not normalize titles,
accept more identities, fill metadata, infer binding, or change production. It observes the
constructed representation failure documented in the synthetic review; it does not establish the
cause or frequency of any rejection in a completed live sample.

The new transient `titleDiagnostic: repeated_subtitle` appears only after Google admission has
already returned the original `title_mismatch` reason, when all of these hold:

- Raw title, subtitle and expected title are bounded strings.
- The subtitle contains normalized text, not just punctuation or whitespace.
- The raw title equals the complete expected title under the existing normalization.
- The raw title ends with a space-delimited exact normalized subtitle and has a preceding title.

For example, a raw title `The Lantern Archive: A Novel` with a separate `A Novel` subtitle is still
rejected after assembly produces a repeated phrase. The diagnostic describes that representation;
it does not remove the phrase. A partial-word suffix, different qualifier, malformed field, or
earlier ISBN/shape failure does not receive the tag. As before, identity matching stops at the
first failed field, so unexamined contributors or language can also be wrong. This is not a claim
that duplication is the only defect or that the record is otherwise safe.

## Output and compatibility

Edition-page reports now have version 3 and diagnostics version 2. Existing reason, terminal-stage,
packet-format and candidate histograms retain their meanings. The additional `googleTitleMismatch`
histogram groups only Google identity-review title mismatches by the same terminal stage and then
by `repeated_subtitle` or `other`. Unknown subtype values become `other`; unrecognized stages become
`unknown`. Arbitrary provider text cannot become a key. On real client results, the new bucket
total reconciles with the Google `title_mismatch` reason count.

The Google client naturally carries the enum through its existing search/detail return path.
Search rejection still prevents detail fetching. Detail rejection still withholds the joint packet,
including an otherwise matching Open Library observation. Current reader values remain protected.
Removing the diagnostic from an acquired result produces the same packet and candidate decision.

The normalizer used for this observation mirrors the frozen identity normalizer locally; it is
not imported into or substituted for admission. The baseline/study modules, consumed locks,
attempt markers and prior reports are unchanged. Old report schemas stay historical, not backfilled.
No raw title, subtitle, ISBN, author, response, credential or case-level provider output is added
to persisted reports. There is no new request, retry, cache, provider, model or writer.

## Verification

Six added tests cover normalized positive shapes, partial/qualified/malformed negatives, ISBN and
shape precedence, coexistence with other identity contradictions, search/detail mock orchestration,
and fixed-enum nonmutating aggregation. They assert the rejection and candidate consequences,
not merely the presence of a label. Positive mock reports withhold candidates and both providers'
observations, retain original reasons, and contain no fixture identity or credential strings.
The focused edition-page suite passes all 36 tests.

An additional offline differential check exercised 7,680 combinations of title, subtitle, author,
ISBN and language against the admission function at merged #515 (`e304ddedf9de46886e1ea34cda8c0e4dd23a6962`).
All admission results were identical after removing the new optional enum; 72 combinations emitted
the enum and remained rejected. This checks behavioral parity, not provider frequency or accuracy.

The complete non-browser gate passes: 403 trial tests, 2,708 core tests, 909 web tests and the
compiler-backed Workflow integration test, plus typecheck, lint, build, formatting and diff checks.
The build retains its expected local-URL/bundle-size warnings and is not deployment verification.
The required fresh default-worker, retries-zero full browser run is in progress; its result will be
recorded before completion. No fresh provider sample is included. Before measuring this diagnostic on live data,
freeze a new independently reviewed sample and system lock; neither prior edition pilot may be
replayed. Diagnostic frequency alone would still not justify automatic repair or qualification.
