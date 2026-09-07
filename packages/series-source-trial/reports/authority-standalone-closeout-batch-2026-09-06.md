# Authority standalone closeout batch

Date: 2026-09-06

## Outcome

One standalone challenge case is now authority reviewed. *Goldilocks* moves from candidate to true
standalone based on a title-specific author statement. *Bulletproof* remains unresolved after a
fresh publisher review because connected-world language does not establish a bibliographic-series
membership or position.

## Goldilocks

L. R. Lam's [exact work page](https://lrlam.co.uk/work-1/goldilocks) calls *Goldilocks* “a
standalone near-future thriller” and supplies matching US and UK publication details. Gold truth
therefore records `standalone: true`, an empty membership set, and `membershipsComplete: true`.

Hachette's [standalone SFF list](https://www.hachettebookgroup.com/landing-page/standalone-sff-books/)
continues to supply selection provenance only. It is not cited as truth evidence, so this ruling is
independent of the challenge label that selected the case.

## Bulletproof

Sourcebooks' [exact product page](https://www.sourcebooks.com/9781464265587-bulletproof-standard-edition-tp.html)
and Penguin Australia's [exact product page](https://www.penguin.com.au/books/bulletproof-9781464265570)
both identify *Bulletproof* and place it in the world of Dark Forces. Neither page assigns the exact
work to a bibliographic series or supplies a position.

Sourcebooks separately assigns *Your Knife, My Heart* and *My Blade, Your Back* explicit Dark
Forces series numbers. That asymmetry does not authorize reversing the target's shared-world wording
into membership. The seed's position 4 is likewise unsupported. The case remains a candidate rather
than being promoted from inference.

## Program impact

The development set contains 306 selected works: 178 reviewed, including 141 series-positive cases
and 37 true standalone controls, plus 128 candidates. The standalone challenge stratum is now 45 of
50 reviewed. The hard development gates still need 22 reviewed cases, including 13 true standalone
controls; the separate 1,000-case qualification partition has not started.

No model call or provider request was needed for this deterministic review, so incremental token and
provider cost is zero.

## Boundary

This batch changes trial truth, tests, and documentation only. It does not alter Reverie's seed,
corpus, Supabase, Edge Functions, or production classification.
