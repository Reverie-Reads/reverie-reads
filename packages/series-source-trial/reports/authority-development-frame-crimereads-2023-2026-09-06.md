# CrimeReads November 2023 authority-development frame

Date: 2026-09-06

## Outcome

Added the complete ten-title featured release list from CrimeReads' November 6, 2023 article as an
independent, traditionally published sampling frame. Selection was fixed before classification and
did not depend on provider search results, series labels, or whether authority evidence was easy to
find. The unannotated extended release index after the ten featured entries is outside the frame.

- 10 selected cases
- 5 authority-reviewed cases
- 4 positive series cases
- 1 affirmative standalone case
- 5 unresolved candidates
- 0 model calls and $0 incremental model cost

The frame moves the development sample from 263 selected / 164 reviewed to 273 selected / 169
reviewed. The remaining reviewed-case gap is 31 and the true-standalone hard-gate gap is 22.

## Selection boundary

Selection source:

- https://crimereads.com/10-new-books-coming-out-this-week-november-6-2023/

The CrimeReads URL appears only in `sampleSources`. It does not appear in any reviewed truth's
`sources`, so the industry-press list can select and identify the frame without becoming series or
standalone evidence. The list's Sara James and Paul Garuana Galizia bylines were normalized to the
first-party names Sarah James and Paul Caruana Galizia.

## Reviewed truth

| Work | Classification | Authority evidence |
| --- | --- | --- |
| Barbacoa, Bomba, and Betrayal | A Caribbean Kitchen Mystery #3 | Penguin Random House exact-work page and publisher series roster |
| Blood Betrayal | Blackwater Falls #2 | Macmillan exact-work relation plus the author's Inaya Rahman roster |
| Resurrection Walk | A Lincoln Lawyer Novel #7 | Hachette series roster plus Michael Connelly's exact seventh-book statement |
| Kennedy 35 | Box 88 #3 | Official publisher-distributor page labels the exact work Book #3 of Box 88 |
| Sweet Thing | standalone | Exact Hachette page affirmatively calls the work a standalone |

`Resurrection Walk` illustrates a false-positive guard for connected characters: the publisher and
author establish its Lincoln Lawyer membership, while Harry Bosch's appearance in the novel is not
converted into a second series membership.

## Unresolved cases

The Manor House, The Cliff House, The Twelve Days of Murder, Last Night at the Hollywood Canteen,
and A Death in Malta remain candidates. Their reviewed first-party pages establish work identity,
but none affirmatively establishes a bibliographic series relationship or standalone status.

This preserves several important negative rules:

- an alternate-market title is not a series relationship;
- a generic `A Novel` subtitle is not standalone evidence;
- an author's second novel is not series position two;
- mentions of the author's other series do not classify the exact work;
- a nonfiction subject or family connection is not a bibliographic series.

## Optimization implication

Complete release frames are efficient for broad, non-romance-biased coverage, but exact publisher
and author pages still determine usable truth. This batch achieved five reviewed cases through
deterministic human evidence review at no token cost. The five ambiguous cases should not receive
more model spend until a new authority surface, reviewed retrieval origin, or direct publisher or
author statement becomes available.
