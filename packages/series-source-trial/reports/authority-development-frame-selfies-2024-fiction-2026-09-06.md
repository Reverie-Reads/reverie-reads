# Authority development frame: 2024 Selfies adult fiction shortlist

Date: 2026-09-06

## Outcome

The complete seven-work adult fiction shortlist from the 2024 Selfies Book Awards adds five
authority-reviewed series cases and two unresolved candidates. The official award page fixes the
frame before model behavior is inspected and states that the category covers books self-published
in the UK during 2023.

| Work | Authority result | Classification |
| --- | --- | --- |
| *Shooters* - Julia Boggio | Reviewed series-positive | The Photographers Trilogy, book 1 |
| *Ostler* - Susan Grossey | Reviewed series-positive | Cambridge Hardiman Mysteries, book 1 |
| *Like Me* - Katharine Light | Reviewed series-positive | The Millingham Series, book 1 |
| *Hidden Depths* - J. H. Mann | Candidate | Unresolved |
| *Darcy: A Pride and Prejudice Variation* - Alice McVeigh | Reviewed series-positive | Warleigh Hall Jane Austen; order unset |
| *The Eagle and the Cockerel* - Alan Rhode | Candidate | Unresolved |
| *Artificial Wisdom* - Thomas R. Weaver | Reviewed series-positive | The Wisdom Duology, book 1 |

The [official 2024 winners page](https://theselfies.co.uk/uncategorised/2024winners/) supplies all
seven selected titles, their authors, the publication year, and independent-publication path. It is
sampling evidence only and does not establish classification.

## Authority review

- Julia Boggio's [catalog](https://juliaboggio.com/books) presents *Shooters* inside the
  Photographers series. Her author posts call the set a true trilogy, identify *Exposure!* as the
  final book, and describe it as returning to Stella and Connor from book one, establishing
  *Shooters* as publication position one.
- Susan Grossey's [dedicated series page](https://susangrossey.com/books-by-susan/cambridge-hardiman-mysteries/)
  explicitly labels *Ostler* Cambridge Hardiman Mysteries book one.
- Katharine Light's [books page](https://www.katharinelight.com/books) places *Like Me* under The
  Millingham Series and explicitly labels it book one.
- Alice McVeigh's [exact page](https://www.alicemcveigh.com/books/darcy/) and
  [series note](https://www.alicemcveigh.com/a-note-on-the-warleigh-hall-jane-austen-series/)
  establish membership in the Warleigh Hall Jane Austen series. The books may be read in any order;
  that is reading independence, not bibliographic standalone status. Gold leaves numeric order
  unset because the strongest first-party series note does not explicitly number *Darcy*.
- Thomas R. Weaver's [catalog](https://thomasrweaver.com/) labels the pair The Wisdom Duology. His
  [Artificial Wisdom page](https://thomasrweaver.com/artificial-wisdom/) and
  [Infinite Wisdom page](https://thomasrweaver.com/infinite-wisdom/) identify the latter as the
  sequel and conclusion, establishing publication position one for *Artificial Wisdom*.
- J. H. Mann's exact-title page and Alan Rhode's current catalog establish identity but make no
  affirmative bibliographic-series or standalone claim. Both remain unresolved.

## Truth-blind scout check

After the human rulings were fixed, the scout made seven model calls and fourteen hosted searches,
using 105,334 input tokens and 3,861 output tokens. All seven outputs were structurally valid,
policy-safe, and fully grounded. It found all five series relationships and abstained on both
unresolved candidates, with no false standalone or false series classification.

The first score was 80% because the model returned the publisher-used name `The Warleigh Hall Jane
Austen series`, while gold retained the shorter canonical `Warleigh Hall Jane Austen` and only the
alias `Austenesque`. Human review confirmed the publisher form and added it as an alias to both
affected gold records. A zero-request cache rescore then reported 100% resolved accuracy, effective
accuracy, series precision, and series recall. This was evidence normalization, not a model retry
or truth change.

## Program impact

The development set now contains 238 selected works: 151 reviewed and 87 candidates. It contains
125 reviewed positives and 26 true standalone controls. The recent independent or Kindle-first
stratum advances from 36 to 41 reviewed cases, leaving nine to its 50-case minimum. Darcy also
advances the standalone challenge stratum from 33 to 34 because it tests the distinction between
independent readability and bibliographic membership.

## Boundary

This frame changes only trial data, tests, and documentation. It does not write Supabase, modify
the Reverie corpus, deploy a function, or treat model output as gold truth.
