# Authority discovery recall pilot

Date: 2026-09-07 America/Los_Angeles

## Decision

Adopt the v11 adaptive first-party locator in the no-write authority-source acquisition trial. It
fixes the observed official-site discovery and series-name extraction failures without giving the
model a known origin, gold label, selection-frame source, or provider packet. It is not a production
accuracy qualification: a fresh 12-case development slice resolved only 50% of reviewed works.

The safe operating point remains precision-first. Every emitted decision in the fresh slice was
correct after deterministic cleanup, every cited URL was grounded in the same-run search manifest,
and there were no false series or false standalone classifications. Unavailable affirmative
first-party evidence remained unresolved instead of being inferred from catalog silence.

## Change

The scout now uses an adaptive, bounded locator sequence:

1. Search the quoted exact title and author with an official-source signal.
2. If that reveals a likely author or publisher origin without the relationship, spend the next
   query inside the discovered host.
3. Search for the author's official catalog and then the discovered host when no origin appears in
   the first result.
4. Use a generic publisher fallback only when no first-party origin is found.

The model may cite only URLs returned by hosted search and may not synthesize a plausible path on a
discovered domain. The report now retains the API's search-query telemetry alongside its consulted
URLs. Series extraction prefers the explicit bibliographic relationship label over a page,
collection, bundle, universe, or campaign heading and preserves articles and named forms such as
duology or trilogy.

Two deterministic safeguards close structural and scoring artifacts without upgrading evidence:

- a claimed identity becomes unmatched when no eligible authority identity source survives; and
- a bounded set of generic descriptor tails such as “crime fiction series” is treated as naming
  drift for score comparison, while the original proposal and relationship evidence remain
  unchanged.

## Failure-driven development results

The initial failure was `Ruthless Rival` by L.J. Shen. The v7 scout used four searches and did not
consult the official author site, leaving the reviewed retrieval profile unreachable. V8 found both
the official exact-title and reading-order pages with three searches and correctly returned `Cruel
Castaways #1`.

| Run | Cases | Valid | Resolved | Resolved accuracy | Series precision | Series recall | Searches | Input / output tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v7 Ruthless Rival baseline | 1 | 0% | 0% | n/a | n/a | 0% | 4 | 22,233 / 505 |
| v8 Ruthless Rival | 1 | 100% | 100% | 100% | 100% | 100% | 3 | 16,314 / 626 |
| v7 fixed seven-case baseline | 7 | 100% | 85.7% | 83.3% | 83.3% | 83.3% | 13 | 111,887 / 4,185 |
| v8 fixed seven-case regression | 7 | 85.7% | 71.4% | 100% | 100% | 66.7% | 10 | 103,697 / 3,932 |
| v10 fixed seven-case regression | 7 | 100% | 100% | 85.7% | 83.3% | 83.3% | 13 | 102,715 / 3,914 |

V8 eliminated the earlier false membership but missed two official deep pages. V9 made same-origin
follow-up explicit and found both: Halima Khatun's three-book author page and Thomas R. Weaver's
official Wisdom pages. It also stopped the prior invented-URL behavior. The remaining failures were
name extraction rather than relationship discovery: one run promoted a collection heading over the
author's explicit `The Secret Diary` label, and another shortened `The Wisdom Duology` to `Wisdom`.
V10 and v11 corrected those exact cases independently at 100% accuracy, grounding, and policy
safety.

These repeatedly inspected cases are development regressions, not an untouched holdout.

## Fresh development validation slice

After freezing v11, a separate 12-case development slice was selected by SHA-256 ordering of case
IDs with the seed `authority-v11-fresh-validation`, taking six series-positive and six standalone
works with distinct authors within each class. None of the eight failure-driven cases above was
eligible for selection. This is a development validation slice, not the locked qualification set.

| Valid | Policy-safe | Grounded URLs | Resolved | Resolved accuracy | Effective accuracy | Series precision | Series recall | False standalone | False series |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100% | 100% | 100% | 50% | 100% | 50% | 100% | 66.7% | 0% | 0% |

The scout resolved four of six series cases and two of six standalone controls. The unresolved
series cases were discovery or evidence-boundary misses: it did not locate S. M. Davies's official
catalog, and the consulted Ali Hazelwood pages described `Mate` as a companion without directly
supplying the reviewed `Bride` series label. Three legacy standalone controls had no affirmative
first-party standalone source in gold and correctly stayed unresolved. `Bulletproof` also remained
unresolved because hosted search did not surface the qualifying author post; publisher pages only
supplied connected-world wording. These abstentions reduce coverage but do not create false data.

One raw result used `DCI Logan crime fiction series` while gold records `DCI Logan` and a longer
official alias. The scorer now recognizes that generic descriptor tail as naming drift, consistent
with its existing generic-tail policy. It does not rewrite the proposal or weaken relationship
eligibility.

## Cost

The fresh 12-case run used 28 hosted searches, 170,503 input tokens, and 5,770 output tokens. At the
2026-09-07 standard GPT-5.6 Luna rates of $0.20 per million input tokens and $1.20 per million output
tokens, plus $10 per 1,000 web-search calls, that is approximately $0.321 total, or $0.0268 per work.
The complete v8-v11 iteration recorded here used 62 searches, 449,014 input tokens, and 16,347 output
tokens, approximately $0.729 total. Pricing source:
https://developers.openai.com/api/docs/pricing

The v8 exact-case change reduced Ruthless Rival from four to three searches and from 22,233 to
16,314 input tokens. At the same rates, estimated total cost fell from about $0.0451 to $0.0340.
Search fees remain the dominant cost; future optimization should reduce calls only after preserving
the zero-dangerous-error boundary.

## Boundary and next gate

This pilot made no Supabase request, corpus write, authority-gold edit, production deploy, or raw
page-text retention. The acquisition model remains a truth-blind, review-only source scout. It does
not replace the deterministic eligibility layer and cannot write a series classification.

The next useful experiment is retrieval/profile coverage, not broader guessing. Improve reviewed
origin coverage and the bounded same-origin retriever for cases where hosted search finds only a
catalog or homepage. Then freeze acquisition, retrieval, cleaning, and scoring before building and
running the untouched 1,000-case qualification partition.
