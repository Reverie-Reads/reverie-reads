# Authority development frame: Hachette standalone SFF fantasy

Date: 2026-09-06

## Outcome

The complete seventeen-title Fantasy section of Hachette's standalone SFF list contains four
authority-reviewed works and thirteen unresolved candidates. Two works were already present through
Hachette's complete romantasy frame: *The Undertaking of Hart and Mercy* is a reviewed series
false-positive, while *Wild and Wicked Things* remains unresolved. The frame therefore adds fifteen
unique selected works, three new reviewed standalone controls, and twelve new candidates.

| Work | Authority result | Classification |
| --- | --- | --- |
| *Brother Red* — Adrian Selby | Reviewed standalone | No memberships |
| *The Age of Witches* — Louisa Morgan | Candidate | Unresolved |
| *The Wolf in the Whale* — Jordanna Max Brodsky | Candidate | Unresolved |
| *The Once and Future Witches* — Alix E. Harrow | Candidate | Unresolved |
| *The Unlikely Escape of Uriah Heep* — H. G. Parry | Candidate | Unresolved |
| *The Ladies of the Secret Circus* — Constance Sayers | Candidate | Unresolved |
| *The Light of the Midnight Stars* — Rena Rossner | Reviewed standalone | No memberships |
| *Wildwood Whispers* — Willa Reece | Candidate | Unresolved connected-world risk |
| *An Orc on the Wild Side* — Tom Holt | Candidate | Unresolved |
| *The Raven Tower* — Ann Leckie | Candidate | Unresolved |
| *The Great Witch of Brittany* — Louisa Morgan | Candidate | Unresolved connected-world risk |
| *Sistersong* — Lucy Holland | Candidate | Unresolved |
| *The Book of Gothel* — Mary McMyne | Candidate | Unresolved |
| *The Monsters We Defy* — Leslye Penelope | Reviewed standalone | No memberships |
| *The Ballad of Perilous Graves* — Alex Jennings | Candidate | Unresolved |
| *The Undertaking of Hart and Mercy* — Megan Bannen | Reviewed series-positive | Hart and Mercy #1 |
| *Wild and Wicked Things* — Francesca May | Candidate | Unresolved |

The selection source is Hachette's complete
[standalone SFF list](https://www.hachettebookgroup.com/landing-page/standalone-sff-books/),
observed on 2026-09-06. Every title under its Fantasy heading was retained in displayed order with
no provider or classification filtering. The heading selects the cases but cannot establish truth:
the same frame contains a directly disproven standalone label.

## Authority review

- Hachette Australia's [exact *Brother Red* page](https://www.hachette.com.au/adrian-selby/brother-red)
  affirmatively describes the work as a standalone adventure.
- Hachette's [Spring 2021 catalog](https://www.hachette.co.uk/wp-content/uploads/2020/10/Spring-2021-Online-Catalogue.pdf)
  gives *The Light of the Midnight Stars* an exact title, author, ISBN, and release entry and calls
  it a new standalone novel.
- Leslye Penelope's [current FAQ](https://lpenelope.com/contact/) states that *The Monsters We
  Defy* was written as a standalone novel and that no sequel is planned.
- Megan Bannen's existing first-party evidence establishes *The Undertaking of Hart and Mercy* as
  Hart and Mercy book one. This is retained as a false-label control rather than overwritten by a
  publisher marketing heading.
- The remaining exact author and publisher pages establish work identity and useful relationship
  warnings but do not independently make an eligible affirmative classification. In particular,
  a Goodreads-hosted author answer is not promoted into first-party gold, an attributed review
  quotation is not treated as publisher classification, no-sequel language is not equivalent to
  no bibliographic relationship, and shared-world language cannot be reversed into membership.

## Source-risk result

Only four of the seventeen labels, 24%, are independently gold-ready under the locked authority
policy. Three survive as true standalones; one is contradicted by stronger current author evidence.
This is not a precision estimate for Hachette's catalog because unresolved cases are not errors. It
is an acquisition-yield result: the list is useful for challenge-case discovery, but unsafe as a
direct standalone truth feed and expensive to finish without better exact-work sources.

The result supplies concrete cleaning rules for the LLM path:

- keep a selection heading out of the truth packet;
- distinguish publisher-authored description from attributed praise;
- require an exact title to anchor every standalone statement;
- treat no sequel, self-contained reading, shared setting, and same-world language as context;
- let direct author series evidence defeat an older publisher standalone label; and
- abstain when exact authority pages provide identity but no affirmative relationship claim.

## Program impact and cost

The development set moves from 273 selected / 169 reviewed to 288 selected / 172 reviewed, with
116 candidates. It contains 141 reviewed positives and 31 true standalone controls. The overall
review gap is 28 and the true-standalone hard-gate gap is 19. The standalone challenge stratum is
39/50 reviewed, leaving eleven; the program is 172/1,200 reviewed cases.

This batch used deterministic source review only: zero model calls and zero model-token cost. The
thirteen unresolved labels remain available for targeted retrieval experiments, but the prior
homogeneous-frame spending stop argues against a blind scout run over all of them.

## Boundary

This batch changes only reproducible trial data, tests, and documentation. It does not write
Supabase, alter the corpus, deploy a function, or turn provider or model output into gold truth.
