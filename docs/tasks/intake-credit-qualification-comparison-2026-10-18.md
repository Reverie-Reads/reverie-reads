# Source qualification and contributor comparison — October 18, 2026

This is a read-only, non-LLM shadow comparison on implementation `27a5945`. Add, scanning,
imports and catalog writers remain unchanged. No personal library or reading-history data was
read or written by the comparison. No source was promoted, no metadata was proposed for saving,
and no Luna request was made.

## New frozen sample

The reference reviewer prepared six unseen editions, with six creator-positive cases and six
paired noncreator controls. Parent review independently opened every exact-ISBN publisher page
before acquisition. The reference set contains 17 selected credits and 12 page-count/format facts;
it does not claim complete contributor rosters. One person has two separately supported roles.
Two introduction credits with conflicting page evidence were excluded before freezing and remain
under review. The prior-exclusion manifest covers 137 previously exposed target variants, including
consumed comparisons, unused candidates and development cases. No prior frame was reacquired.

| Source               | Positive identities observed / 6 | Negative controls held / 6 | Negative unobserved | Selected edition credits / 17 | Facts agree / disagree / missing, of 12 |
| -------------------- | -------------------------------: | -------------------------: | ------------------: | ----------------------------: | --------------------------------------- |
| Penguin Random House |                                4 |                          5 |                   1 |                             7 | 8 / 0 / 4                               |
| Hardcover            |                                3 |                          4 |                   2 |                             0 | 4 / 2 / 6                               |
| Open Library         |                                1 |                          4 |                   2 |                             1 | 1 / 0 / 11                              |

There were **zero false identity matches**, zero resolved works/editions, zero proposed fields,
zero writes and zero model calls. A source outage or malformed record is unobserved, not a correct
negative. Hardcover observed seven selected credits only at work scope, with one role/part conflict;
these do not count as edition credits. PRH retained six selected credits as unknown roles and four
behind identity holds. Open Library had three missing selected credits and 13 behind identity holds.

This purposeful contributor stress sample is harder and different from the previous comparison;
its coverage cannot establish a before/after accuracy change. Publisher website references and
publisher API observations share lineage. Agreement is not independent corroboration, a license,
or evidence of general corpus accuracy.

## Duplicate-credit review outcome

The new diagnostics successfully separate two observed failure classes: repeated retained credits
in Open Library and distinct publisher role labels that collapse into the same unsupported internal
role. The latter remains a role-normalization hold, not a conclusion that the books or people are
wrong. Literal rows remain ordered and withheld; neither failure supplies identity or facts. Existing
partial-roster and count warnings survive the failure. No person-ID conflict was observed in this
small sample; synthetic regressions cover that boundary.

The earlier consumed Madame Bovary record cannot be retrospectively resolved: its raw credit rows
were not retained. It was not requested again. The new record demonstrates a class of failure,
not the historical cause of that earlier record.

Remaining publisher gaps include context-specific role-label variants not yet covered by the narrow
verified mapping, unsupported credit roles, one initials-only creator identity, and the normalized
credit collision. Do not relax exact ISBN or creator checks, infer roles from display text, or silently
deduplicate to raise coverage. Any further mapping change needs explicit evidence and a new unseen
comparison; this consumed receipt must retain its observed failures.

Other source holds include title mismatches, an edition/parent-title conflict, malformed edition
identity, unknown formats and ambiguous creator names. PRH remains the most useful edition source
in this bounded sample, with Hardcover useful for work-scoped observations and Open Library offering
limited supplementary coverage. None is qualified for automatic promotion.

## Source-use qualification

The [dated qualification review](intake-source-qualification-2026-10-18.md) is now consumed by source
construction, the transient viewer and durable comparison reports. It separates lookup, transient
review, response cache, durable facts, export and model input. All three sources remain review-only,
with unknown upstream lineage. Open Library documents bounded lookup and caching guidance; this
does not establish downstream rights for mixed contributed content. PRH/Hardcover API-specific
reuse terms remain unverified. Unknown, stale and invalid-date findings retain explicit holds.

## Reproducibility and retention

- Frame SHA-256: `2339d6c392fda5d0ca5107fee8145329c2e46ddec2642d2ebb71cfb385b1148b`
- Acquisition-system SHA-256: `829e92002c401a2454e6e7244f9dd2eddc09e1942d7598374ea7a8756c63494f`
- Prior-exclusion SHA-256: `dc32def14de1c93a165bdaf36242e59c007b3bc146176472eb845530e5f4188a`
- Frozen at `2026-10-18T21:29:44.257Z`; 12 cases, six ISBNs.
- Transport: Open Library 23 requests (six expected edition redirects, 17 successful responses),
  Hardcover six successful requests, PRH 12 successful requests. No access/rate stop.

The private frame, reference decisions, exclusion provenance, lock and aggregate receipt live in
`/Users/gregchism/.codex/private/intake-source-qualification-2026-10-18/`. The permanent Git-common-directory
attempt marker is consumed. Provider observations were inspected through the five-minute read-only
loopback viewer; no provider payload was exported into the durable report. The report retains
policy findings, counts and diagnostic codes, not contributor names, provider person identifiers or role-label literals.

## Validation and budget

Independent review found and closed direct/manual-packet bypasses and name-equivalence gaps in the
new person-conflict guard. Ten additional regressions cover inverted/Latin-accent/apostrophe names,
non-Latin marks, legitimate multiple roles, withheld-credit roundtrips and provider-ID isolation.
The focused five-suite run passed 203 tests. Full unit tests, typechecking, lint, production build
and repository formatting passed. Unit coverage includes 3,478 core tests, 1,354 web tests,
498 source-trial tests and two workflow tests, plus the root budget/stack/completion/recovery checks.
One full browser run is in progress with the default worker count, fresh local database and zero
retries; its final result and local restore verification will be recorded here. Remote CI could not
be read: the required code-review connector returned “Connect your GitHub account to continue.”

The durable budget status remains $20.73931475 committed/reserved historical burden, leaving
$29.26068525 under the $50 ceiling, with zero open reservations and zero unsettled requests. Pricing
is unconfigured, so paid execution remains blocked. This is the local workflow ledger, not an
account-wide invoice audit. New Luna spend in this pass: **$0**.
