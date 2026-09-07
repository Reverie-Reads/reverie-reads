# Freida McFadden standalone-thriller authority frame

Date: 2026-09-06
Partition: development
Disposition: reviewed gold, no corpus write

## Selection frame

The frame includes all 23 titles displayed under **Standalone Thrillers** on Freida McFadden's
current complete Books page, in displayed order. It excludes the separately labelled Housemaid
Series, Women's Fiction, and Short Stories sections. Selection did not depend on any provider or
model result.

- Frame: https://www.freidamcfadden.com/books/
- Dated cross-check: https://www.freidamcfadden.com/printable-booklist/
- Author policy and rewrite context: https://www.freidamcfadden.com/about/faqs/

The first two author-controlled pages repeat the same 23-title classification. The printable list
also supplies publication dates. The FAQ says the author's books are standalone unless explicitly
marked as a series and explains that the current *Dead Med* is a rewritten successor to the
out-of-print *Suicide Med*. Gold therefore records *Dead Med* as the current 2024 work identity and
does not turn the prior-title relationship into a series.

## Development audit after review

| Measure | Count | Gate | Result |
| --- | ---: | ---: | --- |
| Selected works | 329 | 200 | met |
| Authority-reviewed works | 202 | 200 | met |
| Reviewed series-positive works | 141 | 100 | met |
| Reviewed true standalones | 61 | 50 | met |
| Standalone-control stratum | 69 | 50 | met |

The audit remains `building` because the Reverie-seed stratum is 68/69 and the recent-independent
or Kindle-first stratum is 49/50. Those cases remain unresolved rather than being promoted from
weaker evidence. The locked 1,000-case qualification partition has not started; total gold-program
progress is 202/1,200 reviewed works.

## Truth-blind acquisition slice

A five-case scout run used *The Witch*, *The Intruder*, *Ward D*, *The Locked Door*, and *Dead Med*.
The selection-frame URL was withheld by policy, along with gold labels and known authority URLs.

| Measure | Result |
| --- | ---: |
| Valid structured output | 5/5 |
| Grounded URLs | 5/5 |
| Policy-safe resolutions | 3/5 |
| Accuracy among resolved cases | 3/3 |
| Effective accuracy | 60% |
| False series | 0/5 |
| Model calls / web-search calls | 5 / 5 |
| Input / output tokens | 56,909 / 1,974 |
| Structural repairs | 0 |

The scout safely resolved *The Witch*, *The Intruder*, and *The Locked Door*. It quarantined *Ward
D* because its proposed standalone decision depended only on the blocked selection frame. It also
quarantined *Dead Med* because the cited exact-work page supported identity but its evidence summary
did not state affirmative standalone support. Both misses reduced coverage without creating a false
claim, which is the intended failure direction. The raw run remains gitignored under
`private-results/`.

## Boundary

This batch changes only the reproducible trial data, audit expectations, documentation, and tests.
It does not write Supabase, the production corpus, or any user record. No provider or model output
wrote gold truth.
