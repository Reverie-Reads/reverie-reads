# Penguin Random House 2026 SFF development frame

Date reviewed: 2026-09-06

This development frame includes all 30 works on Penguin Random House's current New Fantasy and
Science Fiction To Read This Year page. Publisher-supplied structured data supplied each title,
author, ISBN, 2026 publication date, and exact product URL. The frame was selected without filtering
on a series or standalone result; the list page is sampling provenance, not classification truth.

## Authority review

Exact publisher product pages directly established 16 initial series relationships. Fourteen works
remained candidates because their product pages established identity but did not affirm a named
bibliographic series or standalone status.

A balanced truth-blind replay then sampled five reviewed cases and five candidates. It made 10 model
calls and 17 live searches, consuming 149,447 input tokens and 5,627 output tokens. Nine outputs
were structurally valid and policy-safe, every cited URL was grounded, and four of five reviewed
cases resolved correctly. The only failed reviewed response proposed the correct Full Moon Coffee
Shop membership but omitted identity support, so validation rejected it.

Human review accepted one candidate proposal. Penguin Random House's dedicated Critical Role series
roster explicitly lists the exact Nibedita Sen title among its ten titles. The work is therefore a
reviewed Critical Role membership with no inferred position. The campaign-sequel description was
not used as relationship evidence.

The replay also found that `Beneath` has two first-party memberships. Its publisher page calls it
Conform book two, while Ariel Sullivan's exact work page assigns it to Thousand Voices without an
order. Both claims are now retained; the second membership is not guessed into a primary role.

## Standalone correction

The initial replay's only standalone proposal concerned `Star Wars Outlaws: Low Red Moon`. The
author said the video-game prequel "works as a standalone title." That is a reading-independence
claim, not an affirmative statement that the book lacks bibliographic membership. Penguin Random
House's Star Wars series roster does not list this exact work, but absence from that roster is also
not standalone evidence, so the case remains unresolved.

The acquisition prompt now names this distinction directly. Deterministic cleanup also removes
standalone support from summaries that say a work works, reads, or can be read as a standalone (or
is independently readable). A direct validation of an uncleaned proposal records
`reading_independence_not_classification`; after cleanup, a standalone classification fails the
existing affirmative-evidence gate.

A fresh one-case replay with the corrected prompt made one model call and two searches, consuming
14,133 input tokens and 607 output tokens. It returned a valid, grounded, policy-safe unresolved
result and explicitly preserved the reading-independence distinction. Across the 10-case discovery
run and this focused verification, the frame used 163,580 input and 6,234 output tokens.

## Gold-program impact

- Selected development cases: 231/200
- Authority-reviewed development cases: 146
- Reviewed series-positive cases: 120
- Reviewed true standalone cases: 26
- Candidates awaiting authority review: 85
- Multi-series or connected-universe stratum: 20/20 reviewed
- Recent traditionally published stratum: 51/50 reviewed

The development set still needs 54 reviews overall, including 24 affirmative standalone controls.
The next frame should prioritize recent independent or Kindle-first books with exact author or
publisher classification evidence; additional traditionally published or connected-universe cases
are no longer the limiting strata.
