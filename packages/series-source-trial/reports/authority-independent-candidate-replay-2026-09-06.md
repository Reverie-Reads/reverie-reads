# Authority independent-candidate replay

Date run: 2026-09-06

## Outcome

The truth-blind authority scout re-ran the 13 unresolved cases already selected in the recent
independent or Kindle-first stratum. It received only title, author, and optional publication year;
gold labels, known authority URLs, sample sources, and provider packets remained withheld.

- Model: `gpt-5.6-luna`
- Cases and model calls: 13
- Hosted searches: 31
- Input tokens: 202,148
- Output tokens: 7,157
- Structurally valid and policy-safe: 10/13 (76.9%)
- Grounded cited URLs: 100%
- Series proposals: 0
- Standalone proposals: 0
- Safe unresolved results: 10
- Quarantined results: 3
- Gold promotions: 0

The three quarantines were *My Brother's Keeper*, *Can I speak to Josephine please?*, and
*Swimming with Manatees*. In each, the model marked identity as matched without supplying the
required identity evidence. Deterministic validation rejected the outputs. None contained a
series or standalone claim that could leak into truth.

The ten valid results abstained because they found no eligible author- or publisher-controlled
statement establishing membership or standalone status. That is the correct result for the current
packet, but it does not convert missing evidence into negative truth.

## Spending decision

Repeatedly searching the unchanged 13-case queue is now stopped. Further model spend belongs on
new complete, externally defined independent-publishing frames where the scout can be measured
against fresh first-party evidence. An old candidate should be re-run only when its authority page,
source profile, or retrieval capability changes.

The raw acquisition output remains ignored under `private-results/authority-acquisition/`. This
report preserves only aggregate economics and the human review decision. No result was promoted,
and the run had no Supabase or corpus write path.
