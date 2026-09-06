# Authority development frame: 2022 Selfies adult fiction shortlist

Date: 2026-09-06

## Outcome

The complete nine-work adult fiction shortlist from the 2022 Selfies Book Awards adds four
authority-reviewed series cases and five unresolved candidates. The official shortlist release
fixes the frame before model behavior is inspected and states that the judges were selecting the
best indie-published books of 2021.

| Work | Authority result | Classification |
| --- | --- | --- |
| *So Many Ways of Loving* - Christine Webber | Candidate | Unresolved |
| *The Big Fix* - Jill Morris | Candidate | Unresolved |
| *The Menai Bridge Killings* - Simon McCleave | Reviewed series-positive | DI Ruth Hunter Crime Thrillers, book 8 |
| *White Heron* - J. J. Marsh | Candidate | Unresolved |
| *Death in the Last Reel* - Paula Harmon | Reviewed series-positive | The Margaret Demeray Series, book 2 |
| *Sealfinger* - Heide Goody and Iain Grant | Reviewed series-positive | Sam Applewhite, order unresolved |
| *Breathe* - Elena Kravchenko | Candidate | Unresolved |
| *None Stood Taller* - Peter Turnham | Reviewed series-positive | None Stood Taller, book 1 |
| *The Other Times of Caroline Tangent* - Ivan D. Wainewright | Candidate | Unresolved |

The [official 2022 shortlist release](https://theselfies.co.uk/wp-content/uploads/2022/03/Selfies-2022-shortlist-announced.pdf)
supplies all nine selected titles, their authors, and the independent-publication frame. It is
sampling evidence only and does not establish classification. The frame uses the author's
canonical plural title *The Menai Bridge Killings* rather than the release's singular label.

## Authority review

- Simon McCleave's [exact-title page](https://www.simonmccleave.com/books/the-menai-bridge-killings/)
  labels the work book eight of DI Ruth Hunter Crime Thrillers.
- Paula Harmon's [dedicated series page](https://paulaharmon.com/books-by-paula-harmon/the-margaret-demeray-series/)
  explicitly labels *Death in the Last Reel* book two and lists it between books one and three.
- The co-authors' [current site](https://goodyandgrant.com/) names the Sam Applewhite mysteries,
  while their [publisher catalog](https://www.pigeonparkpress.com/sam-applewhite/) groups
  *Sealfinger* with the recurring-protagonist works. This establishes membership but not an
  explicit numeric position, so gold leaves order unset.
- Peter Turnham's [catalog](https://www.peterturnhamauthor.com/) names the None Stood Taller series
  and presents the target before a work whose description says the story continues. His
  [blog](https://www.peterturnhamauthor.com/blog/) separately describes that next work as a sequel
  and a later title as the third novel in the series, establishing publication position one.
- First-party pages establish *So Many Ways of Loving*, *The Big Fix*, *White Heron*, and *The
  Other Times of Caroline Tangent* but do not make a sufficiently direct bibliographic-series or
  standalone claim. *Breathe* currently lacks qualifying first-party classification evidence.
  All five remain unresolved rather than treating catalog absence, a planned sequel, or a
  distributor label as authority truth.

## Truth-blind scout check

After the human rulings were fixed, the scout made nine model calls and twenty-one hosted searches,
using 155,256 input tokens and 4,642 output tokens. It recovered all four reviewed memberships,
producing 100% resolved accuracy, effective accuracy, series precision, and series recall with no
false standalone on reviewed truth. It found the exact positions for *The Menai Bridge Killings*
and *Death in the Last Reel*, omitted the reviewed position for *None Stood Taller*, and proposed
position one for *Sealfinger* even though gold deliberately withholds that order. The current
headline capability score evaluates membership, not position accuracy, so those differences must
remain visible beside the score.

Seven of nine outputs were structurally valid and policy-safe. *Breathe* and *White Heron* were
correctly unresolved but quarantined because the model marked identity matched without a qualifying
identity citation. *So Many Ways of Loving* and *The Big Fix* produced valid abstentions.

The remaining candidate, *The Other Times of Caroline Tangent*, exposed a more important source-
authority overreach: the model proposed standalone from an interview on a third-party review blog
and labelled that URL as an author post. The source may reproduce an author statement, but it is not
author-controlled and is not sufficient under the gold policy. The case remains unresolved. The
same boundary appears in the model's proposed *Sealfinger* position, which relied on a professional
association profile rather than the reviewed first-party sources. These are review-only signals for
tightening deterministic source ownership; they do not become gold truth.

## Program impact

The development set now contains 255 selected works: 158 reviewed and 97 candidates. It contains
132 reviewed positives and 26 true standalone controls. The recent independent or Kindle-first
stratum advances from 44 to 48 reviewed cases, leaving two to its 50-case minimum. Overall, 42 more
reviewed cases and 24 more true standalone controls remain before the 200-case development accuracy
set meets its gates.

## Boundary

This frame changes only trial data, tests, and documentation. It does not write Supabase, modify
the Reverie corpus, deploy a function, or treat model output as gold truth.
