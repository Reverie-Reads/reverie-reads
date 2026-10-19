# Source-specific evidence handoff — October 18, 2026

This stage adds a transient handoff preview to the existing operator evidence viewer. It preserves
current values, retains identity/edition conflicts and lists separate requirements for catalog
storage, export and model input. It cannot save, export or send a model request. Add, scanning,
imports and the existing administrator credit writer keep their existing paths.

## Source-use evidence refreshed

The owner confirmed no separate PRH or Hardcover agreement is available. The earlier
[source-use review](intake-source-qualification-2026-10-18.md) remains a dated record; its inaccessible
Hardcover-documentation finding is superseded by this addendum. Public documentation can inform
qualification without a private agreement, but no additional source operation was approved here.
No provider was contacted, account created, terms accepted or book-data request made.

Hardcover's official documentation site remained inaccessible to the research tool. Its public
[documentation repository](https://github.com/hardcoverapp/hardcover-docs) provided a supported
primary-source alternative. The inspected revision was
`c965e65dfdc60bd26a9377ade3f8132f48467dee`; the
[Getting Started guide](https://github.com/hardcoverapp/hardcover-docs/blob/c965e65dfdc60bd26a9377ade3f8132f48467dee/src/content/docs/api/Getting-Started.mdx)
discusses commercial API tools, restricts reader-owned information, warns about image rights and
prohibits training publicly available or commercial language models. It disclaims proprietary
rights but does not settle this application's durable field retention, redistribution or
third-party inference scope. Its linked [policies page](https://hardcover.app/pages/policies)
returned navigation without policy text. The repository's MIT license concerns its software and
documentation, not a blanket license to API records. These findings support a conditional transient
review entry; they do not promote the source. Training restrictions and inference-input permission
are separate questions; Luna input remains unqualified. Bibliography is kept separate from
reader libraries, ratings, reviews, journals and other reader-owned information.

The [PRH registration page](https://developer.penguinrandomhouse.com/member/register) still identifies
portal-management terms; it does not establish API metadata retention/export/model-input scope.
The [Open Library licensing statement](https://openlibrary.org/developers/licensing) still disclaims
new database rights while acknowledging potential prior contribution rights. Its linked Internet
Archive terms returned a JavaScript requirement without readable terms. No new permission follows
from unavailable text. PRH and Open Library operation findings are unchanged.

The code-owned manifest advances to `intake-source-use-2026-10-18-v2`, references this addendum and
retains its original local review window through November 16 UTC. That window is an engineering
freshness policy, not a contractual expiration. Hardcover transient review changes from unverified
to conditional; lookup remains conditional. Durable facts, export and model input remain
unverified for all three sources. All adapters retain `review_only` usage and unknown claim-level
upstream lineage.

## Implemented handoff preview

`buildIntakeReview` now consumes `buildIntakeHandoffReview` using the same validated resolver
snapshot. The loopback, five-minute, script-free viewer renders the result in ordinary language,
with expandable evidence/use details. Current values receive a preserve disposition even when
source observations disagree. A missing field observation is distinguished from a successful empty
source, provider failure, reached cap or identity hold; original source outcomes remain visible.
A gap with evidence receives a review disposition. No proposed values or write payload are added
to the handoff preview.

Each claim retains its observation/claim references, resolver hold reasons and separate use
checklists. `reviewIntakeSourceUse` always obtains findings from the code-owned manifest, so a
packet's `usage: eligible`, source-kind or lineage assertion cannot supply permission. Reported
lineage remains reported, never independently verified. The preview lists only the operations
needed for its intended use:

| Intended use        | Required operation reviews              |
| ------------------- | --------------------------------------- |
| Catalog correction  | Lookup, transient review, durable facts |
| Deliberate export   | Lookup, transient review, export        |
| Luna evidence input | Lookup, transient review, model input   |

Export or model-input uncertainty does not become a prerequisite for an unrelated catalog
correction. Response caching guidance cannot authorize durable facts. Every current checklist
retains the review-only and field-rights qualification holds. Stale/invalid/unknown-source review
states remain explicit. These are review requirements, not a generalized legal ruling or an
execution permission API.

The preview records the target fingerprint and explicitly requires a fresh check before preparing
any saved-edition review. It does not claim to have checked the live catalog. The existing
administrator editor still requires independent inspection of an original first-party edition
listing, permitted-retention confirmation, literal credits, explicit selection and the server's
authority, current-fingerprint and exact-ISBN checks. No adapter packet is automatically converted
into that manual document; provider IDs and role codes remain transient. Unsupported roles,
edition conflicts and ambiguous names stay under review. Existing values, personal contributors,
copy inventory and reading history remain protected by the unchanged writer boundary.

The handoff view remains in memory. Durable comparison diagnostics do not include its per-claim
identifiers or provider facts. Earlier comparison frames remain consumed; no matching/admission
rules changed and no new book-source comparison or population-accuracy claim is made in this stage.
A future intake cutover still needs qualified operations, a genuinely new frozen comparison and
explicit review of the actual save path.

## Verification and remaining work

The 91 focused qualification, handoff, review, server and shadow tests pass. Independent read-only
implementation review at `537455f9f0ce20ce1b36620f58a908c02064e83d` found no blocking issues.
Typechecking, lint, build and formatting pass. The full suite passes under CI's Node 22 runtime:
3,523 core tests, 1,376 web tests, two workflow tests and the source-trial/root checks. The first
full run used Node 26 during high host load and retained four unrelated five-second web-test
timeouts; all 25 tests in those four files passed in a diagnostic Node 22 run before the full
Node 22 verification. This does not establish a single cause for those earlier timeouts.

A synthetic operator-view browser inspection confirmed expandable evidence/use details at 320 px,
no horizontal overflow, no write controls and no local storage. Its screenshot and snapshots remain
local; this is operator-view behavior, not provider accuracy or production acceptance.

The first full-browser setup failed before Playwright launched: the operator edited its temporary
shell runner after its process had started, causing a command-read error. Recovery restored the
original archive, and all 102 public/authentication tables matched. The failure receipt remains
retained. A separate runner was prepared before launch and remained unchanged (verified script hashes).
Its one full fresh-database browser run completed with **438 passed, 11 existing conditional skips,
zero failures** in 46.3 minutes, at the default one worker and zero retries. The eleven skips retain
the existing desktop/mobile conditions and documented mobile back-navigation skip; none was added.

The original development snapshot was restored transactionally with project writers stopped and
restarted afterward. Sorted contents and column lists matched across all 102 public/authentication
tables, with 290 books, zero reads and one user; migration version returned to `20261108010000`.
Authentication and REST checks returned 200 and the missing-table negative control returned the
expected 404. The lifecycle exited successfully and released the stack lock. Both the failed setup
and successful run retain private backups and receipts under
`/Users/gregchism/.codex/private/intake-handoff-2026-10-18/`. No application, adapter, matching or
database code changed after the verified `537455f9` implementation revision.
Remote CI remains unverified because the required connector requests GitHub account connection.

Next, qualify only the bibliographic field classes and intended uses needed for the smallest
reviewed catalog correction. Attach applicable public terms or a specific permission record with
its conditions and revision. Independently establish any claimed upstream corroboration. Continue
manual first-party review within its existing authority and retention controls; the model cannot
resolve source rights or certify its own facts. PRH API-specific use scope and unsupported credits
remain held. A broader provider acquisition or automatic intake cutover is not authorized by
this preview.

This stage made zero Luna requests and consumed $0 of the existing $50 total budget. The ledger
still records $20.73931475 conservative burden, $29.26068525 remaining, zero reservations and zero
unsettled requests; pricing remains unconfigured and paid execution remains blocked. It is a
workflow ledger, not an account-wide invoice audit. No spend limit or uncertain reservation was reset.
