# Publisher edition comparison — October 18, 2026

This is a bounded, non-LLM shadow comparison of selected edition facts and contributor roles.
It does not qualify a source, update the corpus or switch Add, scanning or imports. Both consumed
frames and their permanent attempt markers remain intact. Private frames contain identities and
reference answers; public reporting contains aggregate results and reproducibility hashes only.

## Corrected adapter, new frozen comparison

Code commit `d044e22`, frozen at `2026-10-18T17:50:10.932Z`. Twelve cases use six previously
unseen ISBNs: six positive identities and six paired negative controls. Five are paperback editions
and one hardcover. Eight selected contributor references and twelve edition facts (pages and format)
were reviewed before acquisition. Negative controls include a translator, an introduction writer
and deliberately wrong creators. This is not a representative corpus sample or an ebook/audio test.

| Source               | Positive identities matched / 6 | Negative controls held / 6 | Unobserved cases / 12 | False identity matches | Edition facts agree / disagree / missing (12) |
| -------------------- | ------------------------------: | -------------------------: | --------------------: | ---------------------: | --------------------------------------------- |
| Penguin Random House |                               5 |                          5 |                     2 |                      0 | 10 / 0 / 2                                    |
| Open Library         |                               4 |                          5 |                     2 |                      0 | 7 / 1 / 4                                     |
| Hardcover            |                               2 |                          5 |                     2 |                      0 | 0 / 2 / 10                                    |

Each source's two unobserved cases represent one ISBN pair. Unobserved negatives are not credited
as successful rejections. Open Library also held one positive identity; Hardcover held three.
The six positive identities are the denominator even when a source returns no usable observation.
A match in this table means the identity guard passed, not that the source became trusted.

| Source               | Selected edition credits observed / 8 | Work scope only | Missing | Identity withheld |
| -------------------- | ------------------------------------: | --------------: | ------: | ----------------: |
| Penguin Random House |                                     6 |               0 |       0 |                 2 |
| Open Library         |                                     4 |               0 |       1 |                 3 |
| Hardcover            |                                     0 |               2 |       2 |                 4 |

PRH supplied the most usable edition evidence in this frame. Its remaining pair failed closed on
`duplicate_credits`: literal withheld credit evidence remains distinct, with unknown roles and
lossless-storage needs visible. The score cannot establish whether those repeated entries are
harmless duplicates or separate meanings; no automatic deduplication or role repair was attempted.
All PRH rosters remain explicitly incomplete/unverified. One recognized literal binding label also
retained an unmapped-code warning. No observed agreement removes that uncertainty.
The failed pair is the translator control, so this run did not independently demonstrate PRH's
translator safeguard. The introduction control was observed and held; translator rejection remains
supported by synthetic regressions rather than this live comparison.

Open Library's unavailable pair reported malformed edition identity. Its held positive identity
reported a contributor mismatch. Hardcover's held positives reported title and/or contributor
mismatch; its unavailable pair had no usable observation. These diagnostic scores do not establish
that the underlying books were wrong. The frame was not reacquired to investigate or tune matches.
Page disagreements remain review items, not corrections to existing values.

Transport made 17 Open Library requests (six approved edition redirects and eleven successful
responses), six successful Hardcover requests, and twelve successful PRH requests (six titles and
six title-scoped contributor lists). Paired controls reused the same acquired record. No source
was removed from the denominator. Reference answers never entered provider requests.

The independently prepared reference answers use public publisher pages; the PRH API and publisher
website share an origin and may share data. Their agreement is not independent upstream corroboration.
No roster completeness, source-use permission, lineage qualification or overall accuracy estimate
is established by this pilot. Publication date, language and publisher observations were not scored
against this frame's selected references. Raw provider responses were not retained in the report.

All twelve cases remain review-only: **zero resolved works, zero resolved editions, zero proposed
field writes, zero catalog/personal-data writes, zero model calls; cutover readiness false**.

