# Reverie series-source trial

Current authority-correction work: [source checks and gated integration plan](../../docs/tasks/authority-automatic-correction-gates.md).
The scout now requires per-source relationship names/types/positions. Legacy proposals are only
offline regression material; neither validation success nor an LLM label authorizes catalog writes.

This package compares book-series data providers against the same cases and acceptance policy.
It does not write to Supabase or modify Reverie's corpus.

## Exact-edition page evidence (trial only)

`metadata:pages` evaluates a separate Google detail plus Open Library exact-edition path.
It does not change the consumed subscription study runtime or production enrichment.

```sh
pnpm --filter @reverie/series-source-trial metadata:pages --help
pnpm --filter @reverie/series-source-trial metadata:pages --input data/edition-pages.example.json
```

The fixture is fictional and dry-only. A reviewed development frame uses purpose
`development-edition-pages` and 1–20 distinct ISBN cases, each with `identity`, `current`, and
an independently reviewed publisher `reference` (the fixture shows the shape). References are
offline scoring data, never fetched by this command or passed to acquisition. Unknown facts stay
null. Human review must exclude qualification cases and previously used development works,
including translations and retitled editions that exact normalization cannot identify.

Live mode additionally requires `--live --consumed-frame <original-100-work-frame.json>`.
Before loading credentials it authenticates that complete frame against the committed consumed
study lock and refuses overlapping canonical ISBNs or normalized base titles. This is read-only
exclusion, not permission to repeat, reset, reinterpret, or partially replay the old study.
The guard does not replace human overlap review against other development/qualification frames.
Do not relabel the synthetic fixture's `.example` reference to make it live.

Credentials use the existing `GOOGLE_BOOKS_API_KEY` (or `GOOGLE_BOOKS_KEY`) and optional
`GOOGLE_BOOKS_REFERRER`, loaded from package `.env.local` or `--env <local-env-file>`.
Google receives at most two calls per edition: one bounded ISBN search, then one detail call only
after a unique returned ISBN/full-title/full-author match. The detail must repeat that identity,
safe volume ID, and language observation. Only positive integer detail `pageCount` in 1–20,000
is observed; neither search pages nor `printedPageCount` is a fallback or an independent vote.
The existing exact-ISBN Open Library path resolves every author and validates every returned ISBN;
work-level median pages are never used. Its default 80 HTTP-request ceiling includes author and
redirect hops; `--max-openlibrary-requests` can set 1–200. Google has fixed-host/manual-redirect,
15-second timeout, 512-KiB response, pacing, no-retry and stop-on-access/rate-limit safeguards.

The memory-only packet records field-level source, endpoint, source identifier, target ISBN,
time, value, and state. Cross-provider agreement is **not proven independent lineage** and never
automatic eligibility. Ambiguity, edition conflicts, unavailable providers and audio withhold a
candidate; a completed provider miss can leave a one-source review candidate. Existing pages are
protected, disagreement remains visible, and all output remains review-only. This evaluation
queries protected cases to measure conflicts; it is not yet a gap-only production policy.

Only aggregate counts, request/status/time metrics and the input hash reach stdout. Acquisition
wall time includes pacing; transport time measures requests alone. Provider
payloads, values, identities, URLs and credentials are not persisted; packet JSON serialization
is refused. There is no cache, corpus/personal patch, Supabase writer, ISBNdb request or model call.
Report version 2 adds fixed-vocabulary diagnostic histograms: provider reason (first failure only),
Google terminal stage, packet format evidence, candidate source and candidate format evidence.
These are marginal counts, not per-book traces or independent provider coverage. Missing reasons
count as `none`; unknown codes count as `other`. A Google terminal stage names the branch that
returned, not proof a request occurred (a stopped provider can return `not_attempted`). Unknown
binding is not a certified format, and blocked packets report format as unavailable even if one
provider supplied it. Current format may contribute to packet format; reference format never does.
Candidate counters include only emitted candidates, not protected current values. No gate is relaxed.

Report version 3 (diagnostics version 2) adds `googleTitleMismatch`, a bounded stage-to-category
histogram for Google's `identity_review` / `title_mismatch` returns. Its only categories are
`repeated_subtitle` and `other`; stage keys use the existing vocabulary including `unknown`.
The repeated-subtitle observation requires a valid nonempty subtitle, the raw title matching the
complete expected title under existing normalization, and that subtitle repeated as an exact
token-boundary suffix of the raw title. It does not strip or repair text. The original rejection
reason, candidate eligibility and search/detail request sequence remain unchanged. Later identity
checks may also have failed: the label describes text packaging, not the sole cause or a safe match.
Only enum counts persist; raw title/subtitle remain transient. Open Library and frozen baseline
modules are not instrumented by this addition. See the
[implementation and verification](../../docs/tasks/google-repeated-subtitle-diagnostic.md).

The completed [16-edition comparison](../../docs/tasks/edition-page-comparison-report-2026-09-09.md)
had one reference difference among three candidates and did not clear automatic filling. Its
version-1 report and frozen runtime hashes remain unchanged; do not rerun it with diagnostics or
backfill invented reasons. Mocked transport tests establish diagnostic behavior, not live quality.
The completed [ten-edition diagnostic sample](../../docs/tasks/edition-diagnostic-sample-report-2026-09-09.md)
also remains consumed; its report-v2 artifacts and locks must not be upgraded or replayed.
A new independently reviewed and registered sample is required for further live evaluation; see the
[Google diagnostic and implementation boundary](../../docs/tasks/google-edition-diagnostics.md).

## ISBNdb subscription-value evaluation (trial only)

**Owner decision, September 9: drop ISBNdb from the planned source stack.** The completed
[100-work comparison and decision](reports/isbndb-value-study-results-2026-09-09.md) remain an
audit record, not authorization for another live run. The commands below document the retained
harness; no further ISBNdb acquisition without new owner approval. The study changed neither
billing nor production. The separate [retirement patch and audit](../../docs/tasks/isbndb-retirement.md)
remove the live adapter in code; deployment and any retention cleanup remain owner-controlled.

`metadata:value` asks whether the recurring fee buys meaningful additional utility, rather than
whether a narrowly gated lookup can fill a page or binding gap. It independently evaluates Google,
Open Library, and ISBNdb against each reviewed ISBN/title/full-author identity. A failure or mismatch
from either free provider does not block the independent ISBNdb observation. Exact ISBNs, complete
author agreement, title qualifiers, and known binding/language checks are not loosened.

Run the fictional fixture without keys or network requests:

```sh
pnpm --filter @reverie/series-source-trial metadata:value --input data/metadata-value.example.json
pnpm --filter @reverie/series-source-trial metadata:value --help
```

This fixture's ISBN is checksum-valid but its title/author are fictional. Live mode rejects its
`.example` reference origin. Do not substitute a real-looking origin to make it run.

A separate, preregistered, reviewed development cohort has purpose `development-subscription-value`,
1–20 distinct ISBNs, an explicit `requiredFields` list, `economics`, and cases with `workGroup`,
`identity`, and `reference`. Different editions of one underlying work must share a work group.
References follow the existing publisher-reference rules; no provider truth or qualification cases.
Unknown facts and economic assumptions stay null. Only the input identity enters acquisition;
reference fields, work groups, prices, and scoring thresholds never enter provider requests.

`--live` requires an explicit `--max-isbndb-requests` covering every case (maximum 20), along with
the existing fixed-host, header-key, response-size, pacing, deadline, and stop rules. Google has one
request per selected edition; Open Library defaults to 80 HTTP requests, bounded at 200, including
redirect/author hops. Stop conditions can leave an incomplete cohort; do not retry or replenish it
to improve results. Freeze the clean runtime, entire frame, budget and exclusive start marker before
a single-use live run as in the completed page trial. The authorized live study is now complete.

The scorer fetches each provider once, then models three policies in memory:

- **Free:** use independently admitted Google/Open Library observations; conflicting values wait.
- **Selective:** consult ISBNdb when free identity or any requested factual field is incomplete or
  conflicted. Combine admitted observations without resolving disagreement by source preference.
- **ISBNdb-first:** stop at ISBNdb when it supplies the requested fields; otherwise combine with
  free observations. Offline references can expose an incorrect early answer; they never select it.

These are evaluation policies, not replacements for the older gap-only or page-review commands.
Modeled provider lookups are not actual HTTP request counts: Open Library needs author/redirect
requests, caches can differ by ordering, and policies are not live-replayed. Acquisition wall time
includes pacing; it is not a production policy latency benchmark. Actual request totals are separate.

