# Development provider and resolver evaluation — 2026-09-06

## Outcome

The complete 209-case development frame is now large enough to reject the earlier assumption that
an ordinary exact-work, non-singleton Hardcover relation is safe automatic membership evidence.
Hardcover remains the strongest free high-recall candidate generator, but its plausible taxonomy
errors survive an LLM that sees only provider evidence. The resolver policy now requires independent
open relational corroboration for Hardcover membership and explicitly quarantines publication-,
reading-, chronological-, and recommended-order containers.

That conservative policy produces a safe floor of 100% membership precision, 8.8% recall, and 0%
false standalone on the frozen development frame. A targeted truth-blind authority scout recovered
five of the six series cases involved in the resolver's remaining false acceptances, which supports
the intended next layer: scout first-party sources only for unresolved provider candidates, then let
deterministic validation—not model confidence—decide whether the result can become automatic.

This evaluation was entirely local and no-write. It did not change Supabase, production functions,
or Reverie's corpus. Raw provider responses, model outputs, caches, and secrets remain ignored.

## Frozen frame

- 209 authority-reviewed cases
- 147 positive series cases
- 62 affirmative standalone controls
- all configured development strata complete
- untouched production-qualification partition: 0 of 1,000 inspected

## Provider acquisition

The clean four-provider report used live Open Library, Wikidata, Google Books, and Hardcover
observations. The resume runner reused 835 of 836 successful provider observations and requested
only the missing Google result.

| Provider or strategy | Exact-work coverage | Membership precision | Membership recall | False standalone | Order accuracy |
| --- | ---: | ---: | ---: | ---: | ---: |
| Open Library | 73.7% | 100.0% | 4.8% | 0.0% | 100.0% |
| Wikidata | 21.1% | 100.0% | 6.1% | 0.0% | 80.0% |
| Google Books | 94.7% | identity only | 0.0% | 0.0% | n/a |
| Hardcover, raw | 88.0% | 84.9% | 68.0% | 9.7% | 97.8% |
| Open Library + Wikidata | 74.2% | 100.0% | 8.8% | 0.0% | 100.0% |
| All four | 98.1% | 85.0% | 68.0% | 9.7% | 97.8% |

Wikidata is the only current provider that clears the configured development procurement gates on
its own; it is durable CC0 but sparse. Open Library adds some correct relational coverage but still
needs a rights and persistence decision. Google materially improves identity selection but remains
identity-only. Hardcover supplies most candidate recall, while its terms and persistence boundary
remain unresolved.

## Google reliability and reproducible resume

The first full Google run returned 70 `429 rateLimitExceeded` errors. A shared request-start pace
reduced that to six. A process-wide quota cooldown that honors `Retry-After`, combined with the new
resume path, produced the final zero-error report without repeating successful work.

The adapter starts requests at least 1.1 seconds apart through one shared gate, pauses all workers
after a 429, and retries under a shared cooldown. `--resume` accepts one or more prior reports, but
reuses a successful observation only when the stable case ID, exact title, and exact authors still
match. A later error cannot erase an earlier success.

## Why the previous Hardcover policy failed

Raw Hardcover emitted 101 correct and 18 incorrect membership claims. The earlier semantic cleaner
removed universes, reading-order containers, companions, self-titled relations, fractional
positions, and conflicts, improving the eligible claims to 98 correct and 9 incorrect: 91.6%
precision, 66.0% recall, and a 1.6% false-standalone rate. The provider-only LLM resolver still
accepted seven plausible wrong claims:

| Failure shape | Observed example | Required treatment |
| --- | --- | --- |
| Ordering container presented as series | `Imperial Radch (publication order)` for *Provenance* | Deterministic quarantine |
| Original-language or alternate taxonomy | `満月珈琲店の星詠み` for *Dreamers of the Full Moon Coffee Shop* | First-party work mapping and canonical-name review |
| Truncated community name | `Sophie Sayers` | First-party canonical name |
| Expanded community name | `Secret Diary of a Bengali Woman` | First-party canonical name |
| Truncated community name | `DI Ruth Hunter` on two works | First-party canonical name |
| Marketing/world shorthand | `Wisdom` | First-party bibliographic-series evidence |

The old resolver result was fully grounded to its packet—100% citation faithfulness, no invented
fields, and no policy violations—but achieved only 92.9% membership precision, 61.9% recall, and a
1.6% false-standalone rate. This is not a prompt-compliance problem. The packet itself made unsafe
Hardcover claims eligible, so a fluent model reasonably selected them.

## Conservative resolver rescore

After changing Hardcover to `independent_corroboration_required`, the same frozen report produced:

- 209 of 209 structurally valid outputs;
- 13 policy-safe automatic proposals;
- 31 review decisions and 165 abstentions;
- 100% citation faithfulness;
- zero unsupported fields and zero policy violations;
- 100% membership precision, 8.8% membership recall, and 0% false standalone.

The profile is included in every packet cache key, so all 209 cases were intentionally re-evaluated
under the new policy. The run used 280,856 input tokens and 25,502 output tokens with no errors.

## Targeted authority-scout check

The truth-blind scout then evaluated only the seven cases behind the prior resolver's false accepted
claims. It received title, author, and optional year—not the gold truth, provider packet, or known
authority URLs.

- 7 model calls and 13 hosted web searches
- 111,887 input tokens and 4,185 output tokens
- 100% structurally valid, policy-safe, and URL-grounded
- 85.7% resolved and 71.4% effective accuracy
- 83.3% membership precision and recall
- no false standalone and no false series classification

It found the correct first-party membership for *Dreamers of the Full Moon Coffee Shop*, *The Secret
Diary of an Arranged Marriage*, both DI Ruth Hunter cases, and *Artificial Wisdom*. It safely left
*Provenance* unresolved. Its one wrong claim, `Sophie Sayers Village Mystery`, was a plausible
singular rendering rather than the authority-reviewed `Sophie Sayers Village Mysteries`. Grounded
first-party browsing therefore improves candidate adjudication substantially but does not remove the
need for deterministic canonical-name checks or human review when wording conflicts.

## Optimal pipeline supported by this trial

1. **Identity:** use paced Google Books plus Open Library, Wikidata, and Hardcover to choose the
   exact work. Google never contributes series truth.
2. **Open automatic evidence:** accept exact-work, non-singleton Open Library or Wikidata relational
   membership subject to their separate rights rules. Order still needs independent agreement.
3. **Candidate generation:** retain exact Hardcover `book_series` relationships, after deterministic
   semantic quarantine, as high-recall candidates only.
4. **Selective authority acquisition:** invoke the first-party scout only for unresolved
   Hardcover-only candidates or conflicts, not for every catalog work.
5. **Deterministic adjudication:** require an exact-work first-party statement, supported canonical
   series text, allowed source policy, and compatible provider relationship. Conflicting names,
   uncertain aliases, multiple roles, and unsupported order remain administrator review.
6. **Persistence boundary:** keep all trial evidence no-write until the untouched 1,000-case
   qualification frame, source-rights, privacy, latency, and cost gates pass.

The next implementation slice is the join between steps 4 and 5. It should consume the existing
authority-acquisition output as a separate evidence lineage, never allow the model to promote its
own source, and run only for the candidate queue. The 209-case conservative rescore is the baseline
that join must improve without losing 100% precision or standalone safety.
