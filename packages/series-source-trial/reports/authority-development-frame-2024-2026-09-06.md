# Authority development frame: 2024 Kindle Storyteller shortlist

Date: 2026-09-06

## Outcome

The complete five-work 2024 Kindle Storyteller shortlist adds four authority-reviewed positive
series cases and one unresolved candidate to the development partition. No case was selected based
on provider behavior or ease of review.

| Work | Authority result | Series | Position |
| --- | --- | --- | ---: |
| *Stateside* — JD Kirk | Reviewed series-positive | Robert Hoon Thrillers | 5 |
| *Bitter Enemies* — Kerry Barnes | Reviewed series-positive | Carrie Verne | 2 |
| *Hopes and Dreams on Foxglove Street* — Alix Kelso | Reviewed series-positive | Foxglove Street | Unknown |
| *Jennifer* — Beverley Watts | Reviewed series-positive | The Shackleford Legacies | Unknown |
| *Murmuration* — Elisabeth Pike | Candidate | Unresolved | — |

The selection frame is [The Bookseller's shortlist report](https://www.thebookseller.com/news/kindle-storyteller-award-2024-shortlist-announced).
Amazon's [winner announcement](https://press.aboutamazon.com/uk/news/books-and-authors/2024/11/jd-kirk-announced-as-winner-of-amazons-kindle-storyteller-award-2024)
independently confirms that the award covered independently published KDP works and identifies
*Stateside* as the winner. Neither source establishes series truth.

## Authority review

- JD Kirk's [exact title page](https://jdkirk.com/project/stateside/) labels *Stateside* as Robert
  Hoon Thriller book 5. Amazon's readable-standalone description does not reverse that explicit
  bibliographic relationship.
- Kerry Barnes's [books-in-order page](https://www.authorkerrybarnes.co.uk/books-in-order/) places
  *Bitter Enemies* at book 2 in the Carrie Verne Series.
- Alix Kelso's [Foxglove Street Series page](https://www.alixkelso.com/foxglovestreet-series)
  includes the exact title. The page does not explicitly number it, so the truth record leaves
  position blank rather than inferring order from layout.
- Beverley Watts's [Shackleford Legacies page](https://www.beverleywatts.com/copy-of-the-shackleford-legacies)
  includes *Jennifer* in that named series. Its first visual placement is not an explicit sequence
  number, so position remains blank.
- Elisabeth Pike's [author site](https://elisabethpike.co.uk/) calls *Murmuration* her debut novel
  and a later work her second novel. That establishes identity and chronology, but it does not
  affirm either a bibliographic series or standalone status. The case therefore remains a
  candidate.

## Program target

The audit now distinguishes the 200-case development set from a locked 1,000-case production
qualification set. The complete program target is 1,200 authority-reviewed works. Qualification
requires 600 true standalone controls and 400 series-positive works; with zero observed errors,
the configured one-sided 95% bounds also require at least 598 standalone observations and 299
emitted membership claims.

After this frame, the development set contains 113 selected works: 103 reviewed and 10 candidates.
It contains 82 reviewed positives and 21 true standalone controls. The four promotions reduce the
development review gap from 101 to 97 and the recent independent or Kindle-first stratum gap from
32 to 28.

## Truth-blind scout check

The authority scout was rerun over the ten-candidate queue after the frame was recorded. Nine
prior results came from the semantic cache. The one new *Murmuration* call used 13,294 input and
572 output tokens with two hosted searches. It independently reached the same result as human
review: exact identity was supported by the author's home, book, and post pages, but none explicitly
established a bibliographic series or standalone classification. No candidate was promoted from
model output.

## Boundary

This batch changes only the reproducible trial data, audit, tests, and documentation. It does not
write Supabase, alter the corpus, deploy a function, or turn model output into gold truth.
