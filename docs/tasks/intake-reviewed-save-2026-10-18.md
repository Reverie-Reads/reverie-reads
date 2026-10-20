# Reviewed edition-credit save — October 18, 2026

This stage makes the existing manual administrator handoff accountable for its source-use basis.
It does not switch Add, scanning or imports, qualify an API provider, fetch book data, or modify
personal bibliography, copy inventory or reading history. Non-LLM inspection remains first.

## Source-use qualification

The [preceding findings](intake-source-handoff-2026-10-18.md) remain applicable. PRH's
[registration page](https://developer.penguinrandomhouse.com/member/register) identifies Boomi
portal terms, without establishing bibliographic storage scope. Its
[legacy web-services site](https://www.penguinrandomhouse.biz/webservices/rest/) links to
[January 2003 site terms](https://www.penguinrandomhouse.biz/about/terms), which restrict copying
and provide bounded exceptions. They expressly scope themselves to that site. Their applicability
to Enhanced API v2 is unverified; they do not settle its retention, export or model-input conditions.
The [digital-audio reseller terms](https://www.penguinrandomhouse.biz/booksellers/pdfs/Retail/2020%20Digital%20Audio%20Full%20Line%20Reseller%20TOS.pdf)
describe a particular reseller relationship, not permission granted to this app.

Hardcover's [pinned official API guide](https://github.com/hardcoverapp/hardcover-docs/blob/c965e65dfdc60bd26a9377ade3f8132f48467dee/src/content/docs/api/Getting-Started.mdx)
supports conditional API use, with reader-owned data and image restrictions and a model-training
prohibition. It does not independently establish this app's durable field retention, redistribution
or third-party inference scope. [Open Library's licensing statement](https://openlibrary.org/developers/licensing)
disclaims new proprietary rights while preserving possible contribution-rights issues. Neither an
unavailable policy nor a factual field automatically establishes the intended use. This is a
bounded qualification finding, not a determination that every source requires a private agreement.
Applicable public terms can support a reviewed use.

No operation status changes in the code-owned manifest. All three adapters remain `review_only`,
with unknown upstream independence; unsupported facts and ambiguous identities retain their holds.
No book-provider calls or new comparison were made. Earlier frozen frames remain consumed. A future
intake cutover still requires qualified operations, a new frozen comparison and reviewed writer
acceptance. The manual receipt below cannot override those requirements.

## Implemented handoff

Before a new manual edition-credit review can retain bibliography, its administrator must inspect
the first-party edition source and record either applicable public terms or specific written
permission. The new receipt contains only a basis, HTTPS reference, explanation, inspection time,
explicit confirmation and fixed edition-identity/credit-facts scope. References reject credentials,
query parameters, whitespace and backslashes. The form advises against recording private reader
data, credentials or agreement text. Missing or invalid attestations leave the draft browser-only.

The receipt and existing v1 evidence freeze atomically in the new reviewed-prepare RPC. The old
prepare function loses API execution privileges. Receipt storage has RLS and no direct API access;
only administrator review readback exposes its reference and explanation. It is separate from
published edition credits. It is a human attestation, not verification of the cited terms or a
legal/source approval. It covers neither prose/images nor export/model input.

Prepare and new application reject future or more-than-720-hour-old inspection times. That is a
local engineering freshness rule, not a contractual expiration. Bibliography, identity, role,
scope, selection and fingerprint checks remain independent. Changed input clears confirmations.
Unknown roles, work-only evidence, duplicate credits, ambiguous names and edition conflicts remain
held; literal labels, parts, order and unsupported/unselected evidence remain available for review.
Transient provider person IDs and role codes are rejected by the manual document contract rather
than silently removed or treated as catalog identifiers.

Exact retries keep their original immutable receipt, draft and selection. Applied retries return
without writes even after the receipt expires or later catalog changes. An uncertain save can
retry only its original selection; the server distinguishes an already-applied request from a stale
pending review. Changed drafts or receipts conflict. Legacy pending reviews without a receipt
require a new review; existing accepted credits and identical applied retries are preserved.
Reopened administrator history displays current, missing and stale source-use records explicitly.

## Verification

The full Node 22 suite passes: 3,556 core tests, 1,394 web tests, two workflow tests, 498 source-trial
tests and the root checks. Typechecking, lint, build and formatting pass. The focused source-use and
manual-credit checks cover 58 core and 23 web tests. Independent read-only review found no blockers
in the application, SQL or shared-evidence registry changes.

All 71 SQL files and 2,389 checks pass on a fresh local public-schema database. Coverage includes
authority/direct-access checks, malformed references and private/provider payloads, immutable
receipt retries, transaction-local zero-mutation auditing, legacy and stale holds, literal accepted
credits and protected personal-row snapshots. The source-use receipt is registered as collective
review evidence, excluded from personal export/restore. The household reconciliation rollback
snapshot follows its parent review's attribution rather than treating a review UUID as a user UUID.

Earlier gate failures remain retained: the old PRH parsing test assumed transient provider codes
could enter the manual contract, the new table needed registry/rollback-order declarations, and a
coercion test needed an explicit return type. The first SQL attempt stopped on a fixture timestamp
expression and an outdated conflict-code inventory. Those checks were corrected before the fresh
full browser run; the original development snapshot was restored after that attempt.

The one full browser run used the default one worker and zero retries at application revision
`ee2bae9`: **436 passed, 11 existing skips, two failures**, in 42.3 minutes. Both failures were in
the new history assertion: after a successful lost-response save and personal/history comparisons,
the test waited for history without pressing the existing “Check saved reviews” button. Desktop and
phone traces identify the same missing action. Those failures and their original traces remain
retained; this is not a green full-suite result.

Revision `38b69b1` adds only that missing browser-test action. No application or database code changed.
A separate fresh-database, one-worker, zero-retry run of the two affected scenarios on desktop and
Chromium phone simulation completed with **four passed** in 29.3 seconds. It confirms that unresolved
source use prepares no stored review, unknown roles stay unselectable, a lost response retries the
original selection without duplicate credits, the frozen reference survives reopening, future
evidence stays held, and personal values/history remain unchanged. Screenshots were inspected on
desktop and phone; these are synthetic local checks, not physical-device or production acceptance.
The complete suite was not rerun to replace the retained failed result.

Full-run recovery initially hit an existing Realtime publication. Its transaction rolled back,
and the queued follow-up refused the unexpected baseline before resetting anything. A separate,
locked recovery explicitly handled both project publications and restored the original archive.
The final focused lifecycle used that corrected recovery step. All **102 public/authentication
table contents and column lists** match the pre-test archive, with **290 books, zero reads and one
user**; all **eight publication definition/ownership/membership statements** match as well. Migration
history returned to `20261108010000`. Authentication and REST returned 200, and the missing-table
negative control returned the expected 404. Both recovery verification and the final lifecycle
exited successfully. The shared lock was preserved throughout; runner hashes remained unchanged
while running.

Local Supabase advisors reported seven warnings on existing public objects and none on the new
receipt/functions. All seven match findings in the restored baseline after normalizing role-list
ordering. The baseline has one additional private-overlay policy warning; that table is absent
from the fresh public test schema. There are no added advisor findings, but this does not clear
those existing warnings or qualify private integration. No production migration or live acceptance
is claimed. Migration `20261110010000_reviewed_edition_credit_source_use.sql` remains owner-run after
review. Remote CI remains unverified because the required checks connector requests GitHub account
connection.

Private logs, original archives, failure traces and recovery receipts remain under
`/Users/gregchism/.codex/private/intake-save-2026-10-18/`. Incidental documentation examples are recorded
there as future comparison exclusions. No live metadata comparison or catalog enrichment was run.
The new work is in [draft PR #647](https://github.com/Reverie-Reads/reverie-reads/pull/647), stacked on
the still-open #646, not on a confirmed merged parent.

This stage made zero Luna calls and spent $0. The durable ledger still records a $50 total ceiling,
$20.739314750 conservative burden, $29.260685250 remaining, zero reservations and zero unsettled
requests. Pricing remains unconfigured; this is a workflow ledger, not an account-wide invoice audit.
No source or model is promoted by this manual-save implementation. Qualify the particular source
operations and use a genuinely new frozen comparison before any later intake cutover; Add, scanning
and imports remain unchanged here.
