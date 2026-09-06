# Authority development frame: 2025 Selfies adult fiction shortlist

Date: 2026-09-06

## Outcome

The complete six-work adult fiction shortlist from the 2025 Selfies Book Awards adds four
authority-reviewed series cases and two unresolved candidates to the development partition. The
frame was fixed before provider or model behavior was inspected, and no title was removed because
its truth was difficult to establish.

| Work | Authority result | Classification |
| --- | --- | --- |
| *Sizar* — Susan Grossey | Reviewed series-positive | Cambridge Hardiman Mysteries, book 2 |
| *The Secret Diary of a Bengali Mum* — Halima Khatun | Reviewed series-positive | Diverse Romcom; order unknown |
| *The Echoing Shore* — J. H. Mann | Candidate | Unresolved |
| *Pride and Perjury* — Alice McVeigh | Reviewed series-positive | Warleigh Hall Jane Austen, book 4 |
| *Unravelling* — Preethi Nair | Candidate | Unresolved |
| *House of Crimson Hearts* — Ruby Roe | Reviewed series-positive | Kingdom of Immortal Lovers, book 1 |

The selection source is the official
[2025 Selfies shortlist](https://theselfies.co.uk/uncategorised/2025-shortlists-announced/), which
lists all six adult fiction finalists. It establishes the complete independent-publishing sampling
frame but does not establish series truth.

## Authority review

- Susan Grossey's
  [dedicated series page](https://susangrossey.com/books-by-susan/cambridge-hardiman-mysteries/)
  labels *Sizar* as Cambridge Hardiman Mysteries book two.
- Halima Khatun's
  [exact-title page](https://halimakhatun.co.uk/the-secret-diary-of-a-bengali-mum/) calls *The
  Secret Diary of a Bengali Mum* the latest work in the Diverse Romcom series. It gives no numeric
  position, so gold retains membership and leaves order unknown.
- Alice McVeigh's [exact-title page](https://www.alicemcveigh.com/books/pride-and-perjury/) calls
  *Pride and Perjury* the fourth work in an award-winning standalone series and links the author's
  [Warleigh Hall Jane Austen series note](https://www.alicemcveigh.com/a-note-on-the-warleigh-hall-jane-austen-series/).
  Standalone describes independent readability here; it does not erase the author's explicit
  bibliographic relationship.
- Ruby Roe's [reading order](https://www.rubyroe.co.uk/pages/reading-order) says her four series
  share a universe and places *House of Crimson Hearts* first in Kingdom of Immortal Lovers. The
  [dedicated series page](https://www.rubyroe.co.uk/collections/kingdom-of-immortal-lovers?view=no-usf)
  confirms that relationship. The shared universe is retained as risk context, not a second series.
- J. H. Mann's [catalog](https://www.jhmannauthor.com/books) identifies *The Echoing Shore* but
  exposes no bibliographic series label. Third-party Wild Cornwall metadata remains discovery-only.
- Preethi Nair's [site](https://preethinair.com/site/) identifies *Unravelling* as her fourth novel,
  and her [blog](https://preethinair.com/site/blog/) confirms its 2024 independent publication, but
  neither source affirmatively establishes series membership or standalone status.

## Program impact

The development set now contains 138 selected works: 120 reviewed and 18 candidates. It contains
95 reviewed positives and 25 true standalone controls. The overall review gap is 80, the positive
gap is 5, and the true-standalone gap is 25. The recent independent or Kindle-first stratum advances
from 31 to 35 reviewed cases, the multi-series or connected-universe stratum advances from 16 to 17,
and the publisher or author standalone-challenge stratum advances from 29 to 30.

## Truth-blind scout check

The authority scout was run after the human records were fixed. Gold labels, known authority URLs,
and the selection source were withheld from the model.

On the two unresolved cases, it made two model calls and four hosted searches, using 33,075 input
tokens and 884 output tokens. It found the exact author-controlled catalogs and correctly returned
both cases unresolved. Both outputs were valid, policy-safe, and grounded; it made no series or
standalone proposal.

On the four reviewed positives, it made four model calls and seven hosted searches, using 59,625
input tokens and 2,078 output tokens. Three proposals were valid and policy-safe, all three matched
gold, and there were no false series or false standalone calls. It correctly structured *Sizar*,
*Pride and Perjury*, and *House of Crimson Hearts*. For *The Secret Diary of a Bengali Mum*, it found
and described the correct first-party relationship but again returned `classification: series`
with an empty `memberships` array. Deterministic validation rejected that result rather than
reconstructing or promoting a claim from prose.

Across both runs, the scout used six model calls, eleven hosted searches, 92,700 input tokens, and
2,962 output tokens. No result was promoted into gold.

## Boundary

This batch changes only the reproducible trial data, tests, and documentation. It does not write
Supabase, alter the corpus, deploy a function, or turn provider or model output into gold truth.
