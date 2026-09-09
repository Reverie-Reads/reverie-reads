# ISBNdb subscription-value decision: keep for targeted metadata support

**Recommendation: keep the $14.99/month Basic subscription for targeted, review-only edition
metadata support; do not adopt ISBNdb-first or promote the broad joined packet to production.**
ISBNdb's contribution was material, not marginal: the selective policy correctly improved 38 of
100 distinct works, versus 25 for ISBNdb-first. Pages and binding are the useful capabilities.
Publisher normalization, conflict handling and preservation of existing correct fields still
need work. This is a procurement recommendation, not production rights or deployment clearance.

The owner authorized this evaluation before further ISBNdb contact. No provider contact,
production write, deployment, subscription change, renewal or cancellation was performed.

## Completed comparison

The [prospective plan](isbndb-value-study-plan-2026-09-09.md) and
[dataset/system lock](isbndb-value-study-lock-2026-09-09.json) were committed and pushed before
acquisition. Five ordered, single-use cohorts completed on September 9, 2026, from
16:56:37 to 17:03:14 UTC. The same in-memory observations supported all three policies; these
were not three separately acquired or timed workflows. See the
[validated aggregate result](isbndb-value-study-results-2026-09-09.json).

| Policy                           | Admitted editions | Additional correctly improved works | Regressed works | Works with a selected reference-mismatching value |
| -------------------------------- | ----------------: | ----------------------------------: | --------------: | ------------------------------------------------: |
| Free-only: Google + Open Library |                91 |                            Baseline |               0 |                                                66 |
| Selective ISBNdb                 |                92 |                              **38** |              20 |                                            **29** |
| ISBNdb-first                     |                92 |                                  25 |              20 |                                                66 |

An improvement means at least one new reference-agreeing field, no previously correct field lost,
and no wrong/unscored/unsupported-precision value emitted for that work. It does **not** mean a
complete corrected record: a conflicting field can remain withheld while another field improves.
A regression means a previously correct field became conflicting, missing or mismatching; it is
not necessarily a newly asserted false value. These are simulated policy outcomes, not writes.
Gains and regressions affect different works and should not be hidden inside a single net score.

The final column is the instrument's `wrongValueWorks`. It counts exact reference mismatches,
including publisher strings. Imprint/parent naming and punctuation can create such mismatches;
they are not all independently established factual errors. No post-result alias normalization or
case-level reclassification was performed to improve a policy's score.

Both paid policies clear the prospective 10/100 useful-work floor without increasing this
mismatch-work count over free-only. Selective use provides more qualifying gains and fewer
selected mismatches, so it is preferable among the three tested policies. Its 20 regressions
still prevent endorsement of the current broad join as an automatic catalog updater.

## What ISBNdb contributes

Reference-agreeing field observations after each provider's independent exact-identity guard:

| Provider     | Admitted / 100 |  Pages | Format | Publisher string | Publication date | Language |
| ------------ | -------------: | -----: | -----: | ---------------: | ---------------: | -------: |
| Google       |             90 |      0 |      0 |               35 |               83 |       90 |
| Open Library |             30 |     14 |     13 |               16 |                0 |       22 |
| ISBNdb       |             85 | **79** | **85** |               26 |               81 |       85 |

ISBNdb supplied 85 reference-agreeing bindings from 85 admitted editions, and 79 agreeing page
counts with six page mismatches. It added only **one** admitted identity beyond the free union.
Its value here is edition-field quality and completeness, not discovering many more works.
The two audiobook controls were not admitted by ISBNdb; audio quality is not established.

Google's page results are an important warning: 69 mismatches, 31 missing/withheld, zero exact
agreements in this frame. The unchanged adapter reads `volumeInfo.pageCount` and the scorer
compares numeric counts; a read-only code review found no field-remapping change introduced by
this study. The underlying cause was not diagnosed: raw responses were not retained and completed
cases were not queried again. Do not treat those counts as safe exact-edition values merely because
ISBN/title/author matched. This anomaly can inflate the advantage over the current free join; an
optimized free policy was not tested. Even separately, Open Library supplied only 14 agreeing page
observations and 13 agreeing formats in this frame.

The broad join illustrates why source-specific treatment matters:

- Selective use raised agreeing formats from 13 to 86 with no format mismatch or conflict.
- Agreeing pages rose from 1 to 18, but page conflicts rose from 17 to 67. ISBNdb-first recovered
  79 agreeing page values, while selecting ten page mismatches including fallback results.
- Selective publisher conflicts rose from 17 to 52 and publisher agreement fell from 32 to 13.
  ISBNdb-first selected 64 publisher-string mismatches. A paid source should not replace a trusted
  publisher/imprint value solely because it returned a value.
- Google already supplied substantial date/language coverage. Those are not strong reasons to
  prefer ISBNdb wholesale.

**Implementation direction, not an additional tested policy:** use ISBNdb as an exact-ISBN
pages/binding candidate source; preserve existing trusted metadata, leave conflicts for explicit
review, and handle publisher/imprint aliases separately. Do not use an LLM to certify unsupported
values. A field-scoped, preservation-safe policy needs its own implementation verification before
production. This completed study will not be rerun to tune it.

