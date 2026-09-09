# Recent-edition gap-seeking metadata trial: preregistration

Registered before any tested-provider request on this frame. Development only; no production,
model training, qualification run, or automatic metadata correction.

## Question and selection

Does the unchanged selective path reach ISBNdb on recent editions, and do any proposed missing
page/format fields agree with independently reviewed publisher references? The earlier 20-edition
run reached zero ISBNdb lookups; its completed inputs and results remain untouched.

This is a deliberately small, nonrandom, single-publishing-group challenge set: ten English
editions across four works/authors. Four 2026 paperbacks are paired with their 2025 hardcovers;
two 2025 audiobook editions are controls. Recent publication is only a hypothesis for less complete
baseline metadata, **not prior knowledge that a gap exists**. We have not screened Google, Open
Library, or ISBNdb responses to choose these cases. There is no claim of representative coverage,
ten independent works, or catalog-wide precision. No previously selected identity was excluded
because of a tested-provider result.

All eight print cases have an empty current state. Both audiobook cases have only their
publisher-confirmed audiobook format as a controlled current value; pages remain null/unscored.
That deliberate known-format control checks protection and audio applicability, not reader data.
No baseline field is hidden, cleared, or masked to force a paid request. These are edition/subtitle
and contributor-risk challenges, not pre-labelled live identity-conflict outcomes.

The expected full title retains the publisher catalog's `A Novel` subtitle. The Dream Hotel audio
also retains its catalog's `A Read with Jenna Pick` title wording. Consumer product headings often
omit these words; that representation difference is documented before the run, not normalized away
after observing a rejection. Only explicitly credited authors enter expected authorship; narrators
are not silently equated to authors. The runtime will still review any undifferentiated extra
contributors or unmatched qualifiers.

## Independent references

Only bibliographic facts were transcribed; no publisher descriptions, excerpts, praise, covers,
or review text are retained. The API receives ISBN/title/authors/language only, never reference truth.

| Work | Paperback | Hardcover | Other control |
| --- | --- | --- | --- |
| The Dream Hotel — Laila Lalami | [Publisher catalog](https://penguinrandomhousehighereducation.com/book/?isbn=9780593469804), 336 pages | [Publisher retail catalog](https://www.penguinrandomhouseretail.com/book/?isbn=9780593317600), 336 pages | [Publisher audio catalog](https://penguinrandomhousehighereducation.com/book/?isbn=9798217076406); pages unscored |
| Audition — Katie Kitamura | [Publisher catalog](https://penguinrandomhousehighereducation.com/book/?isbn=9780593852347), 208 pages | [Publisher catalog](https://penguinrandomhousehighereducation.com/book/?isbn=9780593852323), 208 pages | [Publisher audio catalog](https://penguinrandomhousehighereducation.com/book/?isbn=9798217021338); pages unscored |
| The Antidote — Karen Russell | [Publisher product page](https://www.penguinrandomhouse.com/books/750408/the-antidote-by-karen-russell/), 432 pages | [Publisher edition listing](https://penguinrandomhousehighereducation.com/2025/12/09/national-book-awards-winner-and-finalists/), 432 pages | [Catalog subtitle/edition mapping](https://penguinrandomhousehighereducation.com/book/?isbn=9798217018635) |
| The Loneliness of Sonia and Sunny — Kiran Desai | [Exact-ISBN publisher page](https://www.penguinrandomhouse.com/books/212138/the-loneliness-of-sonia-and-sunny-by-kiran-desai/9780307744555/), 688 pages | [Publisher catalog](https://penguinrandomhousehighereducation.com/book/?isbn=9780307700155), 688 pages | None |

These references are independent of the tested responses, not proof of independent upstream feeds.
There are eight scored page references and ten scored format references. Null is unscored, never
agreement. References/identity choices are frozen before acquisition.

## Isolation and lock

The owner-only, Git-ignored input is `private-inputs/metadata-gap-10-2026-09-08.json`.
Canonical JSON SHA-256:

```text
5027f82d414c7bbf6cc7dc832aac5c82438a9b5b61acaebe02e60e14ea386367
```

An in-memory identity-only comparison found zero ISBN overlaps with the completed 20-edition input
and zero author overlaps with the 1,180-case private qualification candidate pool. No qualification
truth or identities were displayed or copied. The earlier 12-edition comparison is not pooled with
this run; its private input was not located during this preparation, so no fresh exhaustive overlap
claim is made for that older comparison.

All runtime files are unchanged from merged #488, based here on `c9f457f`. The commit that first
adds this registration is the exact run lock. An ignored single-use wrapper must check that commit,
clean tracked tree, and input hash, then exclusively create a start marker **before** network calls.
It writes one aggregate result exclusively and never retries a completed/started run. Do not change
the frame, source references, runtime, or request policy after acquisition starts.

## Request limits, outcomes, and stop rules

- At most 10 Google HTTP requests, 40 Open Library HTTP requests (including author/redirect hops),
  and 8 selective ISBNdb HTTP requests. Existing keys/subscription only; no upgrade or purchase.
- Existing fixed hosts, 1.1-second provider pacing, 15-second deadlines, payload bounds, no retries,
  and provider stop rules remain unchanged. Incomplete baseline attempts are not gaps. Identity or
  binding review blocks paid lookup. Existing values are protected and conflicts remain conflicts.
- Report version-2 aggregate outcomes, first-failing review reasons, per-field descriptive states,
  protected-current counts, candidate/reference agreement, conflicts, requests, and elapsed time.
  Do not persist identities, values, URLs, payloads, or case-level outcomes from the tested APIs.
- No minimum paid-call count: zero eligible lookups is a valid result. No additional cases, title
  edits, masked baselines, alternate endpoint, or direct ISBNdb bypass may be added to rescue yield.
- A returned exact identity does not certify any field. Every candidate is review-only. Any
  disagreement blocks a production-readiness conclusion; even perfect agreement on this tiny,
  conditional sample cannot clear accuracy, rights, latency, or user-review gates.
- If no useful candidates emerge, use only the aggregate diagnostics to propose the next separate
  experiment; do not rerun these inspected cases to claim improvement.

There are no LLM, Exa, PRH API, Supabase, corpus, or personal-row calls/writes. Request counts are
the cost proxy; this trial does not read billing, assert a remaining credit balance, or invent a
per-request subscription price. This branch changes documentation/results only; it reuses the
tested runtime and requires no production migration or deployment.