Scored facts are pages, edition format, publisher, publication date, and language. Publication dates
retain numeric precision: compatible partial dates are scored as less precise or more precise but
unverified, not exact agreement or incorrect facts. Compatible provider date prefixes retain the
most specific observed date; contradictory dates remain conflicts. Natural-language dates are
unparsed rather than guessed. Publisher comparison normalizes case/spacing only, not imprint
aliases. A language already present in the identity is a consistency check, not independent new
identity evidence. Audiobook pages are not applicable; conflicting formats block page comparison.
An unparsed date has its own counter rather than masquerading as absent provider data. Replacing
only that parser limitation cannot count as an additional correctly improved work for economics.

Only availability booleans are counted for covers, descriptions and alternate ISBNs. No images,
text, URLs or alternate identifiers are emitted, rendered, downloaded, or put into a graph/LLM.
Presence cannot establish correctness, usable image quality, membership, or redistribution rights.

`additionalCorrectWorks` counts a work at most once: at least one requested fact now agrees where
the free policy did not, without losing a previously correct fact or emitting a wrong/unscored
value (including unverified date precision) on any sampled edition of that work. It measures reviewed factual opportunity, not accepted
production writes or a completely resolved book. Field conflicts, missing values and wrong values
remain separately visible. Independent paid-only identity matches are counted separately, splitting
completed free misses from free infrastructure failures.

Economic inputs are the actual `monthlySubscriptionUsd`, an explicitly assumed
`monthlyDistinctWorks`, and an owner-selected `maxUsdPerAdditionalWork`; all may be null. The
projection divides the monthly fee by assumed monthly works times the observed additional-work
rate. A zero observed gain or unknown input yields null cost, never a zero-dollar success. The
threshold result is **cost only**. Every report remains `not_qualified`: small-cohort uncertainty,
permissions, and measured review time still prevent a keep/cancel verdict. See the
[evaluation protocol](reports/isbndb-subscription-value-design-2026-09-08.md) before selecting cases.

The separate command has no Supabase, personal-data, model, index, cache, or provider-value writer.
It does not change or certify the existing production ISBNdb adapter. Public reports retain only
aggregate metrics and a frame hash. Subscription access does not settle retention/display/LLM rights.

### Multi-cohort subscription study

`metadata:study` wraps the subscription scorer; it does not change the older commands or authorize
live acquisition merely because a key works. Source-use rights, account quota, source review,
historical/qualification overlap and a registered budget must be checked before running a study.
**The owner authorized one bounded evaluation before further ISBNdb contact on September 9.**
The public CLI admits only the committed 100-ISBN/100-work evaluation set, before loading
credentials. Every other live set is refused, with no bypass flag. This scoped code change and
new runtime fingerprint do not clear production rights or retention; see the
[source-use review](reports/isbndb-source-use-review-2026-09-08.md).

```sh
pnpm --filter @reverie/series-source-trial metadata:study --help
pnpm --filter @reverie/series-source-trial metadata:study --dry --input data/metadata-value.example.json
```

Both commands run offline. The dry fixture remains fictional and cannot be made live by relabelling
its reference origin. A study frame uses the same input shape as `metadata:value`, but allows up to
200 editions. Cases are sorted by reviewed work group and canonical ISBN, then packed into cohorts
of at most 20 without splitting a work. Duplicate equivalent ISBNs, a work group larger than 20,
and an exact normalized title/full-author identity assigned to two groups are refused. Translations,
retitlings and other non-exact work equivalences still require human grouping and overlap review.

`--freeze` requires an ignored frame under this package's `private-inputs/metadata-value-studies/`
and an explicit, new `--lock` file inside the repository. It writes an aggregate-only lock with
frame/cohort hashes, counts, fields, economics and per-cohort request ceilings (one Google and one
ISBNdb request per edition, at most 80 Open Library HTTP requests per cohort). All metadata modules,
the runner/environment loader, dependency manifests and Node version are included in the system
fingerprint. Source files must match committed contents, including any newly added metadata module.
The optional Google referrer is fingerprinted without retaining its value. Use the same local
environment file via `--env` for freeze/run/merge if a referrer is configured; key values are never
hashed, written or printed. Missing keys are allowed during freeze, not during a live run.

For the owner-authorized evaluation, commit the non-secret lock and review plan before execution. The tested
execution primitive requires an explicit 1-based
`--cohort`, at least 100 reviewed works, both keys, a matching private frame, and a clean, matching
committed runtime/lock. There is no refresh, retry, partial-case selector, alternate state directory
or output-file override. Successful freeze only records a plan; it does not certify the selection
frame, source permissions or the correctness of reference facts.

Attempt markers and aggregate-only cohort results live under `metadata-value-studies/` in the
repository's **common Git directory**, shared by its worktrees. One repository-wide active marker
serializes study cohorts. A permanent marker and reserved result file precede acquisition, so
interruption or invalid output cannot silently restore quota eligibility. The exact same canonical
ISBN set is bound to its first attempted lock even if its price, reference facts, grouping or runtime
subsequently changes. Overlapping but non-identical sets and separate clones still need the
preregistered historical overlap audit; these guards are not tamper-proof experiment attestation.
Run cohorts in order. A failed/interrupted cohort or an authentication, quota, or infrastructure
stop in a completed cohort prevents further acquisition; fresh clients cannot reset that stop.
Never delete attempt markers or run a failed cohort again. A process crash can leave the active
marker in place: stop and report it for owner investigation, rather than automatically clearing it.

`--merge` reads only those fixed result paths. An incomplete study reports completed/missing/failed
cohorts and no cost projection. A complete one validates every cohort binding, expected field/state
shape, enum, count total, request ceiling, reference coverage and economic definition. Duplicate,
foreign, malformed, dry-run or failed reports cannot enter the combined result. All editions of a
work are already together, so work-level benefit/regression counters can be summed without double
counting. Cost is recomputed from combined works and benefits, never averaged from cohort costs.
Only finite aggregate metrics and lock hashes leave the command. Reports stay `not_qualified`;
rights, representativeness, uncertainty and review time still require a separate decision.

The freeze/commit/incomplete-merge/refused-live CLI path and a complete 100-work mocked persisted
study are covered offline. The underlying injected execution primitive is tested with fake clients;
its public live CLI path is limited to the one approved ISBN set. No real frame is frozen or acquired by
these examples.

The authorized September 9 study is now complete: see the
[results and final owner drop decision](reports/isbndb-value-study-results-2026-09-09.md).
Its exact set is consumed, not a reusable example. Do not reacquire it from another clone or
delete its attempt state. The recommendation does not promote a production policy or clear rights.

## Selective ISBNdb edition supplement (trial only)

This separate metadata experiment requests ISBNdb only when an exact Google/Open Library edition
identity is present and page count or edition format is still missing. Existing and baseline
values win; conflicts require review. It is not part of the series resolver or reader matching UI,
and does not enable or change the older production ISBNdb enrichment adapter.

From the repository root, run the synthetic example without credentials or network requests:

```sh
pnpm --filter @reverie/series-source-trial metadata:supplement --input data/metadata-supplement.example.json
```

The example combines a checksum-valid ISBN with fictional metadata. It is a dry-run fixture, not
provider evidence, gold truth, or a live test case. Do not run it with `--live`.

For real development cases, prepare an ignored local input file from actual returned baseline
records. The runner validates identity agreement but does not fetch or authenticate those baseline
observations: writing `source: "google"` is not proof of origin. Never invent baseline evidence.
Keep baseline inputs short-lived and subject to each provider's retention rules; Git-ignored is
not permission for permanent storage. Remove restricted baseline snapshots after the trial.
The version-1 schema is illustrated above. Cases may contain at most two baseline records, one
each from `google` and `openlibrary`. Both must agree on returned canonical ISBN, full title, and
full author names. Initial-only author matches, mixed ISBNs, or edition-format conflicts stop the
paid lookup. Add optional identity `language` as `en`, `es`, `fr`, `de`, `it`, `pt`, `ja`, `ko`, or
`zh` when independently known. Do not include reader state or qualification identities.

Pages must be an integer from 1 to 20,000 or null/omitted. Normalize a provider's invalid sentinel
to unknown during input preparation; never hide a disputed valid value as a gap. Edition format
is `paperback`, `hardcover`, `ebook`, or `audiobook`, or null/omitted. It describes the identified
edition, never possession, owned formats, or the reader's reading format. Audiobooks do not receive
page-count suggestions.

Opt in with `--live`, set `--max-requests` (default 10, maximum 20), and optionally use `--env`
with an absolute path to the existing local credential file. Otherwise the CLI reads this
package's `.env.local`; it accepts `ISBNDB_API_KEY` or `ISBNDB_KEY`. No new Supabase secret is
needed. The CLI defaults to dry-run and does not read credentials in that mode.

