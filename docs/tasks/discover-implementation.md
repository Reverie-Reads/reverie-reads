# Discover: implementation and release notes

The approved study is now implemented in `/discover` on `codex/discover-reading-decision`,
PR #444. Readers choose a loved book, one or two moods, or a genre; inspect a small shortlist;
and decide whether to add a book. The wider paginated catalog remains available through
“Browse the whole catalog,” including existing genre deep links.

## Product behavior

- Starting books come from explicit favourites or personal ratings of at least four, or a reader's
  own catalog search. Ownership alone does not imply a favourite.
- Search combines shared works and the existing wider search service. Catalog work identity wins
  over duplicate external editions; ambiguous personal copies are never guessed.
- Guided discovery returns at most five books from a bounded candidate pool. Owned/borrowed
  titles and the starting book are suppressed. Unowned wishlist titles remain eligible and labelled.
- Reasons name actual author/genre relationships or mood-search words in descriptions/tags. Both
  selected moods require evidence. These words are retrieval evidence, not editorial mood labels
  and not a guarantee of tone. No private `book_moods` rows are written.
- Book details reuse exact identity checks, plain-text descriptions, retry states, and the existing
  full-quality cover renderer. Missing shared records cannot silently become another work.
- Details use route history; Back/Escape return to the same shortlist. Add uses the established
  review form and an allowlisted shortlist UUID return parameter. Possession remains an explicit
  choice, with wishlist as the initial Discover context.
- “Not this time” is local to the shortlist, with Undo. Saving stores only remaining books in
  their current order. Updating a saved shortlist reuses its identity. Removing it removes no books.
- Saved selections belong to the account, travel in backup v9, and cascade on account deletion.
  Cached selections can be read offline; saving/removing requires connectivity.
- Series invitations inspect at most three exact confirmed relationships from up to twelve read
  anchors. Unknown/removed/private order suppresses the invitation. No series reconciliation runs.

## Matching and cost boundaries

Each corpus query is capped at 32 rows. The anchor path checks up to two exact contributor names
and the known genre. The mood path applies the fixed retrieval vocabulary to catalog descriptions,
genres, and tags, then validates whole-word evidence after removing HTML. Wider genre shelves
supply actual source categories and descriptions; an editorial fallback is labelled as such.

The `embed` function adds authenticated `intent` mode. It compares public candidate descriptions
with the chosen starting point using the existing `gte-small` runtime. It does not query the
reader's taste centroid or send personal notes, ratings, or reading history. Inputs are bounded;
each request allows at most twelve candidates, and the client makes at most four calls within a
12-second ranking deadline. The existing account rate limiter applies. Ranking failure preserves
source-supported choices in catalog order; no arbitrary score threshold invents a relationship.

This is a first bounded retrieval implementation, not evidence that lexical moods or semantic
ordering deliver strong recommendations across the entire catalog. Sparse metadata can produce
fewer choices. Evaluate actual reader selections before expanding the retrieval vocabulary,
adding a reviewed mood taxonomy, or calibrating more distant description-based relationships.

## Release dependencies

The web change requires migration `20260926010000_discovery_sessions.sql` for saving and backup.
The updated `releases` function supplies categories/descriptions under a versioned genre cache;
`embed` supplies optional intent ordering. Without those function updates, exact corpus-supported
choices still work, but wider metadata and semantic ordering may be absent.

Deploy through the existing guarded release process after merge, from the appropriate production
checkout. No production account or database was modified during implementation. The owner runs
any production migration guard requiring human confirmation. Verification commands and final
results are recorded below when the implementation gate completes.

## Verification

Completed locally on 2026-09-06:

- `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed. The build used the committed local
  Supabase demo configuration; it is not a production-configured deployment artifact.
- `pnpm test` passed: 2,603 core tests, 822 web tests, and the compiled Workflow integration
  test. After the final history/series review, the affected core and web selections passed again
  (29 tests each), followed by another successful typecheck and build.
- A fresh database reset followed by the complete pgTAP suite passed: 45 files, 1,358 assertions.
  This includes 29 new saved-shortlist ACL, RLS, quota, validation, and account-deletion checks.
- The focused `discovery-guided.spec.ts` browser run passed all five tests. It exercised real
  local catalog reads, factual matching, details, Back/Forward/Escape and scroll preservation,
  dismissal/Undo, a filtered saved snapshot, the established Add form and return, refresh,
  offline-save refusal without replay, and confirmed/unknown/deleted series cases.
- The same browser coverage checked all nine rooms in both modes: stable shortlist ordering,
  Axe WCAG A/AA checks, and no horizontal overflow or clipped control text at 320px.
  The new registry-keyed core contrast test also covers all 18 room/mode combinations.

The complete fresh-database browser run used the default one worker and retries 0. It finished
with **235 passed, 3 failed, 10 skipped, and 10 not run** in 31.7 minutes. The original run remains
recorded as red:

- `no-third-party-catalog.spec.ts` expected the former Discover heading. The corrected guard
  checks the guided entry, then explicitly requests a genre and observes its failed provider
  before asserting that the browser made no direct third-party catalog requests.
- `search-param-persistence.spec.ts` expected the former catalog search field on the entry route.
  Its catalog cases now enter Browse explicitly. A new guided-search case checks Back, refresh,
  and malformed input against the new field.
- `shelf-regressions.spec.ts` received a gateway 502 for its `list_items` save after the book
  insert succeeded. The trace contains “An invalid response was received from the upstream
  server.” This existing shelf test was rerun unchanged, with no added retries or timeouts.

The focused follow-up run of those three complete files passed **all 18 tests** in 1.8 minutes,
with one worker and retries 0. This includes the cases blocked by their earlier serial failures.
The full suite was not repeatedly rerun to obtain a green report.

A real local Supabase `gte-small` intent-runtime smoke check passed: authenticated input returned
a finite score for a matching description; unauthenticated input returned 401; malformed and
over-limit candidate lists returned 400. The cold runtime returned a bounded partial batch,
which the client supports. Counts for that account remained zero in `books`, `book_embeddings`,
and `discovery_sessions`; the temporary account was then deleted. An initial smoke attempt
reached the old local function after an unsupported CLI argument prevented the new server from
starting; the passing run explicitly waited for the new intent handler before checking inference.

Browser tests deliberately stub external provider/model responses. The separate runtime smoke
proves local execution, not recommendation quality or hosted production behavior.

## Multiline writing follow-up

The landing reading-record field inherited button typography and the Tryst pill radius, which
cut into the first line of text on a phone. Guest notes now use the app's writing-field class.
All multiline writing fields use body type at 16px, normal weight/style, 1.65 line height,
16px padding, and the room's small card radius. They retain each room's field colors and visible
keyboard focus without clipping prose inside button shapes. This also covers reading-log notes,
reviews, club comments, onboarding note previews, and bulk entry. Reviews, comments, and bulk
entry now have explicit accessible names.

Browser verification checked all nine landing rooms in both modes at 320px and 390px (36
combinations), with no horizontal overflow. A two-paragraph guest note saved and appeared in both
book-detail examples. On a local signed-in account, a reading note survived refresh; the review
draft and multiline bulk list retained their line breaks. Both app fields showed 16px text,
26.4px line height, 16px padding, and a visible 2px focus outline. Review and bulk drafts were not
submitted. The shared club/onboarding field styling was checked in source, without creating a
club or posting a comment. Mobile screenshots were visually inspected.

After this follow-up, typecheck, lint, production build, formatting, and 17 focused existing
reading/demo tests passed. No additional complete browser-suite run was performed.
