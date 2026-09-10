# Open Library title handling: offline policy comparison

## Decision

Reject broad subtitle stripping. Keep the current matcher and frozen Open Library client unchanged.
A narrow, exact repeated-subtitle rule is mechanically plausible but not yet justified by live
evidence. Do not add another provider diagnostic or run another sample merely to look for it.
The two Open Library title mismatches in #517 remain unexplained: its aggregate-only report cannot
establish which representation, qualifier or conflicting identity caused either rejection.

At merged #517 (`1e3a7adb93c7bce4051b144dfef755c7ef040539`), 34 constructed scenarios were exercised
under three policies: **102 expected-result checks passed**. These numbers describe a deliberately
adversarial synthetic matrix, not real books, measured accuracy, coverage lift or production safety.

| Offline policy                                 | Review-only candidates | Identity-review packets | Unavailable | Page conflict | Audio not applicable | Protected agreement without candidate |
| ---------------------------------------------- | ---------------------: | ----------------------: | ----------: | ------------: | -------------------: | ------------------------------------: |
| Current unchanged client                       |                      4 |                      28 |           2 |             0 |                    0 |                                     0 |
| Exact repetition only, then all existing gates |                      8 |                      20 |           2 |             2 |                    1 |                                     1 |
| Broad qualifier stripping counterexample       |                     15 |                      13 |           2 |             2 |                    1 |                                     1 |

The extra seven candidates from broad stripping include missing or changed subtitles, abridgement,
graphic adaptation, volume qualifiers, partial repetition hiding abridgement, and duplication of an
entire title. These are seven **unjustified admissions**, not seven independently established wrong
real-world books. A returned ISBN and matching author must not erase conflicting title evidence.

## Method and reproducibility boundary

Imported the unchanged `createEditionPageClient` and `buildEditionPagePacket` into a local Node
exercise. Each policy/scenario used a fresh client, injected JSON responses, fixed clock and no-op
sleeper. Global fetch threw on any attempt; unknown mock routes were counted and required to remain
zero even if the client swallowed their exception. There were no environment-file reads, credentials,
provider requests, reference lookups, historical identities, qualification data or model calls.

The toy identity was `The Lantern Archive: A Novel`, author `Ada Example`, language `en`, paired
only synthetically with existing checksum-valid ISBN fixture `9780316565202`. This is not a claim
about the actual book assigned that ISBN. The second valid ISBN fixture was `9781250890313`.
Default Google search/detail responses used the complete toy title, author and 300 pages; default
Open Library used `The Lantern Archive` plus `A Novel`, exact ISBN, one resolved author, English,
paperback and 300 pages. Google remained matched in every execution, isolating Open Library's effect.

The current policy ran first. Each hypothetical policy transformed a fresh copy of the **mock
edition body only when the original result was identity review with `title_mismatch`**, then ran
the real client and packet gates again. This is an offline counterfactual, not a deployed adapter,
retry algorithm or permission to alter provider evidence. The original body was asserted unchanged.

- Exact repetition: bounded nonempty string title/subtitle; normalized raw title equals the complete
  expected title; that raw title ends with a space-delimited normalized subtitle and has preceding
  title text. Remove only the separate duplicate subtitle in the mock. Preserve all other fields.
- Broad counterexample: the normalized portions of raw and expected title before `:`, en dash or
  em dash agree. Remove the subtitle and replace the raw title with the expected full title in the
  mock. This deliberately models an unsafe matcher that discards qualifiers and disguises the
  discarded evidence; it is not implemented in the product.
- Normalization mirrors the existing NFKD/accent removal, lowercase, punctuation-to-space and trim
  behavior. No fuzzy matching or model inference is involved. Malformed and earlier-failing records
  do not enter either transformation; the overlong assembled-title control stays rejected.

The [machine result](openlibrary-title-offline-results-2026-09-09.json) contains synthetic scenario
labels and the asserted status/reason/packet/candidate matrix. Each policy made 135 calls to the
in-memory fetcher, not HTTP requests. The deterministic exercise was executed twice, passing the
same expected assertions; these are two executions of 102 checks, not 204 independent scenarios. The local
probe SHA-256 is `194ef0fcfff527cb0d437e39e71aee3660312cd12f23a2372196bb1cbd7e7b70`.
It is an ad hoc assessment, not a newly installed CI regression suite; only this report and the
synthetic result are committed. Any future implementation must add ordinary regression tests.

## What the checks establish

