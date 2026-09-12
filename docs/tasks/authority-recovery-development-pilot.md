# Authority recovery development pilot

Frozen before acquisition: 2026-09-12 UTC. Local, review-only development experiment;
not production integration, a new qualification run, or permission to write the catalog.

## Question and selection

Can the existing Luna-low authority scout turn the difficult remainder of recovery batch
25-A into useful, independently checkable review proposals? Does its existing opt-in Exa
fallback add useful evidence after an unresolved or policy-quarantined first pass?

The completed batch had four pending reviews and six deferred works. The normalized-title
history check found one exact title/author overlap with prior development (`Fall with Me`,
Becka Mack); exclude it, leaving nine fresh development targets. A local identity-only scan
covered 1,010 JSON artifacts across 19 available trial roots. No other target-title overlap
was found. This is an available-artifact check, not proof about deleted or unavailable archives.
The historical qualification intake remains separate and unsealed; this pilot cannot fill it.

The private input contains only opaque experiment IDs, exact stored title and full author.
Omit publication year because the stored year may identify an edition rather than the work.
Keep the stored `Lisettw Marshall` typo unchanged as an identity-error control. No catalog IDs,
personal data, candidate series labels, reference truth, or known authority URLs reach the scout.

## Frozen method

- Existing `gpt-5.6-luna`, low reasoning, medium search context, adaptive prompt v11.
- First pass: at most three hosted search calls. Existing structural-only repair may run once.
- Existing Exa fallback only after an unresolved or policy-quarantined first pass: three Search
  requests, at most eight domains in memory, then a separate Luna search with its own consulted
  source manifest. A safe first pass makes no Exa request. One structural repair per Luna pass.
- Nine targets, sequential execution; at most 36 model requests, 54 hosted search tools, and
  27 Exa requests. No automatic retries. Stop the whole experiment on a provider error, quota,
  authentication failure, timeout, or exhausted request allowance.
- No navigation retrieval, new providers, model/prompt tuning, or broad fallback escalation.
- Retain Luna proposals and their consulted-source manifests privately; no raw page text or
  Exa responses, queries, result titles, snippets, URLs, domains, request IDs, or case-level
  Exa output. Exa reporting is aggregate operations, errors, latency and cost only.
- A Git-common-directory exclusive attempt marker prevents replay from another worktree.
  An incomplete run is reported incomplete; it is not silently retried or replaced.

Local artifact directory: `/Users/gregchism/dev/reverie-authority-recovery-pilot.ueWj7w`.
It contains the one-use local orchestration, private input and complete runtime hashes;
the production and qualification runtimes are unchanged.

Private input normalized JSON SHA-256:
`d37ba37f1d20120496f9cfb36b5c22f0f3e65c60c5b88de3eac39842533ec0c5`.

Private lock file SHA-256:
`42d801ab665ea7f8c3d5ff2ef7521c46fe2389b4274de0de322c008a13dec695`.

Local orchestration SHA-256:
`35ed8226ae43f306cf86b3517b219fab02dec6e95c27a74c4d8c62fce6987e03`.

## Evaluation and boundaries

Freeze acquisition before checking cited author/publisher pages. Report first-pass and final
policy-safe proposal counts separately from independently supported conclusions. Identity,
membership, position and affirmative standalone status require separate checks. Policy-safe
does not mean correct; no label is not proof of standalone. Preserve contradictions and the
author typo for review, and do not turn reading independence into bibliographic independence.

Record actual request/token counts. Any cost calculated with the September 7 report rates is
a historical-rate estimate, not current billing confirmation. This nine-work, selected difficult
slice cannot establish general accuracy, human time savings, qualification or production readiness.
No Supabase writes, migrations, deployments, billing changes or qualification-state changes.

Only this methodology/results document is a tracked change. The docs-only branch is exempt
from the full application e2e gate; the existing trial tests are run as a regression check.

## Completed run and independent audit

Acquisition: 2026-09-12 05:19:55.990–05:22:35.308 UTC, all nine targets completed in
159.318 seconds. No provider errors or retries. Frozen methodology commit: `24cd691`.

| Measure                                          | Luna first pass | Luna plus conditional Exa |
| ------------------------------------------------ | --------------: | ------------------------: |
| Validator-safe resolved proposals                |             5/9 |                       6/9 |
| Independently supported proposals as emitted     |               4 |                         4 |
| Emitted proposals requiring rejection/correction |               1 |                         2 |
| Model abstentions                                |               4 |                         3 |

This is a selected development slice, not general accuracy or qualification. No standalone
claim was emitted. Abstentions have not all been independently assigned reference truth.
The four supported proposals still require explicit administrator review of identity, naming,
order and current state; they are not automatically approved catalog updates.

The two rejected/corrected proposals expose distinct source-cleaning gaps:

1. A real publisher anniversary collection was accepted as a reader-series relationship.
   The [publisher's reissue description](https://www.penguinrandomhouseretail.com/book/?isbn=9798217460106)
   and cross-author roster establish the edition-collection context. A publisher URL containing
   `/series/` does not establish the relationship type Reverie needs.
2. An author page's series field reproduced a publishing label despite conflicting primary
   evidence already present in the packet. [PRH's announcement](https://global.penguinrandomhouse.com/announcements/introducing-thousand-voices-x-rhpg-a-new-publishing-venture-from-the-random-house-publishing-group-jenna-bush-hagers-thousand-voices-media/)
   explains the label's publishing role. Source authenticity and accurate quotation do not make
   the source's field interpretation correct. Conflicting first-party labels must remain visible.

The independent audit did not change the frozen proposals or rerun the model. The private
`REVIEW-HANDOFF.md` links original sources and distinguishes four supported proposals, two
rejections/corrections, and three unresolved cases. One rejected proposal has a separately
supported manual correction, which is not counted as model success. No catalog save occurred.

Actual usage: 13 model requests, 36 hosted web-search tools, 193,547 input tokens and 6,566
output tokens. Four fallback attempts made 12 Exa requests with zero errors; one selected
fallback added a validator-safe proposal but **no correct additional reader-series resolution**.
Exa contributed 18.993 seconds of aggregate locator latency. No Exa result content was persisted.

Using the September 7 report's historical rates ($0.20/M input, $1.20/M output, $0.01/hosted
search, $0.007/Exa request), acquisition cost is approximately **$0.4906**: $0.4066 OpenAI and
$0.0840 Exa. This is not current billing confirmation and excludes this Codex source-review
session. Reviewer time was not measured; there is no demonstrated human-time-savings claim.

Checks: existing trial suite **403 passed**; frozen input/runtime preflight passed; explicit
duplicate execution refused by the Git-common-directory marker before any provider request.
The lock remains unchanged and the attempt is consumed. Do not replay the live run.

## Next decision

Retain the existing Luna-low scout as a review-preparation tool; keep Exa conditional, not a
blanket second pass. Do not promote this protocol to automatic classification. The smallest
useful next implementation is trial-only protection against publisher/edition collections and
conflicting first-party labels, tested offline on retained development evidence before any
new independent live slice. Do not solve this by rejecting every publisher catalog or by
trusting author fields unconditionally. Identity errors stay explicit review tasks.

Reuse the existing human review controls rather than building a new database, API or queue.
Any later in-app acquisition still needs the existing privacy, retention, budget, authorization
and stale-evidence gates. This experiment changed no production or qualification runtime.
