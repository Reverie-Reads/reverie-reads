# Standalone-risk representative replay

Date reviewed: 2026-09-06

This truth-blind replay sampled the first 10 unresolved titles from the complete 47-title Kiersten
Modglin standalone-label challenge frame. It tested whether the scout could independently locate
exact-work evidence that would overcome the frame's known catalog-family conflict.

## Result

The run made 10 model calls and 17 live searches, consuming 133,921 input tokens and 5,008 output
tokens. All 10 outputs were structurally valid and all cited URLs were grounded in the same-run
consulted-source manifest. The model proposed `standalone` for every title, but deterministic policy
correctly quarantined all 10:

- Policy-safe outputs: 0/10
- Standalone proposals eligible for human promotion: 0/10
- Series proposals eligible for human promotion: 0/10
- Gold records changed: 0

For each title, the scout found an older author-controlled book-list PDF that placed the work under
an explicit Standalones heading. Those PDFs belong to the same profiled catalog family as the
current selection frame. That family is not classification-eligible because it also labels *The
Nanny's Secret* standalone while the author's exact work page calls it a Locke Industries Series
installment. Exact author shop or book pages found in this replay established identity, but none of
them independently affirmed standalone status.

This is the intended defense against a plausible, repeated false positive: source ownership and an
explicit category label do not erase a demonstrated taxonomy contradiction.

## Spending decision

Do not run the remaining 36 unresolved titles from this homogeneous frame as another blind batch.
The representative slice already shows that the accessible classification evidence converges on
the quarantined catalog family. Reopen individual titles only when discovery finds an exact-work
author or publisher page with an affirmative relationship or standalone statement.

This stop rule avoids a projected additional 36 model calls while preserving the full candidate
frame for future evidence changes. It does not convert any unresolved title to standalone and does
not weaken the catalog-family quarantine.

## Gold-program status

- Selected development cases: 201/200
- Authority-reviewed development cases: 129
- Reviewed series-positive cases: 103
- Reviewed true standalone cases: 26
- Candidates awaiting authority review: 72

The next review work should seek a different, independently selected frame whose exact author or
publisher pages make title-specific affirmative standalone statements. The development gate still
needs 71 reviewed cases, including 24 true standalone controls.