Live requests send only the canonical ISBN to the fixed ISBNdb API host, with the key in the
Authorization header. Calls are serial, paced at 1.1 seconds, limited to 15 seconds and 256 KiB,
and never follow redirects or retry. Authentication/quota failures or two consecutive
infrastructure failures stop further requests. Missing or unavailable records remain unresolved,
not standalone.

An ISBNdb longer title that differs from the expected full title requires review, even when its
short title matches. Cosmetic subtitles can therefore reduce coverage; do not strip a qualifier
merely to obtain a match. Baseline titles must likewise retain any returned subtitle/edition qualifier.

Only page count and edition format can become ephemeral review candidates. Publisher, dates,
contributors, covers, descriptions, and series are excluded. Candidate values remain in memory;
the CLI prints aggregate counts only, has no output-file option, and never writes book data or
calls an LLM. This is an evaluation command, not yet a persistent review queue or user-facing tool.
Production use requires broader accuracy evaluation and review of account-specific storage and
redistribution rights. See the [implementation report](reports/isbndb-selective-supplement-2026-09-08.md).

### Acquired-baseline edition benchmark

Use `metadata:benchmark` for live provenance: it acquires Google and Open Library responses itself,
keeps them in memory, and applies the same selective ISBNdb gates. It accepts no caller-supplied
baseline labels. The older `metadata:supplement` command remains a manual-input evaluation tool.

```sh
pnpm --filter @reverie/series-source-trial metadata:benchmark --input data/metadata-benchmark.example.json
```

This second example is also fictional and dry-run only. Real inputs use purpose
`development-edition-benchmark`, 1–20 cases, exact `identity`, `current` fields, and a `reference`
with optional/null pages and editionFormat, an HTTPS publisher reference URL, and `reviewedOn` date.
Review the exact edition before collecting any provider output. The reference is a scoring target,
not permission to overwrite existing data; neither references nor current fields enter baseline
acquisition. Tested catalog/search providers are rejected as circular reference hosts, but this
denylist is not authority certification. The operator still owns source/edition review and exclusion
of qualification identities. Do not include reader data, provider snapshots, or qualification truth.

Explicit live usage with an independently reviewed local frame:

```sh
pnpm --filter @reverie/series-source-trial metadata:benchmark \
  --input private-inputs/reviewed-development-frame.json --live \
  --max-isbndb-requests 20 --max-openlibrary-requests 80 \
  --env /absolute/path/to/existing/.env.local
```

Google uses `GOOGLE_BOOKS_API_KEY` (`GOOGLE_BOOKS_KEY` alias) and optional
`GOOGLE_BOOKS_REFERRER`. ISBNdb uses the credentials above. No keys are loaded in dry-run mode.
Google is capped at one request per case; Open Library defaults to 80 actual HTTP requests (maximum
200), including edition redirects and author lookups. ISBNdb defaults to 10 requests (maximum 20).
No provider retries; each baseline provider is paced at 1.1 seconds and bounded to 15 seconds/512 KiB.
The only permitted redirect is one canonical same-origin Open Library edition JSON path. Every
listed edition author must resolve through a canonical Open Library author path; no work-level
fallback, partial contributor list, or third-party URL is admitted. Successful author names may be
reused only within the current process. Google credentials never reach Open Library or a redirect.

An authentication/quota refusal or two consecutive infrastructure failures stops that provider.
Both baseline attempts must complete before any paid lookup: transport failures, incomplete author
resolution, malformed payloads, and exhausted budgets are unavailable, not metadata gaps. Returned
identity or binding ambiguity on either baseline also blocks the paid lookup. A completed not-found
response may coexist with one exact matched baseline. Google page counts are scored only after
identity checks; `printType=BOOK` and ebook/preview availability never establish edition binding.

Only aggregates leave the runner: provider outcomes, completed-baseline count (including completed
reviews), planning decisions, candidate/reference agreement or disagreement, unscored fields,
request counts, baseline HTTP elapsed time excluding pacing, and the canonical frame hash. A null
reference is unscored, not agreement. No provider values, URLs, identities, raw error bodies, API
keys, or model output are persisted. Redirect stdout only to an aggregate result file. Freeze the
frame and implementation before a live benchmark, preserve the completed result, and use a new
development frame to test changes rather than rerunning inspected failures to improve a score.
See the [20-edition preregistration](reports/metadata-baseline-plan-2026-09-08.md).

Benchmark output version 2 adds finite `baselineReviewReasons`, separate `fieldEvidence` state
counts for pages and edition format, and `protectedCurrent` counts. Input remains version 1.
Reasons describe the first failing guard, not every defect in a record. Unrecognized reasons become
`unspecified_reason`; raw provider explanations never enter these counters. The completed
20-edition version-1 result is unchanged: these new reasons cannot retrospectively explain its
review counts, and it must not be rerun to obtain them.

Field evidence is descriptive, not a confidence probability or permission to fill a field:

| State                 | Meaning                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `unavailable`         | A required provider attempt is incomplete or unrecognized.                       |
| `identity_review`     | Identity or edition admission needs review; no fields are trusted from the pair. |
| `identity_unresolved` | Both attempts completed but neither admitted an exact identity.                  |
| `edition_conflict`    | Format disagreement prevents interpreting page-count agreement.                  |
| `not_applicable`      | Page count is not applicable to the known audiobook format.                      |
| `conflict`            | Providers disagree, or a provider disagrees with a protected current value.      |
| `source_missing`      | Admitted identities have no observation for this field.                          |
| `single_source`       | One admitted source supplies the field.                                          |
| `source_agreement`    | Two admitted sources agree; independence and correctness remain unproven.        |

The descriptor receives identity/current values and ephemeral baseline observations, never publisher
reference truth. It emits no field values and always sets `automatic: false`. Current values are
protected in every state, never a third corroborating vote; even an inapplicable page count is not
deleted. These observations do not change the existing ISBNdb lookup gates, score source quality,
feed the LLM, or write shared/personal data. No new live benchmark is required to test this reporting
layer; synthetic offline tests cover the states and demonstrate reference-truth separation.

### Separate page-count review evaluation

`metadata:review` is an opt-in comparison, not a change to the gap-only benchmark. Its input uses
the same reviewed identity/current/reference schema with purpose `development-page-review`.
Freeze a **fresh** development frame and implementation before live use; do not convert and rerun
a completed benchmark frame. No live accuracy result has yet been established for this command.

```sh
pnpm --filter @reverie/series-source-trial metadata:review \
  --input data/metadata-page-review.example.json
```

This example is fictional and dry-run only. The default is dry-run, with no credential loading
or requests. Use a fresh, reviewed private frame for live work. The same explicit `--live`,
`--env`, and request-budget flags as the benchmark apply. A paid lookup requires both baseline
attempts to complete, at least one strictly admitted identity with a page observation, and no
identity/edition ambiguity or known audiobook format. Unlike the gap benchmark, this path may
compare an already populated page field; reference truth cannot trigger a lookup.

The in-memory review packet separates page and format observations, protected current values,
and eligible gap-fill proposals. A page conflict does not discard an otherwise admitted format
proposal. Neither observation agreement nor a publisher-reference score authorizes a replacement.
Rejected ISBNdb identity/binding/language admission contributes neither field; the packet retains
the baseline states and explicitly records the rejected supplement status/reason. Late audiobook
binding suppresses page scoring. Agreement is descriptive, not proof of independent sourcing.

The packet contains no reference truth, raw provider prose, or arbitrary response fields, has no
model or corpus writer, and throws on direct JSON serialization to catch accidental export.
It is **not** a persistent queue or an LLM-ready integration: copying it or sending provider values
to a model still requires separate rights/privacy approval. Only aggregate field states,
observation/proposal agreement, and paired page comparisons leave the runner. Paired outcomes
distinguish both agree, baseline only agrees, ISBNdb only agrees, neither agrees, and unscored;
they never select a winning value. Existing completed reports remain unchanged.

## What is measured

- exact work matching;
- relational work-to-series membership;
- membership precision and recall on authority-reviewed cases;
- false series assignments on reviewed standalone books;
- order accuracy, separately from membership accuracy;
- request failures and latency;
- commercial-use, persistent-storage, and provenance gates.

A provider's search label never counts as series evidence. Candidate labels from Reverie's seed are
useful for measuring coverage and discovering disagreements, but they do not contribute to claimed
accuracy until an authority source has been reviewed.

The current development sample contains one difficult work from each of Reverie's 69 distinct
seeded series plus external sampling frames: 335 selected works, of which 209 are
authority-reviewed. The reviewed set contains 147 positive series cases and 62 confirmed standalone
controls. Some reviewed cases replace seed references, so the final distinct-case count is printed
at runtime.

