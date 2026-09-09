# Recent-edition selective ISBNdb trial: results

## Decision

Keep ISBNdb as a selective, review-only format supplement. Five eligible lookups produced five
edition-format proposals that agreed with the frozen publisher references. Every one of those
records still required review because its page count conflicted with the baseline. This is useful
field-level evidence, not five clean records, a correction result, or production qualification.

Do not widen provider coverage or put raw Google page counts into the LLM as trusted facts. The
next step is a bounded field-level review packet that preserves missing fields, disagreements,
source attribution, current-value protection, and abstention independently. Rights/retention and
review-interface gates still precede persistence or product integration.

## Frozen run

- [Preregistered selection, controls, references, limits, and stop rules](metadata-gap-plan-2026-09-08.md).
- [Aggregate result](metadata-gap-results-2026-09-08.json).
- Runtime lock: `35c214cd7e9d8244a61d7c72f0aa312fd9f6138b`; trial runtime unchanged from merged #488.
- Frame SHA-256: `5027f82d414c7bbf6cc7dc832aac5c82438a9b5b61acaebe02e60e14ea386367`.
- One completed run: 2026-09-09 02:02:56.992–02:03:20.245 UTC (September 8 locally), 23.248 seconds.
- Ten editions across four works/authors; four paperback/hardcover pairs plus two audiobook
  controls. One publishing group, English only, convenience sample. Editions are not independent
  work-level observations. No claims about long-tail, multilingual, or population accuracy.
- The start marker and output were created exclusively. No refresh, retry, replacement case,
  reference edit, or runtime change followed acquisition. Prior completed results are untouched.

## Observed routing

| Decision | Cases |
| --- | ---: |
| Baseline identity/edition review | 3 |
| No admitted baseline identity | 1 |
| Incomplete baseline attempt | 1 |
| Eligible ISBNdb lookup | 5 |

Google returned six admitted identities, two title-mismatch reviews, one not-found result, and
one server error. Open Library returned one admitted identity, two title-mismatch reviews, and
seven not-found results. Provider outcomes can overlap by case. Three cases were routed to baseline
review; the aggregates cannot recover the exact distribution of all four provider title reviews,
including possible overlap with an incomplete attempt. The finite reason identifies the first failed title guard;
it does not prove whether omission, subtitle wording, promotion text, or a different work caused it.
No raw titles were retained to diagnose that distinction after the run.

Nine cases had completed baseline attempts, including reviews; this is not nine accepted identities.
Five cases had a single-source page observation and no baseline format observation. Unknown format
was an actual acquired gap, not a masked field, and triggered the five ISBNdb calls.

## Field observations

| Provider / field | Available or proposed | Agrees with publisher reference | Differs | Unscored |
| --- | ---: | ---: | ---: | ---: |
| Google pages, after identity admission | 6 | 0 | 6 | 0 |
| Google edition format | 0 | 0 | 0 | 0 |
| Open Library pages | 0 | 0 | 0 | 0 |
| Open Library edition format | 0 | 0 | 0 | 0 |
| ISBNdb missing-format proposals | 5 | 5 | 0 | 0 |
| ISBNdb missing-page proposals | 0 | 0 | 0 | 0 |

All five ISBNdb responses passed the strict identity, long-title, binding, and supplied-language
guards far enough to produce a format proposal. All five assessments were `review`, not clean
`candidate`, because of page conflicts. Format conflicts were zero. The empty supplement-reason
map is expected: these are field conflicts, not early identity/format rejection reasons.

The benchmark only scores ISBNdb **new-field proposals** against reference truth. It did not score
ISBNdb's competing existing-field page counts, so this result does **not** establish that ISBNdb's
pages were correct or that it corrected Google. No source values were retained. Similarly, six
Google disagreements do not establish why the values differ or imply a catalog-wide error rate.

Five out of five format proposals is encouraging but far too small and selected to justify an
automatic trust threshold. Publisher references were reviewed separately from API responses,
but shared upstream feeds remain possible. Source agreement is not proven independence.

Both controlled current audiobook formats remained protected. No `not_applicable` page state was
reached in the field-evidence aggregate: this run does not provide new live proof of successful
audio-page applicability handling. Identity/unavailability gates take precedence; offline tests
remain the evidence for the applicable-audio branch. No user values were edited.

## Cost and retention

| Provider | Actual requests | Ceiling |
| --- | ---: | ---: |
| Google | 10 | 10 |
| Open Library, including redirects/authors | 16 | 40 |
| ISBNdb | 5 | 8 |
| LLM / Exa / PRH API | 0 | 0 |

31 provider HTTP requests total; no provider was stopped for quota/authentication. Google had one
server error, recorded without retry. Baseline HTTP time was 3.308 seconds Google and 13.423 seconds
Open Library, excluding deliberate pacing; the 23.248-second wall time is a sequential developer
batch, not an interactive latency promise. ISBNdb adds five subscription requests. No purchase,
upgrade, or LLM/Exa credit consumption occurred; billing and remaining balances were not queried.

Only aggregate outcomes, the frame hash, lock, counts, and timing are published. Independent
publisher-reference input stays owner-only and Git-ignored. Tested-provider values, payloads,
identities, raw errors, and case-level outcomes were not persisted. There was no Supabase, corpus,
personal-row, production flag, migration, deployment, public-gold, or private-repo change.

## Next evaluation boundary

1. Keep useful format proposals separate from disputed pages in any future review packet. A record
   marked `review` must not accidentally erase its useful field or bless its conflicting field.
2. Evaluate disputed page counts against edition-specific independent references in a **new**,
   preregistered review experiment. This gap-only run cannot answer which competing page count wins.
3. If an LLM is introduced, require cited supplied evidence and allow explain/review/abstain only.
   Do not give it authority to strip qualifiers, repair identity, invent pages, or overwrite values.
4. Do not rerun this inspected set for a better score, infer that five proposals represent broad
   coverage, or bypass rights and retention review to create a persistent provider-value graph.

## Verification

The unchanged runtime passed 308 trial tests and the new frame passed the credential-free dry run.
Full repository lint, typecheck, unit tests, and build passed. Unit counts: core 2,688; trial 308;
web 875; compiler-backed Workflow integration 1. Formatting and diff checks are recorded in the PR.
This branch changes documentation/aggregate results only; under AGENTS.md's docs-only exemption,
no fresh database/browser suite was run and the shared local stack was not used. Merged #488's
runtime verification remains separate evidence, not a new test result for this branch.
