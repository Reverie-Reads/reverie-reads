# Series lookup outage recovery

## Scope and diagnosis

September 10 read-only production diagnosis found 847 historical relationship-unavailable results
stored as `no_series`. The classifier emitted `unresolved` with a positive identity and null
confirmed series; the database treated that null as a successful no-label observation. The stable
180-day recheck interval then applied instead of the unresolved 30-day interval. The catalog had
no `found`/`review` work classifications. Those counts are a dated observation, not a repair selector.

Migration `20261002010000` replaces only the RPC, preserving authorization, locking, evidence
allowlisting and relational admission. Explicit unresolved results cannot promote even with an
inconsistent proposed name. Null-name packets with evidence cannot be no-label observations.
Legacy matched/null/empty-evidence callers remain compatible. No historical data is backfilled.

The `series` Edge Function accepts bare or Bearer-prefixed Hardcover tokens like `enrich` already
does. This closes an adapter inconsistency, not a diagnosis of the owner's current credential.
Fixed failure codes distinguish missing configuration, HTTP status, GraphQL failure, malformed
response, no match, empty relationship, timeout, network and internal failure. Logs never include
credentials, queries, names, raw upstream bodies or errors. Successful cache lifetime stays 24 hours;
unavailable rows (including old ones) expire after five minutes. All failures remain unresolved,
never standalone evidence. No LLM, new provider, or paid acquisition is introduced.

## Owner-run rollout

1. Merge the public PR, sync it through the private repo, and deploy from the clean private
   `/Users/gregchism/dev/reverie` main checkout. Use the existing guarded migration and `series`
   function deployment commands documented in `docs/reference/DEPLOY.md`; a human must answer
   the confirmation. This implementation session does not deploy or write production.
2. Verify migration `20261002010000` and the new `series` function are deployed. Do not assume
   a web deployment includes either. Finish/cancel any existing corpus sweep before recovery.
3. Run `docs/queries/series-unavailable-inventory.sql` read-only. Save the output privately.
   Select no more than five works for the first canary. Do not promote legacy labels as evidence.
4. In a private copy of `docs/queries/series-unavailable-retry.sql`, insert ONLY those reviewed
   UUID/fingerprint pairs into `series_retry_input`, and the existing administrator UUID into
   `series_retry_actor`. It refuses empty input, over 25 rows, missing migration, active sweeps,
   changed records and existing live shared slots. It ends in ROLLBACK by default.
5. Inspect the dry run, then the owner may rerun the identical reviewed input with COMMIT instead
   of ROLLBACK. It only changes the classification state and schedules a check; the ordinary audit
   stores complete before/after work snapshots, including the old check timestamp. It does not
   invoke providers, delete caches or alter reader choices. Reuse after commit is refused.
6. The shipped administrator control runs a general completion sweep, not a per-work check.
   Review its complete candidate count before authorizing it: it includes other metadata gaps,
   not just these five rescheduled works. Do not describe it as an exact five-work run. If that
   wider scope is unacceptable, stop here for a separately approved exact-target execution path.
7. Inspect actual saved results, not just the run's `completed`/`filled` counters. Unavailable must
   store `unresolved` with evidence/reason; positive exact relationships may become found or review
   under existing rules. Confirm actual shared slots for accepted memberships and unchanged reader
   choices. Inspect `series` logs for `relationship_unavailable` and the bounded `failureCode` /
   `httpStatus`. A still-unavailable canary is a stop: diagnose that code before expanding.
8. Only after a successful canary, regenerate inventory and review remaining batches (maximum 25
   reset targets each). Never rewrite the entire catalog or remove consumed trial safeguards.

The production cause of the historical provider failures remains unknown; old cached results did
not retain those distinctions. The migration alone will not populate the catalog. Successful
relationship retrieval and owner-run verification remain release gates.

## Local verification

- Regression control: the new 50-assertion discovery test fails six assertions against the old
  local RPC, including the unavailable/null-name outcome and pending-review preservation.
- Fresh reset with the forward migration: the entire database test suite passes, including all
  50 discovery assertions. No production connection was used for these tests.
- The 18 mocked actual-handler tests and 12 classifier tests pass; HTTP is intercepted throughout.
- The app's 930 unit tests and compiler-backed Workflow integration test pass.
- The repository-wide `pnpm test` run is **not green**: the untouched Google trial scheduler's
  `paces concurrent workers through one shared request-start schedule` test failed its 20ms
  request-spacing assertion (402/403 trial tests passed). No trial files were changed or live
  providers called. This failure was not retried away.
- Full fresh-database browser run (default one worker, retries zero), final build/static checks,
  and the rollback recovery script checks are in progress; record their results before release.
