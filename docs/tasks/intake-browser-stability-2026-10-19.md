# Browser verification stabilization — October 19, 2026

The retained local zero-retry run had 197 passes, seven failures, four skips and 241 unrun
cases before a controlled stop. Load reached 318 on eight CPUs. Several failing traces show
successful development-module responses taking up to 27 seconds, beyond the unchanged
15-second app recovery timer. Those timings establish a startup bottleneck; they do not prove
that every subscription, navigation or planner failure has the same cause. Original failures
and the successful old-head CI matrix remain separate retained evidence.

## Changes awaiting verification

- Build a fresh `browser-test` SPA into ignored `.browser-test-dist` on every browser-server
  launch, then strict-port preview on the existing config-owned port. This removes development
  transform/request fan-out without reusing an old artifact or relaxing a deadline.
- Preserve real local Supabase and the existing explicit Workflow/bookstore mocks. Production
  boot and service-worker registration now execute in these bundled tests. No worker is blocked
  or application behavior stubbed to make a check pass.
- Three room sweeps import a test-build-only entry sharing the real appearance store. They
  assert the resulting room and mode. Normal builds exclude the entry. Monitoring upload stays
  disabled for browser-test builds, including when local upload credentials exist.
- Observe library join frames before navigation, retain an early acknowledgement, and start
  the same 20-second wait only when the test awaits subscription after navigation is ready.
  This prevents a rejection while the test is still awaiting startup. Missing/wrong-reader
  acknowledgements still fail; listeners and the deadline are cleaned up.
- Local admission refuses one- or five-minute load above twice the available CPUs before
  launching the browser command. The outer archive/reset lifecycle must call it before reset
  too. This is an operational ceiling, not an independently calibrated accuracy or capacity
  guarantee. Memory pressure remains a separate required observation. CI policy is unchanged.
- Readiness uses bounded HTTP probes with the committed public local anonymous key. It never
  invokes CLI credential discovery, grants access or reads book rows. The actual local contract
  is Auth health 200, API schema 200, private-books permission control 401/42501 and missing-table
  control 404/PGRST205. The first live anonymous books probe expected 200 and failed; that receipt
  remains retained. A separate read-only inspection confirmed the permission and schema responses.

No production intake, matching, metadata, account or reading-history writer changes. Original
frozen comparisons and attempt markers remain consumed and untouched. No model call or paid
source acquisition. Existing archive recovery safeguards still apply to every reset/test/restore.

## Current boundaries

Three subscription regressions and two admission regressions passed before the owner-requested
pause; typecheck passed. Readiness tests exercise actual HTTP responses, rejection of HTML,
negative controls and a stalled endpoint. New final-head build/browser/full-suite results belong
in the PR verification record; old-head CI does not certify this change. Intake stays unchanged
until unresolved local failures and service readiness are checked.

The owner resumed this work on October 19. The Mac still showed memory pressure and sustained
load above the admission ceiling, so no new browser run or reset was launched. The previous
archive match across 102 public/auth tables and eight publication statements remains distinct
from the old timed-out CLI readiness check. No other application's work was stopped.

The retained title discrepancy is still unresolved. The frozen positive target is exactly
The Hexologists / Josiah Bancroft / ISBN 9780316443302, consistent with the publisher reference.
A subsequent manual public Open Library edition inspection reached human verification rather
than book facts. Its redirect names OL46630289M, but does not prove its title or identity.
Do not bypass that gate, replay the consumed comparison, infer an article/subtitle difference,
or relax identity admission without verified text. No raw provider page was retained.