## Run the open-source baseline

From the repository root:

```sh
pnpm series:trial -- --scope all --providers openlibrary,wikidata
```

The expanded open-data comparison adds Inventaire and BookBrainz:

```sh
pnpm series:trial -- --scope all --providers openlibrary,wikidata,inventaire,bookbrainz
```

Inventaire results preserve their origin: an `inv:` entity is distinct Inventaire evidence, while
a `wd:` entity observed through Inventaire remains Wikidata evidence. BookBrainz relationships are
also checked against the series roster. Neither adapter promotes a one-member provider series into
automatic evidence.

The Open Library adapter intentionally runs at roughly one request per second. Reports are written
under `packages/series-source-trial/reports/` and ignored by default because ad-hoc results are not
stable fixtures.

Google Books is supported as an identity baseline:

```sh
GOOGLE_BOOKS_API_KEY=your-key \
GOOGLE_BOOKS_REFERRER=https://your-authorized-origin.example \
pnpm series:trial -- --scope all --providers google-books
```

`GOOGLE_BOOKS_KEY` is accepted as an alias for `GOOGLE_BOOKS_API_KEY`, matching the production
Supabase secret name. Production uses `BOOKS_KEY_REFERER`; the trial uses
`GOOGLE_BOOKS_REFERRER`. Both should name an origin allowed by the Google Cloud key restriction.

Keys are read from the environment, are never written to reports, and must not be committed.
The runner also loads `packages/series-source-trial/.env.local` when present; that path is ignored
by Git.
For reliable trials, use a dedicated Google Cloud project and Books-only key, monitor its daily
query quota, and request a quota increase before a full run. A browser-restricted production key is
not a general server credential. Google-derived content remains live/short-cache metadata because
Google's API terms prohibit building a permanent copy of returned content unless separately
permitted.

Google requests share a conservative 1.1-second start interval across the adapter's workers. This
avoids turning concurrency into a quota burst; controlled trials may override the interval with
`GOOGLE_BOOKS_DELAY_MS` and the worker count with `GOOGLE_BOOKS_CONCURRENCY`. A 429 pauses the
shared schedule and retries after the larger of Google's `Retry-After` value or the bounded
`GOOGLE_BOOKS_429_COOLDOWN_MS` fallback.

A full comparison can resume from one or more prior reports without repeating successful provider
requests:

```sh
pnpm series:trial -- --scope gold \
  --providers openlibrary,wikidata,google-books,hardcover \
  --resume packages/series-source-trial/private-results/first-pass.json \
  --resume packages/series-source-trial/private-results/google-retry.json
```

Reuse requires the same stable case ID, title, and authors. Later successful observations replace
earlier successful observations; an error never erases a reusable success. Only missing, failed, or
identity-changed cases are requested again, and the output records its resume sources and counts.

Hardcover is supported as a relational series source:

```sh
HARDCOVER_TOKEN=your-personal-token \
pnpm series:trial -- --scope all --providers hardcover
```

The adapter first searches for the exact book, then queries that book's `book_series` rows. The
search document's `series_names` field is never counted as membership evidence. Hardcover requires
a backend-only personal token and limits the beta API to 60 requests per minute, so the adapter
paces all requests at slightly over one second apart. Its published API documentation does not
grant commercial use or persistent-storage rights; both procurement gates remain unresolved until
Hardcover provides written terms for Reverie's use. A relation whose series contains only one known
book is retained as review-only evidence and never counted as an automatic membership.

## Score a commercial sample

Ask the vendor to return the trial cases using the shape in
`data/provider-result.example.json`, or transform its export into that shape locally. Then run:

```sh
pnpm series:trial:score -- packages/series-source-trial/private-results/vendor.json
```

`private-inputs/` and `private-results/` are ignored deliberately. Do not commit a vendor sample
until its contract explicitly permits publication.

## Run the evidence resolver in shadow mode

The resolver is an optional, no-write interpretation layer over a completed JSON trial report. It
cannot browse, receives no authority truth labels, and cannot modify Supabase or Reverie's corpus.
It may only return fields and evidence IDs present in the supplied provider packet; deterministic
validation rejects unsupported values and keeps singleton or conflicting relationships in review.

Before a packet reaches the model, a deterministic cleaner assigns each claim a source role,
membership rule, lineage, risk flags, and separate membership/order eligibility:

| Source              | Usable resolver input                 | Automatic membership rule                    | Automatic order rule                    |
| ------------------- | ------------------------------------- | -------------------------------------------- | --------------------------------------- |
| Google Books        | Work identity only                    | Never                                        | Never                                   |
| Open Library        | Exact structured relationship         | Non-singleton exact-work relation            | Independent agreement                   |
| Wikidata            | Exact P179 relationship               | Non-singleton exact-work relation            | Independent agreement on P1545          |
| Inventaire          | Exact `serie-parts` roster relation   | Non-singleton; `wd:` mirrors remain Wikidata | Independent non-mirror agreement        |
| BookBrainz          | Exact series-roster relation          | Non-singleton exact-work relation            | Never until dependable order is exposed |
| Hardcover           | Exact `book_series` relation          | Independent open relational agreement        | Independent agreement                   |
| Authority scout     | Grounded first-pass candidate         | Never                                        | Never                                   |
| Authority retrieval | Hash-checked reviewed-origin relation | Direct exact-work relationship               | Same direct relationship                |

This is deliberately asymmetric. Hardcover adds broad candidate coverage, but the complete 209-case
development frame showed that an ordinary exact-work, non-singleton relationship can still carry a
plausible wrong series name or an order container. It therefore remains review-only until an
independent open relational source agrees. Self-titled containers, reading-, publication-,
chronological-, and recommended-order lists, companion collections, connected “universe” groupings,
fractional positions, and competing relationships are quarantined. Hardcover order also needs
independent agreement. An Inventaire view of the same Wikidata entity is one lineage, not two votes.
Unknown providers cannot corroborate a source until a profile is added.

The LLM's job is to select, explain, or route these cleaned claims—not to make an unsafe claim true.
It can suppress a Hardcover false positive by choosing review or abstain, but a Hardcover-only
candidate is deterministically ineligible even when the model accepts it. An optional authority
report can now join the shadow resolver packet. A grounded first-pass scout claim remains
deterministically review-only. Only a selected, policy-safe retrieval interpretation whose output
matches its persisted interpretation and whose citations stay inside its hash-checked child
manifest enters as eligible relational evidence from a human-reviewed origin. Declaring a book
standalone still requires affirmative author/publisher evidence; silence from another dataset is
never enough.

Put the server-side API key in `packages/series-source-trial/.env.local`:

```dotenv
OPENAI_API_KEY=your-server-side-key
BOOK_RESOLVER_MODEL=gpt-5.6-luna
```

Then run a small reviewed shadow sample before spending against the whole report:

```sh
pnpm series:resolve -- \
  --input packages/series-source-trial/reports/your-trial.json \
  --scope gold \
  --max 10
```

Join an authority-acquisition report and target exact stable case IDs when evaluating the
adjudication boundary:

```sh
pnpm series:resolve -- \
  --input packages/series-source-trial/private-results/your-provider-trial.json \
  --authority packages/series-source-trial/private-results/your-authority-trial.json \
  --scope gold \
  --ids case-one,case-two
```

The committed origin registry activates only the owner-reviewed, time-boxed
`authorljshen.com` trial profile through 2026-10-07. Other live scout reports enrich review
packets only; they cannot make a Hardcover candidate automatic.

Requests use strict JSON Schema output and `store: false`. Responses are cached by the complete
evidence packet, model, and prompt version under ignored `private-results/resolver-cache/`, so an
unchanged evaluation does not pay twice. The generated score reports citation faithfulness,
unsupported fields, policy violations, membership precision/recall, and false-standalone behavior.
Only policy-safe proposals count as automatic fills; review and abstain decisions do not.

The trial measures the prospective production tool as a system, not the model in isolation. Source
adapters perform explicit, auditable acquisition; the model interprets only the resulting evidence
packet. A future production orchestrator may let the model choose which approved source tool to call
next, but it must not hide source retrieval inside an unverifiable answer. Authority pages in the
gold set are evaluation evidence, not facts trained into or memorized by the model. Repeatable
failure patterns become source-profile or deterministic validation rules instead of title-specific
prompt exceptions.

The resolver refreshes the report's case metadata and authority truth from the current sample by
stable case ID. That lets a newly reviewed candidate reuse the provider observations already stored
in an older trial report; only a genuinely new evidence packet needs a model request.

