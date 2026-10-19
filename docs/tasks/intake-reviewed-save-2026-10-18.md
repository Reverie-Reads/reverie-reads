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

Verification is in progress. Focused checks currently cover 58 core and 23 web tests. The SQL tests
include authority/direct-access checks, malformed references and private/provider payloads, immutable
receipt retries, transaction-local zero-write auditing, legacy and stale holds, literal accepted
credits and protected personal-row snapshots. The browser fixture checks that missing source-use
evidence prepares no persisted review, then exercises explicit selection and lost-response recovery.
The final report will record full gates, the fresh database browser run, retained failures and exact
snapshot recovery before delivery. No production migration or live acceptance is claimed.

This stage uses no Luna calls and spends $0. The existing $50 total ceiling and prior burden remain
unchanged. No source or model is promoted by this manual-save implementation.
