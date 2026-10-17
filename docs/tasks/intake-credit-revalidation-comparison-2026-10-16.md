# Edition-credit revalidation comparison — October 16

## Frozen protocol

This final comparison follows the additional safeguard for later catalog identity corrections.
Historical accepted credits now retain their complete evidence but require renewed review after
work title/creator or edition identity changes. Source matching itself is unchanged. The earlier
consumed frame remains separate evidence; it is not rerun or presented as unseen.

The new purposive frame has eight editions of four previously untested works: The Picture of Dorian
Gray, Great Expectations, Dracula and Moby-Dick. Each primary publisher title heading and edition
byline was inspected before any provider query. Moby-Dick's separate subtitle is not silently merged
into its primary heading. A preliminary Dracula ISBN returned a publisher 404; the publisher's
linked hardcover edition was chosen before freezing. That selection used no provider outputs.

| Inspected publisher listing                                                                                         | Format    | Pages |
| ------------------------------------------------------------------------------------------------------------------- | --------- | ----: |
| [The Picture of Dorian Gray, 9780141439570](https://penguinrandomhousehighereducation.com/book/?isbn=9780141439570) | Paperback |   304 |
| [The Picture of Dorian Gray, 9780141442464](https://penguinrandomhousehighereducation.com/book/?isbn=9780141442464) | Hardcover |   304 |
| [Great Expectations, 9780141439563](https://penguinrandomhousehighereducation.com/book/?isbn=9780141439563)         | Paperback |   544 |
| [Great Expectations, 9780141040363](https://penguinrandomhousehighereducation.com/book/?isbn=9780141040363)         | Hardcover |   544 |
| [Dracula, 9780141439846](https://penguinrandomhousehighereducation.com/book/?isbn=9780141439846)                    | Paperback |   560 |
| [Dracula, 9780141196886](https://penguinrandomhousehighereducation.com/book/?isbn=9780141196886)                    | Hardcover |   512 |
| [Moby-Dick, 9780142437247](https://penguinrandomhousehighereducation.com/book/?isbn=9780142437247)                  | Paperback |   720 |
| [Moby-Dick, 9780141199603](https://penguinrandomhousehighereducation.com/book/?isbn=9780141199603)                  | Hardcover |   720 |

Twenty supported reference credits and fifteen literal labels without a supported normalized role
form partial reference rosters. The manual-source arm validates manually transcribed source evidence,
not automatic extraction or independent human review. Four secondary-credit-as-creator controls and
two repeated work-scope/unverified-source controls must admit no manual credits. The two repeated
controls are not distinct editions. Post-save invalidation is separately tested against the database
and browser; this source comparison does not claim to exercise persistence.

The exclusion manifest now contains 90 prior target/reference entries; the runner also excludes
synthetic cases. Code, frame and exclusion hashes are frozen before one acquisition attempt. Open
Library and Hardcover use only the existing bounded exact-ISBN adapters. Reference answers never
reach acquisition/resolution. Retain all failures, role/scope conflicts and page-count disagreements.
No LLM, ISBNdb, production database access, automatic proposals or intake cutover are authorized by
this comparison. Any later policy change needs another unseen frame.

## Outcome

The single acquisition ran against frozen commit `5068aea`: 27 Open Library requests (eight
redirects and nineteen JSON responses) and eight Hardcover requests, all successful at the HTTP
layer. The permanent attempt is consumed. No LLM/ISBNdb calls, production access, source-qualified
resolutions, automatic metadata proposals or writes occurred.

| Eight distinct editions                         | Open Library | Hardcover |
| ----------------------------------------------- | -----------: | --------: |
| Reference-agreeing identity candidates          |          4/8 |       6/8 |
| Identity held with an observation               |          2/8 |       0/8 |
| Unobserved                                      |          2/8 |       2/8 |
| Page/format agreements, out of 16 opportunities |            4 |         8 |
| Page/format disagreements                       |            2 |         4 |
| Missing or identity-withheld fields             |           10 |         4 |
| Wrong-creator controls held, out of four        |            3 |         3 |
| Wrong-creator controls unobserved               |            1 |         0 |
| Misleading wrong-creator identity candidates    |            0 |         1 |

Open Library has one malformed edition identity and one duplicate-credit rejection. Hardcover has
one successful empty query and one edition/parent-title conflict; these are distinct outcomes. All
observed page/format disagreements are page counts and remain under review. The Hardcover misleading
candidate substitutes the publisher-listed editor for the creator. This is a contributor-attribution
failure on a controlled query, not a finding that a different book was returned. Source-use holds
prevent promotion, and the manual-source policy rejects the same wrong creator.

| Twenty selected reference credits          | Open Library | Hardcover |
| ------------------------------------------ | -----------: | --------: |
| Name/role/scope observed on edition        |            4 |         0 |
| Name/role agrees, only work basis observed |            0 |         7 |
| Same name, conflicting role or part scope  |            1 |         5 |
| Missing from admitted identity record      |            4 |         3 |
| Identity withheld                          |           11 |         5 |

All four Open Library edition-observed agreements are authors. This subset does not establish complete
rosters or certify extra provider credits. The repeated scope/source controls produce ten positive
probes overall: 6/10 Open Library and 8/10 Hardcover identity candidates. The edition denominator
remains eight. Reports preserve only codes/counts/scores, not provider field values.

The separate manually inspected source arm admits **20/20 supported credits**, holds **15/15 labels
without a supported normalized role**, and admits **zero credits on all six controls**. The agent
transcribed those publisher facts; this is policy validation, not automatic retrieval accuracy or
independent human verification. Unsupported role labels remain lossless evidence in review.

### Verification

The final database-wide run passed 2,271 assertions across 70 files, including 67 edition-credit
checks. New cases prove historical evidence survives later edition/work identity corrections,
returning old identity values never revives qualification, fresh reviewed support can append, and
page-count-only edits do not withdraw contributor qualification. The desktop/mobile browser journey
passed both cases with real local RPCs, lost-response retry, later edition correction, accessibility
checks and unchanged personal book/history. The final full browser run is in progress with a fresh
database, 447 scheduled tests, one worker and zero retries.

The full unit gate passed 3,366 core tests, 1,346 web tests, 498 source-trial tests and two Workflow
tests. The later safeguard additionally passed the 47 relevant core tests, typecheck, lint and build.
Initial integration failures and the interrupted pre-safeguard browser run remain retained; neither
is represented as a completed passing gate. Remote CI could not be inspected because the required
connector requests GitHub account connection.

### Decision

Keep the new manual administrator handoff separate from Add, scanning and imports. Exact ISBN alone
still cannot establish primary authorship, and provider role/part/page conflicts remain review-only.
Neither source earns automatic edition-credit authority. The migration is undeployed and owner-run;
production and personal data remain unchanged. Next qualification should cover malformed/duplicate
provider records, currently unknown roles and ISBN-less evidence on another new frame.