This shadow harness is intentionally not a production Edge Function. The development sample now
meets the gates below and can support provider and resolver comparisons; production integration
still waits for the untouched qualification partition and production-readiness gates.

The first live 10-case shadow, the prompt/lineage correction it exposed, and the corrected full
23-case pilot are recorded in
`reports/resolver-shadow-pilot-2026-09-04.md`.
The first 10-case authority expansion, zero-request provider rescore, and Hardcover semantic-policy
revision are recorded in `reports/authority-review-batch-1-2026-09-04.md`.
The first recent independent/Kindle-first cohort, complete-shortlist sampling frames, and
production-shaped four-provider comparison are recorded in
`reports/authority-indie-batch-1-2026-09-04.md`.
The second Reverie seed batch, connected-world false-positive control, and 50-case resolver score
are recorded in `reports/authority-seed-batch-2-2026-09-04.md`.
The complete publisher-selected standalone frame, third Reverie seed batch, role-only resolver
correction, and 61-case score are recorded in
`reports/authority-seed-batch-3-2026-09-04.md`.
The complete 2025 Kindle Storyteller shortlist, Hachette standalone-label challenge frame, fourth
Reverie seed batch, and 74-case capability score are recorded in
`reports/authority-challenge-batch-4-2026-09-04.md`.
The high-risk semantic batch, its intentionally unresolved connected-world cases, and the first
zero-request rescore are recorded in `reports/authority-high-risk-review-2026-09-04.md`.
The fifth Reverie seed batch, complete 108-case provider refresh, and 84-case resolver score are
recorded in `reports/authority-seed-batch-5-2026-09-05.md`.
The sixth Reverie seed batch, complete provider refresh, and 89-case resolver score are recorded in
`reports/authority-seed-batch-6-2026-09-05.md`.
The seventh Reverie seed batch, false-standalone controls, connected-world boundary, and corrected
seed position are recorded in `reports/authority-seed-batch-7-2026-09-05.md`.
The final unambiguous Reverie seed candidates, historical publication-path handling, and the two
deliberately unresolved controls are recorded in `reports/authority-seed-batch-8-2026-09-05.md`.
The first external-candidate promotions, translated-edition reconciliation, and explicit
series-versus-reading-independence boundary are recorded in
`reports/authority-external-batch-9-2026-09-05.md`.

## Test LLM authority-source acquisition

The authority acquisition harness tests the next layer of the proposed production tool: can the
model find an author or publisher page for the exact work, distinguish bibliographic series from
connected-world noise, and cite only pages it actually consulted? It uses the Responses API's
hosted `web_search` tool with live access, strict structured output, `store: false`, and at most
three web-search calls per book by default.

The scout now treats first-party location as its own bounded objective. It starts with the exact
title and author plus an official-source signal, inspects that result, and then searches inside a
newly discovered author or publisher host before trying a generic publisher fallback. It does not
batch all fallback queries before learning that host and may cite only exact URLs returned in the
consulted-source manifest. Once a discovery-only result establishes identity, it stops searching for
more aggregators. The report records the API's search queries and consulted URLs so recall failures
can be diagnosed without adding a known authority URL to the model input. When the source's page or
collection heading differs from the bibliographic relationship stated in its prose, the scout uses
the explicit relationship label rather than promoting the heading into a series name. It preserves
articles and named forms such as duology or trilogy instead of shortening them into a plausible but
different series name. Deterministic cleanup clears a claimed identity when no eligible authority
identity source survives, while retaining the separate consulted-URL and query telemetry for
diagnosis. The scorer treats only a bounded set of generic descriptor tails as naming drift; it does
not change the model proposal or create a relationship.

This remains a shadow evaluation. The model receives only title, author, and an optional publication
year; existing truth labels, authority URLs, sample sources, and provider packets are withheld.
Deterministic validation rejects an unconsulted URL, an unsupported membership or position, and a
standalone conclusion without affirmative author/publisher evidence. A separate source-policy check
prevents the exact selection-frame page from validating the case it selected while allowing an
independently rediscovered first-party identity page to supply evidence, and quarantines known
conflicting source taxonomies such as Hachette's standalone marketing lists. It also strips
membership support inferred only from spin-off/companion context, trigger-warning or trope
taxonomies, and unlabelled headings. “Valid” therefore means well-formed and grounded;
“policy-safe” additionally means the proposed evidence survived those deterministic source rules.
Even a policy-safe first-pass result is always review-only and cannot write authority gold,
Supabase, or the corpus. The optional resolver join admits only a later selected retrieval result
that also passes the reviewed-origin, packet-hash, child-manifest, and ordinary claim-validation
gates. That eligibility exists only in the no-write shadow score.

If the only structural failure is a `series` result with no membership object, the trial may make
one bounded no-tools repair call. That call can only reorganize facts and URLs already present in
the proposal or fall back to unresolved; every ordinary grounding and source-policy check runs
again afterward. Cached evidence retains its historical usage metadata, but score reports count
tokens only for calls made in the current run.

Hosted search can miss a first-party page that is visible only through site navigation. Do not add
an arbitrary URL fetcher to compensate. The bounded follow-up is the trial-only, single-hop
gateway in [`docs/decisions/0009-authority-retrieval-gateway.md`](../../docs/decisions/0009-authority-retrieval-gateway.md):
it accepts only a consulted-manifest URL on a reviewed origin, selects one same-origin child
deterministically, returns sanitized evidence, and fails unresolved. Its security boundary is now
implemented and its interpreter can be enabled explicitly for the no-write trial.
When a reviewed origin supplied several consulted URLs, a shallow catalog-style hub is preferred
over its homepage or a detail page so the single navigation hop can reach an exact-title child.

The first bounded implementation slice now lives in `src/authority/retrieval/`. It provides the
reviewed-origin gate, public-address validation and connection pinning, manual redirect checks,
per-hop robots evaluation with a process-shared 24-hour cache, process-shared origin pacing, a
nine-request case ceiling, single-child navigation selection, static HTML extraction, provenance
hashes, and persistence redaction. It deliberately has no production integration. The only active
real-origin profile is the owner-reviewed, time-boxed `authorljshen.com` trial. The opt-in pipeline
adds a second strict, no-tools model pass only when the first pass is unresolved or quarantined. It
binds citations and source kind to the retrieved child manifest, hash-checks the packet, and skips
the model entirely when the exact target title or author is absent. Post-validation requires a
non-heading evidence line to join the exact target title to each claimed bibliographic series or
affirmative standalone statement. A narrow catalog exception exists only when the current
human-reviewed origin profile grants `repeated_numbered_catalog_headings`; the gateway binds that
capability into the manifest, and provider conversion verifies it again. The page must still be a
shallow, query-free catalog with two or more distinct numbered-title headings sharing one
non-generic series prefix and an exact target-title match. Position and membership role survive
only on that same relationship line or exact catalog entry. This prevents a model from joining one
book's identity to another book's series facts on a multi-book page. The packet is stripped before
returning or caching results.
Exercise the boundary with:

Cleaning also drops a membership whose cited sources were all deterministically demoted while
retaining a separately supported membership in the same proposal. An originally uncited
membership remains invalid, and a series result with no surviving membership still fails closed.

```sh
node --test packages/series-source-trial/test/authority-retrieval-*.test.mjs
```

Run the integrated path explicitly:

```sh
pnpm series:authority:acquire -- --scope gold --max 10 --retrieval
```

With the committed registry, `authorljshen.com` and `smdaviesauthor.com` may perform bounded
retrieval only inside their owner-reviewed trial windows through 2026-10-07. The S. M. Davies
profile alone grants `repeated_numbered_catalog_headings`; its technical access review and owner
decision are recorded in
`reports/authority-origin-approval-sm-davies-2026-09-07.md`. `alihazelwood.com`,
`penguinrandomhouse.com`, and `penguin.co.uk` are manual-only. An unchanged successful second-pass
interpretation is cached by packet hash without retaining evidence text. Origin activation
requires a separate human rights/access review and cannot be supplied by model output or a CLI
flag.

Run a small gold holdout before a broader capability evaluation:

```sh
pnpm series:authority:acquire -- --scope gold --max 10
```

Target exact stable case IDs when constructing a balanced holdout:

```sh
pnpm series:authority:acquire -- \
  --scope gold \
  --ids gold-divine-rivals,gold-standalone-mexican-gothic
```

Results and per-case caches are written under ignored `private-results/`. Repeating an unchanged
run is free; pass `--refresh` only when intentionally testing live-source drift. The cache preserves
the raw model response and consulted-source manifest, then applies current deterministic policy on
every replay. The report separates resolution rate from accuracy, and reports membership
precision/recall, false standalone, false series, URL grounding, tool calls, and token usage. A
candidate run can prioritize human review but does not convert candidate output into truth:

