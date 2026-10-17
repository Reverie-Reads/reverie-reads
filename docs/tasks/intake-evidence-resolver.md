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
  Additional comparison-only guards retain contributor word boundaries and non-Latin vowel signs.
  They do not change persisted work keys or duplicate verdicts. Cross-source comparisons check both
  directions so a shared coauthor cannot hide competing creator sets.
- Credits keep source order, role and whole-work versus named-part scope. Original-story
  creators and playwrights can establish work identity; narrators, foreword writers and individual
  anthology-story authors cannot independently establish whole-work identity. Editors cannot stand
  in for creators in the roleless intake target, even when credited for the whole work. Editor-only
  collections stay held, including ISBN-only scans, pending an explicit role-aware identity handoff.
  A separate author credit for the same person remains usable; the editor credit is never converted
  or discarded. This creator boundary also applies to cross-source identity, existing values and
  series membership. An initialed secondary credit does not negate a separate full creator. Initials are never expanded.
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
The formatting fixtures deliberately supply a qualified synthetic publisher observation to isolate
matching behavior. This does not promote a lone ISBNdb result: a bibliographic observation still
needs independent support, and review-only usage remains held regardless of text agreement.
The original ISBNdb responses were not retained; this is explicitly **not** a replay of those raw
responses or a fresh paid-provider comparison.

Six private cases were separately reconstructed from inspected public sources for the two mixed
identities and four contributor-credit holds. They are not a frozen unseen evaluation set and
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

The exact-ISBN adapter/shadow slice is implemented below. There is no runtime feature flag that
could accidentally turn review evidence into writes.

## Trusted adapters and independent shadow pilot

`scripts/intake-source-client.mjs` calls the existing Open Library and Hardcover sources, using
the same exact-edition query constraints, Open Library identity header, ISBN-10 equivalence and
single-hop edition redirect validation as the existing code. It runs serially, at least 1.1 seconds
between requests per source, with 15-second timeouts, 512 KiB bodies, no retries, and a maximum of
80 Open Library / 20 Hardcover requests. Authentication/rate-limit refusals stop that source;
two consecutive infrastructure failures stop it as well. An ISBN is acquired once per run, including
failure. Author lookups are key-bound and bounded. No title search or sibling-edition fallback runs
after a miss, error or conflict. The operator must coordinate this small run with other provider
traffic; its in-process pace is not the deployed cross-process source budget.

`intakeSourceAdapters.ts` accepts provider-specific shapes, not a caller-supplied source policy.
It constructs source URLs/record IDs, fixes the extraction method, and always assigns bibliographic,
review-only qualification with unknown upstream lineage. Neither a response's `verified` label,
publisher string nor agreement between two APIs grants authority. Hardcover's missing/unknown
contribution labels stay `unknown`; translator, editor, narrator and other explicit roles survive.
Open Library's author relation is recorded as an observation, not a guarantee of complete credits.
Compilations, incomplete authors, competing editions, capped responses and parent-title conflicts
remain unresolved. Credits are edition-scoped; parent-work credits do not certify edition completeness.

Only objective identity/credit, pages, publication, publisher, format and language observations enter
memory. Descriptions, covers and series labels are not harvested by this restricted pilot. Unknown
binding/date representations are diagnostic gaps, not guessed values. ISBN-less intake and work
search adapters still need separate implementation/evaluation before a general intake cutover.

Run from the repository root, using private paths outside Git:

```sh
pnpm intake:shadow freeze /private/frame.json /private/lock.json /private/prior-replay.json
INTAKE_ENV_FILE=/private/existing-provider.env pnpm intake:shadow run /private/frame.json /private/lock.json /private/report.json
```

The environment file is optional; only `HARDCOVER_TOKEN` is passed to the source client. Missing
credentials are reported as unavailable, never successful emptiness. There is no LLM or ISBNdb path,
no database client, and no writer. This pilot uses the already configured provider account; it does
not purchase usage or change source subscriptions.

Freeze validates at most 20 strictly allowlisted cases, compares identity/ISBN overlap with the prior
private replay and sanitized development scenarios, and binds the frame, prior-replay and system
hashes. This is a guard against accidental reuse, not a guarantee that an operator supplied a complete
history. The system hash includes imported core, edge and trial helpers plus the dependency lock.
Run refuses changed inputs/code and creates a permanent exclusive attempt marker in the shared Git
common directory before any request. A different output path, worktree or system hash cannot replay
the same frame. Do not delete markers or create a new clone to evade this rule. An interrupted run
remains consumed; automatic resume is deliberately absent.

The resolver sees only the target and acquired observations. Reference URLs, expected decisions and
edition facts are supplied to scoring afterwards. Scan-only outcomes are checked against the separate
reference identity, not just the query ISBN. Reports distinguish candidate identity matching from
source-qualified work resolution; missing/failed candidates do not count as correctly rejected books.
Pages and format agreement have explicit missing/disagreement counts. A matching page count does not
prove every edition fact, and matching identity does not certify role completeness. The pilot does
not measure description or complete-contributor accuracy.

Private reports retain case IDs, decisions, diagnostic codes and scores only. Provider payloads,
names, titles, credit arrays and field values are transient; neither provider facts nor the human/agent
reference frame are added to the public corpus. Reports are mode 0600 and create-only reservations;
the runner finishes only its own reserved report. The JSON frame is local operator input, not a new
client API or privacy scrubber. Personal fields are rejected before networking.

