# Authority candidate scout review

Date run: 2026-09-06

The truth-blind authority scout ran over all 18 candidates that existed before the Fern Michaels
frame. It received only title, author, and optional publication year and retained no write path to
gold data, Supabase, or the corpus.

## Run summary

- Model: `gpt-5.6-luna`
- Cases: 18
- Model calls: 16, plus 2 cache hits
- Live searches: 35
- Input tokens: 274,833
- Output tokens: 9,836
- Structurally valid outputs: 16/18 (88.9%)
- Policy-safe outputs: 12/18 (66.7%)
- Grounded consulted URLs: 100%
- Valid series proposals: 0
- Valid standalone proposals: 1
- Unresolved: 11
- Quarantined: 6
- Gold promotions from model output: 0

The only policy-safe standalone proposal was `One of Us`. Human review rejected promotion because
the proposal depended on another Hachette/Orbit standalone marketing list from the same known-
conflicting taxonomy as the case-selection page. The existing candidate record remains unresolved
until an author-controlled or independently eligible publisher-controlled page directly states the
classification.

The six unsafe claims were quarantined rather than converted into standalone truth. This is the
desired failure mode: the scout can prioritize evidence, but neither a model assertion nor a
grounded discovery URL upgrades an ineligible source.

The raw acquisition output remains ignored under `private-results/authority-acquisition/`; this
report preserves only aggregate run economics and the human review decision.
