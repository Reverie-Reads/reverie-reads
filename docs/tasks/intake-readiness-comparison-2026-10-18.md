# Intake review latency, contributor labels and fresh comparison — October 18, 2026

Implementation `58ab628` removes a no-write duplicate-review delay and extends the review-only
publisher adapter with two narrowly qualified role-label variants. Add, scanning and imports still
use their existing matching and persistence paths. The new evidence resolver has not been activated.
No production database was accessed or changed and no Luna request was made.

## Duplicate review and test reliability

`useIntake` previously awaited library and reading-history invalidation after computing a duplicate
review, even though that result writes nothing. Add already refreshes its library before matching.
Only the `review` outcome now returns before that second refresh. Authentication/account checks,
matching, duplicate choices and refreshes after actual adds or merges remain unchanged.

The regression first failed on the old behavior. Four new cases exercise a deliberately unresolved
refresh: duplicate review returns without writes and preserves cached personal history, real adds
and merges still await both refreshes, and an account change still rejects the operation. The three
focused intake suites passed 11 tests.

The edition-credit browser fixture also used an unbounded synchronous database-clock query, which
could block the worker's own timeout handling. It now awaits asynchronous execution with a ten-second
process deadline, bounded output and explicit failure. Empty, non-positive, unsafe or invalid dates
are rejected; host time is never substituted. Local administrator-key discovery retains its existing
selection but has a fifteen-second process deadline. Eighteen helper tests cover these boundaries.
These changes expose infrastructure failures; they do not establish why the previous host stalled.

## Publisher label evidence

The finite E/Edited by and T/Translated by pairs preserve editor and translator roles. The existing
A/Written by pair is unchanged. Codes and literal labels remain in transient evidence. Contradictory
codes/labels, unknown roles, duplicate credits and unsupported identities stay under review; editors
and translators never become authors through these aliases.

The [qualification note](intake-prh-contributor-labels-2026-10-18.md) links official code definitions
and publisher display vocabulary and identifies their combination as a narrow semantic inference,
not an API-string guarantee. Synthetic adapter regressions passed 104 tests.

## New frozen comparison

An independent reviewer selected four unseen editions before acquisition, with four creator-positive
cases and four paired noncreator controls, 13 selected edition credits and eight page/format facts.
The parent independently opened every exact-ISBN publisher page. The exclusion manifest contains
222 prior or research-exposed target variants, including all consumed earlier frames. There was no
normalized identity or ISBN overlap. Uncertain introduction and series-editor credits were excluded
before acquisition; published initials were preserved without expansion.

| Source               | Positive identities / 4 | Noncreator controls held / 4 | Negative controls unobserved | Selected edition credits / 13 | Facts agree / disagree / missing, of 8 |
| -------------------- | ----------------------: | ---------------------------: | ---------------------------: | ----------------------------: | -------------------------------------- |
| Penguin Random House |                       4 |                            4 |                            0 |                            13 | 8 / 0 / 0                              |
| Hardcover            |                       3 |                            3 |                            1 |                             0 | 1 / 3 / 4                              |
| Open Library         |                       2 |                            2 |                            2 |                             2 | 2 / 1 / 5                              |

All sources had zero false identity matches. The resolver produced zero resolved works/editions,
zero proposed fields, zero writes and zero model calls: `cutoverReady=false`. An unobserved negative
is not a successful rejection. Hardcover observed three selected credits only at work scope, with
seven missing and three behind identity holds. Open Library had two role/part conflicts, two missing
credits and seven behind identity holds.

PRH is the most useful edition source in this bounded sample; its thirteen observed selected credits
do not certify a complete roster. Its positive observations also retain five unknown-role credits
outside the scored subset, a conflicting-role diagnostic, and count/format qualifications. All four
retain partial/unverified-roster warnings. Publisher website and API share lineage. Four deliberately selected
works are not a population estimate, independent corroboration or a before/after accuracy measurement.
The old consumed comparison and all of its failures remain intact.

## Retained gates and reproducibility

Source-use permission for storage, export and model input, upstream lineage, and complete contributor
coverage remain unqualified. Existing title/edition conflicts, unsupported roles and ambiguous names
are not waived by higher observed coverage. The source manifest remains `review_only`.

- Frame SHA-256: `8b552a75de05fb3ab5852e04391bcef977d6795e4bfc717f20aef736103fd7f5`.
- Acquisition-system SHA-256: `3867d24cc4ffe29e170928b2c209c166e403990267950bb9bb5514e7512452c9`.
- Prior-exclusion SHA-256: `eefcf8ca8c911f96433cdcc7254b0f2195a81f2b99bd811757e3b9fc9e177d6d`.
- Freeze: `2026-10-19T00:35:16.512Z` (October 18 locally).
- Transport: Open Library 12 requests (four expected redirects/eight successful), Hardcover four
  successful requests, PRH eight successful requests; no access/rate stop.

Private frame, references, provenance, permanent attempt and aggregate receipts are retained under
`/Users/gregchism/.codex/private/intake-readiness-2026-10-18/` and the existing Git-common-directory
attempt journal. The receipt contains diagnostic classes and counts, not provider payloads or
contributor names/IDs/literal labels. No consumed frame was requested again.

## Verification and budget

Full unit, typecheck, lint and build checks passed. The full unit run included 3,505 core tests,
1,358 web tests and two workflow tests, plus source-trial/root checks. The eighteen new clock-helper
tests were added after unit discovery and passed separately; they are not included in the 1,358 count.
Formatting also passed. No application, adapter or database code changed after the tested implementation freeze.

The user confirmed the intended test stack moved from Docker Desktop to OrbStack. The existing
engine guard pinned that runtime inside the shared stack lock. One full browser run on a freshly
reset local database completed with **438 passed, 11 skipped, zero failures** in 44.4 minutes, using
one worker and zero retries. All thirteen previously failing checks passed, including exact re-add,
Keep both recovery, edition-credit lost-response handling, walkthroughs and catalog correction.
The earlier red receipt remains retained; this pass does not establish a single cause for every
previous failure.

All eleven skips were pre-existing conditions: six desktop cases cover mobile-only controls; three
mobile cases defer redundant theme/desktop-only coverage; one mobile back-navigation case retains
its documented timing-flake skip; and one mobile fixture has no whole-star control. No skip was
added to obtain this result. These are 438 passing checks, not 449.

The browser command passed, but its automatic database-recovery step failed during local schema
initialization. Two subsequent snapshot restore attempts rolled back atomically: one encountered
an inherited partition constraint during cleanup, and the other an existing Realtime publication.
The final restore removed the snapshot-owned schemas and database event triggers/publication before
replaying the full original archive in one transaction. Project writer services were stopped for
restoration and restarted afterward. The original and failed-state backups remain private.

Recovery verification compared sorted table contents and column lists against the pre-test archive:
**all 102 public/authentication tables matched**, with 290 books, zero reading-history rows and one
user. The migration version returned to `20261108010000`. Authentication and REST probes returned
200; the missing-table negative control returned the expected 404. The shared stack lock was then
released. Production data was never involved. The failed lifecycle exit is retained separately from
the successful browser result and subsequent verified recovery.
Remote CI remains unverified because the required connector requests GitHub account connection.

New Luna spend is $0. The durable workflow ledger retains $20.73931475 historical burden and
$29.26068525 remaining under the $50 ceiling, with zero reservations/unsettled requests. Pricing is
unconfigured, so paid execution remains blocked. This is not an account-wide invoice audit.
