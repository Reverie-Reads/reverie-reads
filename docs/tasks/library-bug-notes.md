# Library workflow fixes

Owner request, October 13, 2026. Source: the black-text items and seven screenshots in the
owner-provided library bug notes. The source document remains private.
Gray text is completed history; the document's original-design appendix is background.

## Changes

- Book history navigation and Add's ordinary return action say **Back**. Household-only Add
  confirmation goes to the household library even when Add originated on another book.
- Review's **Back to information** preserves the draft without saving; the browser regression
  checks the database before and after this button. A successful Add offers the loaded book and
  **Plan this book**, with deliberate timing and optional notes.
- Corpus administrators can select the saved series relationship alongside edition and guidance
  changes. Direct mode retains optional evidence and explicit confirmation; the server requires
  current corpus and personal membership state. An unchanged unconfirmed legacy label becomes a
  real shared relationship only through this deliberate action.
- Personal bibliography edits and explicit Add refresh an existing household work. New owned
  intake includes its known bibliography. The household overlay never becomes catalog authority
  or copies private notes, reading history, ratings or copy locations. No historical backfill.
- My series searches names, books, contributors and ISBNs; shared search includes aliases and
  member titles/authors. Search ignores accents and punctuation, matches all words, and survives
  navigation. A stored series with multiple authors appears once, addressing the duplicate-card
  screenshot. Existing explicit series merge remains the way to combine genuinely separate records.
- Contributor arrows preserve the requested order and roles. Personal tag names preserve entered
  acronym/capitalization choices. Book merging opens the per-field comparison with both books visible.
- Household details have a full-page view and an owner-only link to the current reader's book.
- Edition covers have a preview, visible image-failure state and image upload alternative to a URL.
  Upload changes the edition draft; the existing explicit inventory save remains required.
- Shelf arrangement exposes a dedicated touch/pointer handle and keyboard arrows. The order changes
  at drop, so moving a pointer does not reorder targets underneath it. Pointer reveals ease through
  the same cover geometry renderer; reduced motion remains immediate and scrolling retains its
  same-frame tracking.
- Reading progress can calculate a percentage from pages, chapters or audio minutes. The saved
  model remains percentage, not an exact-position bookmark; this is explained in the control.
- Intensity hover text includes the existing meaning for each level. A fixed safe-area background
  prevents scrolling content from appearing under an iPhone's status/camera area.
- Desktop calendar cells show book titles. Calendar selection can enter Add for a new book; after
  its confirmed save, planning stays on that screen. Release lookup accepts a full author name
  outside the reader's existing authors, links to general new/upcoming browsing, and publishes
  bounded batches together to prevent reshuffling.
  Existing date/source qualifications and cover fallback remain in place.

## Boundaries and delivery

The owner explicitly excluded standalone calendar events from this book/planning pass. Release publication dates never automatically become reading plans. Goodreads import is tested
with isolated local fixture accounts, not against the owner's existing library.

Migrations `20261107010000` and `20261108010000` share the public/private namespace and follow the
combined history through `20261106010000`. Production migration deployment remains owner-run through
the private checkout's deployment guard. This branch does not write production data.

Validation results and screenshot evidence are recorded with the PR. Browser iPhone simulations do
not establish physical-device Safari acceptance.

## Local verification

- The required full browser run used a fresh database, the default one worker and zero retries:
  **400 passed, 9 failed, 11 skipped and 20 did not run**. The failures were old assertions for
  household links, return labels, the now-open merge comparison, intensity descriptions, an
  ambiguous shelf link and preserved tag capitalization. Their original reports were retained;
  correcting those assertions does not turn the original full run green.
- All nine room accessibility checks passed in that run. New Add review/no-write, planning and
  corpus series publishing checks also passed. The phone household sequence stopped at its old
  link assertion before the new full-page check could execute.
- The final unit run passed 3,104 core checks and 1,330 web checks, with one existing Home draft
  test exceeding its five-second timeout under concurrent machine load. Both tests in that file
  passed in an isolated follow-up; the two workflow checks also passed. Initial cover-upload test
  type errors were corrected before the follow-up typecheck.

Focused browser and database follow-up results are recorded below when complete.
