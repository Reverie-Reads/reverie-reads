# Historical metadata repair proposals

Second in the September 12 repair sequence. This is a bounded evidence handoff, not a data repair,
source acquisition service or permission to write production. The owner-run save/reopen check is
tracked separately in `docs/operations/book-data-save-smoke.md` (first sequence PR).

## First-pass review

The existing private snapshot contains 25 unique works; all 25 carry multiple ISBNs. A sequential
read-only check inspected their 33 recorded Open Library edition locators once. All requests returned
HTTP 200. This is transport completion, not identity certification: author reference IDs were not
resolved, some locators name different/translated works, and several omit ISBNs, authors or pages.
Two exact-ISBN publisher pages supplied priority proposals. No production/cache writes, paid API,
LLM run, qualification replay, PRH API activation or broad completion sweep occurred.

The private handoff retains per-work dispositions and short factual source notes. Public reporting
retains only aggregate scope and constraints, not private record IDs, fingerprints or catalog rows.
Its input snapshot remains unchanged. Snapshot values must be rechecked before an owner decision.

- One calendar-invalid date has a publisher-backed, edition-specific replacement proposal.
  Reference-edition selection and current full identity/fingerprint review are still required.
- The reported anthology has publisher-backed page/date proposals, but contributor-role evidence
  disagrees with its stored primary display. Its identity hold blocks a page/date repair; this
  action must not silently rewrite contributors to make the evidence match.
- The remaining 23 works are deferred for reference-edition or identity review. Agreement on a
  page count, a successful API response, or multiple ISBNs does not certify one canonical edition.

No historical correction has been approved or applied by this review. Mixed-source provenance is
a warning, not a count of incorrect dates. Partial dates stay partial; a reprint's date is not the
work's original publication date. Numeric page count and catalog pagination text are not equivalent.

## Smallest useful correction action

Extend the existing administrator metadata workspace, not the broad shared editor or a new store.
Require an explicit reference ISBN already associated with the work, full identity confirmation,
an HTTPS source and explanation, and exact before/after fields. Record reference edition and source
per corrected field; do not imply the reference describes every ISBN in a shared work.

Correct pages or the whole publication tuple independently. Selecting date-only must preserve pages;
selecting pages-only must preserve the entire date. Blank or invalid values are not a request to
clear a field. A separate explicit clear action is outside this first delivery. Reject stale work
or evidence fingerprints/review revisions, unconfirmed identity, invalid dates, conflicting ISBN
ownership, and duplicate submissions. Keep administrator notes private and retain append-only audit.
Never change identity, ISBN associations, series, covers, personal copies, household membership,
possession or reading history as a side effect. Keep unresolved identity cases deferred.

This action is manual source review, not LLM-issued qualification or automatic correction. It needs
local SQL/browser protection tests, public PR review, private sync and owner migration/deployment
before any historical apply. The first live apply must name the approved edition and fields, then
read back the shared record and verify all personal copies unchanged.

## Verification boundary

Counts were computed from the frozen private JSON (25 rows, 25 distinct IDs, 25 multi-ISBN works,
33 locators). Every locator response was inspected for title, ISBN, date, numeric pages, pagination
and any by-statement. Two publisher product pages were read directly; observations remain proposals.
This docs-only PR changes no app/runtime or schema and is exempt from the full browser gate.
The first production save receipt remains owner-pending and is not represented as passed here.
