# Authority development frame: Hachette standalone SFF horror

Date: 2026-09-06

## Outcome

The complete nine-title Horror section of Hachette's standalone SFF list contains four reviewed
works and five unresolved candidates. One of the four reviewed works, *A Dowry of Blood*, was
already in gold through a different complete Hachette list. The frame therefore adds eight unique
selected works, three new reviewed cases, and five candidates without duplicating the shared work.

| Work | Authority result | Classification |
| --- | --- | --- |
| *The Children of Red Peak* — Craig DiLouie | Candidate | Unresolved |
| *Ghoster* — Jason Arnopp | Reviewed standalone | No memberships |
| *Someone Like Me* — M. R. Carey | Candidate | Unresolved |
| *One of Us* — Craig DiLouie | Candidate | Unresolved |
| *The Last Days of Jack Sparks* — Jason Arnopp | Reviewed standalone | No memberships |
| *The Girl With All the Gifts* — M. R. Carey | Reviewed series-positive | The Girl With All the Gifts; order unknown |
| *Dead Water* — C. A. Fletcher | Candidate | Unresolved |
| *It Rides a Pale Horse* — Andy Marino | Candidate | Unresolved |
| *A Dowry of Blood* — S. T. Gibson | Reviewed standalone | No memberships |

The selection source is Hachette's complete
[standalone SFF list](https://www.hachettebookgroup.com/landing-page/standalone-sff-books/),
observed on 2026-09-06. Every title under its Horror heading was retained. The heading selects the
cases but cannot establish truth: its own frame contains a publisher-confirmed series work.

## Authority review

- Jason Arnopp's [exact page for *The Last Days of Jack Sparks*](https://www.jasonarnopp.com/jack-sparks.html)
  affirmatively calls it a standalone book. For *Ghoster*, the author's
  [Orbit deal announcement](https://www.jasonarnopp.com/128240-news/new-book-deal-announced)
  says the two books would be unrelated standalones, while his current
  [biography](https://www.jasonarnopp.com/128075-about.html) and
  [exact *Ghoster* page](https://www.jasonarnopp.com/ghoster.html) identify the two Orbit novels.
- Orbit's [exact *The Girl With All the Gifts* page](https://www.orbit-books.co.uk/titles/m-r-carey-2/the-girl-with-all-the-gifts/9780356500157/)
  contains a relational module titled “The Girl With All the Gifts series” and places the target
  beside *The Boy on the Bridge*. Orbit separately describes
  [*The Boy on the Bridge*](https://store.orbit-books.co.uk/products/the-boy-on-the-bridge) as a
  stand-alone novel in the same world. The frame therefore records a false standalone label and
  leaves series order unknown rather than inferring it from carousel layout.
- S. T. Gibson's [works catalog](https://stgibson.com/works/) places *A Dowry of Blood* under
  Vampire Standalones and separately labels the Summoner's Circle Series. The author's
  [companion announcement](https://stgibson.com/2023/06/07/cover-reveal-for-an-education-in-malice/)
  does not assign *A Dowry of Blood* to a bibliographic series, so the work remains standalone while
  gaining a connected-work risk annotation.
- The exact author and publisher pages for *The Children of Red Peak*, *Someone Like Me*, *One of
  Us*, *Dead Water*, and *It Rides a Pale Horse* establish identity and publication context but do
  not independently make an eligible affirmative standalone statement. Missing series metadata is
  not negative truth, so all five remain candidates.

## Sampling integrity

*A Dowry of Blood* occurs in both the complete Hachette romantasy standalone list and this complete
horror frame. A case can now declare `selectionFrames` to retain both selection events. The audit
counts the work in each frame but keeps one stable case id and one authority truth record, preventing
duplicate works from inflating the 200-case development target.

## Program impact

The development set now contains 126 selected works: 112 reviewed and 14 candidates. It contains
89 reviewed positives and 23 true standalone controls. The review gap is 88, the positive gap is
11, and the true-standalone gap is 27. The connected-universe stratum advances to 15/20 reviewed;
the five ambiguous labels remain visible in the review queue without counting toward any accuracy
gate.

## Truth-blind scout check

The authority scout was run only on the five unresolved cases after the human records were fixed.
It made five model calls and twelve hosted searches, using 100,444 input tokens and 2,950 output
tokens. All five responses were structurally valid and URL-grounded. Deterministic policy accepted
three conservative unresolved results and quarantined two proposed standalone results because they
depended on the same Hachette list taxonomy or on absent series metadata rather than an affirmative
eligible statement. No scout result was promoted into gold.

## Boundary

This batch changes only the reproducible trial data, audit logic, tests, and documentation. It does
not write Supabase, alter the corpus, deploy a function, or turn provider or model output into gold
truth.