```sh
pnpm series:authority:acquire -- --scope candidate --max 10
```

The current design keeps acquisition and resolution as separate calls with an explicit typed join.
The scout proposes first-party evidence for review; the resolver reconciles provider evidence and,
when supplied, eligible retrieval evidence under deterministic source profiles. A future production
orchestrator may call both, but neither model is allowed to promote its own output into trusted
corpus data.

The first 12-case balanced gold holdout, nine-candidate queue trial, cost measurement, and
source-policy correction are recorded in
`reports/authority-acquisition-pilot-2026-09-04.md`.

The complete 25-work Reverie seed-candidate run, explicit-series/standalone semantic correction,
and expanded 24-case gold holdout are recorded in
`reports/authority-seed-candidate-pilot-2026-09-04.md`. That later report supersedes the first
pilot's v2 prompt for ongoing acquisition experiments.

The failed prompt-only and allowed-domain same-origin recall experiments, the Pyg false-positive
audit, and the resulting deterministic quarantine are recorded in
`reports/authority-same-origin-scout-2026-09-05.md`.

The bounded second-pass wiring, Pyg live-source limit, cache/redaction proof, and synthetic no-tools
model check are recorded in
`reports/authority-retrieval-interpretation-pilot-2026-09-05.md`.

The 99-case acquisition baseline, source-profile decisions, live one-hop gate, and dependent-claim
cleanup are recorded in `reports/authority-origin-evaluation-2026-09-05.md`.

The adaptive first-party discovery experiment, explicit series-name extraction correction, and
fresh 12-case development validation slice are recorded in
`reports/authority-discovery-recall-pilot-2026-09-07.md`.

The follow-up origin coverage review, explicit manual-only decisions, pending S. M. Davies profile,
and repeated-numbered catalog safeguard are recorded in
`reports/authority-origin-coverage-evaluation-2026-09-07.md`.

The subsequent S. M. Davies technical access review, owner-approved 30-day profile, fresh discovery
miss, and successful manifest-grounded downstream isolation are recorded in
`reports/authority-origin-approval-sm-davies-2026-09-07.md`.

The frozen 22-work first-party discovery benchmark, its 81.8% known-origin recall, the CWA
source-ownership correction, and the zero-cost policy replay are recorded in
`reports/authority-discovery-recall-holdout-2026-09-07.md`.

The first-party discovery benchmark is frozen in `data/authority-discovery-holdout.json`. Its 22
works had never been sent through any authority-acquisition prompt at freeze time, have distinct
authors, and are balanced between series/standalone truth plus author/publisher discovery cells.
Run exactly that set without exposing its known origins to the scout, then score discovery
separately from classification:

```sh
pnpm series:authority:acquire -- \
  --holdout packages/series-source-trial/data/authority-discovery-holdout.json \
  --retrieval \
  --refresh
pnpm series:authority:discovery:score -- \
  packages/series-source-trial/private-results/authority-acquisition/<run>.json
```

Model experiments should set their controls explicitly. Model, reasoning effort, search-context
size, and search budget are recorded in the report and included in the cache key, so one arm cannot
silently reuse another arm's response:

```sh
pnpm series:authority:acquire -- \
  --holdout packages/series-source-trial/data/authority-discovery-holdout.json \
  --model gpt-5.6-luna \
  --reasoning low \
  --search-context medium \
  --max-tool-calls 3 \
  --refresh
```

An opt-in `--focused-search` experiment makes one additional bounded search only for an unresolved
or quarantined first pass that already cited a grounded, non-discovery-only authority origin. The
second request is restricted to at most two such domains and can replace the first proposal only
when it produces a resolved, valid, policy-safe result. It does not inject a gold URL, approve an
origin, enter the retrieval eligibility path, or change the review-only boundary. It is not the
default: the frozen regression recovered one additional safe classification in six attempts but did
not improve source discovery.

The acquisition command rejects a stale dataset hash, prompt-version drift, an invalid cell, or a
holdout combined with ad-hoc scope, ID, or maximum selectors before making a model call. The scorer
requires the exact frozen target/result order and reports known-origin discovery, targeted-channel
discovery, exact-page discovery, source citation, retrieval, and resolution as separate outcomes.

### Freeze and run the production qualification set

The 1,000-case qualification partition is a private, single-use holdout. Its candidate pool and
selected truth file live only under ignored `private-results/`; do not append them to
`authority-gold.json`. The committed `data/authority-qualification-plan.json` preregisters a
minimum 1,500-case reviewed pool, complete provider-independent selection frames, deterministic
SHA-256 ranking, a maximum of two selected works per author identity, the exact 600 series / 400
affirmative-standalone mix, Luna-low plus Exa fallback, and a $10 Exa ceiling.

Build publisher-controlled selection frames through supported APIs rather than scraping retail
pages. The PRH intake uses the public Enhanced PRH API, captures every English-language work in an
explicit publication-date interval, verifies the API record count against unique work IDs, and
resumes from private state after an infrastructure failure. It retains structured identity,
category, series, and position metadata plus response hashes; it discards descriptions and never
persists or logs the key.

Register for a PRH developer key, then keep it beside the other local trial keys:

```dotenv
PRH_API_KEY=your-server-side-key
```

Preview a bounded frame without a key or network request:

```sh
pnpm series:authority:qualification:capture:prh -- \
  --frame-id prh-us-2025-q1 \
  --from 2025-01-01 \
  --to 2025-03-31 \
  --dry-run
```

For the deliberately series-positive portion of the challenge set, add
`--numbered-series-only`. This uses PRH's documented `hasSeriesNumber` catalog filter inside the
same complete publication-date frame; it does not accept a series code, title query, maximum, or
random result. The selection constraint is recorded in the frame manifest. Each retained
relationship still requires human review of its separate exact-work publisher evidence before it
can become gold truth.

Remove `--dry-run` to capture the frame. The output remains under ignored
`private-results/authority-qualification/` and is intentionally a review queue. Exact structured
series relationships are proposals, not gold truth. Self-titled, unnumbered, fractional,
multi-series, and collection-like relationships are flagged. A work with no returned series is
explicitly unresolved; it can become a standalone control only after a reviewer adds affirmative
author or publisher evidence.

After reviewers have changed every retained case to `truth.status: "reviewed"`, they must also add
`reviewer`, `reviewedAt`, a substantive `reviewNote`, and
`reviewBlindToSystemOutput: true`. The truth source must be separate from that case's selection
frame. The merge rejects development overlap, duplicate works, incomplete frame accounting,
missing review attestations, non-authority truth, self-validating selection evidence, or any
remaining candidate:

```sh
pnpm series:authority:qualification:merge -- \
  --input packages/series-source-trial/private-results/authority-qualification/prh-us-2025-q1.review.json \
  --out packages/series-source-trial/private-results/authority-qualification/reviewed-pool.json
```

Use `--require-minimum` on the final merge to enforce the 1,500-case preregistered minimum before
freezing. PRH covers only one traditional-publishing group, so it cannot satisfy the independent /
Kindle-first floor or the author-evidence floor alone; those must come from separate complete award,
platform, author-bibliography, or publisher frames.

The independent intake captures the complete General, Regional, and Ebook medalist frames from six
official 2023-2025 Independent Publisher Book Awards result pages: four sectioned 2025 pages and one
complete archive page for each earlier year. It honors the site's declared ten-second crawl delay
and retains only winner identity, award category, medal, publisher label, and response hashes—never
page HTML, images, or descriptions:

```sh
pnpm series:authority:qualification:capture:ippy -- --dry-run
pnpm series:authority:qualification:capture:ippy
```

The fixed six-page capture has no year, category, title, or maximum selector. An award record
establishes selection identity only: it cannot establish series membership or standalone status,
and its own result page cannot be reused as a truth citation. Publication year and Reverie's
publication-path label stay reviewer-verified; an award year is not silently treated as the book's
publication year. Ambiguous contributor strings are flagged for manual splitting. Review the
private output, then merge it with the PRH review queue using repeated `--input` arguments.

After blind authority review is complete, freeze the set:

```sh
pnpm series:authority:qualification:freeze -- \
  --input packages/series-source-trial/private-results/authority-qualification/reviewed-pool.json
```

The command writes the selected set to ignored private storage and creates a commit-ready
`data/authority-qualification-lock.json` plus an aggregate lock report. It refuses to overwrite an
existing set or lock. Commit and merge those public, non-secret artifacts before running; they
contain hashes and counts, not case identities, truth, or authority URLs.

Run the locked set only after the current source files reproduce the frozen system hash:

