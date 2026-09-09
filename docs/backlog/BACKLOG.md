# Reverie backlog

Living record. Items leave by being done or by an explicit decision, not by being
forgotten.

This file is an evidence ledger, not the execution order. Current priorities and dependencies live
in the root `ROADMAP.md`. Before promoting an entry into active work, re-check its last verification
stamp against current `origin/main` and create or refresh a brief in `docs/tasks/`.

> ## These entries age. Check before you build.
>
> **An entry describes the code as it was WHEN WRITTEN, not a live mirror of the tree.** That is
> not a flaw to be fixed by writing more carefully — it is what a written record IS, and this
> project has now paid for the lesson four times (§0.7 twice, §2.6 once, and the series-cluster
> audit below). In §2.6 the drift **changed a product decision**. Four consecutive prompts have
> been drafted from entries that turned out to be already fixed.
>
> **So: read the entry, then check the tree, then check ancestry.** `git log -S"<string>" -- <path>`
> and `git merge-base --is-ancestor <sha> origin/main` are the two commands that settle it. Do not
> judge an entry by its own confidence; a confident entry is exactly the one that reads as current
> when it is not.
>
> ### Audit status, per section
>
> | section                            | last audited             | result                                                                                                                                                 |
> | ---------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | Real bugs, outstanding             | **2026-08-20** (batch 1) | 21 live entries: 9 CLOSED, 9 OPEN (stamped), 1 rewritten from source, 2 unverifiable from a Code session                                               |
> | Conventions — established patterns | **2026-08-20** (batch 3) | 1 live: 1 ACCURATE (stamped)                                                                                                                           |
> | Deliberately partial, and why      | **2026-08-20** (batch 3) | 2 live: 2 OPEN (stamped)                                                                                                                               |
> | Grep audit, 2026-08                | **2026-08-20** (batch 3) | 5 live: 2 CLOSED, 1 WRONG AS WRITTEN, 2 OPEN (one recounted)                                                                                           |
> | Pre-public tracked-data decisions  | **2026-08-20** (batch 3) | 3 live: 2 OPEN (one WRONG AS WRITTEN on its reason), 1 stale-coordinates                                                                               |
> | Known-flaky, with a prior          | **2026-08-20** (batch 2) | 5 live: 1 CLOSED, 3 OPEN (stamped), 1 rewritten from source                                                                                            |
> | Test-infrastructure follow-ups     | **2026-08-20** (batch 2) | 9 live: 1 CLOSED, 7 OPEN (stamped), 1 unverifiable from a Code session                                                                                 |
> | Product queue                      | **2026-08-22** (batch 4) | 6 live units: 4 CLOSED, 2 OPEN (stamped) — the 2026-08-18 stamp had gone stale on four of the six                                                      |
> | everything below Product queue     | **2026-08-22** (batch 4) | 9 live: 6 OPEN (stamped), 1 corrected from source (one table row), 1 PARTIAL (one sub-point wrong as written, 3 unverifiable), 1 carries no tree claim |
>
> **Only the audited section carries stamps.** An entry with no `verified` stamp has not been
> checked against source since it was written — treat its age as unknown, whatever its tone.

## In flight

- Nothing. The infrastructure arc is done: CI landed (`chore/ci`), the trio moved
  off the shared dev account (`test/trio-migration`), throughput stages 1–2
  landed and stage 3 was cancelled on its own measurements
  (`docs/archive/task-ci.md`). Everything below is product or its own branch.

## Real bugs, outstanding

> **PERISHABLE — audited entry by entry 2026-08-20 (batch 1 of the file).** Every live entry below
> was read, checked against the tree, and checked for ancestry on `origin/main`. Result: **9 CLOSED**
> (struck, each naming the commit, original folded into a `<details>`), **9 OPEN** (each stamped with
> what it was verified against), **1 rewritten from source** because the entry misdescribed a defect
> that was half-shipped, **2 unverifiable** from a Code session and said so rather than guessed.
>
> The stamps are the point: an entry here carrying `verified 2026-08-20` was checked on that date
> against the file:line it names. One carrying nothing was not. **The stamps themselves age** — a
> month from now this section needs the same treatment, and the honest read of a stale stamp is
> "true once", not "true".
>
> Sections other than this one are UNAUDITED (see the table at the top of the file).

> **Series-cluster audit, 2026-08-14.** All eight series-data-integrity entries were re-verified
> against current source, after four consecutive prompts were drafted from entries that turned out
> to be already fixed. **Four are CLOSED** (struck through, each naming the commit that closed it,
> original text folded into a `<details>` so the reasoning survives); **four remain OPEN and are
> accurate as written**. The audit checked code only — where an entry's closing condition also
> requires a production deploy, that half is called out as unverifiable from a Code session.
>
> | entry                                                   | state                                                                                                                  | closed by                                                 |
> | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
> | `merge_books` doesn't fold `series_user_chosen`         | **OPEN** — latest definition is `20260815010000`, which predates the column (`20260818010000`) and mentions it 0 times | —                                                         |
> | Nothing scores confidence on a surviving `series` value | **OPEN** — accurate; the wrong-series risk it describes as closed _is_ closed, the review-bucket gap is not            | —                                                         |
> | `useRemoveEntry` two sequential writes                  | CLOSED                                                                                                                 | `0dfe63e` (+ deploy of `20260731010000`, unverified here) |
> | "Series of N" pill on a removed book                    | **OPEN** — `BookDetailRoute.tsx:257` renders `<Pill>{seriesBadge}</Pill>` ungated; deferred product decision           | —                                                         |
> | `useMoveEntry` renumber 2n round trips                  | CLOSED                                                                                                                 | `a6e1937`                                                 |
> | `syncBookPosition` swallowed mirror write               | CLOSED                                                                                                                 | `a6e1937`                                                 |
> | Archived tombstones keyed on (series, position)         | **OPEN** — `slotKey` is still `${seriesId}@${position}`; v-next format decision                                        | —                                                         |
> | `useSyncBookSeries` unprotected shape, inverted         | CLOSED                                                                                                                 | `b60707d`                                                 |
>
> Entries outside the series cluster were **not** re-verified in this pass and may carry the same
> drift.

