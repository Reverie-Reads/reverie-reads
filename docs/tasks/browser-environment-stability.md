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

## Verification

Results will be recorded after the final checks. All browser runs use synthetic accounts, a fresh
local database, one worker and zero retries. Pre/post local snapshots and failure traces stay in
private receipts outside Git. The standard local demo library is restored under the same pinned
engine and stack lock after each run. Production data and personal reading history are not accessed.

Existing ambiguous identities, contributor roles, source qualifications and unobserved provider
controls remain under review. Browser acceptance does not authorize intake cutover.
