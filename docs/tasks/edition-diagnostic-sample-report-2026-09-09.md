# Edition-page diagnostics: completed fresh sample

## Decision

Keep Google volume-detail plus exact-edition Open Library as a **review-only trial approach**.
Do not enable automatic page filling or relax identity gates. Four of ten editions emitted a
candidate; all four agreed exactly with the preregistered publisher page reference. The remaining
six were withheld: four identity-review packets and two page-count conflicts. All four candidates
lacked provider/current format evidence. The sample is too small and purposive for a population
accuracy claim, and publisher agreement is not physical-copy or format certification.

## Frozen execution

- Plan and lock committed before acquisition: `8e0e59a81a981ce5fa49014fc7ab68a01d8c3b97`.
- Unchanged merged #511 runtime: `ad9665487a1902232bc9f11149f98bf99f97fcb8`.
- Ten editions, eight works, ten numeric publisher references, no current values.
- Canonical frame SHA-256: `7547467d69bebf51fff6c4cf89738b1f804dd42019aa783037a846adcb88b484`.
- One run: 2026-09-10 00:57:26–00:57:58 UTC (September 9 locally); acquisition 32.480 seconds.
- Single-use marker retained. No retry, replacement, replay, or response-driven frame change.
- Zero overlap with the ten located exclusion frames and the earlier four diagnostic works;
  the unlocated older twelve-edition frame remains an explicit historical-audit limitation.

See the adjacent [preregistered plan](edition-diagnostic-sample-plan-2026-09-09.md),
[system/dataset lock](edition-diagnostic-sample-lock-2026-09-09.json), and
[aggregate machine report](edition-diagnostic-sample-results-2026-09-09.json).

## Results

| Measure                               |      Google | Open Library |
| ------------------------------------- | ----------: | -----------: |
| Provider identity matched             |           8 |            5 |
| Identity review                       |           2 |            3 |
| Not found                             |           0 |            2 |
| HTTP requests                         | 19 / 20 cap |  24 / 60 cap |
| Transport elapsed                     |     4.838 s |      8.211 s |
| Joint-packet page observations        |           6 |            3 |
| Observations agreeing with reference  |           4 |            2 |
| Observations differing from reference |           2 |            1 |

Packet states: three single-provider candidates, one cross-provider agreement, two conflicts,
four identity reviews. Candidate yield is 4/10 (40%); reference agreement among candidates is 4/4,
with zero differing or unscored candidates. The three single-provider candidates were Google-only;
the remaining candidate used both providers. Shared agreement does not prove independent lineage.

Observation counts are not raw independent provider coverage: the joint gate suppresses both
observations when either provider needs identity review or is unavailable. The conflicting packets
can still contribute observation scores, so observation disagreement is not candidate disagreement.

Google transport recorded nineteen successful responses. Open Library recorded eight edition
redirects, fourteen successful responses and two not-found responses. Neither provider stopped;
no authentication, quota, timeout or network error was reported. These are request/transport counts,
not monetary invoices. No paid provider or application model was called; billing was unchanged.

## What the new diagnostics establish

Google: two `title_mismatch` reasons, eight `none`; nine terminal `detail` stages and one `search`.
Open Library: two `title_mismatch`, one `missing_contributors`, seven `none`. `none` is absence of a
diagnostic reason, not proof of matching: it also covers not-found responses.

The six nonblocked packets had unknown format; four blocked packets had unavailable format.
All four candidate formats were unknown. Google volume details do not establish binding here, and
the publisher reference binding was correctly kept out of the acquisition packet.

These are marginal counts, not per-case traces. They do not identify which title was rejected,
whether a mismatch was a subtitle discrepancy or a different work, or which provider observation
was responsible for a given reference disagreement. The terminal stage describes the returning
branch, not a general guarantee that a request was sent. This report does not reconstruct or
retain case-level provider data.

## Next bounded step

Use synthetic fixtures to examine full-title/subtitle representation and missing-contributor
handling, while preserving exact ISBN, contributor and edition checks. A title mismatch is a
review reason, not permission to strip subtitles or use fuzzy matching. Treat page extent and
edition format as separate claims; do not infer a binding from page agreement or an ISBN alone.

Before another live sample, decide whether improved diagnostics can distinguish harmless title
representation from identity conflict without retaining provider text. Preregister any changed
system and fresh identities before acquisition. This consumed sample is development evidence,
not a reusable holdout. There is no measured improvement versus the prior sixteen-edition pilot:
case composition differs, and this run did not score a paired Google-search baseline.

## Retention and verification

Public artifacts contain aggregate counters, hashes, bounded metadata and publisher-reference
citations only. New private input and one-time wrapper are ignored and hash-locked; historical
frames and markers were not changed. No provider responses, case-level results, keys or request
URLs were persisted. Automatic fills, production writes and application model calls are all zero.
No app/core/Supabase runtime, production checkout, deployment, billing or local database changed.

Verification passed: all 397 trial tests, 2,706 core tests, 909 web tests and the compiler-backed
Workflow integration test; repository typecheck, lint, build, formatting and diff checks. Aggregate
arithmetic, candidate/diagnostic reconciliation, request caps and zero-write counters were checked
separately against the saved result. The local build emitted its expected committed local-URL and
bundle-size warnings; it was not a production build/deployment verification. This branch changes
only committed documentation; fresh browser E2E is explicitly exempt under AGENTS.md.

The other active chat confirmed no overlap before PR creation. Its covers-efficiency PR #513
touches different paths; this follow-up does not consume the shared local database.
