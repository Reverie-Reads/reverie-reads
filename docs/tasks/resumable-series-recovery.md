# One-approval series outage recovery

This is an incident-specific owner tool, not a new application pipeline. It replaces repeated
browser-console handoffs for the historical September 10 outage population. The successful
canaries and 25-work recovery established the existing save/read-back path; they do not certify
every provider relationship as bibliographically correct.

## Scope and guarantees

- `plan` reads the current eligible population and freezes ordered identities, complete work-row
  fingerprints, project, existing administrator, deployed web build, series function version/hash,
  local commit/runtime and Node
  version. It refuses zero or more than 1,000 works; it never silently truncates a larger population.
- `run` asks a human once to approve that exact list. Each reset batch contains at most 25 works.
  The existing incident SQL runs with rollback first and revalidates the same fingerprints under
  locks before committing. Only historical `no_series`/provider-unavailable records with no live
  shared membership or pending review qualify. Resets do not clear their evidence or candidate tuple.
- Lookup uses the existing `series` Edge Function and the signed-in existing administrator. A high
  stored identity confidence, nonblank candidate series, full author and explicit Hardcover **book**
  locator are required. Missing input defers without a provider call. A label alone never suffices.
- The actual application classifier decides found/review from one exact title/full-author member
  in the returned relationship. The existing discovery RPC decides confirmed versus review against
  the current stored tuple. No LLM, new provider, standalone assertion or inferred series count.
  A missing observed position cannot certify an existing candidate position: that work defers.
- HTTP-200 ambiguity, identity mismatch, no match, empty relationship or relationship limit defers
  that work. It does not stop the other works or initiate pagination. Authentication, quota, timeout,
  network, malformed success contract, changed record or changed web build stops the run. The
  active JWT-protected series function version/hash is rechecked at run/resume and reset-batch
  boundaries. Keep deployments quiet; these checks are not a cross-service deployment lock.
- Confirmed relationships reconcile eligible personal defaults through existing database triggers.
  Reader/import choices stay protected. Each save is read back using privileged owner SQL across
  **all** linked personal copies, not merely rows visible to the signed-in browser. The runner checks
  protected fields, reading logs, shared/personal memberships, pending reviews and provenance.
- Reviews enter the existing administrator suggestion queue; deferred records remain unresolved
  with their reason in the private journal. Neither category is automatically approved or retried.
  A finished recovery is not a claim that all works are resolved or that all data is accurate.
- No billing, provider configuration, app deployment, migration, cover, other metadata enrichment,
  qualification dataset or consumed ISBNdb study is changed. Provider calls may populate the
  existing lookup cache; cache versus live is **not distinguished**.

## Owner preparation

Merge the public change and sync it into the private repository through the normal PR process.
No new migration or Edge Function is introduced. Run from the clean, merged **main** checkout that
will own this recovery, preferably `/Users/gregchism/dev/reverie`. Install the locked dependencies.
The existing series fixes must already be deployed. Finish/cancel other corpus sweeps and keep
deployments and catalog administration quiet during execution.

The owner needs:

- An authenticated Supabase CLI with database-query access to the explicit production project.
- The existing corpus administrator UUID; this tool does not grant administrator access.
- A current signed-in access token for **that same administrator**, entered into a hidden prompt.
  Do not paste a refresh token, service-role key, token into chat, or token into command arguments.
- The project's public/publishable key. By default it reads only `VITE_SUPABASE_ANON_KEY` from
  `<deployment>/apps/web/.env.local`. Alternatively provide `REVERIE_RECOVERY_PUBLISHABLE_KEY`
  through the owner's environment. No new secret is required in Supabase.

`--deployment` is an absolute checkout with the matching `supabase/.temp/project-ref`. Every SQL
request also specifies `--project-ref` explicitly, so a relink cannot redirect execution.
The lookup uses the actual user token; the privileged owner SQL transaction attributes the existing
RPC call to that already-validated actor using transaction-local JWT claims. This is not an RLS
relaxation or a general service-role API. Do not give this command to ordinary readers.

## Commands

Replace the uppercase placeholders. These commands belong in an owner terminal, not the browser
console or SQL editor. `plan` does no production writes; `run` and `resume` must never be executed by
an agent session or approved with piped input.

```sh
cd /Users/gregchism/dev/reverie
pnpm series:recovery --mode=plan --project=PROJECT_REF --actor=ADMIN_UUID --deployment=/Users/gregchism/dev/reverie --app=https://APP_HOST
```

Inspect the printed private `plan.json`: count, identities, scope, project, actor and build. Copy
the complete 64-character run digest printed by `plan` into `RUN_DIGEST` below. Then:

```sh
pnpm series:recovery --mode=run --project=PROJECT_REF --deployment=/Users/gregchism/dev/reverie --run=RUN_DIGEST
```

