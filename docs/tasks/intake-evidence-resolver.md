# Intake resolver and evidence model

Owner direction, October 16: build and test a shared resolver before changing Add, scanning, or
imports. Preserve personal data and leave unsupported facts in review.

## Delivered boundary

`resolveIntakeEvidence` in `packages/core/src/intakeResolver.ts` consumes a versioned, strictly
validated bibliography-only packet. It returns independent work, edition, acquisition, observation,
claim and field decisions, with a defensive snapshot of the original input. It performs no I/O.
The runnable consumer is `scripts/intake-resolver-replay.mjs`, exposed as `pnpm intake:replay`.
This is an offline review implementation, not a production cutover, catalog repair, or a new provider.

No output is a `Book`, `Incoming`, database patch, or save authorization. Existing Add, scan, import,
duplicate, backup, series and reading-history writers remain unchanged. No new schema is deployed.
The broader durable import-session/transactional-save design is a separate follow-on; this resolver
does not make the existing multi-step import safely replayable.

## Packet and decisions

The public types live in `intakeEvidence.ts`; the runtime allowlist is in
`intakeEvidenceValidation.ts`. An observation identifies its source record and HTTPS URL, retrieval
time, upstream lineage, source qualification, usage eligibility, extraction method, target
fingerprint and retrieval outcome. Claims retain their exact value, scope and source locator.

- A scanned ISBN is normalized with the existing checksum and ISBN-10 equivalence rules. It never
  defeats a contradictory title or creator. Equivalent ISBN-10/13 identifiers are allowed; competing
  identifiers on one edition are held. Work-search ISBN arrays cannot select an edition.
- Work identity and selected-edition identity are independent. Title/full-creator matching reuses
  the tested admission rules, including bounded formatting variants only with exact ISBN support.
  Initial-only identity anchors, arbitrary series suffixes and competing identities remain review.
- Credits keep source order, role and whole-work versus named-part scope. Editors, original-story
  creators and playwrights can establish work identity; narrators, foreword writers and individual
  anthology-story authors cannot independently establish whole-work identity. An initialed
  secondary credit does not negate a separate full creator. Initials are never expanded.
- The evidence roles are broader than the persisted personal contributor enum. There is deliberately
  no lossy adapter mapping all of them to `author`. Before writer integration, unsupported roles
  require a lossless persistence/review design. A listed set is not a certification that all credits
  have been discovered.
- Existing identity disagreement blocks gap filling. Existing values are never replaced, including
  conflicting contributor arrays. Conflicting descriptions do not compete on length. Dates remain
  complete precision-preserving tuples, never a union of independent axes.
- Edition fields require the selected exact edition. Format/language contradictions hold edition
  fields. Audiobooks cannot receive print page counts. ISBN-less editions remain unselected in this
  first version; they need an explicit reviewed edition locator before writer integration.
- Series requires an explicit relationship naming the same work and full creator. Search labels
  cannot create membership or standalone status. A proposed relationship still goes through the
  existing shared-series review controls; this resolver cannot publish it.
- Failed/capped retrieval is separate from successful emptiness. A supported peer can retain its
  proposals while the packet still reports incomplete acquisition. Stale (over 30 days), future-dated,
  differently fingerprinted, unverified and review-only observations remain available for review.
- Each fact requires its own support. One eligible author/publisher/independently reviewed catalog
  observation can support a proposal; bibliographic observations need two known independent origins.
  Mirrored records share a lineage. Unknown lineage is not independence. This is a conservative
  policy for proposals, not a statistically calibrated probability or majority-vote truth rule.
- `model_proposal` never supports identity or a field. `gpt-6-luna` can later supply research proposals
  after deterministic acquisition, but the model cannot grant itself source or retention authority.

**Trust boundary:** source kind, usage, method and lineage must come from trusted acquisition policy
or an actual reviewer. The resolver validates their shape and applies them; it does not fetch the
URL, authenticate an upstream publisher, or prove textual entailment. A URL alone is not evidence.
Do not expose this operator packet as a client-controlled catalog authorization API. A real write
must independently recheck the current target fingerprint, permissions, source qualifications and
review decision. The fingerprint is an externally supplied revision token, not generated truth.

Unsupported packet fields fail closed rather than silently dropping data or falling back to the
legacy merger. Personal notes, ratings, reading logs, owner identifiers, possession and copy
inventories are rejected by the allowlist. Callers must retain their original private draft outside
this bibliography-only packet when validation fails. Claim text and URLs still require responsible
input preparation; an allowlist is not an automatic free-text privacy scrubber.

## Reproducible verification

Run the sanitized development fixtures through the real command, choosing an unused output path:

```sh
pnpm intake:replay scripts/fixtures/intake-evidence.json /absolute/private/intake-replay.json
```

The command was exercised with a real private output path. It accepts bounded JSON (8 MiB, at most
500 cases), writes a create-only mode-0600 report and prints aggregate counts only. Source records
and case identities belong in the private report. Existing reports are never overwritten. Expected
answers are held outside the resolver input; any mismatch makes the command exit nonzero.

The fixture suite reconstructs all eleven prior formatting failure patterns: eight resolve and
three stay held (one omitted middle initial, two numbered-series suffixes). It also covers two
same-title/wrong-author identities and four distinct contributor problems. Names are synthetic.
The original ISBNdb responses were not retained; this is explicitly **not** a replay of those raw
responses or a fresh paid-provider comparison.

Six private cases were separately reconstructed from inspected public sources for The Lost Kings,
Twisted and the four contributor-credit holds. They are not a frozen unseen evaluation set and
must not be reported as a general accuracy percentage. Private bibliographic evidence and reports
remain outside the repository. No reader history or private annotations enter either fixture set.

Additional tests exercise malformed input, stale evidence, source failures, origin duplication,
model claims, exact ISBN contradictions, meaningful title qualifiers, edition/translation conflicts,
anthology-part credits, date precision, preservation, and the real CLI's create-only behavior.
An intentionally incorrect expected answer verifies that the replay actually reports a failure.

## Cutover sequence

1. Connect trusted adapters to this packet, retaining claim-level lineage and source-use rules.
   Establish explicit ISBN-less edition locators and lossless credit persistence before using either.
2. Run shadow decisions on a separately reviewed, frozen evaluation set, with no writes. Report
   wrong-book and wrong-edition decisions separately from supported gap filling and review burden.
3. Add a review handoff that binds selected facts to the exact draft and current target revision.
   Preserve manual values, protected series choices and the existing deliberate duplicate/copy flow.
4. Route Add and scanning through that handoff, then imports, with fresh browser tests for cancelled
   searches, account changes, late responses, lost saves and retries. Keep personal library and
   reading-history assertions at the actual writer boundary. Known-fixture success alone does not
   authorize silently switching the production paths.

The next slice is adapter/shadow integration. This implementation deliberately has no runtime
feature flag that could accidentally turn review evidence into writes.
