# PRH contributor-label qualification — 2026-10-18

The review-only publisher adapter now accepts two additional, finite code-label pairs:

| Required PRH code | Existing label | Additional label | Preserved role |
| ----------------- | -------------- | ---------------- | -------------- |
| E                 | Editor         | Edited by        | editor         |
| T                 | Translator     | Translated by    | translator     |

Comparison ignores label case and surrounding whitespace only. Literal labels and codes,
source person IDs, source order, and work/edition basis remain unchanged in transient evidence.
The existing A/Written by handling is unchanged. No other alias or code was added.

## Primary evidence and its limit

Checked on **2026-10-18**:

- The official [Contributor role documentation](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Contributor_role)
  explicitly maps E to editor and T to translator. It explains that contributor roles depend on
  a title/work relationship, that a person can hold multiple roles, and that the structured
  roster has a five-person limit. The page identifies its version as November 20, 2015.
- The official [Title resource documentation](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Title)
  distinguishes ISBN-specific title resources and their contributor subresource. This change
  does not relax the existing exact-ISBN endpoint and identity checks.
- PRH's [publisher product listing](https://www.penguinrandomhouse.com/books/231499/the-swordsmans-handbook-by-edited-and-translated-by-william-scott-wilson/)
  displays separate editing and translation credits using the two additional labels above.
  Only the wording and role distinction were used; no description or other book metadata was
  imported into fixtures or the catalog.

The API documentation supplies code meanings; the product listing supplies publisher display
vocabulary. Accepting the corresponding aliases is a narrow semantic inference from those two
sources, **not** a claim that the API documentation guarantees those exact strings. Unknown
strings, combined roles, abbreviations, or labels containing names are not parsed. No book API
request, provider acquisition, model call, credential change, or permission grant occurred.

## Preserved boundaries

- A supported editing or translation credit does not establish creator identity. Editor-only
  or translator-only rosters remain under review, including ISBN-only intake.
- E/Translated by, T/Edited by, and author codes paired with either secondary-role label remain
  conflicting. A missing or unknown code cannot borrow a role from its label.
- Separate editing and translation rows for the same identified person remain separate. A
  repeated credit using canonical and alias labels is withheld losslessly rather than merged.
- The partial-roster warning, review-only source qualification, unresolved upstream lineage,
  exact-edition checks, personal-data isolation, and unchanged Add/scan/import paths remain.

## Verification

`intakePrh.test.ts` and `intakeSourceAdapters.test.ts` pass **104 tests** (73 and 31). Added cases
cover canonical/alias forms, case/outer whitespace, contradictory and unsupported labels,
secondary-credit identity rejection, ISBN-only holds, distinct dual roles, and lossless duplicate
holds. These are synthetic regressions, not a new external-source accuracy score. Consumed
comparison frames must not be reacquired; the next evaluation needs a new frozen frame.

## Reference-frame contamination notice

The public product listing used above and all book identities exposed incidentally by research
search results or documentation examples were reported to the comparison owner for exclusion.
This research did not inspect the next frame's reserved reference candidates. The implementation
uses synthetic identities rather than those observed books.