Covers, descriptions and other ISBNs were availability-only observations. ISBNdb had cover hints
on 85 admitted records, descriptions on 84 and other-ISBN hints on 72. No quality, rights, safe
edition relationships, review-time savings, graph/embedding value or additional economic benefit
is claimed for them. No such content was persisted or sent to a model.

## Subscription economics

The owner-reported fee is $14.99/month. Expected monthly distinct-work volume and the owner's
maximum acceptable cost per added correct work remain unspecified. The following are illustrative
subscription-only projections from the observed qualifying-gain rates, not measured production
costs, demand forecasts or a guarantee that every month's mix will behave the same way.

| Fresh distinct works processed per month | Selective: projected gains / cost per gain | ISBNdb-first: projected gains / cost per gain |
| ---------------------------------------- | -----------------------------------------: | --------------------------------------------: |
| 100                                      |                                 38 / $0.39 |                                    25 / $0.60 |
| 500                                      |                               190 / $0.079 |                                   125 / $0.12 |
| 1,000                                    |                               380 / $0.039 |                                  250 / $0.060 |

At the selective study rate, approximately 158 / 395 / 789 fresh works per month would be needed
to reach illustrative $0.25 / $0.10 / $0.05 subscription costs per additional correctly improved
work. Integration, maintenance, human review, taxes and other service costs are excluded. The
20 regressed works per 100 are not priced away. Very low recurring volume could still make a
subscription poor value after the initial catalog work is finished.

The named "selective" policy was **not selective in request volume here**: free data was never
complete across all five required fields, so it modeled 100 ISBNdb lookups, the same as ISBNdb-first.
ISBNdb-first modeled only 15 Google and 15 Open Library edition lookups, versus 100 each for the
other policies. These are logical lookups, not Open Library's actual multi-request transport count
or separately observed workflow latency. Reducing paid requests does not itself reduce a fixed
subscription bill.

Actual acquisition used **100 Google, 247 Open Library HTTP and 100 ISBNdb requests**, within the
100/400/100 ceilings. There were no authentication, quota, timeout, network or server-error
outcomes and no stopped cohorts. Wall time was about 6 minutes 37 seconds; summed baseline
acquisition was 371.972 seconds and ISBNdb acquisition 17.505 seconds. These include the trial's
sequential transport/pacing and are not production latency measurements for the three policies.

The read-only account check showed Basic and 5,000 daily calls. Its spent counter was 8 before and
106 afterward, a delta of 98 versus 100 observed requests (two ISBNdb results were not found).
Do not infer a billing/refund rule from that coincidence. Remaining quota was 4,894; no separate
cash charge, account-specific renewal timestamp or tax amount was verified or changed.

## Boundaries and confidence

The frozen reference set contains one edition for each of 100 works: 62 paperbacks, 35 hardcovers,
one ebook and two audiobook controls. Five confirmed publishing groups are represented, but 69
works belong to PRH; all reference pages share its publishing/distribution channel. Edition dates
span backlist and recent releases; the frame includes fiction, nonfiction, youth books and
translations. All 98 verified languages are English. Audio pages are not applicable and both audio
languages remain unknown. This is a convenience sample, not an unbiased all-books benchmark.

The plan records the pre-acquisition reference-frame expansion, parser repairs, complete selection
counts and missing older overlap frame. The ISBN/normalized-title audit found no selected overlaps
with located completed metadata frames or private qualification identities; the unavailable older 12-edition frame
prevents an exhaustive historical non-overlap claim. No prior trial's results were pooled here.
Publisher references themselves can contain errors. Strict title/contributor admission, publisher
string matching and unsupported natural-language dates also limit what this instrument measures.

The aggregate's `decision: not_qualified` is intentionally unchanged: it is a **production
qualification flag**, not this report's keep/drop recommendation. Source-use/retention clearance,
production safety, representative accuracy and measured review-time gates are not cleared by a
completed development study. The [source-use review](isbndb-source-use-review-2026-09-08.md) remains
applicable. API access and owner permission to evaluate are not a broad data-use license.

## Verification and handoff

- Runtime/scope commit: `c4a09a8`; lock commit: `5a64af6`, pushed before the first book request.
- Re-merging the five durable cohort aggregates without acquisition exactly reproduced the result;
  canonical result hash: `26b53fdb06be958871ce1516690877c486019d4d51710288ce8be82a2ccce1ca`.
- Shared Git-directory attempt state remains intact. No cohort retry, replacement, cache refresh,
  alternate-state run, scoring change or completed-frame reacquisition occurred.
- Lint, typecheck, build and unit tests passed: 367 trial, 2,695 core, 899 web, plus the compiler-backed
  Workflow integration test. Final exact-scope guard tests: 21 passed.
- One fresh-local-database full browser suite at default one worker, retries zero: **265 passed,
  10 skipped, zero failed**, 22.7 minutes. The shared stack lock was released and the other chat notified.
- Retained study output is aggregate-only. Private references contain publisher facts/URLs/hashes,
  not tested-provider records or raw page bodies. Application model/Exa calls and production writes: zero.

**Final decision: keep ISBNdb in the toolbox for pages and formats, with review and preservation
guards. Do not make it the primary catalog source, do not automatically deploy the tested broad
join, and do not credit unmeasured cover/description potential as justification.** Billing stays
with the owner. No additional ISBNdb contact was needed to reach this value decision.
