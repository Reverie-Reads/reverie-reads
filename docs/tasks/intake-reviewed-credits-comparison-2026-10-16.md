# Reviewed edition credits comparison — October 16

## Frozen protocol

This purposive comparison uses eight previously unseen editions across four works, four controls
that substitute a secondary credited person for the creator, and two repeated manual-review controls
(work-only credit scope and unverified source attribution). The eight editions have 25 selected
reference credits with supported normalized roles and 11 literal labels whose normalized roles
remain unknown. Reference rosters are partial. The two repeated controls are not independent editions.

Exact-ISBN publisher listings were inspected before acquisition. Their literal title/creator spelling,
credit labels, format and page count are privately transcribed. The primary references are Penguin
Random House's higher-education edition listings for ISBNs 9780141439518, 9780141040349,
9780141441146, 9780141040387, 9780140449266, 9780141392462, 9781400079988 and 9780241265543.
Each is linked by `https://penguinrandomhousehighereducation.com/book/?isbn=<ISBN>` in the private
frame. No descriptive prose, provider payloads or personal records enter the public fixture set.

The provider arm performs the existing bounded, exact-ISBN Open Library/Hardcover queries with
no automatic retries, LLM or production access. Publisher reference answers never reach acquisition
or resolver inputs. Score the eight distinct editions separately from repeated controls: identity
candidates, page/format agreement and selected-credit role/scope agreement. Unknown source lineage
and existing review-only qualification still prohibit automatic proposals and writes.

The separate manual-source arm receives manually inspected publisher evidence and the requested
catalog identity. It tests the conservative eligibility policy, not source discovery/extraction or
an independent human audit. Unsupported labels remain unknown; notes, afterwords and cover artwork
are not silently converted into another role. Wrong creator, work-only scope and unverified-source
controls must yield no eligible credits. This offline arm does not execute database saves; synthetic
SQL/browser integration tests independently cover authorization, frozen selection, idempotent retry
and personal-data preservation.

The private exclusion manifest includes 62 prior target/reference entries from known intake problems
and both consumed shadow frames. The runner additionally excludes synthetic fixtures. Frame and
complete resolver/review/writer source hashes are frozen before a single provider attempt. Permanent
attempt markers remain intact. Any subsequent matching/policy changes require another new frame.
This is agent-reviewed, narrow evidence; it cannot authorize Add, scan or import cutover.

## Outcome

The single sealed acquisition ran against commit `279d076`: 22 Open Library requests (eight
redirects and fourteen JSON responses) and eight Hardcover requests. All HTTP requests completed
successfully. Open Library's adapter rejected five edition identity payloads as malformed and one
for duplicate credits; those six editions are unobserved, not successful empty responses or safe
identity rejections. The original frame/lock/report remain private and the attempt is consumed.

| Eight distinct editions                  | Open Library | Hardcover |
| ---------------------------------------- | -----------: | --------: |
| Reference-agreeing identity candidates   |          2/8 |       8/8 |
| Unobserved after adapter rejection       |          6/8 |       0/8 |
| Page/format agreements, out of 16        |            0 |         8 |
| Page/format disagreements                |            2 |         8 |
| Missing or identity-withheld fields      |           14 |         0 |
| Wrong-creator controls held, out of four |            2 |         4 |
| Wrong-creator controls unobserved        |            2 |         0 |
| Misleading identity candidates           |            0 |         0 |

All observed disagreements are page counts. Hardcover's eight format observations agree. These
scores compare current publisher listings, not a universal judgment that every provider value is
wrong; page-count conflicts remain under review. Provider values were transient and were not
reacquired to explain away a disappointing score. Open Library's two admitted edition records lack
format observations. One also carries unparsed credit statements, which are not guessed into roles.

| Twenty-five selected reference credits     | Open Library | Hardcover |
| ------------------------------------------ | -----------: | --------: |
| Name/role/scope observed on edition        |            2 |         0 |
| Name/role agrees, only work basis observed |            0 |        10 |
| Same name, conflicting role or part scope  |            0 |         2 |
| Missing from admitted identity record      |            4 |        13 |
| Identity withheld                          |           19 |         0 |

The two Open Library edition agreements are authors. No automatic source-qualified resolutions,
metadata proposals or writes occurred. Including the two repeated manual controls gives ten positive
probes: Open Library matches 2/10, Hardcover 10/10. These are still only eight distinct editions.
The report preserves all case-level scores and holds without names, ISBNs or provider field values.

### Separate manually inspected source arm

The conservative manual-source policy admits **25/25 selected supported credits** across the eight
editions and holds **11/11 unsupported normalized-role labels** while preserving their literal labels.
All four wrong-creator controls admit zero credits. Both the work-only-scope and unverified-source
controls admit zero credits. No reference answers are used to decide eligibility.

This is not an automatic 100% credit-retrieval result: the agent manually inspected and transcribed
publisher facts, and the supported reference subset uses those same inspected listings. It demonstrates
policy behavior on new evidence, not independent extraction accuracy, complete rosters or authority
to apply these facts to production. The database/browser save path is verified separately using
synthetic fixtures. All production records and personal data remain unchanged.

### Verification and rollout boundary

The corrected database-wide run passed all 2,260 assertions across 70 files, including 56 new
edition-credit checks. The first run exposed a stale conflict-code inventory (29/41 versus the new
31/45 function/path counts); the inventory was corrected and that failure remains retained.
The initial web suite exposed the missing shared-review backup classification; its registration and
reconciliation ordering were corrected. The final web suite passed 1,346 tests plus two Workflow
tests. The final core suite passed 3,366 tests; the source-trial suite passed 498. Typecheck, lint and
build passed. Local build output contains the expected local demo endpoint and is not a deployment.

The new desktop/mobile browser journey passed both cases, with accessibility checks and inspected
synthetic screenshots. It executes real local prepare/apply endpoints, loses the first successful save
response, retries the exact confirmation, and confirms one stored credit plus unchanged personal
book/history. The complete fresh-database browser suite is in progress (447 scheduled tests, one
worker, retries zero); its result will be recorded before completion. Earlier failures are retained.

Keep Add, scanning and imports on their current paths. This branch adds a manual shared-edition
handoff only. Neither provider earns automatic edition-credit authority from this comparison.
Next work is bounded diagnosis of malformed/duplicate provider records, explicit representation of
currently unknown credit roles, ISBN-less evidence, and source-qualified review before a separate
intake integration. Any policy tuning needs another new frozen frame. Production migration remains
owner-run and has not been applied.