Reproducibility hashes:

- Frame: `fd75ca8a1fdfbdd18ed26af7ec226ca65bcf60b23db99f70870b12aa43a1852e`
- System: `587c67f44fcf3e4d86d46621f235f269131c5359ca7e8976a19d6b469d48b225`
- Prior exclusions: `1139d4e7f8391a09718993e7159c59e75224e1668340838eb834b364f2d1c986`

The 124 exclusion entries include prior frames, every first-run target/reference identity and ISBN,
and three unused candidates exposed during reference discovery. A search initially returned
non-publisher metadata; all three candidates in that batch were excluded, and replacements used
publisher-domain searches. Parent review verified the six selected public edition pages before
freezing. This preserves the exposure history rather than treating the replacement set as pristine
by omission.

## Retained first-run failure

The earlier twelve-case/six-ISBN frame at commit `8ffeca7` had five positive identities and seven
negative controls. All six PRH title requests returned HTTP success, but the adapter expected the
wrong title envelope and stopped before fetching credits. All twelve PRH cases were unobserved;
this is a parsing failure, not evidence that the books or ISBNs were wrong. The receipt is consumed
and was never rerun. Its results must not be pooled with the corrected comparison.

| Source               | Positive matched / 5 | Negative held / 7 | Unobserved / 12 | Facts agree / disagree / missing (10) |
| -------------------- | -------------------: | ----------------: | --------------: | ------------------------------------- |
| Open Library         |                    4 |                 7 |               0 | 2 / 2 / 6                             |
| Hardcover            |                    3 |                 3 |               6 | 1 / 3 / 6                             |
| Penguin Random House |                    0 |                 0 |              12 | 0 / 0 / 10                            |

All sources had zero false identity matches; none produced a qualified resolution or write.
A separate three-request development probe on an already-known ISBN established the actual
`data.titles` wrapper and differing contributor-count semantics. Only response shape and exact-ISBN
booleans were inspected; raw values were not retained as a new corpus evidence store. The correction
added strict one-record/ISBN/error/link checks and retained contributor-count uncertainty. Independent
review also caught and fixed malformed ISBN arrays being accepted through string conversion.

First frame frozen at `2026-10-18T17:38:27.543Z`:

- Frame: `adad3056ee748cdc50c5d7a889f88443765f0f80eedb1d63ddd0f030458acc44`
- System: `4ce31852bb73b9c16a2c0b690dae96fdb2397106a2bfa43b5f7c9eedc877a829`
- Prior exclusions: `4d0d3a8d82b38533665bbdd480d4be45140d5258caacfd419eb7c8a2852bea06`

## Budget and release boundary

The shared-worktree durable ledger is initialized at **$20.73931475** conservative prior burden,
including retained uncertainty, with **$29.26068525** remaining under the **$50 total** ceiling.
This pass spent **$0 on Luna**. There are no new reservations or unsettled requests. Current verified
model pricing and token bounds are unset, so paid execution remains blocked. This reconciles local
workflow receipts; it is not an account-wide provider invoice audit.

The new runner requires completed non-LLM research, current identity/fingerprint-bound evidence and
permitted source excerpts. It durably reserves before a request and cannot automatically replay an
uncertain attempt. It interprets supplied evidence only and cannot write catalog or personal data.
See [the budget contract](intake-budget.md) and [publisher adapter contract](intake-publisher-adapter.md).

Validation is recorded in the final PR receipt. The corrected PRH regressions passed 42/42 and
independent review found no remaining blocking issue in the parsing path. Full browser verification
uses the unchanged intake application against an isolated, freshly reset local database. No
production database or private reader record was accessed or changed by this implementation.

Next work remains source-use/lineage qualification and a reviewed handling policy for duplicate or
ambiguous credits, followed by the existing explicit save handoff. Supported observations remain
review candidates; unsupported claims, edition conflicts and ambiguous identities are not promoted.
