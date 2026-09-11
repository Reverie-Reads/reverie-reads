# ISBNdb retirement and retention handoff

Owner decision: stop treating ISBNdb as a planned long-term data source. The completed study
demonstrated useful edition metadata, but did not establish enough recurring value to justify
subscription-dependent retention. This change does not rerun, reprice or reopen that study.

## Implemented and deployment verified

Public PR #505 and private sync PR #42 are merged. The owner confirmed trial cancellation
and deployed from `/Users/gregchism/dev/reverie` on private main
`c620a81f59791a13a15e2acb1a7e16a065f87b74`. A subsequent read-only download verified ACTIVE
`enrich` version 19 and an exact match of the deployed enrichment directory to that checkout,
including the removed adapter and `no-isbndb-v1:` cache key. This was artifact verification,
not an authenticated production request or a stored-data cleanup. The effective subscription-end
date and obsolete hosted-secret removal remain unverified.

- Remove the production enrichment HTTP adapter and its now-unused raw-response normalizers.
  Neither `ENRICH_SOURCES=isbndb` nor the old key/enable flag can activate it. The active roster
  contains only Open Library, Google and optional Hardcover; unknown/inherited object keys are
  rejected. Fast mode also honors the configured free-provider roster.
- Use `no-isbndb-v1:` cache keys for both ISBN and title/author enrichment. The owner-run corpus
  backfill shares that definition and rejects off-roster returned keys. No fallback to old keys.
- Keep historical source types and already-normalized merge compatibility. Those are not live
  acquisition paths. The trial harness is historical and untouched, not authorized for new calls.

The September 11 Google display-boundary follow-on removes Google from automatic enrichment and
advances the active cache namespace to `durable-sources-v1:` so historical mixed Google rows cannot
re-enter that path. This follow-on does not rewrite existing reader choices or historical rows.

- Preserve old cache rows, personal choices, shared works and audit history. No deletion,
  credential change, billing change, corpus update, migration or deployment occurs in this patch.

The namespace change deliberately causes one cache miss per revisited enrichment identity;
normal cache reuse resumes afterward. Existing provider pacing stays in force. Search's `search:`
and cover-picker `editions:` caches use separate free-provider paths and are unchanged. Old cache
rows remain stored: excluding them from enrichment is not compliance deletion.

## Why removing source-labelled fields is insufficient

The merge retains scalar provenance, but authors, categories/genres and ISBN collections are
unioned without a complete per-contribution lineage. A record with only Google-labelled scalar
fields could still have incorporated an ISBNdb union member. Filtering a scalar source label is
therefore not proof that a historical record is safe to reuse.

The personal bulk-enrichment path maps page counts, dates, authors and genres into ordinary book
fields without retaining all corresponding provider claims. Shared corpus enrichment retains
more field provenance, but that cannot retrospectively identify every personal value. Existing
reader choices must not be cleared merely because they match a possibly restricted value.

Relevant code: `enrich/index.ts` and `merge.ts`, `scripts/corpus-backfill.ts`,
`apps/web/src/data/enrichLibrary.ts`, `apps/web/src/lib/corpusSweepPolicy.ts`, and
`20260831010000_corpus_admin_enrichment.sql` (fill-only provenance).

## Read-only live inventory — September 9, 2026

Target project was matched against both saved Reverie checkout links. The hosted `enrich`
function was ACTIVE at version 18 during the pre-deployment inventory. The subsequent version 19
verification is recorded above; this section preserves the earlier audit. Hosted
environment values and historical request logs were not retrieved.

Its source was downloaded read-only into a temporary directory. The deployed entrypoint matched
the pre-retirement `origin/main` entrypoint byte-for-byte (SHA-256
`1aab7bdecc1c7f95c452e46292b498a07529099c5539d0992c215d36b4f8c950`). It still contains
the ISBNdb adapter, CSV activation path and legacy unversioned cache keys. No live enrichment
request was made because that endpoint can write caches/rate-limit state.

The [inventory](../queries/isbndb-exit-inventory.sql) returns counts only: no identities, record
values, keys or personal annotations. Its [known-answer controls](../queries/isbndb-exit-inventory-controls.sql)
passed 8/8 on both local and production databases. Both queries are single read-only SELECTs;
the local and linked CLI invocation forms were executed successfully.

