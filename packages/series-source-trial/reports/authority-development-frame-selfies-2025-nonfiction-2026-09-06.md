# 2025 Selfies general non-fiction development frame

Date reviewed: 2026-09-06

This development frame includes all six titles on the official 2025 Selfies Book Awards general
non-fiction shortlist. The award page supplies complete, reproducible independent-publishing
sampling provenance; it is not series or standalone truth.

## Truth-blind scout and human review

The initial six-case scout made six model calls and 12 live searches, using 98,498 input tokens and
3,048 output tokens. Five outputs were valid and policy-safe. It proposed no series or standalone
classifications: five cases were unresolved and one structurally inconsistent result was
quarantined.

Human review promoted only `The Little Book of Confusables 2`. Sarah Townsend's launch post
directly compares Confusables 1 with Confusables 2, while her author site repeatedly presents The
Little Book of Confusables 1 + 2 together. This establishes primary membership in The Little Book
of Confusables and publication position two. The title's numeral alone was not used as evidence.

The other five books remain candidates. Their first-party pages establish identity or describe
their contents, but do not affirm either a named bibliographic relationship or standalone status.
Silence remains unknown.

## Tool corrections exposed by the frame

The first reviewed replay revealed two independent defects:

- the scout recognized the numbered sequence in prose but returned `classification: series` with
  an empty membership array;
- the deterministic policy blocked every sampling URL on the case, including author pages, rather
  than only the selection-frame source.

The prompt now names the narrow numbered-sequence rule: a first-party source must directly compare
the exact target with the correspondingly named first work. Lone numerals, edition numbers, and
generic volume labels remain insufficient. A single no-tools repair call is allowed only for the
observed series-without-membership structural error; it may reorganize facts already present in the
proposal or fall back to unresolved, but cannot search or introduce a new fact or URL.

Selection blocking now derives from `authority-sample-plan.json` and covers only the actual frame
source. A known author or publisher URL remains hidden from the model, but if live search
independently rediscovers it, the page can support classification. Known conflicting source
profiles and all ordinary evidence checks still apply.

Token accounting also now excludes cache hits from run consumption. Cached evidence retains its
original usage metadata, but a zero-call replay reports zero new tokens.

## Final verification

The corrected six-case run used five new calls plus one cache hit and 11 live searches. The five
new calls consumed 79,153 input and 2,374 output tokens. Including the cached successful
Confusables call, the evaluated evidence footprint was 98,561 input and 3,085 output tokens.

- Valid outputs: 6/6
- Policy-safe outputs: 6/6
- Grounded cited URLs: 100%
- Reviewed resolution: 1/1
- Reviewed accuracy: 1/1
- Series precision and recall on reviewed truth: 100%
- Candidate queue: five unresolved; no standalone, series, or quarantined proposals
- Cached replay: zero model calls and zero newly consumed tokens

Across the exploratory runs, including the malformed-output and repair experiments, this frame
used 228,624 input and 7,891 output tokens. Those experiments are development cost, not the cost of
the final cached replay.

## Gold-program impact

- Selected development cases: 201/200
- Authority-reviewed development cases: 129
- Reviewed series-positive cases: 103
- Reviewed true standalone cases: 26
- Candidates awaiting authority review: 72

The selection target is now complete. Seventy-one additional reviews are still needed, including
24 affirmative standalone controls. The remaining work should prioritize resolvable negatives and
the thin sampling strata rather than adding more selected cases indiscriminately.