Full title, split subtitle, normalized case/accent/punctuation and blank subtitle already work.
Exact repeated subtitles fail in the existing assembly. The narrow counterfactual recovers four
candidate scenarios: exact repetition, normalized repetition, repetition after an approved
same-origin redirect, and repetition with missing language. The last is an existing policy
limitation, not language certification: absent observed language is currently tolerated.

No LLM is needed for the demonstrated string comparison. An LLM cannot supply the missing raw
evidence from an aggregate rejection or turn an unresolved title conflict into a verified identity.

Clearing a title failure is not enough to approve a record:

- Wrong or extra resolved authors then expose `contributors_mismatch`; French exposes
  `language_mismatch`. Their original first failure was title mismatch.
- Missing authors, invalid or mixed ISBNs, malformed language, unknown binding and a mismatched
  author-record key remain blocked before any title repair can occur.
- Both 404 and 503 author lookups remain `incomplete_authors` / unavailable. Missing author evidence
  never becomes absence of a book, a successful partial contributor list or an LLM-fillable gap.
- An audio binding becomes not applicable to pages. Conflicting source page counts or current
  page values remain conflicts. An agreeing existing value stays protected and yields no fill.
- Missing/changed subtitles, adaptation, abridgement, volume qualifiers, partial repetition,
  different base titles, malformed subtitles, excessive assembled length and duplicate whole-title
  text do not gain narrow-policy admission.

Every execution asserted Google match, Open Library status/reason, packet state, candidate presence,
current-value preservation, `automatic === false`, and the packet's serialization refusal. Blocked
identity/unavailable/audio packets had no page observations; rejected Open Library results had no
admitted record. Candidate toy values were exactly 300. Mock routes and request totals reconciled.
The positive split-title control demonstrates the instrument can detect candidates; the qualified
title counterexamples demonstrate why a larger candidate count is not necessarily an improvement.

## Implementation evidence and next boundary

- [Open Library assembly and author/format/language admission](https://github.com/Reverie-Reads/reverie-reads/blob/1e3a7adb93c7bce4051b144dfef755c7ef040539/packages/series-source-trial/src/metadata/baseline-client.mjs): `fullTitle`, `admit`, `openlibrary`.
- [Exact identity and first-failure order](https://github.com/Reverie-Reads/reverie-reads/blob/1e3a7adb93c7bce4051b144dfef755c7ef040539/packages/series-source-trial/src/metadata/supplement.mjs): `identityReviewReason`, `sameAuthors`, `language`.
- [Edition client delegates to the frozen Open Library path](https://github.com/Reverie-Reads/reverie-reads/blob/1e3a7adb93c7bce4051b144dfef755c7ef040539/packages/series-source-trial/src/metadata/edition-page-client.mjs): `createBaselineClient` and `acquire`.
- [Joint packet, current-value and audio/conflict protection](https://github.com/Reverie-Reads/reverie-reads/blob/1e3a7adb93c7bce4051b144dfef755c7ef040539/packages/series-source-trial/src/metadata/edition-pages.mjs): `buildEditionPagePacket`.

Unlike the separate Google detail path, the Open Library result exposes only a rejection reason
after dropping the raw record. A caller cannot infer a subtype from `title_mismatch`. Adding one
would require a separately reviewed evidence seam or new adapter; changing the frozen baseline
or performing another fetch to reconstruct its rejected record is not justified here. Do not copy
the whole client just to collect another diagnostic.

Close this title-investigation branch with unchanged admission. The useful next product decision
is how independently admitted provider evidence should be presented for explicit administrator
review when another provider is unresolved or conflicting—not automatic promotion, a relaxed join,
or model-generated repair. That requires a separate review of the existing metadata-review flow
and its provenance/privacy/write gates before implementation. No UI or data-model change is part
of this assessment. Series-classification and gold-qualification gates remain separate.

## Verification and scope

Repository non-browser validation passed: 403 trial tests, 2,708 core tests, 909 web tests and one
compiler-backed Workflow integration test, plus typecheck, lint, build, formatting and diff checks.
Independent matrix-total and probe-hash checks also passed. The build retained its
expected local-URL and bundle-size warnings; it is not a production deployment check. Committed scope is documentation only, so fresh
browser E2E is explicitly exempt under AGENTS.md. No runtime, CI configuration, app/core/Supabase,
production checkout, billing, local database, provider data, frozen frame, lock or attempt marker
was changed. No paid acquisition or model call was made. The other active chat was notified before
work and again with the exact two-document scope before publication. No public PR was open at
the pre-publication conflict check; this work does not touch the private-overlay sync files.
