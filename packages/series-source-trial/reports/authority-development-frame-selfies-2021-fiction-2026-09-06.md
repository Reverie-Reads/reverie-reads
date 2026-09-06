# Authority development frame: 2021 Selfies adult fiction shortlist

Date: 2026-09-06

## Outcome

The complete eight-work adult fiction shortlist from the 2021 Selfies Book Awards adds four
authority-reviewed series cases, one authority-reviewed standalone, and three unresolved
candidates. The official shortlist release fixes the frame before model behavior is inspected and
describes the category as independently published adult fiction.

| Work | Authority result | Classification |
| --- | --- | --- |
| *Odd Numbers* - J. J. Marsh | Reviewed standalone | Standalone |
| *Murder Your Darlings* - Debbie Young | Reviewed series-positive | Sophie Sayers Village Mysteries, book 6 |
| *His Wife's Sister* - A. J. Wills | Candidate | Unresolved |
| *Fitting In* - Amanda Radley | Candidate | Unresolved |
| *The Snowdonia Killings* - Simon McCleave | Reviewed series-positive | DI Ruth Hunter Crime Thrillers, book 1 |
| *How to Buy a Planet* - D. A. Holdsworth | Reviewed series-positive | The Cleremont Conjectures, book 1 |
| *The Secret Diary of an Arranged Marriage* - Halima Khatun | Reviewed series-positive | The Secret Diary, book 1 |
| *At the Stroke of Nine O'Clock* - Jane Davis | Candidate | Unresolved |

The [official 2021 shortlist release](https://theselfies.co.uk/wp-content/uploads/2021/03/Selfies-2021-shortlist-press-release-FINAL.pdf)
supplies all eight selected titles and authors. It is sampling evidence only and does not establish
classification. The frame normalizes Adrian Wills to the author's current A. J. Wills name.

These works were published in 2020. The frame therefore remains a pre-2021 independent diagnostic
cohort and does not count toward the recent-independent stratum, whose configured year floor is
2021.

## Authority review

- J. J. Marsh's [books navigation](https://www.jjmarshauthor.com/single-books/) explicitly places
  *Odd Numbers* inside a section labelled Standalones. This is affirmative first-party negative
  evidence rather than an inference from a missing series label.
- Debbie Young's [exact-title page](https://authordebbieyoung.com/books/fiction/sophie-sayers-village-mysteries/murder-your-darlings-sophie-sayers-village-mysteries-6/)
  names Sophie Sayers Village Mysteries and labels *Murder Your Darlings* number six.
- Simon McCleave's [exact-title page](https://www.simonmccleave.com/books/the-snowdonia-killings/)
  labels *The Snowdonia Killings* book one in DI Ruth Hunter Crime Thrillers.
- D. A. Holdsworth's [publishing-company catalog](https://www.squirrelandacorn.co.uk/) labels *How
  to Buy a Planet* book one of The Cleremont Conjectures and separately labels the related work
  book two.
- Halima Khatun's [three-book collection](https://halimakhatun.co.uk/the-secret-diary-of-a-bengali-woman-books-1-3/)
  explicitly names The Secret Diary series and labels *The Secret Diary of an Arranged Marriage*
  book one.
- A. J. Wills's author site identifies *His Wife's Sister* as his second psychological thriller,
  but that is author-work chronology rather than a named relationship. Jane Davis's
  [exact-title page](https://jane-davis.co.uk/books/at-the-stroke-of-nine-oclock/) includes its work
  in a retail box set called The London Collection but does not call that collection a
  bibliographic series. Reviewed first-party evidence for *Fitting In* likewise does not affirm a
  series or standalone status. All three remain unresolved.

## Truth-blind scout check

After the human rulings were fixed, the scout made eight model calls and seventeen hosted searches,
using 133,485 input tokens and 4,137 output tokens. It safely abstained on all three unresolved
candidates and produced no false standalone or false-series classifications.

The model found all four real series relationships and all four positions. The exact-name scorer
credited only three: the model repeated Debbie Young's first-party phrase “Sophie Sayers Village
Mystery,” while gold uses the title-page heading “Sophie Sayers Village Mysteries.” That singular
descriptor is not a different series, so the reported 75% membership precision and recall expose a
deterministic name-normalization gap rather than a bad relationship claim. Until normalization is
changed and tested independently, the raw score remains recorded rather than silently rewritten.

The scout did not recover the standalone control. It found J. J. Marsh's homepage but not the
author's explicit Standalones navigation page, then returned unresolved with no qualifying identity
citation. This is a discovery-recall miss and a useful case for the bounded navigation retriever;
it is not evidence against the gold ruling.

Seven of eight outputs were structurally valid and policy-safe. The remaining output was the
conservative *Odd Numbers* abstention described above. *Fitting In* exposed the continuing
source-ownership boundary: the model labelled an author-attributed article on a third-party media
site as an author post, and deterministic validation accepted it for identity. It did not establish
classification, but source kind must ultimately come from a reviewed origin profile rather than
the model's label.

## Program impact

The development set now contains 263 selected works: 163 reviewed and 100 candidates. It contains
136 reviewed positives and 27 true standalone controls. The recent independent or Kindle-first
stratum remains at 48 reviewed cases, two short of its 50-case minimum, because this cohort predates
the configured year floor. The standalone challenge stratum advances to 35 reviewed cases. Overall,
37 more reviewed cases and 23 more true standalone controls remain before the 200-case development
accuracy set meets its gates.

## Boundary

This frame changes only trial data, tests, and documentation. It does not write Supabase, modify
the Reverie corpus, deploy a function, or treat model output as gold truth.