The hidden token prompt is followed by `RECOVER <digest-prefix>` confirmation for the complete
list. The process prints aggregate progress after each work and leaves at least 3.1 seconds between
completed work attempts. A provider request is bounded to 20 seconds; SQL has statement/lock
timeouts and a 60-second client timeout. There are no automatic retries or scheduled/background
runs. Keep this terminal open. Ctrl-C requests a stop at the next safe boundary; an in-flight save
must finish and be checked before the process exits.

```sh
pnpm series:recovery --mode=status --project=PROJECT_REF --deployment=/Users/gregchism/dev/reverie --run=RUN_DIGEST
pnpm series:recovery --mode=resume --project=PROJECT_REF --deployment=/Users/gregchism/dev/reverie --run=RUN_DIGEST
```

`status` reads local progress only. `resume` requires the same sealed plan, commit, runtime and Node
version, checks the current administrator/session and deployed build again, and accepts a fresh
token after expiry. It retains the original scope approval. Completed/deferred work is skipped;
an interrupted lookup/proposal is deferred without repeating it. Untouched works continue.

## Durable state and exceptional stops

State is private under the running checkout's Git **common** directory:
`series-recovery/<project>/<run-digest>/`. Plans, proposal/read-back snapshots and hash-chained
journal entries have owner-only file permissions. Project-wide exclusive work attempt files prevent
another plan in the same repository/worktree family from reacquiring those works. A project-wide
lock prevents concurrent runs. Tokens and raw provider responses are never written there. These
snapshots contain private library data: do not commit, upload or attach them wholesale.

Always use the same repository family. Separate clones do not share this local state: do **not**
switch clones, delete attempt markers, regenerate a plan or edit a journal to retry consumed work.
Keep the state for the incident audit; hashes detect accidental edits, not malicious local tampering.

An interrupted/reset save, failed read-back or stale process lock is deliberately **not** silently
recoverable. First inspect the journal and perform independent read-only database verification.
The runner refuses to replay an uncertain write, even if the network error may have occurred after
commit. A crash during marker allocation can likewise require owner investigation before progress.
Do not remove these safeguards to make the command run. If runtime/build changed after work began,
stop and review a continuation design; do not create a fresh plan to bypass the consumed scope.

The batch is not atomic: previously verified works remain saved if a later work stops. The final
summary separates verified, deferred and uncertain attempts. Keep the journal and independently
check the final inventory/review totals before declaring the incident closed. Remaining ambiguous
cases are a bounded review backlog, not a reason to rerun the entire catalog.

## Verification

`pnpm test:series-recovery` runs offline policy, write-ahead interruption, resume, journal integrity,
single-use, SQL scope and read-back protection checks. It is also part of ordinary `pnpm test`.

`pnpm db:test:series-recovery` acquires the shared local-stack lock and tests the generated reset and
actual discovery RPC with transactional fixtures at loopback port 55322. Fixtures roll back;
production connections are not accepted by that test. Run against the migrated local stack.

Runtime code lives in `scripts/series-recovery-cli.mjs`, `scripts/series-recovery.mjs` and
`scripts/series-recovery-lib.mjs`. Production execution remains a separate owner-run gate after
merge, not a side effect of tests or PR creation.

### Implementation verification — September 12 UTC

- 98 offline recovery checks pass. Full ordinary tests on the merged #537 base pass: 403 trial,
  2,805 core, 971 web and one compiled Workflow test. Full lint, formatting, typecheck and build
  pass; the build's committed-local-Supabase warning is expected and is not a deployed build.
- The generated reset passes exact read-back, rollback and stale-fingerprint tests. Five actual
  RPC save/read-back paths pass: confirmed/review, missing position fill, preserved explicit
  counts, and confirmed membership with unknown order. The fixtures contain eligible defaults,
  a reader's explicit clear, an imported choice and real synthetic reading history. All roll back.
  Fixture setup was corrected to use the schema's non-null metadata-provenance object and the
  full author required by its existing book-identity trigger; no production data was involved.
- Shared full browser verification: 279 passed, 10 expected skips, 28.9 minutes, fresh database,
  one default worker, zero retries. The coordinated task tested
  `5e0a0655b94d4e248d19fa4af85850416298e385`, whose full tree matches merged #537
  (`48a5ff2292a805f0c1b3678e673fced57bc7ffbc`). After incorporating that base, this recovery branch
  has byte-identical application, schema, browser tests/configuration, existing helpers and
  dependency lockfile. This is explicitly shared full-suite evidence, not a second browser run
  in this worktree. The recovery's new script path is independently exercised by the tests above.
- Read-only hosted probes confirmed the Supabase CLI's multi-statement JSON response shape.
  No production reset, relationship lookup, save, billing/configuration change or deployment was
  performed. Hosted execution and its final inventory remain owner gates.
