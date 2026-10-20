# Browser environment stabilization

This follows the [Keep both recovery investigation](keep-both-save-recovery.md). The new resolver
remains in shadow mode; Add, scanning, imports, contributor rules and production data are unchanged.

## Engine consistency

The previous full run had 22 failures. Nine mobile failures occurred after the active Docker
context changed to an empty engine while browser HTTP requests still reached the original stack.

`scripts/stack-engine.mjs` now runs inside the existing shared stack lock. It resolves the selected
context or explicit host to one local socket, resolves socket symlinks, verifies the database and
API containers and their configured ports, and passes that endpoint to every child. Nested runs
check the pinned engine identity. It does not change the user's global context, discover another
stack, start containers, or accept a remote Docker endpoint for localhost browser tests.

This follows Docker's documented [context precedence](https://docs.docker.com/reference/cli/docker/#environment-variables):
an explicit context overrides a host. After resolution the wrapper removes that context variable
so Docker and Supabase receive the same fixed host. `pnpm e2e` includes the guard automatically.
For a reset/test/restore lifecycle, the guard must wrap the entire lifecycle inside the lock,
before its first database operation. A test-only guard cannot protect an earlier reset.

Regression coverage includes context changes, conflicting explicit selectors, socket aliases,
replacement engines, unhealthy or missing containers, wrong ports, remote-engine refusal, command
arguments, exit-code preservation, and refusal to execute after failed preflight.

## Browser failure investigation

The old navigation trace includes local development modules taking up to 52 seconds to load.
The editor trace shows a successful PATCH followed by slow library refreshes, with the dialog-close
assertion already consuming its five-second budget. The editor test now observes the exact book's
successful PATCH response before asserting closure and still verifies saved values after reload.
No assertion timeout or retry allowance is increased.

The first focused run also exposed a distinct edition-credit fixture failure: its freshly generated
browser timestamp was classified as future-dated by the database. The disabled credit was an
evidence hold, not a slow checkbox. This is separate from the earlier missing-container errors.
The synthetic recovery case now anchors its browser clock to a database timestamp taken before
opening the form. Its timers continue running. A separate negative control sends tomorrow's
timestamp to the real prepare RPC and requires disabled selection, no apply request, no stored
credits, and identical personal book/history rows. Neither the server freshness check nor the
client evidence model is relaxed. Real future-dated observations continue to require review.

The focused pass retained 51 passes, two configured skips and that one failure. Its trace remains
in the private receipts; later verification does not replace it. All of the prior 22 failing cases
were included in that selection, although the new clock failure prevented complete desktop
edition-credit coverage until the correction.

The first full attempt retained 14 passes and one accessibility-route navigation timeout before
being interrupted (one interrupted, 433 not run). It is not a completed acceptance run. The
failure occurred while loading `/skins`, not in an axe assertion; its trace again showed slow
local module requests. The browser server now uses a dedicated `browser-test` mode that excludes
Nitro/Workflow builders and watchers. This suite exercises the SPA against real local Supabase;
its bookstore API requests are explicitly mocked. Administrator Settings also requests current
corpus-sweep and series-recovery status. Those two catalog-review fixtures now explicitly stub
only the exact GET status paths with the normal feature-disabled `{ run: null }` response and
assert that both responses were exercised. Other paths and methods are not intercepted. Workflow
has separate compiler-backed tests; these browser fixtures do not establish authenticated,
feature-enabled browser-to-Workflow integration. Normal development and production builds retain
both plugins. The previously failing
Marrow/light case passed in 42 seconds with this mode; that targeted result alone does not
establish full-suite stability or prove a sole cause for host contention.

## Verification

The final full browser run on the stacked adapter head `f67f51b` completed with **438 passed,
11 configured skips and zero failures in 56.4 minutes**. All browser runs use synthetic accounts,
a fresh local database, one worker and zero retries. Pre/post local snapshots and failure traces stay in
private receipts outside Git. The standard local demo library is restored under the same pinned
engine and stack lock after each run. Production data and personal reading history are not accessed.

The corrected edition-credit positive and future-date negative cases also passed on desktop and
mobile (four targeted tests). The final unit gate passed 3,388 core, 1,346 web, 498 source-trial and
two compiler-backed Workflow tests, plus 127 recovery checks, nine completion-plan tests and
11 engine-guard tests. Typecheck, lint, normal production build and repository formatting passed.

The normal compiled Nitro backend was separately exercised for both status routes: with workflows
disabled each returned HTTP 200 and `{run:null}`; with workflows enabled each refused an
unauthenticated request with HTTP 401. These four smoke checks do not prove authenticated job
reads or writes. The full SPA suite's two administrator Settings fixtures explicitly assert their
disabled-status stubs, rather than silently accepting missing routes. Remote CI could not be
inspected because the required checks connector requested a GitHub account connection.

The final full-run lifecycle exited successfully. Local restoration readback confirmed 290 demo
books, zero reading-history rows and one local account, matching the pre-run baseline. Private
pre/post snapshots remain available. This pass did not access or modify the production database.

The targeted server-mode run passed its test but returned a cleanup failure: the local reset
finished applying migrations and timed out while Storage was becoming healthy. The first subsequent
demo seed also received an Auth timeout. After all local services reported healthy, the seed
completed under the same engine guard and lock, and readback confirmed 290 books, zero reads and
one local account. Both failures are retained; the successful seed did not rerun or erase browser
results. Local service readiness remains a separate concern from browser assertions.

Existing ambiguous identities, contributor roles, source qualifications and unobserved provider
controls remain under review. Browser acceptance does not authorize intake cutover.
