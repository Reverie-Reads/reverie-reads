# Selfies 2025 children's authority-development frame

Date: 2026-09-06

## Outcome

Added the complete six-title children's shortlist from the 2025 Selfies Book Awards as a recent
independent-publication sampling frame. Selection was fixed by the official shortlist before
classification and did not depend on provider coverage, scout output, or whether first-party
evidence was easy to find.

- 6 selected cases
- 6 authority-reviewed cases
- 6 positive series cases
- 0 unresolved candidates
- 6 fresh scout calls and 0 retrieval calls

This frame moves the development set from 329 selected / 203 reviewed to 335 selected / 209
reviewed. The recent independent or Kindle-first stratum moves from 49 to 55 reviewed cases, so the
audit now reports `ready for gate evaluation`. Every development review and sampling-stratum
minimum is met. The untouched production-qualification partition remains at 0 of 1,000 cases.

## Selection boundary

Selection source:

- https://theselfies.co.uk/uncategorised/2025-shortlists-announced/

The official page defines a complete six-work children's shortlist and describes the Selfies as a
self-publishing award. It appears only as selection provenance, never as gold truth evidence. The
shortlist's `Karin Inglis` byline is corrected to the author's canonical `Karen Inglis` name using
her first-party site.

## Reviewed truth

| Work | Classification | Authority evidence |
| --- | --- | --- |
| The Wonder Girls Rebel | The Wonder Girls #3 | J.M. Carr's exact-title post names the Wonder Girls trilogy and links the exact work as book three |
| Body in the Thames | Westminster Mysteries #2 | Sarah Lustig's catalog names the trilogy and exact second work; the product page confirms the sequel relation |
| Fyn Carter and the Agents of Eromlos | Fyn Carter #1 | Ian Hunter's exact-work post calls it Fyn 1 and the next work Fyn Carter 2 |
| The Witch's Cat Goes Wild | The Witch's Cat, order withheld | The author catalog establishes the original work and Sourcebooks' exact later-edition page supplies the series relationship |
| Beyond the Secret Lake | The Secret Lake #3 | Karen Inglis's exact-title page directly calls it book three of the series |
| Time Tub Travellers and the Silk Thief | Time Tub Travellers #1 | Claire Linney's store labels the exact work book one beside books two and three and a series bundle |

The later Sourcebooks edition of *The Witch's Cat Goes Wild* is numbered one even though the
author's self-published catalog contains earlier Witch's Cat works. That publisher number is not
promoted into work-level publication order; gold keeps only the direct membership.

## Truth-blind scout replay

The unchanged v7 scout received only each title, author, and publication year. The fresh run
returned six schema-valid, policy-safe, grounded series proposals and resolved every case. It used:

- 6 model calls
- 14 web-search calls
- 85,698 input tokens
- 3,946 output tokens
- 0 errors
- 0 structural repairs

The first score was 83.3% because the scout proposed `Secret Lake series` while gold initially
contained only `The Secret Lake` and the longer `Secret Lake mystery adventure series` alias. The
author's own pages use the shorter proposed form, so human review added it as an authority-supported
alias. A cached rescore then reached 100% resolved accuracy, membership precision, and membership
recall with zero additional model calls or tokens.

This was a truth-label normalization correction, not permission for model output to rewrite gold.
The same-source wording had to be verified independently, and the original score remains recorded
in the ignored raw report.

## Optimization implication

Complete independently published children's frames can provide both sampling integrity and clear
first-party series evidence. The scout found all six relationships without a broader prompt or the
navigation-retrieval path, while deterministic scoring exposed a harmless name-normalization gap
instead of silently counting it as correct.

The development set is now suitable for provider and resolver gate evaluation. It is not a
production qualification result: the locked 1,000-case partition, 600/400 standalone-positive mix,
299 emitted-membership denominator, and configured confidence bounds remain outstanding.

## Boundary

This batch changes trial gold, the fixed sample plan, regression tests, and documentation only. It
does not write Supabase, alter the Reverie corpus, change a production prompt, deploy a function,
or let the scout write authority truth.
