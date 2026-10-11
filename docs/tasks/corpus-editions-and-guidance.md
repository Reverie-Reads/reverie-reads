# Shared editions, ISBN corrections and content guidance

Owner request: ISBN flags and corrections must work, published versions must persist in the
corpus, shared genres and guidance must be consistent, and administrators must be able to
correct them. The owner chose **shared defaults with personal overrides** for spice and darkness.

## Model

A shared work is the title identity. `corpus_editions` stores published versions under that
work, including ISBN, edition title/statement, binding or format, publisher, language, pages,
and a publication date with its actual precision. A version can have no ISBN. An ISBN identifies
one edition; ISBN-10 and ISBN-13 equivalents canonicalize to the same assignment. Bibliographic
versions are separate from private `books.copy_inventory` editions/copies, condition, signatures,
locations, possession, notes and reading history.

Existing unambiguous, valid work ISBNs receive **unreviewed identifier records**, not guessed
edition facts. Subsequent work updates may seed only page/date facts already bound to that exact
ISBN and current value by provenance. A scalar work publisher or page count is never copied to
all its ISBNs. An administrator reviews one edition at a time with an evidence URL, explanation,
preview and explicit confirmation. Each save keeps an audit snapshot and advances its revision.
An incorrect assignment is removed with an exclusion against automatic reacquisition; the
edition and history remain. Reassigning an ISBN across works requires first reviewing/removing
the incorrect assignment, then adding it to the correct work. There is no automatic work merge.

This uses the work/edition distinction documented in [Hardcover's edition schema](https://github.com/hardcoverapp/hardcover-docs/blob/main/src/content/docs/api/GraphQL/Schemas/Editions.mdx)
and [edition standards](https://github.com/hardcoverapp/hardcover-docs/blob/main/src/content/docs/librarians/Standards/EditionStandards.mdx).
It does not adopt fabricated January 1 dates when only a year is known, add providers or copy
reader data into the corpus.

## Reader flow

- Add/Edit checks a supplied ISBN checksum. Unchanged invalid legacy data does not block an
  unrelated personal edit. A changed personal ISBN requires review of its page/date fields.
- The book screen exposes shared details and saved published editions on demand.
- A reader can submit an ISBN concern, optional replacement and explanation for administrator
  review. Reports persist and appear in the existing catalog metadata attention queue. They
  do not change an ISBN. Readers see only their own reports; administrators see the work's
  reports. Account deletion removes that reader's reports.
- Selecting a reviewed edition requires a preview. The server checks the edition revision,
  work identity, personal owner and original personal ISBN/page/date tuple. Only those selected
  personal edition fields change; unknown values are shown as clearing those fields. Configured
  copy inventories keep their existing explicit per-copy editor.

## Shared guidance and personal values

`works.shared_spice` and `shared_darkness` are nullable 0–5 administrator assessments.
Spice means sexual content; darkness means emotional intensity. Neither is a star rating or an
objective safety guarantee. Zero is assessed absence; null is unknown. No genre supplies a level.

Genres/subgenres and both levels have one reviewed shared record. Automatic metadata completion
cannot append provider genres over administrator-reviewed guidance. A reader's stored
`Book.intensity` (spice) and `Book.darkness` remain independent. `bookGuidance` applies the shared
value only where the personal value is null, including display, filtering and Next read ranking.
Edit keeps null values null until an explicit personal assessment; returning to shared guidance
is a deliberate action per axis. Personal backup/CSV/merge/intake paths keep personal values,
never the computed defaults. The library query supports a rolling deployment by falling back
only for missing new guidance columns, never for network or permission failures.

## Guardrails and rollout

Migration `20261105010000` adds the registry, reports, exclusions and audit, authenticated RPCs,
reference capture and guidance columns. Direct API table writes are revoked for every role;
authority comes from corpus administrator membership, never Pro or product preferences.
Admin writes lock the exact work and compare the reviewed fingerprint, which includes its
edition revisions and reports. A stale or uncertain submission keeps the draft and requires
reload; it is never automatically rebased or replayed.

The new migration follows series repair `20261104010000` and the combined public/private
migration namespace. Deploy through the private overlay after public review/merge and synchronization.
This changes write behavior: a human must perform the guarded production migration confirmation.
No production data or provider services were modified during implementation.

## Verification

- Core cases cover personal zero overrides, unknown defaults, library filters and ordering.
- Editor cases cover checksum rejection, explicit ISBN review, preserved null defaults and
  deliberate return to shared guidance. Mapper tests deny computed defaults in writes.
- Registry UI cases cover review-before-write, partial date precision, stale snapshots,
  uncertain-save protection and invalid input.
- pgTAP covers role permissions, source-bound edition fields, version persistence,
  reports/privacy, admin-only corrections, stale revisions, rejected ISBN reacquisition,
  shared guidance protection and personal selection boundaries.
- Run the migration under deliberately permissive legacy default table/function grants and
  assert each API role's SELECT/INSERT/UPDATE/DELETE denial.
- Focused real-browser save/reload flows and the required full browser gate remain pending
  until recorded in the delivery report. Local browser evidence is not physical-iPhone or
  production acceptance.

## Administrator push from book details

Book details exposes **Push to corpus** to corpus administrators. It uses saved personal
values in a frozen, explicit review of either a published edition or shared genres/content
guidance. Multiple private editions require choosing the exact source edition; only a valid,
equivalent ISBN automatically matches an existing shared edition. No ISBN means a new edition,
with a retained attempt UUID so a reviewed retry cannot duplicate an uncertain save.
Unknown fields preserve the existing shared values. Reading format is not an edition format.
Personal copy labels, locations, possession, reading history, notes and ratings are excluded.

The review shows current/proposed values, requires evidence and confirmation, and uses the
existing fingerprint-bound administrator writer. A failed or uncertain attempt retains its
draft and requires explicit reload and re-review. The visible update status reads the persisted
`works.updated_at` timestamp; it never substitutes the query refresh time. Successful writes
refresh both shared details and status. This UI addition needs no new migration beyond the
shared-edition registry prerequisite.
