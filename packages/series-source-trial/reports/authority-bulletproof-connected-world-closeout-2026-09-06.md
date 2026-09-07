# Bulletproof connected-world authority closeout

Date: 2026-09-06

## Outcome

*Bulletproof* by K.M. Moronova moves from the candidate queue into authority-reviewed gold as a
true standalone control. It has no bibliographic series membership, despite the seed's Dark Forces
position-four label and the publisher's description of the work as taking place in the Dark Forces
world.

The ruling keeps the case's stable ID, `reverie-dark-forces-bulletproof`, and records
`connected_universe` as a risk feature. It closes authority review for all 69 Reverie seeded-series
cases without converting a shared world into a numbered series.

## Authority evidence

- [K.M. Moronova's official site](https://www.kmmoronova.com/) identifies the author's
  `@k.m.moronova` account.
- The [exact author-controlled post](https://www.tiktok.com/@k.m.moronova/video/7678359894323449119)
  affirmatively describes *Bulletproof* as a standalone within the Dark Forces universe.
- Bloom's [exact product page](https://www.bloombooks.com/9781464265587-bulletproof-standard-edition-tp.html)
  independently confirms the exact work identity and connected-world framing.

The publisher catalog supplies no series attribute for this product. That absence is corroboration
only; it is not standalone evidence. The affirmative author statement establishes the negative
classification, and the shared-universe language remains a semantic-quarantine signal.

## Program impact

| Measure | Current result | Development minimum | Gap |
| --- | ---: | ---: | ---: |
| Selected works | 329 | 200 | 0 |
| Authority-reviewed works | 203 | 200 | 0 |
| Series-positive works | 141 | 100 | 0 |
| Standalone controls | 62 | 50 | 0 |
| Reverie seeded series | 69 | 69 | 0 |
| Recent independent or Kindle-first | 49 | 50 | 1 |
| Recent traditional | 60 | 50 | 0 |
| Multi-series or connected universe | 22 | 20 | 0 |
| Standalone challenge | 70 | 50 | 0 |

The development sample therefore passes the overall reviewed, positive, standalone, Reverie,
traditional, complex-case, and standalone-challenge thresholds. It remains in `building` status
because the recent independent or Kindle-first stratum is one reviewed case short. Qualification
remains untouched at 0 of 1,000 cases.

## Truth-blind scout check

The shipped v7 scout was replayed once against title, author, and publication year only. It
returned a grounded, schema-valid, policy-safe unresolved result: three searches, 16,818 input
tokens, 670 output tokens, no errors, and no false series claim. It found the publisher's
identity/world language but not the author-controlled post.

Two prompt-only probes tried to increase author-social discovery. They used a combined 33,932 input
tokens, 1,050 output tokens, and six search actions, but both also abstained. Across all three runs,
the exploratory spend was 50,750 input tokens, 1,720 output tokens, and nine searches with zero
errors and zero false series claims.

Both experimental prompt variants were reverted. More search pressure increased cost without
improving authority recall, so the repository retains the proven v7 prompt. If author-controlled
social evidence is pursued later, it should be a distinct bounded and measured acquisition
mechanism rather than an unmeasured prompt expansion.

## Boundary

This change updates trial gold, regression tests, and documentation only. It does not write
Supabase, alter the corpus, change the production scout prompt, deploy a function, or make model
output authoritative. Safe abstention remains the correct model behavior when direct authority
evidence is not found.