| Surface                             | Rows examined | Explicit ISBNdb source markers | URL/ID hints |
| ----------------------------------- | ------------: | -----------------------------: | -----------: |
| Enrichment cache                    |         3,243 |                              0 |            0 |
| Shared works                        |         1,345 |                              0 |            0 |
| Personal books (source fields only) |         1,352 |                              0 |            0 |
| Shared metadata edit history        |         5,303 |                              0 |            0 |
| Metadata review events              |             0 |                              0 |            0 |
| Cover review events                 |             0 |                              0 |            0 |

**No detected markers is not proof of independent origin or an empty ISBNdb footprint.** The
controls explicitly show that an unattributed union is undetectable. Positive markers would be
review leads, not automatic deletion targets. The URL/ID heuristic can also produce benign hits.
This inventory does not inspect Storage bytes, backups, exported files, browser/offline caches,
embeddings or every historical data path. No rows were exported or changed.

## Remaining owner-controlled exit steps

1. Cancellation is owner-confirmed. Record the actual effective subscription-end date; it has
   not been independently checked and must not be inferred from the cancellation message.
2. The owner-run enrichment deployment is complete and its artifact verified. Remove obsolete
   ISBNdb secrets/settings deliberately if still present; this session has not removed them.
3. Check historical provider-use evidence and inventory other holdings before deciding whether any
   removal is required. The published [terms](https://isbndb.com/terms-and-conditions), last read
   September 9, require ending use and deleting ISBNdb-derived data within 30 days after the
   subscription ends, including incorporated data and backups. Bare ISBNs and independently
   created/obtained data are excepted; LLM rewriting does not establish independent sourcing.
4. If restricted holdings are identified, prepare a separately reviewed, exact-target cleanup and
   backup-retention plan. Do not delete whole books, user history, independent facts, or source
   evidence indiscriminately. The present inventory does not establish indefinite retention rights
   for every trial artifact. Preserve non-content single-use locks so the study cannot be reopened.

No new ISBNdb contact or paid acquisition is needed to implement this decision. This handoff is
not a legal opinion or a claim that every possible retained derivative has been cleared.

## Next quality work without another paid feed

The [fresh six-edition diagnostic](google-edition-diagnostics.md) found search/detail page-count
disagreement for the same Google volume IDs. Detail agreed with five publisher counts but still
disagreed on one; it is not automatic-trust clearance. Keep exact edition matching separate from
work identity, then test field-specific trust,
publisher/imprint normalization and preservation-safe conflict handling. Measure improvements and
abstentions separately. The existing LLM may select, corroborate or explain supplied evidence; it
must not manufacture missing facts or rebrand restricted data as independently acquired evidence.

## Verification

The actual enrichment handler is executed with a stubbed Deno host and intercepted HTTP: retired
CSV/flag/key combinations, free-provider success, fast/full modes, refresh, ISBN/title cache
cutover, unchanged legacy rows, and new-cache reuse. This is not a hosted Deno deployment test.
Backfill tests assert no legacy promotion and preserve pre-write collision checks.

Deliberate negative controls validate the handler tests: replacing the new cache key with the old
identity key fails both ISBN/title cases by returning the retired fixture payload; reintroducing
a synthetic paid adapter fails the outbound-host assertion. Both mutations were reverted to the
committed implementation and all nine handler tests passed again. HTTP stayed intercepted.

One full fresh-local-database browser run passed: 265 passed, 10 skipped, zero failures, default
one worker, retries zero, 24.3 minutes. The run used the retirement branch before importing the
independent brand-tour PR #504 UI changes; current-main synchronization happened only afterward.
Final merged-tree CI remains a separate gate. Full repository gate results are recorded in the PR.
The initial local `pnpm lint` found
an unused variable in an ignored private study-preparation script. Private trial input/result
directories are now explicitly excluded from ESLint, leaving frozen artifacts untouched. No
live book-provider requests are made by these tests, and no production behavior is verified by
the browser suite, which uses the local database.
