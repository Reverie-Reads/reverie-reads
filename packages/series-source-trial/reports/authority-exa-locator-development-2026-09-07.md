# Exa authority locator development result

Date: 2026-09-07 America/Los_Angeles

## Decision

Keep GPT-5.6 Luna at low reasoning as the default authority scout. Retain Exa as an opt-in,
no-write fallback only after Luna returns an unresolved or policy-quarantined result. Exa does not
become an authority source: it discovers candidate domains in memory, and a separate bounded Luna
hosted-search call must independently consult and cite any source used in a proposal.

The 18-work result clears the development source-recall gate. It does not clear production, source
rights, privacy, retention, cost, or the locked 1,000-work qualification gate.

## Frozen comparison

The benchmark was frozen before either provider saw its 18 distinct titles and authors. It contains
three affirmative standalone works, seven series works with direct author sources, and eight series
works with direct publisher sources. Known authority URLs and classifications were available only
to the scorer after retrieval.

| Arm | Known origin | Targeted channel | Exact known page | Requests | Estimated provider cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Exa Search | 18/18 | 18/18 | 16/18 | 54 | $0.3780 |
| Luna-low hosted search | 14/18 | — | 11/18 | 40 searches | $0.4687 including model tokens |
| Exa paired repeat | 18/18 | 18/18 | 16/18 | 56 | $0.3920 |
| Combined discovery | 18/18 | — | 17/18 | — | — |

Exa recovered all four Luna origin misses and six of Luna's seven exact-page misses. Two retried Exa
requests completed successfully and are included in the paired cost. No Exa response, URL, title,
snippet, query, request ID, domain, or case-level result was retained.

## Domain-routing check

An additional in-memory-only repeat ranked candidate domains by cross-query recurrence, best result
rank, first appearance, and lexical order after excluding known discovery-only sources.

| Candidate-domain ceiling | Cases containing a known authority origin |
| ---: | ---: |
| 1 | 14/18 |
| 2 | 15/18 |
| 3 | 17/18 |
| 5 | 17/18 |
| 8 | 18/18 |

The shadow fallback therefore admits at most eight domains. This is a search restriction, not a
trust decision; Luna still has to find exact-work evidence and ordinary deterministic validation
still decides whether the second proposal may replace the first.

## Integrated fallback arm

The complete 18-work Luna-low run attempted Exa only twice. Both Exa locators completed all three
planned searches; one restricted Luna result safely replaced its first pass and the other remained
unresolved. Safe resolved first passes made no Exa request.

| Valid | Policy-safe | Resolved | Resolved accuracy | Series precision | Series recall | False series / standalone |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 18/18 | 18/18 | 17/18 | 100% | 100% | 100% | 0 / 0 |

The integrated arm used 20 model calls, 44 hosted web searches, 327,018 input tokens, and 10,295
output tokens. Its two Exa fallbacks used six requests and cost $0.0420. The restricted model calls
added 24,535 input tokens, 825 output tokens, and four hosted searches, for an estimated $0.0459;
the observed fallback channel therefore added about $0.0879 total, or $0.044 per attempted case.
The complete integrated run cost an estimated $0.5598 across OpenAI and Exa.

Membership scoring treats a leading article and a generic trailing form as naming drift, not a
different relationship. Canonical series-label fidelity remains reviewable. Separately, a
generic-only proposal such as `series`, `trilogy`, or `duology` is now policy-quarantined; it cannot
be accepted as a named bibliographic series or counted as a resolved result.

Across the five Exa passes used for the first run, paired score, domain-ceiling measurement,
integrated fallback, and cache/retention replay, this experiment made 178 Exa requests and consumed
an estimated $1.2460 of Exa credit. The replay reused all 18 model results, made zero model or hosted
search calls, reproduced the same 17/18 resolution and 100% resolved accuracy, and retained the
first-pass audit record without retaining Exa candidate domains. No call wrote authority gold,
Supabase, the resolver, or the Reverie corpus.

## Next gate

Freeze this implementation and evaluate it on a new development slice containing unresolved,
policy-conflicting, and misleading-series-label cases. Do not tune against the completed 18-work
set. If the fallback retains zero dangerous errors and materially improves resolution there, freeze
the production candidate before opening the locked qualification partition. Provider terms and
retention guarantees must be reviewed independently before any production use.
