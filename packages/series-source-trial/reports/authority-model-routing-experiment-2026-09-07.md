# Authority model and search-routing experiment

Date: 2026-09-07 America/Los_Angeles

## Decision

Keep GPT-5.6 Luna at low reasoning as the default authority scout. Medium reasoning, GPT-5.6 Terra,
and GPT-5.6 Sol did not improve first-party discovery on the frozen 22-work regression set. They
used more tokens and cost more while matching or underperforming Luna-low's known-origin and exact-
page recall.

Retain discovered-origin focused search as an explicit shadow experiment, not a default. It safely
resolved one additional work in six attempts during its run, but added six model calls and eleven
hosted searches without improving known-origin or exact-page discovery. Do not add Wikidata P856 or
Open Library author links to the acquisition path: both located an expected authority origin for
only 3 of 22 works and neither recovered any of the four origins missed by the original Luna run.

No run wrote Supabase, the corpus, authority gold, or any production service. The locked 1,000-case
qualification partition was not opened or evaluated.

## Method

All model arms used the frozen `authority-discovery-recall-holdout-v1`, prompt v11, medium search
context, a three-search ceiling, live web access, strict structured output, and `store: false`.
Only the model or reasoning effort changed. This is a regression benchmark, not fresh holdout
evidence; its labels and known sources were used only by the scorer after each run.

The earlier Luna-low run is the reference. The other three model arms and the focused-search arm
were live reruns on 2026-09-07. Web results and model sampling can drift, so only large or repeated
differences should drive routing. The focused-search marginal result is paired within one run: its
first pass resolved 11 works and its selected second pass resolved 12.

The open-index probes first required an exact title-author relationship. Wikidata supplied P856
official-site domains in two batch requests. Open Library supplied community-curated author links
after an exact work match in 38 requests. The domains were scored as discovery hints only; neither
index was allowed to establish identity, membership, position, standalone status, or source rights.

## Results

| Arm                          | Known origin | Exact page | Safe resolved | Resolved accuracy | Series precision | False series / standalone | Searches | Input / output tokens | Estimated cost |
| ---------------------------- | -----------: | ---------: | ------------: | ----------------: | ---------------: | ------------------------: | -------: | --------------------: | -------------: |
| Luna low reference           |        18/22 |      16/22 |         15/22 |              100% |             100% |                     0 / 0 |       52 |      336,632 / 10,863 |        $0.6004 |
| Luna medium                  |        18/22 |      16/22 |         11/22 |              100% |             100% |                     0 / 0 |       61 |      359,021 / 14,519 |        $0.6992 |
| Terra low                    |        17/22 |      15/22 |         15/22 |              100% |             100% |                     0 / 0 |       55 |      428,336 / 10,807 |        $1.5364 |
| Sol low                      |        18/22 |      16/22 |         14/22 |              100% |             100% |                     0 / 0 |       54 |       371,191 / 9,271 |        $2.2102 |
| Luna low plus focused search |        17/22 |      16/22 |         12/22 |              100% |             100% |                     0 / 0 |       63 |      417,409 / 14,291 |        $0.7306 |

The four new model runs cost an estimated $5.1764 total. Estimates use the standard short-context
rates current on the test date: Luna $0.20/$1.20, Terra $2/$12, and Sol $4/$20 per million
input/output tokens, plus $10 per 1,000 hosted web searches. Search content tokens are included in
the response usage and billed at the selected model's rate. Pricing source:
https://developers.openai.com/api/docs/pricing.

The focused arm attempted six second passes. Only _The Inmate_ was selected: the first pass had
already consulted the exact Freida McFadden page but did not produce an eligible standalone
proposal; the domain-restricted retry did. The other five retries remained unresolved or were
withheld by the existing evidence policy. This is classification variance on an already found page,
not a source-recall improvement.

| Open locator              | Any hint | Expected origin | Added recovery among the original four origin misses | Requests |
| ------------------------- | -------: | --------------: | ---------------------------------------------------: | -------: |
| Wikidata P856             |     4/22 |            3/22 |                                                  0/4 |        2 |
| Open Library author links |     4/22 |            3/22 |                                                  0/4 |       38 |

## Implementation retained

The acquisition command now accepts explicit `--model`, `--reasoning`, `--search-context`, and
`--max-tool-calls` controls. Those fields are persisted in the run and included in a versioned cache
key. Previously, reasoning and search settings could collide in the same model cache; a comparison
could therefore reuse or overwrite another arm unless every invocation forced a refresh.

`--focused-search` remains opt-in. It derives at most two domains only from authority sources that
survived canonicalization, supported identity, and appeared in the first pass's consulted manifest.
Known retailers, aggregators, social sites, hosted profiles, and the observed CWA association source
are excluded. Its result remains review-only and does not become reviewed-origin retrieval evidence.
Current-run billing fields keep mixed cached/live runs from reporting historical tokens as new
spend.

The two open-index clients were removed after the negative probe rather than retained as dormant
acquisition dependencies.

## Next gate

Model scaling is not the bottleneck. The missing cases are primarily first-party origin discovery,
and all tested models share the same hosted search index. The next credible improvement is a second,
independent web index or a maintained author/publisher authority directory evaluated on a new
untouched development slice. Keep Luna-low for ordinary shadow acquisition; spend a second search
provider or human review only on unresolved/conflicting cases. Do not run the locked qualification
partition until that source-recall change is implemented and frozen.
