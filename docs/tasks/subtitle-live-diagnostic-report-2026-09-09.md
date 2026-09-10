# Fresh subtitle diagnostic: completed run

## Decision

Keep the current exact-identity gates and review-only page candidates. Do not implement automatic
subtitle repair or expand this sample to seek a positive diagnostic. All six Google identities
matched; no Google title mismatch or repeated-subtitle rejection was observed. Four of six editions
emitted page candidates, and all four agreed with the preregistered publisher reference. Two joint
packets were withheld for Open Library title mismatch. This small, subtitle-enriched development
sample does not estimate population frequency, establish safety or justify automatic filling.

## Frozen execution

- Registration committed before acquisition: `c1bc00308408b2ca7950d359f8b6b69ba7366329`.
- Unchanged merged #516 runtime: `abfe1b4ef8bef3291a69c8f3f586b621f3f49b1b`.
- Six editions of six works; six numeric publisher references; no current values.
- Canonical frame SHA-256: `e0ab1c66d1cf10dcf0485cfd9a2877ec5b4e5d29cc0a8fe4f85933179d2b5bea`.
- One run: 2026-09-10 02:23:35–02:23:55 UTC (September 9 locally); acquisition 20.444 seconds.
- Single-use marker retained; no retry, replay, replacement or response-driven reference edits.
- Zero overlap in eleven located exclusion frames and the four earlier diagnostic works.
  The older unlocated twelve-edition frame remains an explicit audit limitation.

See the [preregistered plan and publisher references](subtitle-live-diagnostic-plan-2026-09-09.md),
[dataset/system lock](subtitle-live-diagnostic-lock-2026-09-09.json), and
[aggregate machine report](subtitle-live-diagnostic-results-2026-09-09.json).

## Results

| Measure                               |      Google | Open Library |
| ------------------------------------- | ----------: | -----------: |
| Identity matched                      |           6 |            2 |
| Identity review                       |           0 |            2 |
| Not found                             |           0 |            2 |
| HTTP requests                         | 12 / 12 cap |  14 / 36 cap |
| Transport elapsed                     |     3.382 s |      6.238 s |
| Joint-packet page observations        |           4 |            1 |
| Observations agreeing with reference  |           4 |            1 |
| Observations differing from reference |           0 |            0 |

Packets: three single-provider candidates, one cross-provider agreement and two identity reviews.
Candidate yield is 4/6; candidate reference agreement is 4/4, with zero differing or unscored
candidates. Three candidates are Google-only; one uses both providers. Provider agreement does
not establish independent data lineage. Joint-packet observation totals are not raw provider
coverage: a review result in either provider suppresses observations from both, even when the
other identity matched. Do not map aggregate outcomes back to individual sample books.

Google recorded twelve successful responses. Open Library recorded eight successful responses,
four edition redirects and two not-found responses. Neither provider stopped; no authentication,
quota, timeout or network failure was reported. These are transport counts, not billing invoices.
No paid provider or application model was called, and billing was unchanged.

## Diagnostic interpretation

Google has six `none` reasons and six terminal `detail` stages. Its nested `googleTitleMismatch`
histogram is empty, reconciling to zero title-mismatch reasons and zero repeated-subtitle events.
The diagnostic remains supported by synthetic tests, but this live sample did not exercise its
positive branch. Zero observations do not show that the representation defect is absent elsewhere.

Open Library has two `title_mismatch` and four `none` reasons. `none` is absence of a diagnostic,
not proof of matching; two of those outcomes were not found. No subtype is inferred for Open
Library from the Google-only diagnostic. The report cannot tell whether an Open Library rejection
was a subtitle difference, another title variation or a genuinely wrong identity.

Packet formats are three unknown, two unavailable and one paperback. Candidate formats are three
unknown and one paperback. Publisher reference formats stayed out of acquisition; page agreement
is not binding certification or evidence that unknown formats can safely be filled. Marginal
histograms cannot identify the cause for a particular work or cross-tabulate reference format
against provider decisions.

## Next step

Stop live sampling for this subtitle hypothesis. Preserve the diagnostic without changing
admission. If pursuing further coverage, first use offline synthetic fixtures to distinguish
Open Library title/subtitle representation from genuine identity conflict, and decide whether an
additional bounded diagnostic would materially guide a decision. Do not loosen the joint gate
or admit a rejected record merely because Google matched. A different runtime hypothesis would
need its own tests and a fresh preregistration before any new provider acquisition.

There is no measured improvement over prior pilots: samples differ, this run has no paired
control, and all current values were blank. These findings do not measure correction quality,
series membership, reader matching, format accuracy or production readiness.

## Retention and verification

Public artifacts contain aggregate counters, hashes, timestamps and publisher-reference citations,
not case-level provider outputs, raw responses, provider URLs, titles, snippets or credentials.
The new private input, preflight and wrapper remain ignored and hash-locked. Prior study files,
locks and attempt markers were not changed. Automatic fills, production writes and model calls
are all zero. No app/core/Supabase runtime, production checkout, local database or deployment changed.

Verification passed: 403 trial tests, 2,708 core tests, 909 web tests and the compiler-backed
Workflow integration test; repository typecheck, lint, build, formatting and diff checks. Independent result checks passed
for arithmetic, diagnostic reconciliation, request caps, zero-write counters, retention, all frozen
file hashes, registration and the retained single-use marker. The local build emitted its expected
local-URL and bundle-size warnings; it is not production deployment verification. This branch
changes only committed documentation, so fresh browser E2E is explicitly exempt under AGENTS.md.
The owner-authorized #516 merge retains its disclosed local browser timeout and passing hosted
checks; this follow-up neither retries that run nor reclassifies it as passing.

The other active chat was notified of the exact four-document scope before PR creation. Its
private-overlay sync was given the verified #516 merge revision; this sample changes no shared
runtime paths and does not acquire the shared local database. No public PR was open at the
pre-creation conflict check.