- ~~**`merge_books` doesn't fold `series_user_chosen` when a loser's series field wins the merge.**~~ **CLOSED — verified against source 2026-08-20.** `20260824010000_merge_books_fold_series_user_chosen.sql` adds the fold: it captures the loser's provenance and ORs the flag into the survivor. The entry's own edge case — a loser's reader-chosen series winning via `p_fields` and carrying no flag — is the one that migration closes. Closed by `395d806`.
  <details><summary>original entry</summary>
  - **`merge_books` doesn't fold `series_user_chosen` when a loser's series field wins the merge.**
    `feat/series-user-chosen` added the column and taught `sync_book_series`/`remove_series_entry` to
    set it, but left `merge_books` untouched: the primary keeps its own flag, which is correct in the
    common case (the primary's series was already provenance-tracked or blank). The narrow edge is a
    loser whose reader-chosen series wins via `p_fields` — the winning value carries no flag afterward,
    so a later enrichment sweep could treat it as fill-only and silently replace it. Folding OR logic
    into `merge_books` (winning flag = primary's OR loser's, whichever field actually won) is its own
    change with its own pgTAP.

  </details>

- **Nothing scores confidence on a surviving `series` value the way `cover_confidence` does for
  covers.** `feat/series-user-chosen` withholds `low`/`none`-confidence series entirely rather than
  attaching a disclaimed one, so the immediate wrong-series risk is closed — but a `medium`-confidence
  series that does get attached has no recorded confidence for a future review bucket to key off, the
  way the cover pipeline's import-review "low-confidence cover" bucket does. Worth its own look if a
  series-side review bucket becomes wanted. **Not covered by series-consolidation PR 3** — that
  queue proposes merges between two `series` ROWS on name similarity; this is per-book provenance on
  one book's `series` FIELD from an enrichment match. Different subject, signal and surface, so
  neither closes the other.

  <sub>**verified 2026-08-20** — still OPEN: no `series_confidence`/`seriesConfidence` exists anywhere in `packages/core/src` or `apps/web/src`, against 34 occurrences of `cover_confidence`; no migration defines such a column.</sub>

- ~~**The six `sameRiskAsPowerSymbol` glyphs are the same defect, unfired.**~~ **CLOSED — 2026-09-09.**
  `apps/web/src/lib/glyphAllowlist.ts` tiers `⏹` `⏱` `⌕` `⌂` `⌘` (Misc Technical,
  U+2300–U+23FF — the exact block `⏻` came from) and `⠿` (Braille Patterns,
  U+2800–U+28FF) as flagged, not fixed. No skin's custom font covers either
  block — verified against Hanken Grotesk's own `unicode-range` descriptors,
  which stop around U+206F — so all six already fall through to the OS on every
  skin, same as the sign-out button did. `⠿` is the `SeriesArranger` drag
  handle; the other five are `SettingsRoute`'s sweep Stop/trace buttons,
  `DiscoverRoute`'s search affordance, and `AppShell`'s nav icons. **Convert all
  six to inline SVG in a follow-up branch, matching `PowerGlyph`'s pattern,
  rather than waiting to spot each on a real device one at a time.**

  <sub>The Home and Command text marks had already left shipping source. Stop, timer, search, and
  grip now render through `UtilityGlyph`; the same-risk tier is empty, and the source scanner fails
  if any text character from Misc Technical or Braille Patterns returns.</sub>

- **`a11y.spec.ts:309` timed out once on `fix/signout-glyph-tofu`'s standing e2e
  run — `page.waitForLoadState` exceeded 600000ms, not an axe violation.**
  One run, not re-run (the standing-rule reason: a green re-run would launder a
  real defect into "just a flake," so a single red run is reported as red and
  left for a second occurrence to confirm). The diff on that branch was two new
  files (`PowerGlyph.tsx`, `glyphAllowlist.ts`/`.test.ts`) plus a JSX swap in two
  sign-out buttons — nothing touching routing, navigation, or load timing, so
  there's no mechanism in the diff that plausibly explains a page load stalling
  for ten minutes. Recorded so a recurrence has a prior to compare against,
  same reasoning as the `discover-search.spec.ts:275` entry under
  "Known-flaky, with a prior": a second failure here is a defect, not a flake.

  <sub>**2026-08-20: UNVERIFIABLE FROM HERE** — needs the original CI run or a re-run of that branch's suite; the timeout was a one-off observation and the line has since moved. Nothing in the tree can confirm or refute it.</sub>

- **The Supabase MCP connection reaches only project `cywpkhtpxekmjvuoloem`
  ("Steppe") — a different application, not Reverie.** Its tables are `groups`,
  `events`, `neighborhood_requests`, `moderation_actions`; `public.books` does
  not exist there. Discovered mid-`fix/sweep-pace-analysis`/`fix/sweep-instrumentation`
  after `get_logs` returned only infra health-check rows and `execute_sql`
  against `public.books` raised `42P01`. **Any prior report in this project's
  history that claimed to have read Reverie's production database or edge-function
  logs through the MCP connection was, without exception, reading Steppe's data
  (usually an empty result) and reporting the emptiness as a fact about Reverie.**
  I have not gone back to audit which specific past reports made that claim — flag
  and re-verify by hand if one is being relied on. Until the connection is pointed
  at the right project (or a different read path is set up), Reverie production
  reads are the owner's to run, not Code's — see `docs/reference/DEPLOY.md`'s existing rule
  that write access is never Code's; this extends the same boundary to reads
  through this particular tool, which silently produced wrong-project answers
  rather than an error.

  <sub>**2026-08-20: UNVERIFIABLE FROM HERE** — an MCP/environment configuration fact, not a source fact. Confirming it needs a live MCP session; the project id appears nowhere in the repo.</sub>

- **Production ACL verification belongs in the deploy protocol — nothing checks it after a deploy.**
  <sub>**REWRITTEN FROM SOURCE 2026-08-20 — the entry as written was WRONG.** It asked for one thing;
  half of it shipped. The CONVENTION half is DONE: `AGENTS.md` now carries the
  revoke-by-name rule for every new RPC (2 occurrences of `revoke execute`), and
  `20260801010000_revoke_public_execute.sql` is on `main`. The PROTOCOL half is still
  open: `docs/reference/DEPLOY.md` contains zero mentions of `proacl` and has no
  post-deploy grant-verification step. What remains is only the deploy-protocol
  addition, not the convention.</sub>
  today.** `20260801010000` revoked EXECUTE from PUBLIC across every RPC and was
  deployed and reported as done. Nobody read prod's `proacl` afterwards. A
  platform-side bulk `grant ... on all routines in schema public to postgres,
anon, authenticated, service_role` later put an explicit `anon=X` back on all
  **17** functions in `public`, and it stayed that way for days — found only
  because a screenshot of an unrelated series bug prompted someone to look. The
  revoke itself never failed; it was made irrelevant by named grants layered over
  it, which `revoke ... from public` would not have touched.
  Two things follow. First, **deploying a grant is not the same as verifying it
  landed and stayed\*\*: `docs/reference/DEPLOY.md` should require reading `proacl` after any
  migration that touches grants, and there is a case for a periodic check rather
  than a post-deploy one, since the change arrived with no deploy of ours. Second,
  the mechanism is outside this repo and can recur at any time with no
  notification — `fix/rpc-body-defense` responded by making every function refuse
  unauthorised callers in its own body, so the ACL is defence in depth rather than
  the boundary. Re-revoking alone would have been undone by the next platform
  event. A verification step is still worth having: it is how we would learn the
  grants had moved at all.

  **CHECKED 2026-08-15 — this instance closed; the entry stays open.** The check itself was finally
  run, read-only, by the owner in the dashboard SQL Editor. Result on the question it asked:
  **all 14 functions `20260801010000` revoked are clean** — every one reads
  `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`, with no `anon=` entry
  and no empty-grantee `=X/` PUBLIC entry, read from raw `proacl` rather than from a derived
  column. The 2026-07 bulk grant has not recurred on them.

  **It did, however, surface drift on four OTHER functions**, which is the entry's point made
  again: `rate_limit_consume` and `prune_rate_limits` carried an unintended `authenticated`, and
  `backfill_series_from_titles` and `reset_seeded_user_edited` carried `anon` **and**
  `authenticated`. Cause, in one line: those migrations wrote only `revoke ... from public`, and
  Supabase's default privileges hand every newly-created function named grants to
  `anon`/`authenticated`/`service_role` — which a `public` revoke does not touch. Revokes drafted
  here, reviewed and run by the owner the same day.

  **What that drift did NOT do is expose anything**, and the reason is worth recording: the two
  rate-limit functions refuse non-`service_role` callers in their own bodies
  (`20260806010000_rpc_body_defense.sql`), and the other two are `security definer = false`, so
  they run as the caller under RLS. The defence-in-depth this entry describes was observed doing
  its job in production for the first time — the ACL drifted and nothing was reachable.

  **NOT struck**, because the entry's actual ask is unbuilt: this was a one-off manual check, and
  what it asks for is a step in the deploy protocol (`docs/reference/DEPLOY.md`) plus a periodic
  check, since the change that caused it arrived with no deploy of ours. The convention half is
  now closed — AGENTS.md's RPC-grant rule requires revoking `anon`/`authenticated` by name.

- ~~**The deploy guard's `y/N` is the only real gate, and it is not the last one.**~~ **CLOSED —
  the guard now passes explicit downstream approval only after its own human `y/N` succeeds, and a
  mock-CLI regression asserts the exact invocation.**
  After the guard confirms, `supabase db push` asks its own question — _do you
  want to push these migrations_ — defaulting to **yes**, and it takes EOF as
  yes. So in any non-interactive invocation (a piped confirmation, CI, a script)
  that second prompt auto-accepts and is not a gate at all. Observed on the
  2026-07-28 production deploy: the guard consumed the piped `y`, then the CLI's
  own prompt hit EOF and proceeded by itself. Not dangerous today — the guard's
  confirmation is genuine and runs first — but the touch-list is written as
  though the guard's prompt were the final word, and it isn't. Options: pass
  `--yes` so the second prompt is acknowledged rather than accidental, or feed
  the CLI its own confirmation and stop depending on EOF semantics we don't
  control. Recorded during `fix/deploy-guard`, deliberately not fixed there.
  <sub>Historical observation verified 2026-08-20; closed 2026-09-04.</sub>
- ~~**Every `security definer` RPC in the repo is anon-callable, and the ownership `raise` is the
  only thing stopping it.**~~ **CLOSED — verified against source 2026-08-15.** Closed by `9f338d9`
  (#110), which is the migration this entry proposes: `20260801010000_revoke_public_execute.sql`
  revokes `execute … from public` across the RPCs. Verified by `proacl` on the local stack — both
  functions named below now read `{postgres=X/postgres,authenticated=X/postgres}`, PUBLIC gone.

  **The convention this entry asks for, stated so the next reader doesn't misread a grant as an
  oversight: TRIGGER FUNCTIONS ARE OUT OF SCOPE.** `handle_new_user`, `set_updated_at` and
  `bump_club_activity` still carry PUBLIC execute, deliberately. All three `return trigger`, and
  `20260801010000`'s own commit message records the check: calling one directly raises "trigger
  functions can only be called as triggers" — a hard Postgres restriction independent of any grant,
  confirmed as superuser so no grant could have been the reason. They are not RPC-shaped and were
  left alone on purpose. (Note `set_updated_at` is not even `security definer`; a `prosecdef`-filtered
  audit query misses it, which is how docs/audits/backlog-nonseries-audit.md came to list two rather
  than three.)

  <details><summary>original entry</summary>

- **Every `security definer` RPC in the repo is anon-callable, and the ownership
`raise` is the only thing stopping it.** Postgres grants `EXECUTE` to `PUBLIC` by
default, so `grant execute on function … to authenticated` is **additive, not
gating** — it adds nothing that PUBLIC didn't already have. Observed against the
local stack with the anon key: `POST /rest/v1/rpc/remove_series_entry` returns
`P0001 not owner of series entry` and `rpc/merge_books` returns `P0001 not owner of
primary book` — both reached the function body and were turned away by the check
inside it, not by a grant. `proacl` on both reads
`=X/postgres | postgres=X/postgres | authenticated=X/postgres`, where the empty
grantee is PUBLIC.
**No exposure today**, and deterministically so: `security definer` runs the body,
`auth.uid()` is null for anon, and `owner_id = null` is never true, so the first
statement always refuses. The hazard is structural rather than current — it means
the `raise` is the entire boundary on every RPC here, and any future RPC whose
first statement is _not_ an ownership check inherits a function an unauthenticated
caller can run. The two that exist are written correctly; nothing enforces that the
third will be.
Fix is a small migration revoking `execute … from public` across both (and a
convention for new ones) — **its own branch**, because it should cover `merge_books`
in the same change and a red run there needs to mean one thing. Found during
`fix/atomic-series-removal-client` while testing the `pgrst_ddl_watch` schema-cache
reload, which is how an anon call came to be made at all.

  </details>

- ~~**`useRemoveEntry`**: two sequential independently-committed writes, no transaction.~~
  **CLOSED — verified against source 2026-08-14.** `useRemoveEntry` (`series.ts:547`) is now a
  single `supabase.rpc('remove_series_entry', { p_entry })` with `if (error) throw error`; `bookId`
  is no longer passed. Closed by `0dfe63e` (S3b, 2026-07-29). The entry's own closing condition also
  required `20260731010000` to be deployed — that half is NOT verifiable from a Code session; run
  `docs/queries/pending-migrations-check.sql` to confirm. Original text kept below for the reasoning
  about revive-on-refresh, which is still the best description of why the half-committed state was
  worse than stale.

  <details><summary>original entry</summary>

- **`useRemoveEntry`** (`apps/web/src/data/series.ts` ~L353): two sequential
  independently-committed writes, no transaction. A failure between them leaves
  `series_entries` removed while `books.series` still names it. The open question
  recorded here — whether the revive-on-refresh mechanism covers the half-committed
  shape — is answered, and the answer is the opposite of covering it: the revive pass
  (~L192-208) REVIVES any tombstone whose title matches a book still naming the
  series, so the half-committed state does not go stale, it silently **undoes the
  removal** on the next read of that page. **S3a landed the schema half** —
  `remove_series_entry` (`20260731010000`), atomic and ownership-checked, proven by
  `supabase/tests/series_removal_test.sql`. **S3b switched the client** — one
  `supabase.rpc('remove_series_entry')`, `bookId` no longer passed, guarded by an e2e
  request-shape assertion that carries the atomicity claim (state cannot: the old path
  also ended correct, just not simultaneously) plus a test that builds the
  half-committed state by hand, shows revive undoing the removal, and shows the RPC
  path leaving nothing to revive from. **This item closes when S3b merges AND
  `20260731010000` is deployed** — the client is useless without the RPC and merging
  ahead of the deploy ships a frontend calling a function production does not have.
  Rows already in this shape are not healed by the fix —
  `docs/queries/half-committed-series-removals.sql` finds them.

  </details>

- ~~**A book removed from its series still wears a "Series of N" pill.**~~ **CLOSED — verified against source 2026-08-20.** `packages/core/src/seriesStatus.ts:95` now returns `'Standalone'` when `!b.series?.trim()` and the status is one of `ASSERTS_SERIES_MEMBERSHIP`, so a book with no series cannot render a membership badge. Closed by `861e55a`.
  <details><summary>original entry</summary>
  - **A book removed from its series still wears a "Series of N" pill.**
    `seriesStatusBadge` reads `status` and `series_count` and never `series`
    (`packages/core/src/seriesStatus.ts` ~L62), and the pill that renders it
    (`book/BookDetailRoute.tsx` ~L256) is ungated — unlike `SeriesStrip` one line up
    at ~L251, which correctly disappears. So the series door goes and the badge stays.
    **Verified in the browser** on `fix/atomic-series-removal-client`: after removing a
    linked slot, the removed book's page showed no series door and a `Series of 5` pill,
    with `series: null, position: 2, series_count: 5, status: 'ongoing'` in the row.
    Identical before and after S3b — neither `remove_series_entry` nor the two-write
    path it replaced touches `status` or `series_count`, so this is not a regression.
    `position` also survives a removal but is rendered nowhere once `series` is null, so
    the badge is the only visible symptom. Recorded rather than fixed on the owner's
    instruction: whether removal should also clear `status`/`series_count` is a product
    decision, not a bug fix.

  </details>

- ~~**`useMoveEntry`'s renumber is 2n sequential round trips, and it is not a transaction.**~~
  **CLOSED — verified against source 2026-08-14.** The proposed shape in this entry — "one RPC
  taking `(entry_id, position)[]` doing the whole renumber plus the book mirror in a single
  transaction" — is exactly what shipped: `useMoveEntry` (`series.ts:493`) makes one
  `writeSeriesOrder` call into `set_series_order` (`20260814010000`), which parks the affected rows
  above the max and writes the finals in one transaction. Closed by `a6e1937` (2026-08-09).
  **One residual, not a bug:** the last sub-bullet's "no optimistic UI on either, so the reader
  watches the whole thing" still holds — but it is now one round trip rather than 50, so the
  measurements below describe a shape that no longer exists.

  <details><summary>original entry, with the measurements</summary>

- **`useMoveEntry`'s renumber is 2n sequential round trips, and it is not a transaction.**
  Per entry it issues one `UPDATE series_entries` and then `syncBookPosition`'s
  `UPDATE books`, awaited one after another — so a renumber costs **2n** requests, and a
  connection dropped partway leaves the series **half-renumbered**, some slots on new
  integers and the rest on old ones, with the book mirror in step for only the first half.
  It is a **tail** event: `positionBetween` only asks for a renumber when neighbours are too
  tight for a clean one- or two-decimal midpoint, which takes roughly **nine consecutive drops
  into the same gap**, and the common path is the 2-trip single move. But `/series`' arranger is
  drag-primary, so it reaches the tail sooner than the series page's older UI did.
  **Proposed shape:** one RPC taking `(entry_id, position)[]` doing the whole renumber plus the
  book mirror in a single transaction — 50 round trips becomes 1, and the half-renumbered state
  becomes unconstructible rather than merely unlikely.
  **Its own branch, with its own deploy ordering** — it is a migration, so the RPC has to be live
  in production before any client calls it, the same S3a/S3b split this repo has now done twice.
  Deliberately not folded into `feat/series-builder`: a red run there needs to mean one thing.
  Measured there against the local stack (baseline round trip 11.05 ms, median of 20 selects),
  replicating the write sequence exactly — a ghost-only series halves the trips, since there is no
  book mirror, and that is the only mitigation present today:
  - **10 entries** — 20 round trips, 112 ms median (min 92, max 149); ~1.2 s at 60 ms RTT, ~2.0 s at 100 ms
  - **25 entries** — 50 round trips, 302 ms median (min 235, max 375); ~3.0 s at 60 ms RTT, ~5.0 s at 100 ms
  - no optimistic UI on either, so the reader watches the whole thing

  </details>

- ~~**`series.ts:332`, `syncBookPosition`'s single-move mirror write is swallowed, and it is
  unretried.**~~ **CLOSED — verified against source 2026-08-14.** `syncBookPosition` no longer
  exists: `grep` finds only two past-tense comments referring to it. Every position/length writer
  was re-pointed through `writeSeriesOrder` → `set_series_order` (`20260814010000`), which
  propagates errors (`if (error) throw error`) — closed by `a6e1937` (2026-08-09). The one
  remaining branch that still took `position`/`bookId` was DELETED rather than re-pointed, because
  its only caller was `seriesSeedProvenance.test.tsx` — an exported path kept alive by its own test,
  per the dead-export rule in AGENTS.md.

  <details><summary>original entry</summary>

- **`series.ts:332`, `syncBookPosition`'s single-move mirror write is swallowed, and it is
  unretried.** `await supabase.from('books').update({ position }).eq('id', bookId)` has no error
  check and nothing re-runs it. Unlike the app's other bare writes — all self-healing on the next
  read — a dropped connection here leaves `books.position` diverged from the entry it is supposed
  to mirror, silently, and five surfaces then disagree with the series page: the book page's
  "#N of M" eyebrow, `BookDetailRail`, the edit dialog's prefill, the merge preview, and
  `groupSeries`' cover order in Library's Series mode. Found during
  `fix/supabase-error-surfacing`'s audit; left alone there because surfacing it (throw + toast)
  is a behavior change needing product sign-off, not error surfacing.
  **`feat/series-builder` made this more reachable than it was when the swallow was written**: the
  `/series` arranger's drag is the PRIMARY interaction, so this single-move write now fires on
  every drag and every ▲▼ nudge, not on the occasional series-page reorder the old UI offered.
  That is a different amplification from the renumber entry above — this is the common 2-trip
  path firing constantly, where renumber is the rare tail. Recorded, not fixed.

  </details>

- ~~\*\*Archived tombstones are keyed on (series, position); every functional consumer keys on~~ **CLOSED — verified against source 2026-08-20.** `apps/web/src/data/importExport.ts:301` keys `slotKey` on `${seriesId}@t:${nameKey(title)}` (falling back to position only when the title is empty), aligning the archive with the title-based identity every functional consumer already used. Closed by `1fad07f`.
  <details><summary>original entry</summary>
  - **Archived tombstones are keyed on (series, position); every functional consumer keys on
    title.** `slotKey` (`importExport.ts`) identifies a backed-up removal by series name +
    position, and its own comment calls that "the only thing that identifies 'the same slot'".
    But nothing else agrees: suppressing a source-refresh resurrection matches by title
    (`mergeSourceEntries` against the tombstone's `title`), and reviving on re-add matches by
    normalized title (`series.ts` revive pass). Position is the archive's identity and title is
    the system's. Two consequences, both silent:

  </details>

- ~~**Two tombstones at one position lose one.** Reachable today: remove #2, re-add, reposition,~~ **CLOSED — verified against source 2026-08-20.** closed by the same title-based `slotKey` — two tombstones at one position no longer collide, because position is no longer the key. Closed by `1fad07f`.
  <details><summary>original entry</summary>
  - **Two tombstones at one position lose one.** Reachable today: remove #2, re-add, reposition,
    remove again. The backup exports both; restore's within-file dedupe collapses them on
    `slotKey`, so the second is dropped without a word.

  </details>

- ~~**A restore into a non-empty library can drop a refusal.** If a live entry already occupies~~ **CLOSED — verified against source 2026-08-20.** closed by the same title-based `slotKey` — a live entry at the position no longer causes the refusal to be dropped. Closed by `1fad07f`.
  <details><summary>original entry</summary>
  - **A restore into a non-empty library can drop a refusal.** If a live entry already occupies
    the archived tombstone's position, the tombstone is skipped ("existing state wins") — so the
    reader's removal is gone, and the next Hardcover refresh resurrects the ghost they dismissed.
    This **compounds the restore-guardrail item** below: restoring into a non-empty library
    already silently adds a second library, and this is the same operation quietly discarding
    negative space too.
    Renumber makes the second case likelier rather than causing it — it packs positions onto small
    integers 1..n, and small-integer collisions are the common case. Measured on
    `feat/series-builder`: renumber rewrites live entries only and never touches tombstone rows, so
    the "renumber orphans every archived tombstone" worry is not what happens.
    **The honest fix is keying archived tombstones on (series, normalized title)**, which closes
    both cases at once and aligns the archive with every consumer — a v-next backup-format decision,
    its own branch. Recorded rather than fixed on the owner's instruction.

  </details>

- ~~**Revive matches on title alone, so a removal can revive the wrong slot.**~~ — done
  (`fix/revive-author-match`). `matchTombstoneForRevive` in `packages/core` now takes title
  first and consults author only to break a tie between same-title tombstones, refusing to
  revive anything when the tie can't be broken. Author is a discriminator and deliberately
  NOT a requirement: an empty author is a legitimate state (the manual ghost path prompts
  "Author (optional):"; Hardcover stores `''` when the upstream contribution is missing), so
  requiring it would have turned an optional field into a functional one. Both revive paths
  went through it — `useSeriesDetail`'s reconciliation and `revivedTombstone`, the latter of
  which had never selected `author` at all. Both queries also gained a deterministic
  `position, id` order; "first match wins" out of an unordered result meant the winner could
  differ between runs.
- ~~**`ghostMatchesBook` has the identical title-only weakness, one step earlier in the same
  function.**~~ — done (`fix/ghost-adoption-match`), and it closes the sequence the revive fix
  started. Adoption and revive were asking the same question — which of these candidate entries is
  this book — so they now share one answer: `matchEntryForBook`, with `ghostMatchesBook` and
  `matchTombstoneForRevive` both gone rather than left as two functions with one rule to drift
  apart. Callers filter their own population (`unlinkedEntries` for adoption, tombstones for revive)
  and decide what a refusal costs. A unique title still adopts regardless of author, deliberately:
  adoption exists because a catalog's author string almost never matches the reader's byline, so
  requiring author there would break the normal case rather than harden it.
  **The ordering worry recorded here turned out not to apply**: adoption and revive read the SAME
  entries query, which `fix/revive-author-match` had already ordered `position, id`, and the live
  set is a `.filter()` of it — so `.find` was already deterministic, just deterministically wrong on
  a tie. Guarded by an e2e that drives the interaction itself rather than a proxy: two same-title
  ghosts, a same-title tombstone whose author matches, one book — neither ghost may take it and the
  tombstone revives with `book_id` set.
  **One thing to know if you touch this again**: the `bookId == null` check moved OUT of the matcher
  (which sees only `{id,title,author}`) into `unlinkedEntries` at the call site. Without it a book
  can claim an entry that already belongs to a DIFFERENT book, re-pointing it and orphaning the
  first book's slot — mutation-verified, and held by its own e2e.
- ~~**`useSyncBookSeries` has the same unprotected shape, inverted, and it spans two
  tables.**~~ **CLOSED — verified against source 2026-08-14.** `useSyncBookSeries` (`series.ts:582`)
  is now one `supabase.rpc('sync_book_series', …)` with `if (error) throw error` — atomic, and it
  reads the current series from the `books` row INSIDE its own transaction rather than from the
  caller's cached `book.series`, which closed a second bug (a stale cache could retire the wrong
  slot). Closed by `b60707d` (2026-08-11). Worth keeping the "inverted" framing: this one dropped
  the _entry_ half and left `books` authoritative, so it stranded a live slot permanently — where
  `syncBookPosition` dropped the _books_ half and merely diverged the mirror.

  <details><summary>original entry</summary>

- **`useSyncBookSeries` has the same unprotected shape, inverted, and it spans two
  mutations.** The book page's save runs `updateBook` (writes `books.series`) and then
  `syncBookSeries` (tombstones the old slot) as separate mutations in that forced order
  (`book/dialogs.tsx` ~L263-284). A failure between them leaves `books.series` already
  changed and the old slot still **live** — no tombstone, so revive is irrelevant;
  instead the old series page keeps showing a book that no longer names it,
  permanently, because nothing removes a live entry whose book stopped naming the
  series. That is the #65 symptom `20260725010000` was written to eliminate, reachable
  again by failure rather than by design. Less harmful than `useRemoveEntry` in one
  respect: the dialog catches, stays open and names the failed step, so the reader is
  told. `remove_series_entry` cannot fix it — the inconsistency is between two
  mutations, not two statements, so closing it means one RPC for the whole book save.
  Found during `fix/atomic-series-removal`.

  </details>

- ~~**Scroll position is unmanaged app-wide.** TanStack Router ships a~~ **CLOSED — verified against source 2026-08-20.** `apps/web/src/router.tsx:68` sets `scrollRestoration: true`, and `apps/web/e2e/scroll-restoration.spec.ts` guards both directions the entry names. Closed by `311bd5a`.
  <details><summary>original entry</summary>
  - **Scroll position is unmanaged app-wide.** TanStack Router ships a
    `scrollRestoration` option and it is simply unconfigured on `createRouter`. Wrong
    in both directions: back-navigation doesn't restore where you were, and forward
    navigation keeps the _previous_ page's scroll rather than starting at the top.
    Its own branch — one option flips behavior on every route at once, so a red run
    needs to mean one thing.

  </details>

- ~~**Search text lost on back-navigation**: `/tropes` `q`, `/discover` `query`,~~ **CLOSED — verified against source 2026-08-20.** `/tropes` persists `q` and `/discover` persists `query` through `validateSearch`, guarded by `apps/web/e2e/search-param-persistence.spec.ts`. Closed by `4ac9126`.
  <details><summary>original entry</summary>
  - **Search text lost on back-navigation**: `/tropes` `q`, `/discover` `query`,
    `/match` `vibeQ` — all `useState`, same defect class as the tab bug and the same
    fix shape (a validated search param). Not bundled with `fix/tab-routing` for the
    same reason.

  </details>

- ~~**`/shelves` `openListId` lost alongside the tab** — still open, and the entry~~ **CLOSED — verified against source 2026-08-20.** **and the entry is also WRONG AS WRITTEN**: it calls the surface an accordion, but `openListId` opens an EDIT SHEET. Persistence was added in `4ac9126` and deliberately reverted in `1ec7725` for that reason — a param surviving back-navigation re-opens a modal nobody clicked. `ShelvesRoute.tsx:370` keeps it as component state on purpose. Closed by decision, not by omission. Closed by `1ec7725`.
  <details><summary>original entry</summary>
  - **`/shelves` `openListId` lost alongside the tab** — still open, and the entry
    above it was wrong about what the param is. It is **not** "which shelf accordion is
    expanded": `setOpenListId` is wired to each shelf's **Edit** button, and the id it
    holds selects the list rendered into a `ListModal` — an edit **sheet**, dialog and
    all. There is no accordion on this screen. Component state, lost on unmount, same
    class as the tab bug.
    **URL persistence was built for it and deliberately reverted** (`feat/search-param-persistence`,
    #249): a param that survives back-navigation makes the browser back button re-open a
    modal nobody clicked, taking focus on arrival. Restoring an expanded row would have
    been fine; auto-reopening a dialog is worse than the lost state it fixes — and the
    original entry only read as an easy win because its own description of the behavior
    was wrong. Left open because the underlying defect is real (the sheet you were
    editing vanishes on back-nav); the URL is just not the mechanism. A fix would need
    to restore the sheet without stealing focus, or restore scroll/selection instead of
    the dialog.

  </details>

- **`/library` filters, sort and mode live in a module-level Zustand store.**
  Survives back-navigation (the store outlives the unmount), lost on reload,
  invisible to deep-linking or sharing. That store _masks_ the back-nav symptom
  rather than having it, which is why `fix/tab-routing` deliberately left it
  alone. Moving it to the URL needs a store-vs-URL precedence decision first —
  what wins when both exist.
  <sub>**verified 2026-08-20** — still OPEN: `apps/web/src/library/filterStore.ts:34` still holds filters/sort/mode in a module-level Zustand store, and `LibraryRoute.tsx:151` validates only `shelf` from the URL.</sub>
- ~~**Swallowed Supabase errors**: a11y's `setupFixtures`, `cleanup`, `setProfileSkinMode`.~~
**CLOSED — verified against source 2026-08-15.** Closed by `0e8d4ef` (#92), both halves:
`a11y.spec.ts` routes its sign-ins through `authFailure()` (`if (error || !data.session) throw new
Error(authFailure(context, DEV_EMAIL, error))`) and its writes through `ok`/`okData`/`okUser`; and
`scripts/seed-dev.mjs:265` reports `describeSupabaseError(e)` rather than `Seed failed: {}`.

  <details><summary>original entry</summary>

- **Swallowed Supabase errors**: a11y's `setupFixtures`, `cleanup`,
  `setProfileSkinMode` discard sign-in errors then dereference `.data.user!.id`,
  surfacing as a bare TypeError. Plus `db:seed`'s `Seed failed: {}`. Same
  empty-body shape `authFailure()` already solves; it should become the one way
  this repo reads a Supabase error.

  </details>

- **`apps/web/e2e` is outside `tsc`'s reach** (`apps/web/tsconfig.json` includes only
  `["src", "vite.config.ts"]`), while `noUnusedLocals: true` makes a swallowed
  `const { error }` a compile error everywhere else — the reason every swallowed Supabase
  result in the repo lived under `e2e/` (`fix/supabase-error-surfacing`'s audit; 104 sites).
  **Correction to how this was first framed**: extending typecheck to `e2e` would **not** have
  prevented the 13 `.data!`/`.user!`/`.session!` non-null-assertion derefs — `!` is permitted by
  design under `strict: true`, so those are not type errors — nor the 83 bare write `await`s that
  bind nothing at all, since there is no unused binding to flag. `noUnusedLocals` only catches an
  `error` field that is destructured and then never read; it would have forced a handful of the
  sites, not the shape most of them took. The ESLint rule scoped to `apps/web/e2e/**` (bans a
  non-null assertion on `.data`/`.user`/`.session`) is what actually closes the deref gap;
  nothing closes the bare-await gap except a helper everyone routes through (`e2e/support/ok.ts`)
  and reviewing for it. Worth doing anyway — it would catch a real class of future regressions
  typecheck already prevents in `src/` — but it is not a substitute for either guard above, and
  its own branch: turning it on will surface whatever pre-existing type errors 19 spec files have
  accumulated while unwatched, and a red run there needs to mean one thing.
  <sub>**verified 2026-08-20** — still OPEN: `apps/web/tsconfig.json`'s `include` is `["src", "vite.config.ts"]` — `e2e/` is still outside it, and no separate e2e tsconfig exists.</sub>
- **`cleanup()` is a sequential `await` chain, so any failing step skips every step after it —
  including the profile restore.** `a11y.spec.ts`'s `cleanup()` runs its deletes and
  `setProfileSkinMode('tryst', 'system')` one after another with nothing isolating them, so a
  throw partway through (a permission error, a constraint, anything `ok()` now surfaces) leaves
  every later step — not just the one that failed — un-run. The `shared_docs` delete below was
  exactly this: while it threw, `shared_refs`' delete and the profile restore silently never ran
  either. Fixed for that one case by removing the doomed step (see below), but the ordering hazard
  itself is general and outlives that fix — any future failing step in this chain hides every
  later one behind it, the same way. **Harmless today, and now loud rather than silent** — a
  swallowed step used to fail quietly with the same blast radius; `ok()` just made the failure
  visible, not the skip pattern new. Recorded rather than restructured, since making cleanup
  resilient to a mid-chain failure (run every step regardless, collect failures) is its own small
  change with its own trade-off (a cleanup that reports three failures instead of stopping at the
  first) — a call for whoever next touches this fixture, not a drive-by here.
  <sub>**verified 2026-08-20** — still OPEN: `apps/web/e2e/a11y.spec.ts:254-269` is still a sequential `await` chain; `7fc75ca` made its failures loud but not resilient, so a mid-chain throw still skips the profile restore.</sub>
- ~~**`a11y.spec.ts`'s `cleanup()` could never delete its `shared_docs` row.**~~ — done. Removed
  the delete entirely rather than granting the privilege: `20260624010400_grants.sql` grants only
  `select, insert, update` on `public.shared_docs` to `anon, authenticated`, `sharedLists.ts`
  matches it (the app itself never deletes that table), and `ownedTables.ts` documents that
  capability share docs persist by design. Granting `delete` to satisfy a test fixture would have
  been a production privilege change made for the wrong reason. Nothing was lost: `setupFixtures`
  upserts the row on the stable key `'A11YSMOKE'`, so each run overwrites it rather than leaving
  an undeletable table to accumulate one row per run.
- ~~**Restore guardrail**: restoring into a non-empty library silently adds a second
  one. Warn with real counts before it happens.~~ — done. File selection now performs a local
  integrity check and opens a review with current, incoming, and projected book counts plus the
  backup's other reader records. Cancel is read-only; only the explicit Restore action writes.
  Restore remains additive and merge-routed restore remains blocked. See
  `docs/tasks/restore-preflight.md`.
- ~~**Flash of the wrong mode on a fresh device.**~~ — done. An incomplete local appearance now
  receives a neutral Reverie first paint; the private shell waits until the profile's room and mode
  are applied together before paint. Complete local choices still open immediately, while Adaptive
  waits for its profile-only palette. A profile failure offers Retry and an explicit default-room
  escape without implying that library data was lost. The old entry overstated the sign-out path:
  current sign-out cleanup clears IndexedDB, not the room and mode in localStorage. The real cases
  were first sign-in, manually cleared appearance storage, and Adaptive. See
  `docs/tasks/fresh-device-appearance.md`.
- ~~**`merge_books` can silently null out a reader's plan.**~~ — fixed by
  `20260803010000_merge_plan_precision.sql`, guarded by
  `supabase/tests/merge_plan_test.sql`, both mutation-checked. `take_plan` is
  decided once before the update and all four plan columns follow it, so a null
  from the client can no longer clear a stored plan.
  **Correcting how this was first recorded here**: the mechanism was right —
  `plan_date` used an unconditional `case` where `pub_*` uses `coalesce`, and
  `toBookRow(merged)` on a full `Book` always supplies the key, so the first
  branch always fired. But "a merge that was only supposed to deduplicate can
  clear reader intent" overstated the **trigger**. `merge.ts` unions from
  `{ ...source }`, so a merge computed against fresh, correct data always carries
  the primary's own plan forward and the unconditional set writes back what was
  already there. The reachable path is narrower: a client whose cached `Book`
  lacks a plan the stored row actually has — stale or partially hydrated — where
  `merged.plan` is null and the RPC then clears the real one. Narrow trigger,
  total effect, and `pub_*` was immune to that same input all along. Verified by
  reading `merge.ts:72` (`const p: Book = { ...source }`) rather than re-asserted
  from the original note.
  Also settled while fixing it: the union is object-level, not per-column, so the
  latent per-column hazard flagged for `pub_*` (year from one book, month from
  another) was not inherited by `plan_*`. `pub_*` itself still has it, unexercised
  — its own item if it ever matters.
- ~~**`OwnedCopies` has the same write-clobbering shape `PlanEditor` had.**~~ **CLOSED — both
  halves, verified against source 2026-08-15.** The entry names two defects "not one"; neither is
  live, and the second one's stated mechanism is wrong.

  **Half 1, the unscoped writes — closed by `c5ffd04` (#117).** The entry says the hook "now supports
  `scopeBookId` … but nothing routes it through `OwnedCopies`'s `onChange`/`onPossessionChange`
  props". Nothing needs to: both call sites already build their handlers on a scoped hook —
  `BookDetailRoute.tsx:86` and `dialogs.tsx:167` are each `useUpdateBook(book.id)`, and `setOwned`
  (`:157`) / the inline `onChange` (`dialogs.tsx:535`) close over it. Scope lives on the mutation's
  options, not on the payload, so the props were never the place it had to travel.

  **Half 2, the stale read — never reachable, and the mechanism is misstated.** The claim is that the
  `owned` prop "lags one render behind the store". It does not: `useUpdateBook`'s `onMutate` patches
  the query cache optimistically at mutate time (`books.ts:79`), so the prop the next toggle reads
  is already updated. Proven rather than argued, in
  `apps/web/src/book/ownedCopiesStaleRead.test.tsx`: two fast toggles against the real hook with the
  first write held open, asserting the second payload carries `physical: false`. Mutation-checked —
  deleting the optimistic `setQueryData` makes that payload come back as `physical: 'paperback'`,
  resurrecting the format the reader just cleared, which is precisely the defect described. The test
  stays as the regression guard for the property the entry was worried about.

  <details><summary>original entry</summary>

- **`OwnedCopies` has the same write-clobbering shape `PlanEditor` had.**
  `BookDetailRoute.tsx` ~L236/242 and `dialogs.tsx` ~L489/491 each format toggle
  (physical/ebook/audiobook) sends the WHOLE `Owned` object through
  `useUpdateBook`, unscoped at these two call sites (the hook itself now supports
  `scopeBookId`, added in `fix/book-write-race`, but nothing routes it through
  `OwnedCopies`'s `onChange`/`onPossessionChange` props). Fast toggling
  physical → ebook → audio can have an earlier, less complete write land last and
  overwrite a later one — the identical defect `PlanEditor` had before it
  committed once and serialized on the book id. Two things here, not one: the
  ordering hazard (fixed the same way scoping fixed it elsewhere) and a SEPARATE
  stale-read problem — each toggle's payload is built from the `owned` **prop**,
  which lags one render behind the store, so two fast toggles can each compute
  their payload from the same stale snapshot regardless of write ordering.
  Scoping the writes does not fix the stale read; they need separate fixes.

  </details>

- ~~**`ProgressSlider` writes the same book twice on every release, guaranteed.**~~ **CLOSED — verified against source 2026-08-20.** `apps/web/src/book/BookDetailRoute.tsx:97` dedupes on a `committed` ref (`if (value === committed.current) return`), so one gesture writes once; `progressSlider.test.tsx` holds it. Closed by `102083a`.
  <details><summary>original entry</summary>
  - **`ProgressSlider` writes the same book twice on every release, guaranteed.**
    `BookDetailRoute.tsx` ~L183-184: `onPointerUp` and `onBlur` both fire
    `updateBook.mutate(...)` with the identical `value`. Idempotent — ordering
    can't corrupt it, since both writes carry the same payload — so this is pure
    waste (a doubled request on every slider release), not the data-loss shape
    above. Drop one of the two handlers.

  </details>

- ~~**`useRealtimeRefetch` should cover `lists` and `books`, not just clubs and
  shared lists.** `fix/state-pills-flake` closed the reader-facing half of a
  stale-persisted-cache defect with `useConfirmedLookup` (below) — a route no
  longer trusts a restored-fresh absence without asking the server once. What it
  did NOT close is the window that produces that staleness in the first place: a
  reader on device A adding a shelf, or editing a book, leaves device B's
  persisted cache stale until something invalidates it, and today nothing does
  for `lists`/`books` outside the two routes `useRealtimeRefetch` already covers
  (`ClubRoute`, `SharedListRoute`). Subscribing `lists` and `books` to Postgres
  changes the same way would close that gap for real multi-device use, not just
  the single-client cache-restore case the guard handles.
  **Complementary, not a replacement for the guard** — say so explicitly before
  anyone reads this as "realtime makes `useConfirmedLookup` unnecessary." A page
  can always render in the gap between a remote change and its invalidation
  arriving over the realtime channel; the guard is what keeps that gap from
  reading as a permanent, wrong "gone." Realtime reduces how often the cache is
  stale; the guard bounds what staleness costs when it happens anyway. Own
  branch — it's an actual subscription surface change, not a follow-on to a bug
  fix, and its own measurement (connection cost, invalidation-storm risk under a
  large library) belongs with it.

  <sub>**CLOSED for review 2026-09-09.** `PersonalLibrarySync` uses one owner-authorized private
  Database Broadcast topic for books, reads, lists, and list items. A content-free signal avoids
  copying private row data into Realtime, covers deletes without exposing unfiltered Postgres
  Changes payloads, coalesces burst invalidations, and removes the channel on reader change or
  sign-out. `useConfirmedLookup` remains in place as the correctness guard when Realtime is absent.</sub>~~

## Conventions — established patterns, not open work

Entries here describe a pattern the codebase has already settled on. They are NOT defects; they
live here so the next reader reaches for the existing answer instead of reinventing one. Moved out
of "Real bugs, outstanding" on 2026-08-15 after docs/audits/backlog-nonseries-audit.md found the
first of them described no bug at all, and anyone scanning that section for work kept re-reading it
as one.

> **Audited entry by entry 2026-08-20 (batch 3 of the file).** 1 live entry, **ACCURATE**. A
> convention entry is verified differently from a defect entry: the question is not "is this still
> broken" but "is this still what the codebase does", so the check is that the named module exists
> and that its stated consumers still use it.

- **`useConfirmedLookup` (`apps/web/src/hooks/useConfirmedLookup.ts`) is the
  established pattern for a param-addressed lookup that can be loading, found, or
  genuinely absent — use it rather than reinventing per route.** Before
  `fix/state-pills-flake`, `ShelfRoute`/`MoodRoute`/`TropeRoute` each collapsed
  three different situations (`undefined`) into one terminal not-found render:
  still loading, really deleted, and present-on-the-server-but-missing-from-a-
  stale-restored-cache — the third being durable rather than momentary, since
  `hydrate()` preserves `dataUpdatedAt` and a snapshot inside `staleTime` never
  refetches on its own. The hook refetches once before ever reporting `absent`,
  and terminates on a real deletion because `isFetchedAfterMount` derives from
  `dataUpdateCount`, which query-core increments on every successful fetch even
  when the data didn't change — not a guess, verified against query-core's own
  update logic. `SeriesRoute` is NOT a candidate: `useSeriesDetail` creates the
  row when absent, so its `!detail` can only ever mean loading, and the hook
  would be solving a problem that route doesn't have.

  <sub>**verified 2026-08-20** — **ACCURATE**, still the convention.
  `apps/web/src/hooks/useConfirmedLookup.ts` exists, and its consumers are exactly the three routes
  the entry names: `ShelfRoute.tsx`, `MoodRoute.tsx`, `TropeRoute.tsx`. `SeriesRoute` still does not
  use it, matching the entry's stated reason for excluding it. Nothing here needs action; the entry
  is doing its job, which is to stop the next reader reinventing the hook.</sub>

## Deliberately partial, and why

> **Audited entry by entry 2026-08-20 (batch 3 of the file).** 2 live entries, **both OPEN**.
> Entries here are choices, not defects, so "OPEN" means the choice still stands and the code still
> matches the description — not that anyone is expected to have acted.

- **Logged reads do not reach any shelf or facet — the books cache carries
  `reads: []`.** `mappers.ts` loads reads separately and never merges them into
  the books list, so wherever `isBookRead` runs against that cache it collapses to
  `readStatus === 'Read'`. A book with three logged reads but no `Read` status is
  absent from the Read shelf and from the Library's Read facet, and `groupSeries`'
  read counts are computed on the same cache. Found while mutation-testing B2: an
  e2e fixture built specifically to exercise the `!isDnf` guard could not, because
  the app never saw the logged read. The guard is covered in `packages/core` where
  `reads` is populated. Not fixed here — merging reads into the list query is a
  data-layer change with its own performance question, and it would silently move
  every read count in the app.

  <sub>**verified 2026-08-20** — still OPEN and still accurate. `mappers.ts:103` still writes
  `reads: []` into the books cache, so the collapse to `readStatus === 'Read'` the entry describes
  is unchanged. The stated reason for not fixing it (a data-layer change that would silently move
  every read count) is unchanged too.</sub>

- **CLOSED 2026-09-08 — Thumb-class surfaces carried borrowed/DNF to a screen reader but not to
  the eye.**
  `feat/state-pills` added the state to the accessible name on SeriesStrip,
  SeriesRoute rows, MoodRoute and TropeRoute, and deliberately drew no pill: at
  36–48px a text pill does not read small, it covers a third to half the cover.
  So a sighted reader browsing those surfaces still cannot tell an abandoned book
  from a finished one, while a screen-reader user can — an inversion of the usual
  gap, and worth closing rather than leaving as a quiet asymmetry.
  - The **~132px grid cells are the exception and the obvious next step**:
    MoodRoute, TropeRoute, Discover and FromYourAuthors render `aspect-[2/3]`
    cells at roughly CoverCard scale, which already carries the real pill. Those
    four could take `StatePill` as-is; the true thumbs (36–48px) need a different
    register — the ghost/dot convention, not text.
  - The genuinely small surfaces would need a non-text marker if they are ever to
    show state visually. The spine edge-marker idiom is the nearest precedent.

  <sub>**closed 2026-09-08** — `BookStateMarks` now gives Mood, Trope, and both Discover experiences
  the same solid Read/DNF/Borrowed pills as the Library at cover scale. SeriesStrip, SeriesRoute,
  and Discover's 36–60px covers use compact, controlled SVG marks for DNF and Borrowed; their
  enclosing controls retain the full spoken state. Current `FromYourAuthors` release candidates
  exclude works already matched to the personal library, so that historical surface has no personal
  state to display. Component, core contrast, and browser tests hold the visual and accessible
  contract. See `docs/tasks/dense-grid-state-indicators.md`.</sub>

## Grep audit, 2026-08 (`docs/rules-and-grep-audit`) — recorded, not fixed

Four sweeps behind the three rules added to AGENTS.md that session. Nothing here was changed.

> **Audited entry by entry 2026-08-20 (batch 3 of the file).** 5 live items: **2 CLOSED**, **1 WRONG
> AS WRITTEN**, **2 OPEN** (one of them recounted).
>
> **This section decays by a mechanism the earlier batches did not have.** Its entries are
> _measurements of the codebase_, taken once. "Recorded, not fixed" is true of the backlog and says
> nothing about the code: two of these closed because unrelated work fixed the defect while the entry
> sat here, and one is now wrong because the file it cites was deleted. Judge an entry here against
> source, never against whether anyone worked on it.
>
> **A count in this section is perishable in a way its prose is not.** "37 exported symbols" was true
> the day it was counted; hundreds of PRs have landed since. A stamp below that restates a number
> must say what re-derived it — see the unreachable-exports entry, where the recount is a
> re-derivation and NOT the original script, which is not in the repo.

- **`VITE_` env vars are all public — seven beyond the Supabase pair, and one is a real key.**
  Vite inlines every `VITE_`-prefixed var into the client bundle at build time, so each is readable
  by anyone with devtools. The full set and what each gates:

  | var                              | gates                                                                               | exposure                                                                                                                                                                                                                                               |
  | -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `VITE_GOOGLE_BOOKS_KEY`          | `volumesUrl()` in `lib/googleBooks.ts` — appends `&key=` to every Google Books call | **an API key.** Documented in-file as an accepted decision ("free, referrer-restricted, client-safe for this read-only API"). The referrer restriction is the entire control; if it is ever removed or misconfigured the key is a free quota donation. |
  | `VITE_SENTRY_DSN`                | `lib/sentry.ts` init                                                                | Public **by design** (browser SDKs ship DSNs), but it lets anyone POST events into the project — a quota/noise vector, not a data leak.                                                                                                                |
  | `VITE_BOOKSHOP_AFFILIATE_ID`     | `lib/buyConfig.ts` → outbound buy links                                             | Public by nature; it appears in the outbound URL anyway. No action.                                                                                                                                                                                    |
  | `VITE_BUY_ATTRIBUTION_MODE`      | `lib/buyConfig.ts`; flipping it to `affiliate` changes public revenue copy          | Not secret, but it is the flag `revenueClaims.test.ts` exists to stop from publishing a false claim.                                                                                                                                                   |
  | `VITE_SOCIAL_AUTH_ENABLED`       | `AuthScreen.tsx` — shows OAuth buttons                                              | Not secret.                                                                                                                                                                                                                                            |
  | `VITE_BUILD_ID` / `VITE_RELEASE` | update watcher; Sentry release tag                                                  | Not secret; both injected by `vite.config.ts`.                                                                                                                                                                                                         |

  Only `VITE_GOOGLE_BOOKS_KEY` is a credential. Worth a scheduled check that its referrer
  restriction is still in place, since nothing in the repo can assert that.

  <sub>**verified 2026-08-20** — **WRONG AS WRITTEN, and the fix it implies is the wrong fix.** The
  var's row says it gates `volumesUrl()` in `lib/googleBooks.ts`. **That file does not exist** —
  #290 removed the client-side Google Books legs. `VITE_GOOGLE_BOOKS_KEY` is now read **nowhere in
  app source**: the only occurrence of the string under `apps/web/src` is
  `noThirdPartyCatalog.test.ts:19`, which lists it in `FORBIDDEN` — a test that exists to keep it
  out. The live key is the **non-`VITE_`** `GOOGLE_BOOKS_KEY`, read via `Deno.env.get` in four edge
  functions (`search`, `enrich`, `covers`, `releases`), which is server-side and never reaches a
  browser.
  **Measured, not inferred**, because the whole entry turns on whether Vite inlines it: with
  `VITE_GOOGLE_BOOKS_KEY` present in `.env.local`, a full `pnpm build` produced a bundle containing
  the key's value **0 times**, its name **0 times**, and `googleapis.com/books` **0 times**. Vite
  inlines `VITE_` vars per reference, and there are no references left.
  So the entry's premise — "Vite inlines every `VITE_`-prefixed var into the client bundle" — is
  false as applied here, and neither action it points at is right: **rotation** would mint a new key
  for a variable nothing reads, and **restriction** would secure an exposure that no longer exists.
  **The correct action is deletion** of `VITE_GOOGLE_BOOKS_KEY` from every env file and from the
  Vercel project. That is a code/config change and deliberately not made in this docs batch.
  The rest of the table survives: the other eight are benign by design (Supabase URL + anon key
  behind RLS, the Sentry DSN which ships client-side by design, the Bookshop affiliate ID which is
  public by construction, two feature flags, and `VITE_BUILD_ID`/`VITE_RELEASE`, build-injected and
  absent from env files).</sub>

- ~~**`res.json()` in failure branches: one instance, already guarded.**~~ **CLOSED — verified against source 2026-08-20.** `lib/covers.ts:88` parses
  the error body but wraps it `.catch(() => null)`, which is the correct shape. The unguarded case
  the rule targets is the _fall-through_ in `supabase/functions/enrich/index.ts`'s `fetchJson`: it
  handles 429 and 5xx by status and then `return await r.json()` for everything else, so a 400/403/
  404 with an HTML body throws inside the parse. The caller's catch only recognises `'429'` in the
  message, so a quota refusal degrades to "this source had nothing" — indistinguishable from an
  empty result, and it stamps `enriched_at` as though the book were checked.

  <sub>**CLOSED 2026-08-20** — the fall-through this entry is actually about is gone, and fixed more
  thoroughly than the entry asked. `enrich`'s `fetchJson` now classifies every response through a
  shared `supabase/functions/_shared/httpClassify.ts`: `rate_limited` throws a `SourceHttpError`
  carrying `retryAfterMs`, `retry` backs off, and a non-retryable 4xx throws **with the status and
  never reads the body** (`// Non-retryable 4xx: throw WITH the status, and never read the body.`).
  Only an OK body is parsed, and a malformed one raises `SourceBodyError` rather than degrading to
  an empty success — precisely the "indistinguishable from an empty result" failure the entry named.
  `lib/covers.ts`'s `.catch(() => null)` guard, which the entry called correct, is unchanged and
  still correct.</sub>

- ~~**A flat 600ms retry on a 429, in `supabase/functions/geo/index.ts`.**~~ **CLOSED — verified against source 2026-08-20.** `fetchUpstream` retries
  `429 || >= 500` with a fixed 600ms sleep and ignores `Retry-After` entirely. A limiter asking for
  60s gets asked again in 0.6s, which cannot succeed — it spends a second request of quota and then
  throws anyway. **The two retry loops in the codebase disagree about the same status**: `enrich`'s
  `fetchJson` throws immediately on 429 (correct — a 429 is not retryable on that timescale) while
  `geo` retries it. One of them is wrong and it is `geo`. Nominatim, its upstream, publishes an
  absolute 1 req/sec policy; a 600ms retry is below it by construction.

  <sub>**CLOSED 2026-08-20** — fixed, and the fix carries this entry's own reasoning in the file.
  `geo/index.ts:59-70` now reads "This **used to** retry a 429 after a flat 600ms, ignoring
  `Retry-After` entirely", cites Nominatim's 1 req/sec policy, and names the disagreement with
  `enrich`'s `fetchJson` as the tell that one of them was wrong. Current behaviour: 5xx retries with
  backoff, a 429 honours `Retry-After` when present and is otherwise not retried, and no other 4xx
  is ever retried. The 600ms sleep that survives at `:81` is the **transient-retry** path, not the
  429 path — which is the distinction the entry was asking for.</sub>

- **37 exported symbols are unreachable; 26 of them carry tests.** Method: no reference inside the
  defining file beyond its own declaration, and none in `apps/web/src`, `packages/core/src`,
  `apps/web/e2e`, `scripts/` or `supabase/functions/`. Eight are _legitimately_ test-only —
  `*.fixture.ts` (`makeBook`, `FABLE5`, `WHITE_MARK_IN_DARK`), the `ForTests` seam
  (`resetUnreadableReportForTests`), and registries that are themselves the spec
  (`BACKED_UP_TABLES`, `STATE_PILL_TOKEN_FIELDS`, `SERIES_ARRANGER_TOKEN_FIELDS`,
  `resolvePlaceholderColors`, `gradientMatrix`). The remaining ~18 with tests are the actionable
  set, including `fetchCover`, `waitMsFor`, `parseCsvIncoming`, `visibleComments`, `coverKey`,
  `extractGoogleCover`, `buildGoogleBooksUrl` and `renumberEntries`. A further 11 have no test at
  all — notably **`useAddBook`** (`data/books.ts`), an entire unused mutation hook, plus
  `ALL_TROPES`, `SUBGENRES`, `OWNERSHIP_VALUES`, `CANONICAL_MOOD_NAMES`, `moodMatches`,
  `bookMoodNames`, `NEUTRAL_VOICE`, `clearWriteErrors`, `nextSortOrder`, `toList`.

  **Two of these are worth a second look beyond deletion**, because being dead is itself the
  finding: `parseCsvIncoming` is unreachable while CSV import is a headline feature, and
  `visibleComments` is unreachable while the spoiler gate is a AGENTS.md-named core rule. Confirm
  the live path supersedes them before deleting either.

  <sub>**verified 2026-08-20 — OPEN, and RECOUNTED rather than restated.** The recorded totals
  (37 unreachable / 26 with tests) were a measurement, and the tree has moved by hundreds of PRs.
  **A re-derivation today gives 49 unreachable value exports (`function`/`const`/`class`/`enum`), 38
  of them referenced only from tests**, plus a further 29 unreachable `type`/`interface` exports the
  original figure appears not to have counted.
  **What verifies that number, stated because the section's own rule demands it:** a script walking
  `export` declarations in `apps/web/src` + `packages/core/src` and grepping the entry's five search
  paths for each name, treating an intra-file reference beyond the declaration as live. It is a
  **re-derivation, not the original script**, which is not in the repo — so 49-vs-37 is partly method
  and must not be read as "12 new dead exports appeared". Treat the totals as indicative.
  **What is not indicative:** every one of the **19 symbols the entry names by hand is still
  unreachable** — all 8 of the "actionable with tests" set (`fetchCover`, `waitMsFor`,
  `parseCsvIncoming`, `visibleComments`, `coverKey`, `extractGoogleCover`, `buildGoogleBooksUrl`,
  `renumberEntries`) and all 11 of the untested set (`useAddBook`, `ALL_TROPES`, `SUBGENRES`,
  `OWNERSHIP_VALUES`, `CANONICAL_MOOD_NAMES`, `moodMatches`, `bookMoodNames`, `NEUTRAL_VOICE`,
  `clearWriteErrors`, `nextSortOrder`, `toList`). Nothing on the list was deleted or wired up. The
  two the entry flags for a second look — `parseCsvIncoming` while CSV import is a headline feature,
  `visibleComments` while the spoiler gate is a AGENTS.md rule — are both still dead.</sub>

### The enforcement rule, shaped before committing to it

`import/no-unused-modules` with `unusedExports: true` is the obvious ESLint answer and is the
**wrong tool here**: `packages/core/src/index.ts` re-exports via `export * from` on 49 lines, and
that rule treats a barrel as a consumer, so it would report approximately nothing while appearing
to pass. Verified by inspection of the barrel, not assumed.

**Recommendation: `knip`, as its own gate step, not an ESLint rule.** It resolves `export *`
barrels, and it has a first-class notion of "exported but only used in tests" (`includeEntryExports`

- test-file classification) which is the exact predicate wanted. Shape:

```jsonc
// knip.json
{
  "workspaces": {
    "packages/core": { "entry": ["src/index.ts"], "project": ["src/**/*.ts"] },
    "apps/web": { "entry": ["src/main.tsx", "e2e/**/*.spec.ts"], "project": ["src/**/*.{ts,tsx}"] },
  },
  "ignore": ["**/*.fixture.ts"],
  "ignoreExportsUsedInFile": true, // intra-file use counts as live
}
```

The eight legitimate exemptions become explicit: `*.fixture.ts` by glob, `ForTests` by a small
`ignoreExportsMatching` pattern, and each spec-as-data registry by a listed entry **with a comment
giving the reason** — the `ownedTables` principle that an exclusion without a reason is the bug.
Expect a large first run; that is the point, and it should land as its own branch with the initial
list triaged rather than blanket-ignored.

<sub>**verified 2026-08-20** — still OPEN and **not adopted**: there is no `knip.json` in the repo
and no `knip` entry in `package.json`. The recommendation stands unshipped, and the population it
would report has grown (see the recount above), so the "expect a large first run" warning is now an
understatement rather than an overstatement.</sub>

## Pre-public tracked-data decisions, 2026-08 (`docs/audits/pre-public-secrets.md`) — recorded, not fixed

Sweep from the `docs/agent-md-rules-pass` AGENTS.md rules pass. The audit named these; most of its
gaps are since **closed** (`.gitignore` gained `*.pem`/`*.key`/`*.p12`/`.vercel/` at lines 44-49;
gitleaks runs in CI at `.github/workflows/ci.yml:76-88` and fails the build on any leak; the geo
function's unowned-domain fallback was corrected to `reveriereads.app`). Two are still **open** and
are the owner's call, not a Code-session fix — recorded here so they don't disappear from view before
the repo goes public.

> **Audited entry by entry 2026-08-20 (batch 3 of the file).** 3 live entries: **2 OPEN** (one of
> them **WRONG AS WRITTEN on its reason**, which is the half people act on), **1 accurate in
> substance with stale coordinates**.
>
> Both open entries were re-derived from `git ls-files` rather than inherited from the audit that
> raised them, and both are still tracked. The section's preamble — the claim that most of the
> audit's gaps are since closed — was spot-checked and holds: `.gitignore` carries
> `*.pem`/`*.key`/`*.p12` and `.vercel/`, the full-history `gitleaks` scan runs and fails the build,
> and `geo`'s contact fallback is `https://reveriereads.app` (`geo/index.ts:28`). One coordinate in
> that preamble has drifted: the secret scan is cited as `ci.yml:76-88`, but the `secrets:` job
> begins at **`:90`** (its comment block runs 86-89).

- **`.npmrc` is tracked** (`git ls-files .npmrc` → `.npmrc`). Contents today are two harmless pnpm
  flags, but the file is the canonical place a registry `_authToken` lands — the moment any registry
  auth is added, the token commits silently. The audit's recommended shape is ignore-with-checked-in
  example (`.npmrc` → `.gitignore`, `.npmrc.example` committed). Pre-public §3.

  <sub>**verified 2026-08-20** — **OPEN on the fact, WRONG AS WRITTEN on the risk.** `git ls-files
.npmrc` still returns `.npmrc`, and its contents are still two pnpm flags, so the entry's factual
  half stands and the recommended shape is still unapplied. But the risk it states — "the moment any
  registry auth is added, the token commits **silently**" — is no longer true, and silence is the
  whole reason the entry is filed as a pre-public concern. Two controls now stand between an
  `_authToken` and a public repo: the file itself opens with "**NEVER put registry auth here**… Auth
  belongs in `~/.npmrc`", and `.gitleaks.toml` sets `useDefault = true`, whose ruleset covers npm
  tokens, scanned over **full history** (`fetch-depth: 0`) by a job that fails the build. So the
  entry's action may still be worth taking, but not for the reason given: the failure mode it guards
  against is now loud, and an entry whose reason has expired is the half a reader builds on.</sub>

- **`data/raw/Chism_Books.xlsx` is tracked** (`git ls-files` → `data/raw/Chism_Books.xlsx`, 272 KB,
  since the initial commit `2378ffb`). The real library spreadsheet; its `GC Read` and **`TC Read`**
  columns are reading records for a **second person**, not only the owner. The owner's own data is
  theirs to publish; the second reader's column is the flagged part. Removing it from HEAD hides
  nothing from history (the audit's premise), so the decision is publish-as-is vs. history rewrite
  before the repo ever goes public — the one moment a rewrite still works. The derived JSON seeds
  (`data/corpus_seed.json` + `data/reader_seed.json`, the 290-book pair) carry the same data in
  another form and are flagged for the same decision. Pre-public §4.

  <sub>**verified 2026-08-20** — still OPEN, re-derived from `git ls-files` rather than inherited.
  `data/raw/Chism_Books.xlsx` is still tracked, and both derived seeds (`data/corpus_seed.json`,
  `data/reader_seed.json`) are still tracked alongside it, so the entry's "same data in another form"
  point is intact — removing only the spreadsheet would not resolve it. One measurement correction:
  the file is **270,207 bytes** (264 KiB), not the "272 KB" recorded. The substantive claim — that
  the `TC Read` column is a second person's reading record, and that the publish-as-is vs
  history-rewrite decision only stays available until the repo goes public — is unchanged and remains
  the owner's call, not a Code session's.</sub>

- **A guard aimed at the right defect class but the wrong boundary — #287's truncation guard,
  corrected by `fix/import-half-stars`.** #287 guarded half stars against `reviews.rating`'s
  `smallint` (correctly: `useUpsertReview` throws pre-request, asserted by zero supabase calls).
  The actual silent truncation was three `Math.round` calls on the IMPORT path
  (`importMap.ts:278`, `csv.ts:149`, `csv.ts:309`) — application-level coercion that no
  schema-type reasoning would surface: rate 4.5 → export → re-import came back 5, rounding UP,
  with nothing on screen saying a value changed. The durable lesson: **type-level guards catch
  type-level truncation; application-level coercion needs a round-trip test** (export → import →
  compare), which is what `importRatingRoundTrip.test.ts` now is. When adding a guard for "X must
  not silently change," enumerate every path that WRITES X, not just every column that STORES it.

  <sub>**verified 2026-08-20** — the **lesson is accurate and worth keeping; its coordinates and its
  tense are not.** All three cited `Math.round` calls are gone, replaced by `snapHalfRating`, each
  with a comment naming the reason — so the entry's present tense ("The actual silent truncation
  **is** three `Math.round` calls") now describes code that no longer exists. The line numbers have
  each drifted: `importMap.ts:278` → **`:279`**, `csv.ts:149` → **`:150`**, `csv.ts:309` → **`:311`**.
  `importRatingRoundTrip.test.ts` exists as described. Read this entry as a closed case study rather
  than an open defect; its durable half — type-level guards catch type-level truncation, and
  application-level coercion needs a round-trip test — is why it stays.</sub>

## Known-flaky, with a prior

> **PERISHABLE — audited entry by entry 2026-08-20 (batch 2 of the file).** Every live entry below
> was read, checked against the tree, and checked for ancestry on `origin/main`. Result: **1 CLOSED**
> (struck, naming the commit, original folded into a `<details>`), **3 OPEN** (each stamped with what
> it was verified against), **1 rewritten from source** because BOTH of its line citations pointed at
> the wrong lines.
>
> **The section's own rule is what makes its stamps perishable in a way the rest of the file's are
> not.** An entry here says "occurrence N"; the count is a claim about CI history, and CI keeps
> running after the stamp is written. A stamp below verifies that _the test still exists, still
> carries the quoted title, and no fix has landed_ — the tree-side half. It does not and cannot
> verify that the occurrence count is still current. Read a stamped entry as "the defect is still
> reachable", never as "it has still only happened N times".
>
> Sections other than this one and Test-infrastructure follow-ups are UNAUDITED as of batch 2.

- ~~**Playwright install steps hanging on apt/CDN**~~ — **CLOSED 2026-08-19: the surface no longer
  exists.** What actually fixed it was not a better timeout, retry, or mirror — it was removing apt
  from the browser path entirely (`ci/no-apt-browser-path`): `ubuntu-latest` ships Google Chrome,
  so the image already carries chromium's shared-library surface, and probe PR #291 proved all
  three suites green with zero apt calls on BOTH arms (forced cache miss: CDN-only
  `playwright install chromium`, ~11s; cache hit: no install step at all). The six install steps
  collapsed into `.github/actions/setup-browsers`, whose header carries the class's condensed
  history and the no-automatic-fallback ruling. The only network call left in the path is
  Playwright's CDN on a cache miss, made rare by the push-to-main cache warmer; a CDN stall is
  still bounded (1m/4m, apt-free) and still `::warning`s here. The ledger below stands as the
  history that priced each escalation.

  Original entry, for the record — four occurrences, each fix making apt fail _better_ until #4
  proved no in-path fix could beat a mirror outage:

  | #   | run                     | step                                          | note                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
  | --- | ----------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1   | `32085029255`           | OS dependencies (`e2e-a11y`)                  | 14.8m hang; job's 15m cap fired as an ambiguous "cancelled"                                                                                                                                                                                                                                                                                                                                                                                                           |
  | 2   | `32201401052`           | Install browsers (`e2e`, #279)                | tripped the 8m single-shot step timeout                                                                                                                                                                                                                                                                                                                                                                                                                               |
  | 3   | `32201401052` (rerun 1) | OS dependencies (`e2e`, #279)                 | different step, same class; second rerun passed                                                                                                                                                                                                                                                                                                                                                                                                                       |
  | 4   | `32218269328`           | Install browsers (`e2e` + `e2e-mobile`, #285) | FIRST POST-RETRY occurrence, and the first a single retry cannot absorb: `azure.archive.ubuntu.com` unreachable (apt `Ign:` loop), so attempt 2 spent its full 8m against the same dead mirror — exit 124 at the step, named, ~10.5m in, exactly the designed fail case. A retry beats a transient stall, not a mirror outage longer than both bounds; if this arm recurs, the fix is a mirror fallback (swap `apt-mirrors.txt` before attempt 2), not longer bounds. |

  **Mechanism.** apt/CDN operations against Ubuntu mirrors on the hosted runner — nothing this repo
  controls; normal step time is 0.2–0.4m against a measured 80-run max of 3.87m. Occurrence 1
  produced the step-level timeout (#268, legibility); occurrences 2–3 each still cost a red build
  and a manual re-run, which is the asymmetry the retry closes: flaky _tests_ already self-heal via
  Playwright `retries: 1`, the install step did not.

  **The retry is bounded and visible** (`ci.yml`, six install steps, comment blocks kept identical):
  attempt 1 at 2m, attempt 2 at 8m, step backstop 11m, sized against each job's cap from measured
  distributions — the arithmetic lives in the OS-deps comment block. Every attempt-1 trip emits a
  `::warning` annotation naming the step. **Log each annotation occurrence here**: a trip is this
  flake recurring, absorbed but not invisible — and if trips become frequent, or attempt 2 starts
  failing too, that is a defect in this class (runner region, cache key, mirror set) to diagnose,
  not more flake to absorb.

- **`trope-rename-delete.spec.ts:180` — "deleting a personal trope confirms first, then removes it
  from every book". ONE occurrence, recorded so a recurrence has a prior.**

  Full-suite run on `feat/half-stars` (2026-08-19, local): the delete confirm rendered "It is not on
  any books" where the test had seeded 2 carriers — the carrier count resolved to 0 at dialog-open.
  Fast failure (3.0s), so a stale/racing count query, not a timeout. Classified flake, not
  regression: the branch's diff touches ratings only (Stars/reviews/formatRatings — no trope code),
  the same suite passed 4x on identical trope code earlier the same day, and the spec passed **3 of
  3 in isolation** immediately after. Mechanism guess for occurrence 2 to verify: the confirm reads
  a carrier count whose query hadn't settled under full-suite load. By this section's rule, a second
  failure here is a defect in that count's loading state, not a flake.

  <sub>**verified 2026-08-20** — still OPEN: the test still exists at `trope-rename-delete.spec.ts:180` with the quoted title intact; one occurrence (2026-08-19), no fix landed, so the prior stands.</sub>

- **`spine-shelf-reachability.spec.ts:477` — "cover aspect: the rendered cover box keeps the cover
  ratio at every visible wave position". TWO occurrences, and by this section's own rule the next one
  is a defect.**

  | #   | run           | branch / PR                            | note                                         |
  | --- | ------------- | -------------------------------------- | -------------------------------------------- |
  | 1   | `31053864700` | `fix/spine-reveal-window` (#149)       | within the 17-day CI cost/value audit window |
  | 2   | `32104816007` | `fix/recover-267-batch-rescope` (#271) | branch touches ZERO app source               |

  **Mechanism.** A hover lands, the wave settles on a NEIGHBOURING book, and the 5s poll never
  converges. Verbatim from occurrence 2:

  ```
  Error: expect(received).toBe(expected) // Object.is equality
  Expected: "b8bb15d1-8763-461b-87ff-fbcb18a17429"
  Received: "6f300bd6-fabd-4457-a792-58adcd61a6f4"
  - Timeout 5000ms exceeded while waiting on the predicate
  > 567 |   await expect.poll(async () => pickedId(page)).toBe(targetId)
  ```

  **Why occurrence 2 is classifiable as flake rather than regression, stated so occurrence 3 does not
  have to re-derive it.** PR #271 changed `AGENTS.md`, one docs file, and a `.audit.ts` the main
  Playwright config cannot match by construction — **zero app source**. Its app code was
  byte-identical to a `main` that had passed twice in the preceding hour (runs `32101912366`,
  `32098418357`). It does **not** reproduce locally: same tree, same spec, 12/12 in 2.2m with `cover
aspect` at 9.1s. `e2e` failed exactly once in the surrounding 60 runs.

  **This entry is what makes `retries: 1` safe.** CI retries were turned on in
  `playwright.config.ts` because `retries: 0` conflated DETECTING flake with GATING on it — Playwright
  still reports a retried pass as `flaky`, so detection is untouched. The risk of retries is that
  they become a way to stop looking, and this ledger is the answer to that: with two occurrences
  written down, **a third is a defect by the rule at the top of this section, not something to re-run
  past.**

  **What to check on occurrence 3, in order:** (1) whether the picked id is an ADJACENT spine
  (wave-settling) or an arbitrary one (a real pick regression); (2) whether the branch touches
  `SpineShelf.tsx` or its geometry at all — occurrences 1 and 2 differ exactly here, since #149 was a
  spine-reveal branch and #271 was not; (3) `E2E_WORKERS` and runner contention, since
  `playwright.config.ts` records this same spec as one of the two that starve under `workers=2`.

  **Occurrence 3 — same FILE, different test: `:581` "containment: the revealed box stays inside
  the track" (2026-08-20, local, `ci/layout-sweep-390` verification run 3).** A `toHaveCount`
  failure at 39.3s, with the file's 5 remaining serial tests blocked behind it. What makes this one
  different is the contrast, and the contrast is the content: it fired in the **127-test
  `layout-390` sweep** (workers 1, fresh DB — and run 2 of the same sweep had passed this test
  minutes earlier), while the identical spec passes consistently in the PR-time `mobile` project's
  7-spec run, three green full-suite CI runs the same week. The checklist's item (1) doesn't apply
  — the failing assertion isn't the pick — and no code change is in reach (the sweep branch touches
  zero app source). That points at **load / run-length** — the spec's documented
  starve-under-contention behaviour reached through a longer run rather than more workers. A fourth
  occurrence starts at item (3).

  **Operating convention for `layout-sweep-390` reds, recorded here so it outlives PR #293's
  body:** a dispatch-run red gets this section's flake-vs-defect judgment like any PR red — it is
  NOT self-evidently a flake just because the job is non-blocking. The sweep uploads its HTML
  report on failure precisely so that judgment can be made from one run.

  <sub>**verified 2026-08-20** — still OPEN: `spine-shelf-reachability.spec.ts:477` still exists, still carries the quoted title, and no fix has landed. **Deliberately silent on the occurrence count, and on whether the next red is a defect** — the ledger above owns both, and both move. The previous wording reasoned from the count ("two occurrences recorded … so by this section's own rule the third is a defect") and was falsified the same week by occurrence 3 landing directly above it. The section marker already declines to verify the count; an inference drawn from it at the ENTRY level is not covered by a disclaimer at the SECTION level, which is how this one went stale unnoticed. A stamp records what was checked against source — the count is the ledger's to state.</sub>

- **CI `Start Supabase` — `failed to bind host port … address already in use`. TWO occurrences on
  2026-08-14, both in the `e2e` job, both re-run green.** Written down on the second, because the
  first was noted only in conversation and evaporated — the identical loop that kept
  `cover-card-touch-affordance` open until its third occurrence (below).

  | #   | run           | branch                                                                    | port    | container                       |
  | --- | ------------- | ------------------------------------------------------------------------- | ------- | ------------------------------- |
  | 1   | `31816642512` | `fix/uppercase-reader-data-interim` (#224)                                | `55322` | `supabase_db_book-corpus`       |
  | 2   | `31825085654` | `docs/ratchet-rule-and-chip-split` (#223, already merged — an orphan run) | `55324` | `supabase_inbucket_book-corpus` |

  **Not flaky-in-our-code, and not the concurrency hypothesis. Two independent disproofs:**

  1. **Every job is `runs-on: ubuntu-latest`** — a GitHub-hosted, single-use VM per job. Four jobs
     start Supabase (`e2e`, `e2e-a11y`, `e2e-mobile`, `pgtap`) on fixed ports from `config.toml`
     (55321 api / 55322 db / 55323 / 55324 inbucket), but they cannot see each other's ports because
     they do not share a host. Concurrent jobs colliding on a fixed port set requires a shared
     runner, and there isn't one.
  2. **In run 2, the three sibling jobs ran the identical `supabase start` concurrently and all
     three succeeded** — `e2e-a11y`, `e2e-mobile` and `pgtap` green, `e2e` red, same commit, same
     command. A scheduling collision would not spare three of four.

  **What it actually looks like:** a transient race inside Docker's port programming.
  `supabase start` brings up ~8 containers near-simultaneously, and the bind failure lands on a
  _different_ container each time (`db` then `inbucket`) — the signature of whichever container
  loses the race, not of a port something else is holding. A specific occupied port would fail the
  same way every time.

  **Teardown is a red herring, but the fact is worth recording:** there is **no `supabase stop`
  step anywhere in `ci.yml`**, and no `if: always()` cleanup. On ephemeral runners that leaks
  nothing, so it cannot be the cause — but it would matter immediately if this project ever moves
  to self-hosted runners, at which point hypothesis 1 above stops holding too.

  **Re-running is legitimate here and should be labelled as such:** the container never started, so
  no test executed. That is categorically different from re-running a red test until it goes green,
  which is forbidden.

  **If it recurs a third time**, the fix is a bounded retry around the start step
  (`supabase stop --no-backup || true` then one retry), not a concurrency change to the workflow —
  the evidence above already rules that out.

  <sub>**verified 2026-08-20** — still OPEN: still open, and NOT closed by the stack lock — `scripts/stack-lock.sh` serialises the LOCAL stack between sessions on one developer box, while this entry is about CI, where each job already has an isolated runner. `.github/workflows/ci.yml` still has no bounded retry around `supabase start`. The entry's own Docker-race diagnosis survives; the concurrency hypothesis it already ruled out is the one the lock would have addressed.</sub>

- ~~**`cover-card-touch-affordance.spec.ts:169` — "at rest the toggle is invisible; hovering the card reveals it" — three occurrences, none written down until the third.**~~ **CLOSED — verified against source 2026-08-20.** the fix landed in #215: `cover-card-touch-affordance.spec.ts:188` now does `await page.mouse.move(0, 0)` to establish the at-rest precondition before asserting it — the Playwright pointer was persisting across navigation, which is what produced all three occurrences. The desktop-only skip at :167 is intact. Closed by `3e76f92`.
  <details><summary>original entry</summary>
  - **`cover-card-touch-affordance.spec.ts:169` — "at rest the toggle is invisible; hovering the card
    reveals it". RESOLVED — root-caused and fixed in `fix/cover-card-hover-flake`.** Recorded anyway,
    because the failure it represents is a process one as much as a technical one.

  **Three occurrences, none of them written down until the third.** It failed twice during the
  2026-08-13 session — once in a full local run, once in CI — and both times was assessed in
  conversation as "an unrelated flake" and moved past. On the third occurrence it blocked the merge
  of an unrelated PR (#214, the first control-radius migration batch), which is what finally forced
  a diagnosis. The suite runs `retries: 0` **specifically to measure flake rather than absorb it**,
  and that measurement only pays for itself if it accumulates somewhere durable. Two correct
  observations evaporated into a transcript. The third should not have been the first written record.

  **Root cause: the test asserted a precondition it never established.** The toggle carries
  `opacity-0 … group-hover:opacity-100` (`CoverCard.tsx`). Playwright's pointer persists across
  navigation, and the spec's `signIn()` clicks "Enter your library" — so the mouse was left wherever
  that button rendered, and after `goto('/library')` a cover card could land under it, firing
  `group-hover` and revealing the control the assertion says is hidden. Whether it flaked depended
  on where the button and the card happened to land relative to each other.

  The observed values are the tell and were misread twice: `0.695799` then `0.837265`, settling at
  `1` — an **increasing** sequence. That is the signature of a reveal in progress, not of a wrong
  resting value. A test genuinely racing a transition would have been caught by
  `toHaveCSS`'s own polling, which retries until timeout; this one polled and watched the element
  finish arriving.

  **Fix:** `await page.mouse.move(0, 0)` before the at-rest assertion. Deliberately not a timeout or
  a retry — no duration makes a hovered element un-hover, so a wait would only have changed how long
  the test took to report the same wrong answer. Mutation-proved: forcing the toggle to
  `opacity-100` in `CoverCard.tsx` turns the fixed spec red, so the fix did not neuter the contract
  it guards.

  **A second failure here is a defect, not a flake** — and this time the precondition is explicit,
  so a recurrence means something else moved.

  </details>

- **`discover-search.spec.ts:275` — "Shelf picker seam: search everywhere finds and adds an unowned
  book to this shelf".** Failed once in CI on PR #126 (run `30762811683`), passed on re-run with
  **no code change**; the same commit had passed 83/83 locally. Failure was the `expect.poll` on
  `list_items` timing out at 15s — expected 1, received 0 — after the `＋ Add` click.

  **Recording the process breach too, so it has a prior of its own:** the re-run violated the
  standing "never re-run until green" rule. It happened after reporting the failure red and asking,
  and the owner chose the re-run over investigation — but the rule exists because a green re-run is
  what turns a real defect into "just a flake", and this entry is what stops the next occurrence
  being read that way. **A second failure here is a defect, not a flake.**

  **The stale-offline-cache hypothesis is disproven, with evidence.** `discover-search.spec.ts`
  _does_ use `keepOfflineCacheEmpty`, called inside its own `signIn` helper (line 110) before
  `page.goto` — so the `fix/state-pills-flake` idiom reached this spec, in the correct
  `addInitScript` shape that deletes the IndexedDB before the app boots. It is not the
  self-inflicted stale cache.

  What to check on the next occurrence, in order: (1) the click targets
  `getByRole('button', { name: '＋ Add' }).first()` while `STUB_RESULTS` holds **two** entries —
  if library-dedupe has not settled, `.first()` may not be the Wildfire Vow row, and the poll would
  then correctly never see it; (2) `stubBackends` deliberately fails the covers ingest with a 422,
  so the add path's error branch is on the critical path to the insert; (3) CI runs single-worker
  on a shared runner, where 15s is a much thinner margin than locally.

  **Second occurrence, a different test in the same file — `discover-search.spec.ts:218` ("add a
  result to a shelf as unowned via the shelf chooser"), local standing e2e run on
  `fix/series-backfill`'s intake-fix commit.** Same shape exactly: `.first().click()` (this time on
  `'＋ Shelf'`, not `'＋ Add'`), then the identical `expect.poll` on `list_items` for the same
  `Wildfire Vow` book, same 15s timeout. Reported red, not re-run. That branch's diff is
  `packages/core/src/importMap.ts` (CSV/XLSX intake) — nothing touching Discover, shelf pickers, or
  `list_items` — so this is not attributable to that change either, same reasoning as the a11y
  timeout entry above. Two different tests in this one spec file, both failing on the same
  `Wildfire Vow` poll, is stronger evidence for hypothesis (1) than either occurrence alone: both
  tests click a `.first()` button while `STUB_RESULTS` holds two entries, and both then poll for
  exactly the book that ordering ambiguity would drop. Worth checking first on the next look.

  <sub>**REWRITTEN FROM SOURCE 2026-08-20 — the line citations were WRONG in both occurrences.**
  `discover-search.spec.ts:275` is `borrowed: false,` — a line inside a fixture object, not a test.
  The test it means, "Shelf picker seam: 'search everywhere' finds and adds an unowned book to
  this shelf", begins at **:282**. The second occurrence's cite is wrong the same way: **:218**
  is `await page.getByLabel('Clear search').click()`, while the test it means begins at **:225**.
  Both are off by roughly seven lines — near enough to look right, far enough to send the next
  reader to the wrong place. The flake itself is unchanged and the entry's prose about
  `keepOfflineCacheEmpty` (called at :116) is accurate; only the coordinates were wrong.</sub>

## Test-infrastructure follow-ups

> **PERISHABLE — audited entry by entry 2026-08-20 (batch 2 of the file).** Result: **1 CLOSED**,
> **7 OPEN** (each stamped with the file:line it was checked against), **1 UNVERIFIABLE** from a
> Code session and marked so rather than guessed.
>
> **Two findings worth reading before trusting anything else here.** First, the one CLOSED entry
> was closed a long time ago and the file already knew: the "In flight" section at the top records
> the trio migration as done, while this section still listed it as outstanding — **one document
> disagreeing with itself**, which no amount of careful writing catches and only an entry-by-entry
> pass does. Second, that entry's stated PURPOSE was also false: it claimed the migration "buys
> `E2E_WORKERS` back above 1", and it does not, because `workers: 1` is held by an unrelated
> mid-run seeder race. An entry can be closed on its action and still wrong on its reason, and the
> reason is the half that gets built on.
>
> Sections other than this one and Known-flaky are UNAUDITED as of batch 2.

- ~~**Trio migration** (a11y/fonts/cover-sheet onto per-user accounts).~~ **CLOSED — verified against source 2026-08-20.** the trio each own an account: `a11y-e2e@reverie.local` (a11y.spec.ts:16) and `cover-sheet-e2e@reverie.local` (cover-sheet.spec.ts:23); `fonts.spec.ts` needs none (it runs signed-out on the landing page). Migrated in #92. **AND THE ENTRY'S STATED PURPOSE IS NOW FALSE** — it says the migration "buys `E2E_WORKERS` back above 1". It does not: `workers: 1` is load-bearing for an unrelated reason, namely that `a11y.spec.ts:40` and `shelf-membership.spec.ts:37` both `execFileSync('node', ['scripts/seed-dev.mjs'])` MID-RUN, so two workers would race the same seeder. Parallelism is not waiting on this entry. Note also that the file's own "In flight" section already recorded this migration as done, while this section listed it as outstanding — the same file disagreeing with itself. Closed by `0e8d4ef`.
  <details><summary>original entry</summary>
  - Trio migration (a11y/fonts/cover-sheet onto per-user accounts) — buys
    `E2E_WORKERS` back above 1 once CI runtime is a real cost.

  </details>

- Offline-path e2e specs recorded in `docs/archive/task-offline-session.md`. They become
  the stabilized suite's first real exercise.
  <sub>**2026-08-20: UNVERIFIABLE FROM HERE** — the entry promises archived offline specs 'become the stabilized suite's first real exercise'. Whether that has happened is a claim about the suite's composition over time, not about any file — it needs the CI history for the offline specs' first green run. Nothing in the tree settles it.</sub>
- **The a11y sweep has never scanned `CoverPlaceholder`** — every seeded book has a
  `cover_url`, so the placeholder path has never been put in front of axe, despite
  being the surface with the most contrast-test investment in `packages/core`. Add
  a coverless book to the a11y fixture set on its own branch, where a red result
  means one thing. (Deliberately excluded from `test/trio-migration`: bundling it
  would have made a red acceptance run ambiguous between a migration break and a
  new discovery.)
  <sub>**verified 2026-08-20** — still OPEN: `scripts/seed-dev.mjs:138` seeds `cover_url: b.cover || null` from the corpus, and `a11y.spec.ts` adds no coverless book, so the sweep still never puts `CoverPlaceholder` in front of axe. (`discover-cover-quality.spec.ts:24` does exercise the placeholder, but that is a different spec and not an axe scan.)</sub>
- The a11y sweep's Playwright trace (~249MB) corrupts at write time on the CI
  runner in roughly 2 of 3 failures — the artifact uploads, its outer zip passes
  CRC, but the inner `trace.zip` is not a readable zip. Small traces from the
  same runs upload and open cleanly, so the mechanism is sound; likely a flush
  race on oversized captures. Another argument for splitting a11y into its own
  CI job.
  <sub>**verified 2026-08-20** — still OPEN: the e2e-a11y job still uploads traces (`ci.yml:359-364`) with no flush, chunking or size cap. The corruption RATE the entry quotes is CI-history data, not a source fact — the mechanism is unaddressed either way.</sub>
- **No Deno runtime executes in the gate, so `paceSource`'s body never runs under
  test.** The outbound pacing enforcement lives in
  `supabase/functions/_shared/sourcePace.ts`, and `deno` is installed neither
  locally nor in CI — a test placed beside it would never run, which is worse than
  none. What IS covered: the policy (budgets + `waitMsFor` arithmetic) lives in
  `packages/core/src/sourcePace.ts` under Vitest, and `sourcePace.test.ts` reads
  the Deno file and fails when the two tables diverge, so the copied constants
  cannot drift silently. What is NOT covered: the in-process gap actually being
  awaited, the `rate_limit_consume` call, and the fail-open branches — all
  reasoned about, none executed. Wiring a Deno runner into the gate is its own
  branch; it would also cover `_shared/coverUrl.ts` and every other function-side
  module, which are uncovered for the same reason.
  <sub>**verified 2026-08-20** — still OPEN: `ci.yml` still starts Supabase with `-x …,edge-runtime`, so the Deno sandbox never runs in the gate; `supabase/functions/_shared/sourcePace.ts` is imported only by `supabase/functions/enrich/index.ts`. The `packages/core` twin has tests; the Deno body still executes nowhere under test.</sub>
- **`cover-sheet.spec.ts` asserts cover _source selection_, never cover _render quality_**
  (`apps/web/e2e/cover-sheet.spec.ts:196,218,235,245`). Every assertion is
  `toHaveAttribute('src', new RegExp(STUB.…))` — which cover the sheet _picked_ — with zero
  `naturalWidth`/`naturalHeight` checks. The underlying `CoverImage.tsx:83` _is_ guarded by
  `isDegenerateGoogleCoverRender(src, img.naturalWidth, img.naturalHeight)`, so a degenerate
  render (a 1×1 tracking pixel, a blocked-image placeholder) would be caught at the component
  layer but never asserted at the e2e layer. This is the 5761bc0-class gap (the cover-degenerate
  audit's whole point) in its narrowest form: the test proves the right URL was selected, not
  that a real cover painted. Filed, not fixed — the judgment call is whether e2e should
  duplicate the component guard or trust it. The `src`-only assertions are _correct for what
  they test_ (cover-sheet selection logic); the gap is that nothing tests the other half.
  <sub>**verified 2026-08-20** — still OPEN: `cover-sheet.spec.ts` still asserts only `src` URLs (lines 202/225/242/252) with zero `naturalWidth`/`naturalHeight` assertions. The component guard DOES exist (`CoverImage.tsx:83` calls `isDegenerateGoogleCoverRender`), so the gap is e2e-layer only — which is the judgement the entry files rather than settles.</sub>
- ~~**Split the a11y sweep into per-skin jobs.**~~ **DONE** — built in `chore/a11y-timeout-raise`
  rather than filed, once a second timeout raise proved the number was the wrong lever.
  The sweep was ONE test looping ten skin x mode passes, so a single `test.setTimeout` covered ~104
  axe scans: a slow runner spent the whole budget at once and the failure named the sweep, not a
  skin. Measured across one evening on the same unchanged spec: 8m36s green, then 12.9m, 15.1m and
  18.5m — blowing a 720s cap, then an 1080s cap, then a 20-minute JOB cap underneath it.
  Now one test per pass with its own budget (8m for tryst's two full-route passes, 4m for the eight
  core passes), fixtures created once in `beforeAll` so the split does not pay setup ten times.
  Measured after: worst pass 4.7m against its 8m budget, core passes ~18s against 4m — 12 passed in
  11.9m. The registry coverage guarantee moved from a runtime `visited` set to a plan-level
  assertion, which is stronger: it holds on a `--grep`'d run and fails at collection rather than
  after ten minutes of scanning.

- **`route-viewport.spec.ts` covers no signed-out surface.** The 24-route list
  (`apps/web/e2e/route-viewport.spec.ts:250-276`) signs in first (`await signIn(page, …)`, line 248) and then walks `/`, `/library`, … `/welcome`, `/onboarding`, plus a resolved trope detail.
  But `/welcome` and `/onboarding` redirect-or-render for a _signed-in_ reader; the genuinely
  signed-out shell — `/auth` and its `?mode=signin|signup` variants (`AuthRoute.tsx:16-23`,
  which redirects an authenticated reader to `/library` and renders the auth form only for the
  unauth shell) — is unreachable from a test that has already signed in. A layout-overflow
  regression on the auth/landing surface (the first thing a new reader sees) would not be
  caught. Filed, not fixed — adding it means a second `test(...)` block that does _not_ call
  `signIn` and walks the unauth routes, which is its own fixture scope.

  <sub>**verified 2026-08-20** — still OPEN: `route-viewport.spec.ts:248` signs in before walking all 24 routes, and the list holds no signed-out surface; the landing and `/auth` are still unmeasured there.</sub>

- **`fetchCover` is still callerless after #123 — the ISBN-direct cover path is not live.**
  `git log -S"fetchCover(" --all -- apps/ supabase/` returns no commit, ever: its only references
  are its definition and two test files. So `buildOpenLibraryIsbnCoverUrl`, the `?default=false`
  guard that turns Open Library's 43-byte 1x1 blank plate into a clean 404, and the whole
  ISBN-direct chain are **not on any live path**. `ol-covers`' budget (100/300s, 3000ms gap) is
  dead configuration for the same reason — `paceSource('ol-covers')` has zero call sites — yet five
  tests in `packages/core/src/sourcePace.test.ts` assert its numbers and one asserts its key differs
  from `ol-search`. The tests pass and guard nothing reachable. Covers on the sweep's actual path
  come from the enrich merge (OL search's `cover_i`, Google `imageLinks`, Hardcover), which is why
  the observed 75% hit rate does not contradict the 25% measured for ISBN-direct — different
  mechanism. **Third instance of tested-but-uncalled code**, after `bookshopId` and
  `VITE_LIBRO_AFFILIATE_ID`. Decide per case: wire it, or delete it and its tests. The pattern
  itself is worth a lint rule — an exported symbol whose only importers are `*.test.ts`.
  <sub>**verified 2026-08-20** — still OPEN: `fetchCover` has exactly ONE non-test occurrence in the tree — its own `export` at `packages/core/src/covers.ts:310`. Still callerless, and `paceSource('ol-covers')` is still dead configuration guarded by live tests. This is the repo's own documented 'exported symbol whose only importers are `*.test.ts`' shape: the standing rule says delete it or wire it, and neither has happened.</sub>
- **`normalizeImage` decodes the same bytes four times where one would do.** Each
  `ImageMagick.read` re-decodes from scratch: the full-size webp encode, the thumb encode, a read
  whose _only_ purpose is `width`/`height`, and the dominant-colour pass. The dimensions are
  already available inside the first read, and the colour pass could work from the decoded image
  rather than the source bytes. Measured locally (81KB source): 94/47/4/90ms cold, 59/38/4/12ms
  warm — so ~3 of 4 decodes are avoidable. It stays cheap **only because Open Library covers are
  ~384x500, comfortably under `FULL_EDGE = 1600`, so the resize never fires**. A source that
  actually serves large art (a camera upload at full resolution, or a future higher-res cover
  source) pays all four decodes on a big image, in a wasm sandbox, against Supabase's per-request
  CPU limit. Do not treat the current cost as the ceiling.

  <sub>**verified 2026-08-20** — still OPEN: `supabase/functions/covers/index.ts:163` still carries its own comment naming 'FOUR FULL DECODES OF THE SAME BYTES', with the four `encode`/`ImageMagick.read` passes at 167-206. Instrumented, not optimised.</sub>

## Product queue

> **PERISHABLE — audited entry by entry 2026-08-22 (batch 4 of the file).** Every live entry below
> was read, checked against `origin/main` (content via `git show` / `git grep`, shipped-ness via
> `git merge-base --is-ancestor`, never a PR badge). Result: **6 live units — 4 CLOSED**, **2 OPEN**
> (each stamped with what it was verified against).
>
> Sub-entries are counted individually because entry 2 asks for it itself ("status per feature, not
> one verdict") — and the spice sub-entry turned out to have a different verdict per half, so a
> single verdict would have hidden one of them.
>
> The previous stamp here read 2026-08-18. Four of the six units had moved since, and the two
> largest moved within hours of that pass: `7243085` landed at 22:57 on 2026-08-18, after the pass
> that called half stars OPEN. That is this file's own warning behaving exactly as written, not a
> failure of the earlier pass.

1. ~~**Shelf-model redesign**~~ — **SHIPPED.** `packages/core/src/shelves.ts` ("B2 of the shelf
   redesign") derives exactly this set — Owned with physical/ebook/audiobook breakdown, Borrowed,
   Read (with DNF split), Wishlist — as views over the five-flag possession model, with
   `visibleSections` applying the display rule. AGENTS.md's possession section documents the model
   as the shipped convention. Task history in docs/archive/task-shelf-model.md.

   <sub>**re-confirmed 2026-08-22** — `shelves.ts:157` still exports `visibleSections`. Still CLOSED.</sub>

2. **P2 features** — status per feature, re-verified 2026-08-22. **Four of the five have closed**
   since the 2026-08-18 pass; one is accurate as written.

   - ~~**Half stars**~~ — **CLOSED — verified against source 2026-08-22.** `Stars.tsx` declares
     `step?: 1 | 0.5` (line 36), imports `snapHalfRating` (line 2), and line 65 reads
     `const shown = onChange ? snap(value) : snapHalfRating(value)`. It is not an unused prop: both
     reader-facing call sites opt in — `BookDetailRoute.tsx:462-464` (the book's own rating) and
     `dialogs.tsx:130` (Log a read). `reviews.rating` stays whole-star **by design**, not by
     omission: `step` defaults to 1 so the reviews composer cannot emit a half, and
     `useUpsertReview` additionally throws on a non-integer. Closed by `7243085`, an ancestor of
     `origin/main`.

   - ~~**Separate audiobook-vs-print ratings**~~ — **CLOSED — verified against source 2026-08-22.**
     Closed by the same commit, `7243085`. The entry's "no surface … displays ratings by format" is
     no longer true: `BookDetailRoute.tsx:213` computes `latestRatingByFormat(reads ?? [])`, and
     lines 471-495 render a per-format line — stars **and** that read's own note — whenever two or
     more formats carry rated reads. Entry works too: "Log a read" captures Format and a half-star
     Rating side by side (`dialogs.tsx:115-133`). **The "aggregates" half will never close, and
     that is the point:** the rule is the most recent rated read per format, explicitly not an
     average — averaging your own rereads would invent a number nobody gave, which is the
     aggregate-rating disease AGENTS.md forbids. The book-level `rating` staying single is likewise
     the design, not a gap.

   - **Reading-progress granularity** — OPEN. `progress` is 0..100 (smallint percent); nothing
     finer (pages/chapters) exists.

     <sub>**verified 2026-08-22** — still OPEN, and accurate as written.
     `supabase/migrations/20260624010000_core_schema.sql:66` is
     `progress smallint check (progress between 0 and 100)`. No later migration alters that column —
     the only other hit across `supabase/migrations` is `20260805010000_drop_plan_date.sql:168`,
     which reads it through `p_fields` rather than changing its DDL. A grep for `progress_pages`,
     `progress_chapters`, `progress_unit` and `progress_mode` across `supabase/migrations`,
     `packages/core/src` and `apps/web/src` returns **zero** hits.</sub>

   - ~~**Field-level merge picking**~~ — **CLOSED — verified against source 2026-08-22.** The entry
     says "what is absent is any UI for the reader to pick fields per-conflict"; two such UIs now
     exist, one on each merge surface. **Import / duplicate review:** `DuplicateReview.tsx:183`
     builds the options via `mergeFieldOptions` and holds a `picks` state with a per-field
     `setPick(field, take)`; lines 236-273 render the controls themselves — a checkbox per
     contested field reading "keep yours … or take …", inside a list marked
     `data-testid="merge-field-picker"`. The patch path is `data/intake.ts:129`, which spreads
     `mergeImport(existing, inc)` and overrides `patch` with `applyFieldPicks(existing, inc, picks)`.
     Closed by `3ce2258`. **Library merge of two saved books:** `book/dialogs.tsx:768-769` calls
     `bookMergeOptions` then `applyBookMergePicks`, and `data/mergeBooks.ts:30` sends the result.
     Closed by `47e96b0`. Both are ancestors of `origin/main`.
     **One capability was deliberately not built** and should not be re-derived as a gap: declining
     a _union_ is not offered, because a union is additive and destroys nothing, so the control
     would be paid for on every card of every import to undo something that was never a loss.
     Note also that the import picker does **not** go through `p_fields` or `merge_books` at all —
     `resolveCandidate` calls `foldIn`, which does a plain `books.update`, so the picker shapes the
     PATCH. The entry's framing of the RPC as "the backend half" of this UI was a misread of which
     path runs.

   - ~~**Spice standardization with toggle-off**~~ — **CLOSED on both halves — verified against
     source 2026-08-22.** The entry bundles two claims and both are now false; they closed
     separately, so they are recorded separately.
     **Toggle-off:** `supabase/migrations/20260825010000_hide_intensity.sql` adds
     `profiles.hide_intensity` (boolean not null default false), and `hideIntensity` is read in
     eleven files including `SettingsRoute.tsx` (the toggle itself), `CoverCard.tsx`,
     `BookDetailRail.tsx`, `FilterPanel.tsx`, `StatsRoute.tsx` and `data/profile.ts`. Hiding is a
     VIEW flag — `books.intensity` is never modified, so unhiding restores every level the reader
     set, the same suppress-never-clear rule the format flags follow. Closed by `4551920`.
     **Standardization:** `packages/core/src/labels.ts` now carries `SPICE_LEVEL_GUIDE`, a
     definition for each level 0-5 ("Closed door — it happens, you don't see it"), surfaced through
     `LevelPicker` and the read-only `LevelGuideCard`. Its header names the exact defect this P2
     item was about — five identical glyphs with "nothing anywhere in the product saying what 3
     meant", so "two readers, or one reader six months apart, had no way to rate consistently". The
     scale is declared per skin in `FieldLabels`, so a skin can reword it without forking it. Closed
     by `d9003f6`.
     **A canonical `spice_levels` table was deliberately NOT built**, and the reason should survive
     so it is not re-proposed: tropes and moods have such tables because they hold named entities a
     reader can coin — unique on `lower(name)`, a `canonical_id` to alias with, an `aliases`
     array. `intensity` is a `smallint check (between 0 and 5)`: no name to be unique on, no coinage
     the CHECK would permit, nothing for `canonical_id` to point at, no spellings to alias. That
     table would ship with a personal layer that can never be populated — dead schema on day one.

   <details><summary>the five sub-entries as they read before this pass</summary>

   **Half stars** — OPEN in the UI. The schema is ready (`reads.rating numeric(2,1)`), but `components/Stars.tsx` renders and writes whole stars only (integers 1–5, `Math.round`).

   **Separate audiobook-vs-print ratings** — PARTIAL. Per-read `{format, rating}` exists in the model, so the data can already express it; no surface aggregates or displays ratings by format, and the book-level `rating` is single.

   **Reading-progress granularity** — OPEN. `progress` is 0..100 (smallint percent); nothing finer (pages/chapters) exists.

   **Field-level merge picking** — PARTIAL, the backend half is done. `merge_books` takes `p_fields jsonb` and `data/mergeBooks.ts` calls it with the engine-computed merged row; what is absent is any UI for the reader to pick fields per-conflict (DuplicateReview lists what the merge will take, it does not offer choices). Same shape as series consolidation was: RPC shipped, picker unbuilt.

   **Spice standardization with toggle-off** — OPEN. Spice/intensity is settable (Add + book dialogs) and filterable (1–5 in FilterPanel); no standardization pass and no hide-spice toggle exist.

   </details>

3. **Metadata sourcing** — PARTIAL. ISBNdb is no longer "evaluate": it is integrated as an enrich
   source (`packages/core/src/enrich.ts` PRECEDENCE lists it per-field). Wikidata series seeding
   (P179 + P1545) remains OPEN — Wikidata appears only in manual audit queries under
   docs/queries/, not in any code path.

   <sub>**verified 2026-08-22** — still accurate on both halves. ISBNdb: `enrich.ts:13` includes
   `'isbndb'` in the `EnrichSource` union, and it appears in nine per-field PRECEDENCE lists at
   `enrich.ts:89-101`, ranked first for `pageCount`, `publisher`, `pubY`, `pubM`, `pubD`, `binding`,
   `language`, `isbn13` and `isbn10`. It is live in both `supabase/functions/enrich/index.ts` and
   `apps/web/src/data/enrichLibrary.ts`, so it is an integrated source rather than a dead constant.
   Wikidata: a case-insensitive file grep across `apps`, `packages`, `supabase` and `scripts`
   returns **zero** files; every hit in the repo is under `docs/`, exactly as the entry says.</sub>

## Deferred by decision, not forgotten

> **PERISHABLE — audited entry by entry 2026-08-22 (batch 4).** All five checked against
> `origin/main`. Result: **5 live, 5 OPEN** — every one still accurately deferred. Two are not
> merely absent but deliberately implemented as described (the offline landing, the barcode
> fallback message), noted per entry so nobody re-derives them as missing work.

- Offline write queue. Writes currently fail visibly — a subsystem, not a branch.

  <sub>**verified 2026-08-22** — still OPEN. A grep for `outbox`, `writeQueue`, `mutationQueue`,
  `offlineQueue` and `pendingWrites` across `apps`, `packages` and `supabase` returns **zero**
  files. `apps/web/src/lib/offlineCache.ts` is a READ cache only; mutations are optimistic with
  `onError` rollback (`data/books.ts:86` and `:107`, `data/listItems.ts:192`, `data/reads.ts:91`),
  which is the "fail visibly" the entry describes.</sub>

- Realtime subscriptions across sign-out.

  <sub>**verified 2026-08-22** — still OPEN. `hooks/useRealtimeRefetch.ts` subscribes inside a
  `useEffect` keyed on the channel, the serialized subs and the query client, and removes the
  channel only on unmount. It observes no auth state at all, so sign-out while a subscribed route
  stays mounted is exactly the ungoverned case the entry defers. Two live call sites:
  `ClubRoute.tsx:50` and `SharedListRoute.tsx:78`.</sub>

- Signed-out reader opening offline sees above-fold landing content only.

  <sub>**verified 2026-08-22** — still OPEN, and **implemented as described rather than merely
  unfinished**. `auth/Landing.tsx:9` lazy-loads the below-fold chunk inside a `ChunkBoundary`
  (line 220) whose comment states the contract: if the chunk cannot be fetched, "the hero, nav and
  CTA above have already rendered and must stay." What is deferred is the scope of what renders
  offline, not a missing boundary.</sub>

- iOS barcode wasm fallback — decide once tester platform mix is known.

  <sub>**verified 2026-08-22** — still OPEN and still awaiting the same input.
  `AddRoute.tsx:828` gates on `window.BarcodeDetector`, the native API only; a grep for `zxing` and
  `quagga` across `apps` and `packages` returns **zero** files, so no wasm decoder exists. An
  unsupported browser gets a graceful line rather than a broken control, at `AddRoute.tsx:830`:
  "Barcode scanning isn't supported in this browser — search by title or ISBN below."</sub>

- Year heatmap. No longer sold by copy.

  <sub>**verified 2026-08-22** — still OPEN, and the copy claim holds: a grep for `heatmap` and
  `heat map` across `apps` and `packages` returns **zero** hits, so nothing in the product promises
  one. One stale pointer worth knowing before planning against this:
  `docs/reference/STATS_PRIVACY_AND_FEATURES.md:33` still lists a "reading-season heatmap
  (months/days)" under READING RHYTHM. That is a reference doc rather than app copy, so it does not
  contradict the entry — but it is the document someone would build from.</sub>

## Parked — a skin-palette pass, when someone next opens the palettes

> **PERISHABLE — audited 2026-08-22 (batch 4).** 1 live entry. The reasoning and the conclusion
> hold; **one row of the table did not reproduce and has been corrected from source** — tryst/dark
> was measured without compositing its translucent `--card`. The affected set is unchanged at
> four skins. Details in the entry.

- **`--accent-fill` is invisible against `--card` in four dark skins, and in almanac/dark it IS the
  card colour.** Measured from `SKIN_TOKENS` while fixing the level-picker ring
  (`levelRing.contrast.test.ts`), where it was the obvious token to carry state and could not.

  **One row corrected 2026-08-22; the affected set is unchanged at four.** Recomputed with the WCAG
  relative-luminance formula directly from `packages/core/src/skinTokens.fixture.ts`, against
  `--card` — the surface this column has always named — compositing it over `--bg0` wherever it is
  translucent:

  | skin/mode    | `--accent-fill` vs `--card`  | the old table said |
  | ------------ | ---------------------------- | ------------------ |
  | almanac/dark | **1.00:1** — the same colour | 1.00               |
  | hearth/dark  | 1.48:1                       | 1.48               |
  | tryst/dark   | **2.54:1**                   | 2.30               |
  | bloom/dark   | 2.76:1                       | 2.76               |

  almanac/dark's "it IS the card colour" is literally exact: `accentFill`, `card` and `cardSolid`
  are all `#241f14`.

  **The tryst/dark correction, and the class of mistake it belongs to.** The old 2.30 is
  `--accent-fill` measured against `rgba(42, 21, 58, 0.55)` **with its alpha discarded** — the raw
  triplet treated as opaque, `rgb(42, 21, 58)` — which reproduces 2.30 exactly. Honouring the alpha
  and compositing over `--bg0` gives `rgb(28.1, 14.3, 40.0)` and **2.54:1**. So the original number
  was not a slip in arithmetic or a different pair chosen on purpose; it skipped compositing a
  translucent token over its background, and measured a colour that nothing ever paints.

  **The fixture already warns about exactly this, one field above the one being measured.** `--line`
  is documented as kept "AS AUTHORED. Every one of the 18 is an rgba with alpha < 0.5, so a
  border-visibility measurement that skips compositing it over the painted card is measuring a
  colour nothing ever renders." `--card`'s own doc states the same rule positively — it is "kept raw
  rather than pre-composited so skinTokensParity.test.ts can pin it directly to tokens.css; the
  consumer composites it over bg0 itself." **The consumer is whoever measures.** tryst is the only
  dark skin whose `--card` carries alpha, which is why it is the only row that moved.

  **A related trap, named so it is not mistaken for a fifth skin.** `--card` and `--card-solid` are
  different questions, and the fixture says they "diverge … in the three Fable 5 combos where
  `--card-solid` was deliberately lifted away from `--card` (marrow/dark, umbra/light,
  umbra/dark)". marrow/dark is **3.17:1** against `--card` — above the 3:1 floor, so it is **not**
  in the affected set — and 2.70:1 against `--card-solid`. Measuring the latter and reading it
  against this table's header surfaces the divergence, not a missing skin.

  **Not staleness, either way.** `skinTokens.fixture.ts` is byte-identical between the commit that
  wrote this entry (`329487e`) and `origin/main` — the diff for that file is empty. The tryst number
  was wrong when written, not drifted.

  WCAG 1.4.11's floor for a control boundary is 3:1, so anything whose visibility depends on an
  accent fill is absent in those four skins. The level picker was rebuilt around `--muted` instead
  (4.51:1 worst across all eighteen) precisely to avoid the dependency. **The conclusion is
  unaffected by the correction above** — every skin named still fails 3:1, and the set is the same
  four it always was.

  **Why no existing test catches this — accurate as written, verified 2026-08-22.**
  `skinCharacter.contrast.test.ts` asserts text ON the fill (`onPrimary` against `accentFill`) at AA
  4.5:1, which is a different question and passes happily: a fill can be perfectly readable to write
  on and still vanish against the surface it sits in. Confirmed exhaustively — every `accentFill`
  pairing in the suite is text-on-fill (`skinCharacter.contrast.test.ts:45` and `:49`,
  `ownershipControl.contrast.test.ts:27`), plus one parity pin to the CSS var at
  `skinTokensParity.test.ts:114`. There is **no fill-vs-surface pair anywhere** across the twelve
  `*.contrast.test.ts` files, so this class is structurally invisible to the suite.

  **Not scheduled work, and deliberately not fixed here.** Changing `--accent-fill` in four skins is
  a palette decision with reach far past this picker — every button, chip and active state that uses
  it. Recorded so the next person opening the palettes has the numbers, and so the next feature
  reaching for an accent fill as a state carrier knows it cannot be one.

  <details><summary>the original table, as it read before this pass</summary>

  | skin/mode    | `--accent-fill` vs `--card`  |
  | ------------ | ---------------------------- |
  | almanac/dark | **1.00:1** — the same colour |
  | hearth/dark  | 1.48:1                       |
  | tryst/dark   | 2.30:1                       |
  | bloom/dark   | 2.76:1                       |

  </details>

## Parked design conversations

> **Audited 2026-08-22 (batch 4): nothing here is verifiable, by design.** This is a list of topic
> names, not entries — it makes no claim about the tree, so there is nothing to check against
> source and no stamp to add. Recorded explicitly so a later pass does not read the missing stamp as
> "not yet audited".

Calendar cluster; borrowed-as-subsystem; Match
approach (b), library-signal-driven; opt-in genre-gradient personalization;
onboarding Stages B–D.

The multi-series universe layer moved out of this parked list on 2026-08-30. Its accepted model,
Pro boundary, responsive design, and test plan are in
[`docs/tasks/task-series-universes.md`](../tasks/task-series-universes.md).

## Open decisions

> **PERISHABLE — audited entry by entry 2026-08-22 (batch 4).** 2 live entries; 2 more are already
> struck and were re-confirmed. Result: **1 OPEN** (stamped) and **1 PARTIAL** — the cover-cache
> entry's removal half is confirmed, one of its two sub-points is **wrong as written** (the clearing
> it says was "not done here" shipped in the very same commit), and its production measurements are
> **unverifiable from a Code session**.

- **DECIDED + REMOVED (2026-08): the global `{isbn}.jpg` cover cache is gone.** The enrich
  function's `scheduleCoverCache` fetched every resolved cover a second time and stored it at
  `covers/{isbn13}.jpg` — keyed by edition rather than by reader, in a public bucket — then patched
  the cache row to point at it, so the next book to hit that key adopted the shared object and
  skipped the client's ingest. Measured before removal: **33 books on client ingest, all complete;
  1 book on the global path, missing both `coverThumb` and `coverColor`** — 3% of covers and 100%
  of the degraded rows. It also had no host check (while `PRECEDENCE.cover` puts `google` second),
  no magic-byte sniff, no `MIN_COVER_EDGE_PX` floor, no size cap and no normalization, and once
  stored a cover carried our own host, defeating the host-matching audit in
  `docs/reference/reverie-metadata-sourcing.md`. Cross-reader sharing bought nothing — one library per
  account (AGENTS.md decision 2), one reader. If it ever becomes a goal it gets rebuilt **through**
  the `covers` function that already gates everything, not beside it. Guarded by
  `packages/core/src/noGlobalCoverCache.test.ts`, which reads the Deno source (no Deno test runner
  exists) and fails if `enrich` regains any Storage write.

  <sub>**verified 2026-08-22 — the removal itself is CONFIRMED.** `scheduleCoverCache` survives
  nowhere in shipping code: every hit across `apps`, `packages` and `supabase` is either the guard
  test (`noGlobalCoverCache.test.ts:7`, `:41`, `:50`, which asserts that `cacheCover`,
  `scheduleCoverCache` and `coverKeyFor` are all gone) or a migration comment. `COMPLETE_DAYS = 30`
  is real at `supabase/functions/enrich/index.ts:528` and used at line 549, and
  `docs/queries/global-cover-cache-audit.sql` exists. **The measurements (33, 1, 3%) are
  UNVERIFIABLE FROM A CODE SESSION** — they are counts against the production database. What would
  settle them is re-running that audit query against prod, which is the owner's to run.</sub>

  **Two things the removal does NOT do, both left as owner data decisions:**

  1. **The 41 already-stored objects survive.** Deleting the writer does not unstore what it wrote.
     Any of them that are Google-origin are stored copies of covers the licensing analysis permits
     only as hotlinks, and they stay that way until deleted. Origin is recoverable only through
     `enrichment_cache.provenance->'cover'->>'source'` — the object path is just an ISBN and the
     book row, if any, now carries our host. Query 2 in
     `docs/queries/global-cover-cache-audit.sql`.

     <sub>**verified 2026-08-22 — still OPEN in code; the count is UNVERIFIABLE FROM A CODE
     SESSION.** The code half is confirmed: `20260808010000_clear_global_cover_cache_rows.sql`
     states in its own body that "No `storage.objects` row is touched or deleted — the already-stored
     bytes are a separate, deliberately deferred data decision", and it clears `record.cover` while
     explicitly leaving `provenance` intact so the Google-origin breakdown stays answerable. The
     **41** is a production object count and cannot be checked from here; Query 2 against prod would
     settle it.</sub>

  2. ~~**Adoption continues for up to 30 days after deploy.**~~ **WRONG AS WRITTEN — corrected
     2026-08-22.** The sentence "Clearing them is a one-statement data fix; not done here" was
     **never true**. `supabase/migrations/20260808010000_clear_global_cover_cache_rows.sql` performs
     exactly that clearing, and `git show --stat 97042e2` shows the migration was added **in the
     same commit that wrote this entry** — the commit contradicted itself. The migration nulls
     `record.cover` and sets `complete = false` on every row whose `record.cover` points at our own
     public covers bucket, which retires the 30-day window rather than waiting it out; it is
     self-limiting on re-run, since a cleared row no longer matches. Its `WHERE` cannot over-match:
     `mergeRecords` only ever writes external source URLs into `record.cover`, so our own Storage
     host could only have come from `scheduleCoverCache`'s PATCH.
     **What remains genuinely open is a deploy question, not a code one, and it is UNVERIFIABLE FROM
     A CODE SESSION:** whether that migration has been applied to production. If it has, the adoption
     window described here is already closed; if it has not, the 30-day tail still runs. The remote
     column of `supabase migration list --linked` is what settles it, and per AGENTS.md that is the
     owner's to run.

     <details><summary>the sub-entry as it read before this pass</summary>

     **Adoption continues for up to 30 days after deploy.** Cache rows already rewritten still hold a global URL in `record.cover`, and a rewritten row has a cover and an isbn13 so `isComplete` is true and `isFresh` keeps it for `COMPLETE_DAYS = 30`. Every hit on such a row still hands the client a stored URL that `isIngestibleCoverUrl` declines to re-ingest — so new degraded rows can still appear, from `bulkComplete` and from `AddRoute`, until those rows age out or are cleared. Clearing them is a one-statement data fix; not done here.

     </details>

  **The one degraded book cannot repair itself.** `useCoverBackfill` skips it (`isStoredCoverUrl`
  is true), and `resharpenSource` needs `coverSourceUrl` to re-fetch from — which the adoption path
  never set, because only the ingest sets it. It keeps a working cover and permanently lacks a
  thumb and a spine colour unless the cover is cleared and re-swept, or re-picked in Cover Studio.
  At N=1 that is a manual fix; if the count had been larger it would need a repair pass.

  <sub>**2026-08-22 — UNVERIFIABLE FROM A CODE SESSION.** Whether one book is still degraded is a
  production row state. What would settle it: Query 1 in `docs/queries/global-cover-cache-audit.sql`
  against prod, or the owner re-picking that cover in Cover Studio. Deliberately not downgraded to
  OPEN — the code path described is real, but its subject is a row nobody here can see.</sub>

- **LICENSE** — entry rewritten 2026-08-18; the old text described a license that no longer
  exists. The proprietary training-fork grant (87e0195) was replaced by **AGPL-3.0** in the
  pre-public licensing pass (#154, `chore(license)`), which also landed `CLA.md` as a draft and
  the CC0 corpus split. What remains open is the owner's review — whether AGPL-3.0 is the final
  answer before LLC formation, and whether the CLA draft becomes binding — which is Greg's
  decision and not verifiable from the tree. **Post-#297 confirmation, recorded so the question
  stays closed (2026-08-21):** filling the LICENSE appendix's copyright line did NOT break GitHub's
  licence detection — `gh api repos/:owner/:repo --jq .license` returns `spdx_id: AGPL-3.0`
  (`key: agpl-3.0`), so #297's revert-to-README fallback was not needed.

  <sub>**verified 2026-08-22** — accurate as written. `LICENSE` opens "GNU AFFERO GENERAL PUBLIC
  LICENSE / Version 3, 19 November 2007", and `CLA.md` is present on `origin/main`. The recorded
  confirmation reproduces exactly: re-running that same read-only `gh api` call today returns
  `"key":"agpl-3.0"` and `"spdx_id":"AGPL-3.0"`. **The open half stays open and is UNVERIFIABLE
  FROM A CODE SESSION** — whether AGPL-3.0 is final, and whether the CLA becomes binding, are owner
  decisions settled only by Greg saying so.</sub>

- ~~**`NOTICES.md`** missing `npm:@imagemagick/magick-wasm`~~ — done. Present in NOTICES.md
  (Apache-2.0, with the embedded-ImageMagick dual-notice caveat) since the #154 NOTICES sweep.
  The structural caveat stands: the inventory is generated from the pnpm tree and cannot see
  Deno-side Edge Function dependencies, so future Deno deps need adding by hand the same way.

  <sub>**re-confirmed 2026-08-22** — `NOTICES.md:75` carries the `@imagemagick/magick-wasm` row
  (0.0.35, Apache-2.0) with the dual-notice caveat. Still CLOSED.</sub>

- ~~**`AGENTS.md` rules pass**~~ — done (#93). Six rules, each with its reason,
  now live under "Shell & deploy safety" and "Testing & verification discipline"
  in `AGENTS.md`.

  <sub>**re-confirmed 2026-08-22** — both headings are present in `AGENTS.md`, and both sections
  have grown well past the original six (the testing section now counts eighteen). Still CLOSED; the
  count in the entry describes what #93 delivered, not today's file.</sub>
