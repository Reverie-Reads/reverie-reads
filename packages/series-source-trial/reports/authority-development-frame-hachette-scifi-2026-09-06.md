# Authority development frame: Hachette standalone SFF science fiction

Date: 2026-09-06

## Outcome

The complete eighteen-title Science Fiction section of Hachette's standalone SFF list contains
five authority-reviewed standalone works and thirteen unresolved candidates. Every selected title
is new to the development set.

| Work | Authority result | Classification |
| --- | --- | --- |
| *Goldilocks* — L. R. Lam | Candidate | Unresolved |
| *The Ministry for the Future* — Kim Stanley Robinson | Candidate | Unresolved |
| *The World Gives Way* — Marissa Levien | Candidate | Unresolved |
| *Our War* — Craig DiLouie | Candidate | Unresolved |
| *Afterwar* — Lilith Saintcrow | Candidate | Unresolved |
| *84K* — Claire North | Candidate | Unresolved |
| *The Doors of Eden* — Adrian Tchaikovsky | Reviewed standalone | No memberships |
| *A Boy and His Dog at the End of the World* — C. A. Fletcher | Candidate | Unresolved |
| *The Ship* — Antonia Honeywell | Candidate | Unresolved |
| *Places in the Darkness* — Chris Brookmyre | Candidate | Unresolved |
| *Six Wakes* — Mur Lafferty | Candidate | Unresolved |
| *The Last Astronaut* — David Wellington | Candidate | Unresolved |
| *Provenance* — Ann Leckie | Reviewed standalone | No membership; Imperial Radch world |
| *Century Rain* — Alastair Reynolds | Reviewed standalone | No memberships |
| *Adrift* — Rob Boffard | Candidate | Unresolved |
| *The Body Scout* — Lincoln Michel | Candidate | Unresolved |
| *Ymir* — Rich Larson | Reviewed standalone | No membership; Violet Wars false relationship |
| *Eversion* — Alastair Reynolds | Reviewed standalone | No memberships |

The selection source is Hachette's complete
[standalone SFF list](https://www.hachettebookgroup.com/landing-page/standalone-sff-books/),
observed on 2026-09-06. Every title under its Science Fiction heading was retained in displayed
order with no provider or classification filtering. The heading selects the challenge cases but
does not appear in any truth record.

## Authority review

- Adrian Tchaikovsky's [Stand Alone Novels](https://adriantchaikovsky.com/stand-alone-novels.html)
  catalog contains the exact *Doors of Eden* entry under that explicit heading.
- Orbit's [exact *Provenance* page](https://orbitworks.net/titles/ann-leckie/provenance/9780316565202/)
  calls it a stand-alone novel set in the Imperial Radch trilogy's world. Gold records no
  bibliographic membership while retaining connected-universe risk.
- Alastair Reynolds's [novels page](https://www.alastairreynolds.com/novels/) explicitly names
  *Century Rain* among unrelated standalone novels. His
  [current biography](https://www.alastairreynolds.com/about/) separately calls *Eversion* a
  standalone story.
- Rich Larson's [current author-controlled biography](https://www.patreon.com/richlarson/about)
  calls *Ymir* and *Annex* two utterly unrelated standalone novels. Hachette nevertheless places
  both inside [The Violet Wars](https://www.hachettebookgroup.com/series/rich-larson/the-violet-wars/).
  The direct author statement therefore makes *Ymir* a reviewed catalog-grouping false positive.
- The remaining exact author and publisher pages establish identity or useful context but do not
  independently make an eligible affirmative classification. In particular, exclusion from a
  named series, debut or first-novel wording, self-contained plot language, and attributed
  bookseller praise cannot establish standalone truth. An unavailable author site remains
  unresolved rather than becoming negative evidence.

## Source-risk result

Five of the eighteen labels, 28%, are independently gold-ready under the locked authority policy.
This is acquisition yield, not Hachette precision: the thirteen unresolved labels are not errors.
The frame is valuable because it contains both a supported connected-world standalone and an
explicit publisher relationship that stronger author evidence disproves.

The result adds cleaning rules for the LLM path:

- preserve the distinction between bibliographic series and shared world;
- treat an exact publisher series field as a claim, not an unchallengeable fact;
- let direct exact-author evidence defeat a catalog grouping that joins unrelated works;
- reject attributed reviewer or bookseller language as publisher-authored classification;
- never turn author-site failure, catalog separation, debut language, or plot closure into
  standalone evidence; and
- abstain when the available authority packet establishes identity without a relationship claim.

## Program impact and cost

The development set moves from 288 selected / 172 reviewed to 306 selected / 177 reviewed, with
129 candidates. It contains 141 reviewed positives and 36 true standalone controls. The overall
review gap is 23 and the true-standalone hard-gate gap is 14. The standalone challenge stratum is
44/50 reviewed, leaving six; the program is 177/1,200 reviewed cases.

This batch used deterministic source review only: zero model calls and zero model-token cost. The
thirteen unresolved cases remain available for targeted retrieval experiments, but are not promoted
merely to improve the gate count.

## Boundary

This batch changes only reproducible trial data, tests, and documentation. It does not write
Supabase, alter the corpus, deploy a function, or turn provider or model output into gold truth.
