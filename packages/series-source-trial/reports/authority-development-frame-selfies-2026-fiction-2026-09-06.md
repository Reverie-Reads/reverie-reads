# Authority development frame: 2026 Selfies fiction shortlist

Date: 2026-09-06

## Outcome

The complete six-work fiction shortlist from the 2026 Selfies Book Awards adds four
authority-reviewed cases and two unresolved candidates to the development partition. The frame was
fixed before provider or model behavior was inspected, and no title was removed because its truth
was difficult to establish.

| Work | Authority result | Classification |
| --- | --- | --- |
| *Swimming with Manatees* — Bill Bennett | Candidate | Unresolved |
| *Hunting the Sun* — Jean Gill | Reviewed series-positive | Midwinter Dragon, book 3 |
| *The Silver Tide* — J. H. Mann | Candidate | Unresolved |
| *Death Valley* — J. F. Penn | Reviewed standalone | No memberships |
| *Flint in the Bones* — Eva St. John | Reviewed series-positive | The Norwich Map Runners, book 1 |
| *The Butterfly Witch* — E. L. Williams | Reviewed standalone | Connected world; no bibliographic membership |

The selection source is the official [2026 Selfies results page](https://theselfies.co.uk/2026shortlist/),
which lists all six fiction finalists. The award's
[FAQ](https://theselfies.co.uk/frequently-asked-questions-faq/) restricts the 2026 prize to
English-language books self-published during 2025. These pages establish the complete sampling
frame, year, and publication path; they do not establish series truth.

## Authority review

- Jean Gill's [exact title page](https://jeangill.com/books/hunting-the-sun/) explicitly identifies
  *Hunting the Sun* as book 3 of the Midwinter Dragon series.
- The author's publishing imprint, Mudlark's Press, names
  [The Norwich Map Runners](https://mudlarkspress.com/pages/eva-st-john) as a continuing story and
  lists *Flint in the Bones* first, followed by books 2 and 3.
- J. F. Penn's [exact story-world page](https://jfpenn.com/worlds/death-valley/) affirmatively calls
  *Death Valley* a standalone with no shared characters. The author's
  [FAQ](https://jfpenn.com/faq/) independently includes it in the standalone list. A thematic set
  of nature thrillers is not converted into bibliographic membership.
- E. L. Williams's [catalog](https://elwilliamsauthor.com/pages/books) distinguishes a two-book
  duology from two standalone Ethereal World prequels. The
  [exact product page](https://elwilliamsauthor.com/products/the-butterfly-witch-paperback) calls
  *The Butterfly Witch* a standalone Ethereal World novel. The case is therefore a true standalone
  with connected-world risk, not a series member.
- The author catalog for *The Silver Tide* establishes the exact work but exposes no series label.
  Third-party stores call it part of Wild Cornwall, so the disagreement remains visible without
  promoting non-authority metadata into gold.
- Retail and platform metadata group *Swimming with Manatees* with later Ava Martinez thrillers,
  but the author's site blocks automated review and no accessible author-controlled or
  publisher-controlled page was found that exposes the exact relationship. It remains unresolved.

## Program impact

The development set now contains 132 selected works: 116 reviewed and 16 candidates. It contains
91 reviewed positives and 25 true standalone controls. The overall review gap is 84, the positive
gap is 9, and the true-standalone gap is 25. The recent independent or Kindle-first stratum advances
from 27 to 31 reviewed cases, and the multi-series or connected-universe stratum advances from 15
to 16.

## Truth-blind scout check

The authority scout was run after the human records were fixed. Gold labels, known authority URLs,
and the selection source were withheld from the model.

On the two unresolved cases, it made two model calls and six hosted searches, using 32,954 input
tokens and 1,030 output tokens. For *The Silver Tide*, it found the author's catalog, used it only
for identity, and left the third-party Wild Cornwall claim unresolved. For *Swimming with
Manatees*, it found discovery-only Martinez Mysteries labels but no eligible authority page;
deterministic validation quarantined the result because the model marked identity without citing
authority evidence. It made no series or standalone proposal.

The first four-case reviewed run exposed a structured-output defect: the model found and correctly
described both positive relationships, but returned `classification: series` with an empty
`memberships` array. Deterministic validation rejected both rather than reconstructing a claim from
prose. That run made four model calls and seven hosted searches, using 56,034 input tokens and 1,747
output tokens; it resolved only *Death Valley*, with no false series or false standalone calls.

The prompt and output-schema descriptions were then strengthened to require a complete membership
object and its supporting source whenever classification is `series`. A fresh four-case run made
four model calls and four hosted searches, using 42,261 input tokens and 1,606 output tokens. Valid,
policy-safe resolution rose from 25% to 75%, with 100% accuracy among resolved cases and no false
series or false standalone calls. It correctly resolved *Flint in the Bones*, *Death Valley*, and
*The Butterfly Witch*. It again described *Hunting the Sun* as book 3 in prose while omitting the
membership object, so deterministic validation still rejected that proposal. This residual miss is
retained as capability evidence rather than silently repaired or promoted.

Across the three diagnostic runs, the scout used 10 model calls, 17 hosted searches, 131,249 input
tokens, and 4,383 output tokens. No result was promoted into gold.

## Boundary

This batch changes only the reproducible trial data, tests, and documentation. It does not write
Supabase, alter the corpus, deploy a function, or turn provider or model output into gold truth.
