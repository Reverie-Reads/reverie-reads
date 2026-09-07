# Authority candidate adjudication

Date: 2026-09-06

## Decision

The no-write resolver may optionally consume a complete authority-acquisition report. This join is
deliberately asymmetric:

- a valid, policy-safe first-pass scout result becomes review evidence only;
- a first-pass standalone conclusion creates no negative series evidence;
- only a selected retrieval pass from a human-reviewed origin may become membership- or
  position-eligible;
- the selected output must exactly match the persisted retrieval interpretation, and every cited
  authority URL must occur in the selected hash-checked child manifest;
- all existing resolver cleaning and deterministic validation still apply;
- the join has no Supabase, corpus, or production write path.

Hardcover therefore remains a broad candidate source. The authority scout can explain and focus a
review, but its hosted-search result is not treated as independent corroboration. The later bounded
retrieval pass is the only first-party claim form that can cross the shadow automatic-evidence gate.

## Seven-case live join

The targeted report joined the seven prior Hardcover-driven false accepts to their independent
first-pass authority-acquisition results. Exact case IDs were used; no truth labels or authority
URLs entered either model packet.

| Measure | Result |
| --- | ---: |
| Cases | 7 |
| Structurally valid | 7/7 |
| Policy-safe automatic | 0/7 |
| Review | 6 |
| Abstain | 1 |
| Citation faithfulness | 100% |
| Unsupported fields | 0 |
| Policy violations | 0 |
| Unsafe promotions | 0 |
| False standalone | 0 |
| Fresh resolver input tokens | 12,733 |
| Fresh resolver output tokens | 1,387 |

This is the intended result: first-pass search improved the review packet without converting any
candidate into an automatic corpus proposal.

## Verification boundary

Synthetic tests prove that a matching policy-safe retrieval interpretation becomes eligible while
a mismatched persisted interpretation, a citation outside the selected child manifest, an
incomplete report, and a first-pass standalone conclusion all fail closed. The committed origin
registry activates no real origin, so the automatic retrieval path remains structurally tested but
has not yet been exercised against a live publisher or author site.

The next capability gate is a human rights/access review of one candidate first-party origin. Only
after that review should one origin profile be activated and a small exact-title retrieval sample
run. This report does not authorize that activation or any production integration.
