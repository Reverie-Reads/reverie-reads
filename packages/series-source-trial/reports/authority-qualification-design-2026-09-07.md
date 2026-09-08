# Locked authority qualification design

Date: 2026-09-07
Status: implemented protocol; private candidate pool not yet built or sealed

## Outcome

Reverie's 1,000-case production qualification set should not be appended to the public development gold file. The raw candidate pool, final identities, truth labels, and authority citations stay private; the repository stores the reproducible selection plan and, once the set is ready, a non-secret cryptographic lock. Normal trial commands remain development-only.

This preserves the value of the holdout while still making the result auditable. NIST's AITE program uses blind data and a sequestered environment specifically to reduce train/test contamination, and NIST's agent-evaluation work documents how an internet-enabled agent can recover public benchmark material during the evaluation itself. The ordinary machine-learning rule is the same: test data must not influence model choices.

Sources:

- [NIST AITE overview](https://pages.nist.gov/ai-technology-evaluation/)
- [NIST CAISI examples of solution contamination](https://www.nist.gov/caisi/cheating-ai-agent-evaluations/2-examples-cheating-caisis-agent-evaluations)
- [scikit-learn data-leakage guidance](https://scikit-learn.org/stable/common_pitfalls.html)

## What the set measures

The declared population is English-language books likely to enter a North American or UK personal-library catalog: current releases and backlist, traditional and independent publication, fiction and nonfiction, and both ordinary and structurally difficult relationships.

The estimand is deliberately narrower: performance on a fixed safety challenge mix of 600 series-positive works and 400 works with affirmative standalone evidence. It is not an estimate of the percentage of all published books that are in a series. The series-positive majority is intentional: “false standalone” means misclassifying a true series work, so those cases—not standalone controls—supply the denominator for Reverie's 0.5% dangerous-error bound. With zero observed false-standalone errors, 598 series-positive cases are required for a one-sided 95% binomial bound below 0.5%; the plan rounds that to 600. NIST's statistical evaluation guidance distinguishes performance on the selected benchmark from generalized performance over an item superpopulation; the sampling distribution has to be stated rather than implied.

Source: [NIST AI 800-3, Expanding the AI Evaluation Toolbox with Statistical Models](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.800-3.pdf)

## Selection and truth protocol

1. Build a provider-independent pool of at least 1,500 reviewed cases. A case cannot be selected by Open Library, Wikidata, Google Books, Hardcover, Inventaire, BookBrainz, Exa, or model output.
2. Record explicit selection provenance through complete author bibliographies, seasonal publisher catalogs, award lists, industry release lists, or library bibliographies. Each frame records its capture time, total identity count, eligible reviewed count, and reconciled exclusion counts. These frames may select identities, but they do not establish series or standalone truth.
3. Review truth without seeing Luna, Exa, or resolver output. Series truth requires a direct exact-work author or publisher relationship. Standalone truth requires an affirmative author or publisher statement; catalog silence remains unknown.
4. Exclude every work already present in the development partition.
5. Rank the reviewed pool with the committed SHA-256 seed. Deterministically satisfy the preregistered coverage floors first, then fill the remaining ranked slots to exactly 600 series and 400 standalone cases, with no more than two selected works per author identity.
6. Seal the selected private dataset, committed plan, and complete acquisition system into hashes before any qualification request.

The candidate frames should be complete, dated lists rather than convenient search results. Official publisher catalogs are useful identity frames: the University of Chicago Press describes its seasonal catalog as announcing new titles, Duke exposes a multi-season catalog archive, and UNC's dated page enumerates books scheduled for a defined publication window. These frames broaden nonfiction and specialist coverage, but no omission from a publisher series list is allowed to become standalone evidence.

Candidate-frame sources:

- [University of Chicago Press seasonal catalogs](https://press.uchicago.edu/books/catalogs.html)
- [Duke University Press catalog archive](https://www.dukeupress.edu/catalog-archive)
- [UNC Press Fall/Winter 2026 catalog](https://uncpress.org/fall-winter-2026-seasonal-catalog/)
- [Kensington seasonal catalogs](https://www.kensingtonbooks.com/catalogs/seasonal-catalogs/)
- [Simon & Schuster Book Drop catalogs](https://www.simonandschuster.net/m/adult-librarians/the-book-drop)
- [The New Press catalog archive](https://thenewpress.org/about-us/catalog/)

## Frozen production candidate

The qualification plan freezes the current best development configuration:

| Control | Frozen value |
| --- | --- |
| Scout | `gpt-5.6-luna` |
| Reasoning | low |
| Hosted-search context | medium |
| Hosted-search tool budget | 3 calls |
| Concurrent workers | 2 |
| Focused-search experiment | off |
| Exa fallback | on |
| Navigation retrieval | off |
| Maximum Exa spend | $10 |

The lock also hashes every prompt, deterministic cleaning and scoring module, Exa locator module, normalization code, evaluation policy, and runtime setting. OpenAI notes that prompting behavior may change between model snapshots, so the run records the returned response-model identity and burns the set if more than one response model appears in a completed run.

Sources:

- [OpenAI API backwards-compatibility guidance](https://developers.openai.com/api/reference/overview)
- [OpenAI evals guide](https://developers.openai.com/api/docs/guides/evals)

## Cost boundary

The completed 209-case development run observed $1.008 of Exa usage, or about $0.00482 per case. At the same fallback rate, 1,000 cases would use about $4.82 of Exa credit. That is an extrapolation, not a guarantee, so the qualification system reserves each HTTP attempt before it leaves the process and stops at the frozen $10 ceiling, including retry attempts. No paid qualification request should occur until the private set passes every audit and the public lock is committed.

The qualification cache is isolated from every development cache. This prevents a previously tested title from silently becoming a free cached qualification result. A partial infrastructure failure may resume against the same lock; a completed run cannot be rerun. If the system fails the qualification and its results are inspected to make a correction, that set is burned into development and a new untouched holdout is required.

The production decision is explicit rather than inferred from an attractive headline accuracy. It requires all 1,000 locked cases, all 600 series-positive and 400 standalone controls, at least 299 evaluated membership claims, zero false-positive memberships, zero false standalones, at least 85% series recall, at least 75% overall resolution, and no operational errors. The zero-error rules are what make the preregistered one-sided rate bounds meaningful; the recall and resolution floors prevent a system from “passing” by abstaining on nearly everything.

## Implemented safeguards

- `data/authority-qualification-plan.json` preregisters the population, class targets, seed, source boundaries, frozen runtime, $10 ceiling, and failure policy.
- `src/authority/qualification.mjs` audits complete selection-frame manifests and their reconciled counts, rejects development overlap and provider-selected cases, performs deterministic selection, fingerprints the system, and validates the lock.
- `src/freeze-authority-qualification.mjs` writes the ignored private set plus a commit-ready lock and aggregate lock report without exposing case identities.
- `src/acquire-authority.mjs` accepts a qualification set only through a valid lock, refuses partial selectors and refreshes, isolates caches, limits Exa spend, records model drift, and blocks reruns.
- Selection-source URLs are classification-blocked so a case's sampling frame cannot prove its own answer.

## Remaining work before the paid run

1. Capture complete identity frames and assemble the private oversample pool.
2. Complete blind authority review until the pool has enough eligible works to satisfy the deterministic class and author caps.
3. Freeze the private set and commit the generated lock and aggregate lock report.
4. Merge the frozen-system and lock commits without changing any fingerprinted acquisition file.
5. Run the qualification once. Publish aggregate metrics and limitations only.

## Limitations

- The challenge mix measures dangerous false claims and useful recall under a fixed class balance; it does not measure real-world class prevalence.
- Publisher and author sites with stable complete catalogs are easier to sample, so the pool needs deliberate independent, small-press, children/YA, nonfiction, and backlist coverage.
- Affirmative standalone evidence is the bottleneck. A work remains unreviewed when every authority source is silent, even if providers and the model agree that it is standalone.
- Source pages can change or disappear. Wayback URLs may preserve provenance, but the archived page inherits the original source's authority status and never becomes an independent vote.
