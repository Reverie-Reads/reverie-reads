# Authority PRH standalone closeout

Date: 2026-09-06

## Outcome

*The Unicorn Hunters* moves from candidate to true standalone based on an affirmative Penguin
Random House catalog statement. This adds one reviewed recent-traditional case and one reviewed
standalone control without changing the 306-work development selection.

## Evidence

The [Penguin Random House International Secondary Education
catalog](https://prhinternationalsales.com/wp-content/uploads/2026/01/Intl-Secondary-Education-2025-June-2026-Catalog-1.pdf)
identifies *The Unicorn Hunters* by Katherine Arden, supplies ISBN 9780593128282, and explicitly
describes the work as a standalone novel on printed page 3 (PDF page 5).

The catalog entry is independent of the [general PRH fantasy and science-fiction
list](https://www.penguinrandomhouse.com/the-read-down/fantasy-science-fiction/) that selected the
case. PRH's [exact product
page](https://www.penguinrandomhouse.com/books/608879/the-unicorn-hunters-by-katherine-arden/)
confirms the same title, author, ISBN, publisher, and 2026 publication date. Its attributed review
quotation is not used as truth evidence.

Gold truth records `standalone: true`, an empty membership set, and
`membershipsComplete: true`. This is an affirmative publisher ruling, not an inference from missing
series metadata or catalog placement.

## Program impact

The development set contains 306 selected works: 179 reviewed, including 141 series-positive cases
and 38 true standalone controls, plus 127 candidates. The standalone challenge stratum is now 46 of
50 reviewed. The hard development gates still need 21 reviewed cases, including 12 true standalone
controls; the separate 1,000-case qualification partition has not started.

The preceding four-case live scout run found no policy-safe promotable evidence and consumed 68,855
input tokens plus 2,730 output tokens across five model calls. This deterministic catalog review
required no additional model or provider call, so its incremental token and provider cost is zero.

## Boundary

This batch changes trial truth, tests, and documentation only. It does not alter Reverie's seed,
corpus, Supabase, Edge Functions, or production classification.
