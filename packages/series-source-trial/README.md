# Reverie series-source trial

This package compares book-series data providers against the same cases and acceptance policy.
It does not write to Supabase or modify Reverie's corpus.

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

The committed origin registry still activates no real retrieval origin. Current live scout reports
therefore enrich review packets only; they cannot make a Hardcover candidate automatic.

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
hashes, and persistence redaction. It deliberately has no production integration, and the
repository activates no real origin profile. The opt-in pipeline adds a second strict, no-tools
model pass only when the first pass is unresolved or quarantined. It binds citations and source
kind to the retrieved child manifest, hash-checks the packet, and skips the model entirely when the
exact target title or author is absent. Post-validation requires a non-heading evidence line to join
the exact target title to each claimed bibliographic series or affirmative standalone statement;
position and membership role survive only on that same relationship line. This prevents a model
from joining one book's identity to another book's series facts on a multi-book page. The packet is
stripped before returning or caching results. Exercise the boundary with:

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

With the committed registry this remains a no-network retrieval dry run: its real-origin entries
are pending or manual-only, so the command records `origin_pending` and does not fetch them. An
unchanged successful second-pass interpretation is cached by packet hash without retaining evidence
text. Origin activation requires a separate human rights/access review and cannot be supplied by
model output or a CLI flag.

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

The complete gold-program target is therefore 1,200 reviewed works. The qualification partition
contains 400 series-positive works and 600 true standalone controls. With zero observed errors,
598 standalone controls are required to support a 0.5% false-standalone ceiling at a one-sided 95%
confidence level. A 99% membership-precision floor similarly requires at least 299 emitted
membership claims with zero false positives. The 400 positive works make that claim denominator
possible, but the qualification run must report the actual emitted-claim count.

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
