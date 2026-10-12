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

Book details exposes **Push to corpus** to corpus administrators. The panel shows saved personal
values beside the shared values, with individual selections across edition details and shared
content guidance. Different known values start selected; Select all changes and Clear selection
operate on the visible choices. A single **Save selected changes** action saves the selected fields
together. Unknown or unchecked values preserve the opened shared values. An ISBN identifies the
edition destination and accompanies its selected details; it is not a free-floating work field.

Multiple private editions require choosing the exact source edition; only a valid equivalent ISBN
automatically matches an existing shared edition. With no ISBN, an administrator explicitly chooses
an existing ISBN-less edition or creates another. Retained attempt UUIDs prevent uncertain saves
from reusing one edition's identity for another. After an uncertain response, reload keeps the
selection and removes already-saved differences; it never automatically resubmits.

The default **Direct admin update** needs no evidence link, explanation, verification checkbox or
second review screen. Optional supporting evidence retains a real link and explanation. Both paths
keep administrator membership, valid data, ISBN ownership and stale-snapshot checks. Audit history
and provenance distinguish direct changes from evidence-backed changes; absent sources remain null.
Other ISBN correction and report-resolution workflows keep their existing evidence requirements.

`admin_push_corpus_record` accepts at most one edition and one guidance change in a single
transaction, using the same internal writer as the existing evidence-backed endpoint. It locks the
edition's ISBNs before the work, checks the opened fingerprint, and either saves all changes or none.
Only its own locked intermediate fingerprint can be used for the second action. Guidance carries
an explicit field selection: unchecked primary/secondary values remain byte-for-byte unchanged,
and only selected fields gain review protection. Earlier reviewed fields retain that protection
through later partial updates; legacy full reviews keep their existing protections. The private helper
is outside the Data API schema and has no API-role execution privileges.

Private notes, ratings, copy labels, locations, possession and reading history are excluded. The
update status reads persisted `works.updated_at`, never query refresh time. Account/book changes
close the draft. Successful saves refresh shared details and status. Database tests cover atomic
rollback, access, audit provenance and unchanged personal data; UI/browser tests cover independent
field selections, both categories in one save, optional evidence, conflicts and lost responses.
Final validation results are recorded in the feature PR.
