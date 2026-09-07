# Authority acquisition attribution cleaning

Date reviewed: 2026-09-06

## Decision

Keep the candidate unresolved and harden the scout. A publisher or author page does not become
classification evidence merely because it reproduces somebody else's review, endorsement, blurb,
testimonial, retailer description, or quotation.

This batch changed no authority-gold record. It closes a false-positive path before the scout is
used for more gold review or user matching.

## Observed failure

A truth-blind scout run evaluated 10 unresolved Hachette standalone-challenge candidates. It made
10 model calls and 13 live searches, using 141,443 input tokens and 4,813 output tokens. All outputs
were structurally valid, but deterministic policy accepted only three as policy-safe. Seven were
quarantined and two were unresolved.

The only policy-safe standalone proposal was *The Wolf in the Whale*. The exact
[Hachette title page](https://www.hachette.co.uk/titles/jordanna-max-brodsky/the-wolf-in-the-whale/9780356512600/)
contains the word “standalone,” but only inside an attributed Fantasy Book Review quotation. The
first prompt summarized that sentence as if it were the publisher's own classification. That is
attribution laundering: the URL is first-party, but the relevant claim is not.

The proposal was not added to gold.

## Fix

Prompt version `authority-acquisition-v7-attribution-preserving-evidence` now requires the model to
preserve third-party attribution and return unresolved when the relevant claim exists only in
attributed material. It explicitly covers reviews, praise, endorsements, testimonials, retailer
copy, and quotations reproduced on first-party pages.

Deterministic evidence cleaning independently detects those attribution signals. It removes series
or standalone support and records `third_party_attribution` as the policy risk. A first-party page
may still establish identity when its classification language is ineligible.

## Verification replay

The same target was rerun truth-blind after the prompt change. The replay made one model call and
one live search, using 14,010 input tokens and 557 output tokens. The output preserved the material
fact: the publisher page reproduced a review calling the novel standalone, and the attributed
statement was not used as classification evidence.

Canonical cleaning retained the page for identity only. Validation quarantined the standalone
classification because no eligible affirmative authority evidence remained. The observed false
positive therefore changed from an apparently policy-safe standalone proposal to a grounded,
fail-closed review result.

Across discovery and verification, this batch used 155,453 input tokens and 5,370 output tokens.
The raw run artifacts remain local and gitignored; only the reproducible rule, regression test, and
review conclusion are committed.

## Gold-program status

- Selected development cases: 306/200
- Authority-reviewed development cases: 179/200
- Reviewed series-positive cases: 141/100
- Reviewed true standalone controls: 38/50
- Candidates awaiting authority review: 127
- Locked qualification cases: 0/1,000

The development set still needs 21 reviewed cases, including 12 affirmative standalone controls.
Coverage does not justify weakening the evidence threshold. Future standalone promotion still
requires a direct author or publisher statement, or a complete and independently eligible
first-party bibliography whose heading affirmatively classifies the exact work.

## Boundary

This batch changes trial prompt policy, deterministic evidence cleaning, tests, and documentation
only. It does not write authority gold, Supabase, the Reverie corpus, or production classification.
