# Authority development frame: 2023 Selfies adult fiction shortlist

Date: 2026-09-06

## Outcome

The complete eight-work adult fiction shortlist from the 2023 Selfies Book Awards adds three
authority-reviewed series cases and five unresolved candidates. The official shortlist release
fixes the frame before model behavior is inspected and states that the judges were selecting the
best indie-published books of 2022.

| Work | Authority result | Classification |
| --- | --- | --- |
| *The Phone Call* - A. J. Campbell | Candidate | Unresolved |
| *Death in Paris* - Kate Darroch | Candidate | Unresolved |
| *The West Rises* - S. M. Davies | Reviewed series-positive | High King, book 1 |
| *Small Eden* - Jane Davis | Candidate | Unresolved |
| *The Ring Breaker* - Jean Gill | Reviewed series-positive | The Midwinter Dragon, book 1 |
| *The Maids of Biddenden* - G. D. Harper | Candidate | Unresolved |
| *The Secret Diary of a Bengali Newlywed* - Halima Khatun | Reviewed series-positive | The Secret Diary, book 3 |
| *The Secrets We Keep* - A. J. Wills | Candidate | Unresolved |

The [official 2023 shortlist release](https://theselfies.co.uk/wp-content/uploads/2023/03/Selfies-2023-shortlist-press-release.pdf)
supplies all eight selected titles, their authors, and the independent-publication frame. It is
sampling evidence only and does not establish classification.

## Authority review

- S. M. Davies's [books page](https://smdaviesauthor.com/books/) identifies the exact work as
  `High King 1: The West Rises` and separately lists `High King 2`, establishing the named
  relationship and publication position one without using the shortlist's parenthetical label as
  truth.
- Jean Gill's [exact-title page](https://jeangill.com/books/the-ring-breaker/) establishes the work,
  and her [news archive](https://jeangill.com/category/news/) explicitly announces it as book one
  of The Midwinter Dragon.
- Halima Khatun's [exact-title page](https://halimakhatun.co.uk/the-secret-diary-of-a-bengali-newlywed/)
  calls the work an instalment in The Secret series. Her
  [three-book collection](https://halimakhatun.co.uk/the-secret-diary-of-a-bengali-woman-books-1-3/)
  calls the group The Secret Diary series and labels this title book three. Gold normalizes those
  first-party names as aliases of one relationship.
- The exact author pages for *The Phone Call*, *Small Eden*, *The Maids of Biddenden*, and *The
  Secrets We Keep* establish identity but make no affirmative bibliographic-series or standalone
  claim. All four remain unresolved.
- Community catalogs label *Death in Paris* as a Màiri Maguire series book, but the author's former
  books subdomain is unavailable. A [Wayback snapshot](https://web.archive.org/web/20240601091241/https://books.katedarroch.com/)
  preserves the first-party title page's provenance but does not expose an affirmative
  relationship. The case therefore remains
  unresolved; archive availability does not upgrade community metadata into authority truth.

## Truth-blind scout check

After the human rulings were fixed, the scout made eight model calls and sixteen hosted searches,
using 122,929 input tokens and 4,058 output tokens. It found all three reviewed series
relationships at the correct positions and abstained on all five candidates, producing 100%
resolved accuracy, effective accuracy, series precision, and series recall with no false
standalone or false series classification.

Seven outputs were structurally valid and policy-safe. *Death in Paris* was correctly unresolved
but quarantined because the model marked identity matched while providing no qualifying identity
citation. That known structural failure stays visible instead of being scored as a valid
abstention. The other four candidate abstentions were valid, grounded, and policy-safe.

## Program impact

The development set now contains 246 selected works: 154 reviewed and 92 candidates. It contains
128 reviewed positives and 26 true standalone controls. The recent independent or Kindle-first
stratum advances from 41 to 44 reviewed cases, leaving six to its 50-case minimum. Overall, 46 more
reviewed cases and 24 more true standalone controls remain before the 200-case development accuracy
set meets its gates.

## Boundary

This frame changes only trial data, tests, and documentation. It does not write Supabase, modify
the Reverie corpus, deploy a function, or treat model output as gold truth.