The October 16 pilot uses a new publisher-referenced, purposive set: eight editions across six works,
four wrong-author controls and two scan-only probes (14 cases). References were inspected separately
from provider output and exclude all prior intake replay cases. It is independent of that development
set, but is agent-reviewed, small, and not an independent human review or population qualification.
The older 1,000-case series qualification partition and consumed study frames are untouched. Results
and the non-secret frozen lock are recorded separately. Do not tune against a completed pilot and
relabel it as unseen evidence; a later tuning pass needs a new holdout.

## Evidence review and contributor fidelity

`buildIntakeReview` supplies a defensive, in-memory operator view of requested identity, current
values, observed identity, per-axis checks, source attribution, original credits and claim decisions.
It does not convert a review packet into an `Incoming`, `Book`, update or approval. The existing
matching rules remain in force; diagnostic title/name formatting labels do not weaken admission.
Initial-only names, wrong creators and exact-ISBN contradictions remain held.

Credits now preserve the source's literal role and its work/edition basis. Open Library's documented
`authors` relationship remains an author observation; its free-text `contributions` statements are
kept unparsed in memory, never split into guessed names/roles. Hardcover's explicit roles retain the
original label; whitespace/case normalization does not assign missing labels to authorship. Its
parent-work credits have `basis: work`. Even an otherwise eligible source cannot promote those as
edition contributor facts (`credit_scope_unverified`). Unsupported roles and named-part credits
are flagged for lossless storage; this slice does not migrate the personal contributor enum or write
credit arrays. Complete-roster status remains unverified. Original credit order and multiple roles
for one person survive the review view.

```sh
INTAKE_ENV_FILE=/private/existing-provider.env pnpm intake:shadow run-review /private/frame.json /private/lock.json /private/report.json
```

This consumes the same single-use attempt as `run`. After acquisition and report completion, it opens
a five-minute server bound only to `127.0.0.1` with a random capability path. The operator receives
the local URL, not provider content on stdout. The view is read-only, escaped, script-free, has no
external assets or write endpoints, rejects foreign Host/Origin headers and sends no-store headers.
The server releases its HTML at expiry; the operator must close the tab to discard the browser's
already displayed document. It is a local operator view, not authenticated multi-user administration
or a production review queue. It does not grant new source-retention rights.

Saved reports now add title/name/ISBN diagnostic codes and contributor counts, without provider
names, field values, URLs, record IDs or raw role strings. Optional publisher-reference `credits`
are validated and scored only after acquisition; neither gold nor URLs enter the resolver or view.
Scores distinguish edition-observed names/roles from work-scope-only agreement, unknown roles,
role/part disagreement, missing credits and identity-withheld credits. The denominator is the selected
reference subset, never all true contributors; extra provider credits are not certified by omission.
The comparison also retains source-use holds independently of identity agreement.

The new frozen comparison excludes the earlier six inspected development cases, synthetic fixtures
and both target/reference identities from the first shadow frame. The private prior-exclusion
manifest is hash-bound by the lock. Frame validation guards the supplied history; it cannot prove an
operator supplied every past exposure. The first pilot remains consumed and is not reacquired.

Provider contracts checked for this slice: [Open Library edition schema](https://openlibrary.org/type/edition)
and [API usage guidance](https://openlibrary.org/developers/api). No new inference was made from
unavailable Hardcover documentation; unknown labels remain unknown and its existing bounded query
is unchanged. No LLM, ISBNdb, production reads or writes are part of this comparison.

## Manually verified edition credits and save handoff

The administrator's saved-edition editor now offers a separate contributor review when the additive
edition-credit migration is present. The operator inspects the author/publisher edition listing,
enters literal bibliography and credits, and confirms both inspection and permitted retention.
This is an authenticated human-review handoff, not an automatic source-verification service or a
new provider scraper. The existing Open Library/Hardcover source-use and lineage holds remain.

Prepare freezes a bibliography-only document and a caller-generated retry UUID against the current
work fingerprint and selected edition. It does not change catalog facts. The server returns separate
eligibility reasons for every credit. Nothing is preselected. The administrator chooses supported
credits and explicitly confirms that exact selection. Save rechecks authority, fingerprint, exact
ISBN assignment, catalog creator consistency, title/full creators, format/language conflicts,
inspection freshness and roles/scope. No surname/initial/alias inference is added. An edition whose
own title differs from the work title remains conservatively held in this slice.

Accepted credits append to `corpus_editions.credits`, preserving original order, names, role labels,
multiple roles for one person, named parts, evidence and source position. Unknown roles, absent
labels, parent-work scope, ambiguous names and conflicts remain in the frozen review document.
A partial selection closes that receipt; later decisions require a new source review and current
fingerprint. There is no destructive replace/delete action. Accepted- and pending-credit history
are separate from personal contributors. All personal records and reading history remain untouched.

Retries preserve the exact review UUID/payload and then exact selected indices. The server's
identical retry is read-only, including after catalog revision changes; different payloads conflict.
A failed or uncertain response offers explicit retry/history inspection, never an automatic rebase.
Account/work changes discard callbacks. Existing servers without the credits field do not expose
this control. Production migration remains owner-run; this branch does not deploy it.

The new frozen comparison also includes a separately labelled manual-source policy arm. Its source
facts are manually transcribed from inspected publisher listings; it validates admission and holds,
not automatic extraction accuracy or independent human verification. Reference answers do not enter
provider acquisition, resolver decisions or the review viewer. Reports retain only decision codes
and counts. The system hash now includes the catalog UI/data code and migrations as well as the
resolver/adapters. Any policy change after freezing requires a new unseen comparison.

Later work title/creator changes or edition ISBN/title/statement/format/language changes retain
accepted credits but flag them for renewed review. Source identity remains visible. Removing an
ISBN from the work also withdraws its credit qualification. Returning old values never revives
credits automatically; a fresh review may append current support while preserving historical
entries. Personal fields remain untouched.