```sh
pnpm series:authority:acquire -- \
  --qualification-lock packages/series-source-trial/data/authority-qualification-lock.json \
  --exa-fallback
```

Qualification mode rejects `--ids`, `--max`, `--out`, `--refresh`, discovery holdouts, non-gold
scopes, changed runtime controls, a changed dataset, development overlap, and a stale plan or
system fingerprint before making a model call. It uses a qualification-only cache. Use `--resume`
only after an incomplete infrastructure failure against the same lock. A completed run cannot be
rerun; model drift, budget exhaustion, or a failed result inspected for tuning burns the set into
development and requires a replacement holdout. The protocol and research basis are recorded in
`reports/authority-qualification-design-2026-09-07.md`.

Passing requires zero false-positive memberships and zero false standalones, at least 299 evaluated
membership claims, at least 85% series recall, at least 75% overall resolution, and no operational
errors. The zero-error rules give the 600 series-positive controls and 299 membership claims their
configured one-sided 95% safety interpretation; the recall and resolution floors prevent abstention
from masquerading as accuracy.

The Luna/Terra/Sol comparison, cache-isolation fix, focused-search result, and rejected Wikidata and
Open Library locator probes are recorded in
`reports/authority-model-routing-experiment-2026-09-07.md`.

### Test an independent search index

