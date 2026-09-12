# Authority evidence to safe corrections

Status: implementation in progress, September 12, 2026. The owner approved working through four
steps. This does not waive source-use, qualification, production deployment, or owner-write gates.

## 1. Fix source interpretation

The trial scout now emits per-source relationship claims rather than hiding other source labels
inside a summary. Each claim preserves a name, type and explicit position. Validation rejects a
selected imprint, publisher collection, universe or reading list, a missing matching source claim,
an omitted competing bibliographic claim, or a contradictory explicit position. Unknown relationship
types cannot justify standalone. Several explicitly represented memberships remain review-only.

Publisher catalog naming is not inherently authoritative: scoped profiles block Random House 100
and Thousand Voices collections and the Conform author-page imprint conflict. The profiles apply
after source demotion too, preventing structural repair from reviving the rejected membership.
They are development-derived guards, not proof of general accuracy or permission to retrieve pages.
The general checks can detect only claims present in the returned packet. A model may still omit
or misinterpret page content; structured extraction is not independent verification, and an
unconsulted conflicting page cannot be detected by these checks.

The new scout and retrieval interpretation prompt/cache versions require structured source claims.
Legacy frozen proposals can be inspected without backfilling facts they never extracted, but do
not meet the new acquisition contract. No trial output can write the shared catalog.

## 2. Narrow correction contract

This defines the initial production lane; it is not an enabled writer. Reuse the existing shared
series classifier, suggestion/review queue and revision-checked database operations. Do not build
another store or administrator UI. The trial resolver's `accept_membership` and the scout's
`policySafe` are not production authorization.

An eventual automatic proposal must satisfy **all** of these conditions:

- Exact normalized full title and full contributor identity, bound to the current work; no fuzzy
  author repair, ISBN reassignment, edition merge, or reliance on model confidence alone.
- Direct exact-work bibliographic relationship from a separately eligible source. Consulted URL
  grounding proves consultation only. Exa remains an ephemeral locator, never evidence; provider
  mirrors cannot become independent votes, and Hardcover-only candidates retain existing review gates.
- Exactly one unambiguous primary membership, with no conflicting admitted source or current trusted
  claim. Imprints, marketing groupings, self-titled/singleton ambiguities and multiple memberships
  wait for review. Different source/catalog labels need an explicit reviewed alias, not a model rename.
- Only a missing, untrusted shared membership may be filled. A conflicting existing label—including
  an enrichment label—goes to the existing review queue. Trusted/reviewed shared choices are protected.
- Position is independently evidence-bound. Fill only a missing position when explicit positive
  integer order agrees; fractional, unknown, competing and user-chosen order remains untouched.
  Do not derive a total count from observed members, translations, box sets, or unnamed future books.
- No automatic standalone declaration, series removal, rename, merge, or clearing in the initial lane.
  Even affirmative standalone evidence goes through review until that separate action is qualified.
- Fresh identity/evidence fingerprints and review revision at apply time; fail closed on stale or
  changed input. Authentication, authorization, request limits and a kill switch are server-enforced.
- Existing default-only propagation may update eligible personal defaults, never reader/CSV choices,
  manual order, identity, possession, reading history, ratings, notes or cover choices.

The LLM proposes and explains; deterministic policy decides whether a proposal may reach the
guarded write path. Unknown, unavailable and ambiguous remain distinct reasons, not standalone.
Qualification must measure the actual emitted actions under this narrow contract, not just model
labels, before the lane can be enabled.

## 3. Evaluation and qualification

Offline replay of the consumed nine-work development pilot uses saved Luna proposals only. The
new scoped guards block both independently rejected proposals, preserve all four supported
proposals under legacy replay, and leave three unresolved cases unresolved. Current strict
validation admits **none of the six old resolved proposals** because they lack per-source claims.
No facts were retrofitted. This is regression evidence, not a fresh model run, general accuracy,
standalone safety or qualification. No API requests or additional spend occurred in this replay.
The original pilot files and single-use marker remain unchanged.

Next, freeze a separate development run against the new prompt after code review, recording its
identity frame, overlap exclusions, budget, hashes and one-use attempt state before acquisition.
Use independent review to check both emitted answers and abstentions. Do not replay the consumed
pilot under a new name or use development-reviewed failures as a qualification holdout.

The existing qualification requirement remains unchanged: at least 1,500 blindly reviewed pool
works, then the deterministic 1,000-work selection (600 series-positive and 400 affirmative
standalone), author/coverage caps, frozen system and committed lock, isolated cache, Luna low and
Exa fallback, $10 Exa ceiling. Require all cases, at least 299 emitted membership claims, zero false
memberships, zero false standalone claims, at least 85% series recall and 75% resolution, and no
operational errors. Preserve infrastructure-only resume and consumed-set rules.

Readiness check: the committed intake report records 1,180 unique IPPY candidates, all unreviewed;
it is not a reviewed gold set. No qualification-named pool/lock artifact was found in this worktree's
or the canonical local checkout's private-results directory. This limited check does not prove
that an artifact does not exist elsewhere. PRH intake is historical and remains inactive; no API
reactivation, provider contact, or new acquisition is authorized by a documentation reference.

The next qualification prerequisite is a private, blind-reviewed pool with reconciled complete
selection frames and source citations. Model predictions cannot provide its truth or review
attestation. See the existing qualification design and source-intake report for the exact process.

## 4. Integrate only after the gate

After qualification and source-use/privacy/retention/cost approval, connect a bounded server-side
acquisition adapter to the existing review pipeline first. Keep secrets server-side and private
notes out of offline/shared payloads. Verify authenticated and unauthorized paths, stale evidence,
duplicate submission, restart behavior, budget stops and all personal-copy protections against
the actual deployed functions and schema.

Only then introduce the qualified fill-only lane with an explicit rollout control. Public app
changes require a private-repository sync PR before owner deployment; migrations remain owner-run.
Merge/CI is not hosted verification. No production adapter, migration, deployment, catalog mutation
or automatic correction is included in this source-validation change. PR #521 stays draft and
ISBNdb stays retired.
