# Catalog metadata review

The shared catalog now has a cover workspace. Its next quality problem is bibliographic: a missing
description weakens Discover, while an incorrect ISBN or a duplicate identity can make an apparently
polished book misleading. This workspace makes those cases reviewable without automatically
reassigning a reader's books.

## First delivery

`/catalog/metadata` is available to corpus administrators from Settings, Administrator review, and
Catalog covers. The two workspaces share navigation. Search is literal title/author text or exact
ISBN, including valid ISBN-10/13 equivalents. Queues show at most 20 works per page with deterministic
ordering: shared ISBN concerns, exact normalized title/full-author matches, invalid ISBNs, then
missing descriptions. Each concern has a filter; deferred and assessed records remain searchable.

The comparison shows up to ten related shared records, their ISBNs, description, publication year,
publisher, and language, plus the total related count. The evidence is deliberately conservative:
exact normalized title and complete recorded author text, or a checksum-valid equivalent ISBN.
Fuzzy titles, missing authors, and an absent ISBN do not establish a duplicate. These checks are not
a catalog-wide semantic deduplication system.

An administrator can:

- Correct a description after checking identity and recording an HTTPS evidence link and assessment
  note. Use text they have permission to share or a short summary in their own words.
- Record an assessment, set a work aside, or reopen it. An assessment records the reviewer’s finding;
  it does not mean all concerns have been repaired.
- Revisit recent decisions and the source link. Description changes also enter the existing shared
  metadata edit audit.

Saving a description does not close identity concerns. It is a narrow new action because the existing
shared-details editor also declares manual series intent. The new action never changes title,
contributors, ISBNs, series, possession, household membership, personal notes, or reading history.
An unsaved description must be saved or explicitly discarded before another review decision.
Background refetches retain the opened draft and its original version; stale writes fail visibly
and offer an explicit reload.

## Data and review boundary

`20260928010000_catalog_metadata_review.sql` adds administrator-only review state/history, indexed
normalized identity/ISBN lookups, the bounded queue RPC, and the description/assessment RPC. There is
no backfill or production repair. New tables reset platform ACLs explicitly before grants. Ordinary
readers cannot call administrator actions or read assessment notes. Review rows never enter a reader
backup or offline cache. Account deletion can anonymize attribution without deleting catalog history.

A work-and-evidence fingerprint plus review revision prevents stale decisions. Relevant changes to
related records reopen an older assessment too. Description/source audit records remain separate from
administrator assessment notes. The normalization helper is pure and executable by the
service role because expression indexes need it during authorized maintenance writes. Authenticated
corrections run inside the administrator RPC; readers do not call the helper directly.

## Verification and release

Regression coverage includes ISBN equivalence and checksum failures, duplicate candidates, pagination,
permission removal, dirty legacy grants, source validation, concurrent review versions, changed peer
evidence, description persistence, unchanged personal rows, and preserved audit history. Browser
journeys cover correction/reload/deferral, stale draft recovery, ordinary-reader denial, and all nine
skins in both modes on a phone. Run the full repository gate and a fresh-database, no-retry browser
suite before the PR handoff; record actual results in the PR.

Land this feature in the public repository first. Then synchronize it through the private overlay,
run that repository's checks, and have the owner apply the migration using the deployment guard before
promoting the web release. No Edge Function change is needed. The first production mutation is an
owner-operated description correction and reload, with a personal copy checked for continuity.

## Next boundary

An ISBN conflict or duplicate assessment still needs a separately reviewed identity-repair operation.
Do not merge shared works from a title match. That operation must explicitly select the surviving
identity and reconcile personal bindings, household memberships, series entries, covers, provider
identifiers, and audit references without changing personal ownership or reading data. The evidence
collected here supplies concrete cases for that design.