Luna-low remains the reference scout. The completed development experiment isolates search-index
recall from model reasoning by running three fixed, truth-blind title/author queries against Exa Search. Exa
[documents its Search endpoint](https://exa.ai/docs/reference/search) and
[prices Search at $7 per 1,000 requests](https://exa.ai/pricing?tab=api), including up to ten
results per request. The frozen 18-work development slice therefore plans 54 requests, or $0.378
before free account credits. It contains 18 distinct authors and excludes every work matched to a prior
authority-acquisition cache or frozen acquisition benchmark. It is not the locked qualification
partition. Its case list stayed ignored and local until both the first Exa run and paired Luna
baseline were complete; publishing the truth cells earlier would have made the untouched set
searchable. The completed benchmark now lives in `data/authority-locator-development.json`, and the
aggregate findings are recorded in
`reports/authority-exa-locator-development-2026-09-07.md`.

The locator parses URLs only in memory, compares them with reviewed sources only after retrieval,
and persists aggregate recall, request, latency, error-count, and estimated-cost metrics. It never
retains an Exa response, result title, result author, URL, query, request ID, or case-level provider
output. It requests Search results only—no page text, highlights, summaries, synthesized output,
deep search, or live crawl. This tool is discovery measurement only: it cannot establish book
identity, series membership, position, or standalone status and has no provider-evidence, resolver,
Supabase, or corpus write path. Retaining Exa result content would require a separate rights and
design review.

Put a trial key in `packages/series-source-trial/.env.local`:

```dotenv
EXA_API_KEY=your-server-side-key
```

Audit the frozen slice and planned spend without a key or network request:

```sh
pnpm series:authority:locate -- --dry-run
```

Run the independent locator first so the works remain unseen by Luna, writing only an aggregate
report:

```sh
pnpm series:authority:locate -- \
  --out packages/series-source-trial/private-results/exa-locator-development.json
```

Then run the controlled Luna-low baseline on the same slice. Because Exa result content is not
retained, repeat the inexpensive locator with the baseline report to compute paired incremental and
combined recall in memory:

```sh
pnpm series:authority:acquire -- \
  --holdout packages/series-source-trial/data/authority-locator-development.json \
  --model gpt-5.6-luna \
  --reasoning low \
  --search-context medium \
  --max-tool-calls 3 \
  --out packages/series-source-trial/private-results/luna-locator-development \
  --refresh

pnpm series:authority:locate -- \
  --baseline packages/series-source-trial/private-results/luna-locator-development.json \
  --out packages/series-source-trial/private-results/exa-plus-luna-development.json
```

The decision gate is incremental first-party origin and exact-page recovery beyond Luna-low, not
raw Exa coverage. The locator recovered all four Luna origin misses and six of seven Luna exact-page
misses, clearing that development gate. The acquisition command therefore exposes an opt-in shadow
fallback only for an unresolved or policy-quarantined Luna result:

```sh
pnpm series:authority:acquire -- \
  --holdout packages/series-source-trial/data/authority-locator-development.json \
  --model gpt-5.6-luna \
  --reasoning low \
  --search-context medium \
  --max-tool-calls 3 \
  --exa-fallback \
  --out packages/series-source-trial/private-results/luna-exa-fallback-development \
  --refresh
```

Exa ranks at most eight non-discovery-only candidate domains in memory. Luna then performs a
separate bounded search restricted to those domains. Only URLs in that Luna response's hosted-search
manifest may ground a proposal; Exa results never become authority evidence. Safe resolved first
passes make no Exa request. The report retains Exa request, latency, error, URL-count, and cost
aggregates, but no Exa URL, domain, result, query, or request identifier. A generic-only series form
such as `series`, `trilogy`, or `duology` is policy-quarantined rather than accepted as a named
bibliographic membership.

The subsequent complete 209-work reviewed-development run attempted Exa for 48 unsafe first
passes. After deterministic replay and two human-reviewed gold corrections, it resolved 169 works
with 100% resolved accuracy, 100% membership precision, 89.2% positive-series recall, and zero
false series or false standalone classifications. Exa contributed eleven additional correct
resolutions, including four additional positive-series works, for 144 requests and $1.008 in Exa
cost. Unverified hosted author profiles, an explicitly known catalog-relationship conflict,
unmapped translated series labels, and storefront titles that invert the work and relationship
names now remain review-only. See
`reports/authority-exa-full-development-hardening-2026-09-07.md`.

This remains a no-write development arm. It does not replace Luna, change evidence eligibility, or
clear production, rights, privacy, retention, cost, or locked-qualification gates.

The two-stage 1,200-case target and complete five-work 2024 Kindle Storyteller development frame
are recorded in `reports/authority-development-frame-2024-2026-09-06.md`.

The complete five-work 2021 Kindle Storyteller development frame and its five first-party
series-positive reviews are recorded in
`reports/authority-development-frame-2021-2026-09-06.md`.

The final direct Reverie-seed review and the intentionally unresolved Dark Forces case are recorded
in `reports/authority-seed-candidate-resolution-2026-09-06.md`.

The complete nine-title Hachette standalone SFF horror frame, its false-label series control, and
the multi-frame sampling support are recorded in
`reports/authority-development-frame-hachette-horror-2026-09-06.md`.

The complete seventeen-title Hachette standalone SFF fantasy frame, its Hart and Mercy false-label
control, three independently confirmed standalones, and thirteen unresolved publisher labels are
recorded in `reports/authority-development-frame-hachette-fantasy-2026-09-06.md`.

The complete eighteen-title Hachette standalone SFF science fiction frame, five independently
confirmed standalones, the false Violet Wars relationship, and thirteen unresolved publisher labels
are recorded in `reports/authority-development-frame-hachette-scifi-2026-09-06.md`.

The complete 2026 Selfies fiction shortlist, its four first-party rulings, and the scout's refusal
to promote two platform-only series hints are recorded in
`reports/authority-development-frame-selfies-2026-fiction-2026-09-06.md`.

The complete 2025 Selfies adult fiction shortlist, its readable-standalone and connected-universe
controls, and two unresolved author-catalog cases are recorded in
`reports/authority-development-frame-selfies-2025-fiction-2026-09-06.md`.

The complete Fern Michaels 2024 and 2025 matching-year release frames, six direct series
relationships, one direct standalone ruling, one connected-universe crossover, and three
conservatively unresolved collection/title cases are recorded in
`reports/authority-development-frame-fern-michaels-2024-2025-2026-09-06.md`.

The no-write scout pass across the prior 18-candidate queue, including its token cost, quarantine
rate, and the human rejection of its sole standalone proposal, is recorded in
`reports/authority-candidate-scout-2026-09-06.md`.

The complete 47-title Kiersten Modglin standalone-label challenge frame, its exact-page Locke
Industries correction, and the deterministic catalog-family quarantine are recorded in
`reports/authority-development-frame-kiersten-modglin-2026-09-06.md`.

The complete 2025 Selfies general non-fiction frame, numbered-sequence correction, selection-source
boundary fix, structural repair path, and cache-cost accounting are recorded in
`reports/authority-development-frame-selfies-2025-nonfiction-2026-09-06.md`.

The 10-case representative replay of the Kiersten Modglin standalone-label challenge, its 100%
grounded but 0% policy-safe result, and the resulting homogeneous-frame spending stop are recorded
in `reports/authority-standalone-risk-replay-2026-09-06.md`.

The complete 30-work Penguin Random House 2026 SFF frame, its balanced scout replay, one promoted
publisher-series relationship, one multi-membership correction, and the reading-independence guard
are recorded in `reports/authority-development-frame-prh-2026-sff-2026-09-06.md`.

The no-write replay of the prior 13 independent candidates, its ten safe abstentions, three
identity-evidence quarantines, and the resulting queue-spending stop are recorded in
`reports/authority-independent-candidate-replay-2026-09-06.md`.

The complete 2024 Selfies adult fiction frame, five first-party series rulings, two unresolved
works, and the scout's cached 100% exact-ruling rescore are recorded in
`reports/authority-development-frame-selfies-2024-fiction-2026-09-06.md`.

The complete 2023 Selfies adult fiction frame, three first-party series rulings, five unresolved
works, and the scout's conservative archive-boundary result are recorded in
`reports/authority-development-frame-selfies-2023-fiction-2026-09-06.md`.

The complete 2022 Selfies adult fiction frame, four first-party series rulings, five unresolved
works, and the scout's third-party source-authority overreach signals are recorded in
`reports/authority-development-frame-selfies-2022-fiction-2026-09-06.md`.

The complete 2021 Selfies adult fiction frame, four first-party series rulings, one affirmative
standalone, three unresolved works, and the scout's discovery and name-normalization gaps are
recorded in `reports/authority-development-frame-selfies-2021-fiction-2026-09-06.md`.

The first-party evidence refresh that promotes _Swimming with Manatees_ from unresolved to Ava
Martinez book one, without rerunning the scout or trusting retail metadata, is recorded in
`reports/authority-evidence-refresh-bill-bennett-2026-09-06.md`.

The complete ten-title CrimeReads November 6, 2023 featured release frame, four publisher/author
series rulings, one affirmative publisher standalone, five unresolved works, and two corrected
selection-source bylines are recorded in
`reports/authority-development-frame-crimereads-2023-2026-09-06.md`.

The first-party correction of _Bulletproof_ from a seeded Dark Forces position into a true
standalone connected-world control, plus the truth-blind scout replay and two discarded
author-social prompt probes, is recorded in
`reports/authority-bulletproof-connected-world-closeout-2026-09-06.md`.

The complete six-title Selfies 2025 children's frame, six direct first-party series rulings, final
development-stratum closeout, and the scout's cached name-alias rescore are recorded in
`reports/authority-development-frame-selfies-2025-childrens-2026-09-06.md`.

## Build the authority gold program

Audit the sample before running another provider or resolver comparison:

```sh
pnpm series:sample:audit
```

The audit reports selection coverage and authority-review coverage separately. The current 126
candidates count as selected works, but never as truth and never toward an accuracy gate. It also
validates that every reviewed result has
affirmative author or publisher evidence, that a reviewed standalone has no memberships, and that
a reviewed series work has at least one.

`data/authority-sample-plan.json` owns the fixed targets and stratum definitions.
`data/authority-candidates.json` is the queue for additional works; moving a work into
`data/authority-gold.json` is a human evidence-review action. A candidate has the ordinary case
identity plus a truth placeholder:

```json
{
  "id": "candidate-example",
  "title": "Example",
  "authors": ["Example Author"],
  "sampleOrigin": "external_sample",
  "strata": ["recent_independent_or_kindle_first"],
  "publicationYear": 2025,
  "publicationPath": "independent",
  "sampleSources": [
    {
      "kind": "author",
      "url": "https://author.example/books/example"
    }
  ],
  "truth": {
    "status": "candidate",
    "standalone": null,
    "memberships": [],
    "sources": []
  }
}
```

Keep the candidate's `id` unchanged when its reviewed record moves into the gold file. Stable case
IDs let the scorer apply new authority truth to previously captured provider observations without
paying for another API run.

Allowed publication paths are `independent`, `kindle_first`, and `traditional`. Complex cases also
carry `riskFeatures` containing `multi_series` or `connected_universe`. Once reviewed, a complex
case must set `truth.membershipsComplete` to `true`; this is the reviewer attestation that all
in-scope memberships—not only the provider's preferred one—were checked. Strata may overlap, which
is how the minimums fit within 200 distinct works without weakening any category.

Recent-publication strata require a recognized `sampleSources` entry supporting the year and
publication path. `selectionFrames` can name a complete, externally defined list such as an award
shortlist; the audit checks its expected case count, common year/path, required stratum, and source.
This makes selection reproducible without pretending that the list organizer is the authority for
series truth. Use the legacy singular `selectionFrame` for one list or `selectionFrames` when the
same work occurs in multiple complete lists; the audit counts the shared work in each frame while
retaining one stable truth record.

Different dated exports or mirrors of the same catalog taxonomy are not independent evidence. If
human review proves that taxonomy internally contradictory, its profiled catalog pages become
identity-only for classification while direct exact-work author or publisher pages remain eligible.

An authority source is an author page, a verified author-controlled post, a publisher page, or a
publisher catalog. A shared authority page may be declared under the gold file's `sharedSources`
and referenced by `truth.sourceGroups`; the existing standalone controls retain the equivalent
legacy stratum reference. A sampling source such as a platform award may select a case but cannot
validate its truth. An archived copy may preserve provenance, but does not turn a non-authority
page into authority evidence. Provider output and LLM output can prioritize the review queue;
neither can write gold truth.

The program has two intentionally separate partitions:

- **Development:** 200 authority-reviewed cases used to improve source adapters, deterministic
  cleaning, prompts, and operating cost. Existing cases default to this partition.
- **Qualification:** 1,000 additional authority-reviewed cases held out from tuning. New records in
  this locked set declare `"evaluationPartition": "qualification"` and are evaluated only after the
  system is frozen.

The minimum complete gold-program target is therefore 1,200 reviewed works. The qualification
partition contains 600 series-positive works and 400 true standalone controls. With zero observed
errors, 598 series-positive controls are required to support a 0.5% false-standalone ceiling at a
one-sided 95% confidence level: false standalone means that a true series work was classified as
standalone. A 99% membership-precision floor similarly requires at least 299 emitted membership
claims with zero false positives. The qualification run must report the actual emitted-claim
count.

## Decision rule

Accuracy is a hard constraint. A provider cannot pass by trading false claims for lower price or
greater coverage. After all hard gates pass, compare eligible providers using the weights in
`data/evaluation-policy.json`.

The current development set passes the overall reviewed, positive-series, standalone-control, and
every sampling-stratum gate. The audit reports `ready for gate evaluation`, so provider and resolver
comparison can proceed against development data. The intended 200-case minimum stratification is:

- the current 69-series Reverie sample;
- 50 recent independent or Kindle-first works;
- 50 recent traditionally published works;
- 20 multi-series or connected-universe cases;
- at least 50 standalone negative controls, with overlaps rebalanced across the other strata.

Overlap should be resolved while preserving the intended stratum counts. A work with multiple
memberships needs every in-scope membership annotated before claim-level precision is fair.

Passing that 200-case development gate does not qualify production accuracy. Production
qualification additionally requires the untouched 1,000-case partition, the 600/400 truth mix,
at least 299 emitted membership claims, and the configured accuracy thresholds. Any case inspected
while changing the resolver belongs in development, never qualification.

When both Open Library and Wikidata are in one run, the report also scores their combined baseline.
Google Books and Hardcover each receive a separate marginal-lift strategy, plus an all-four strategy
when both supplements are present. Only relational claims are combined. Agreement on a position
keeps the position; disagreement keeps the series membership but leaves its order blank for review.
Google can improve exact-work coverage, but cannot create a series membership without relational
evidence from another provider.

## Provider boundaries

- Open Library, Wikidata, and Hardcover are live adapters. For Open Library, only the structured
  `series_name` relationship counts as membership; its legacy `series` field is retained as a
  candidate label.
- Inventaire is a live CC0 adapter. Its work-to-series claim is checked against `serie-parts`; `wd:`
  entities retain Wikidata lineage and do not become a second independent vote.
- BookBrainz is a live CC0 corroboration adapter. Its API is alpha and its observed series roster
  does not provide dependable order, so the adapter leaves position blank.
- Hardcover labels count only after the exact matched book's `book_series` relationship confirms
  them.
- Google Books is an identity comparison, not a durable corpus source.
- LibraryThing/Bowker and NielsenIQ enter through offline sample imports until commercial access is
  negotiated.
- The Internet Archive/Wayback Machine may be stored as provenance for an authority page, but it is
  not a series provider.
- The LLM resolver is not a provider. It can select and explain supplied claims, but its
  output is never source evidence and never bypasses the deterministic review policy.
