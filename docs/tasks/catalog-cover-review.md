# Catalog cover review

Status: implementation in progress on `codex/catalog-cover-review`, based on public `b32b52c`.

The reviewed cover chooser is shipped. Existing shared records still need deliberate curation:
the September 6 audit found eight identity/art concerns and many small originals. The new workspace
brings that work into one place without requiring an administrator to add a personal copy.

## Implementation

- An administrator-only `/catalog/covers` route, linked from Settings and Review. A bounded,
  searchable queue separates attention, deferred, reviewed, and all records. Missing covers and
  recorded identity/art concerns come first. Opening the workspace never changes catalog data.
- Each work opens into a comparison with its recorded title, author, ISBNs, current image and
  source, measured dimensions, and explicitly requested provider alternatives. Any edition is the
  default; selecting a catalog ISBN is deliberate. Fetch failure remains distinguishable from no
  alternatives. Existing cover display and corpus ingestion are reused.
- Keep, replace, flag, defer, and reopen are explicit administrator decisions. Approval requires
  visual identity confirmation. A saved fingerprint covers the exact work identity and cover state;
  concurrent catalog or review changes refuse the stale decision. Reviews and their history persist.
- Replacements use the existing `set_corpus_work_cover` boundary inside the review transaction.
  Provider images pass through existing corpus-owned ingestion; Google remains linked. No personal
  cover, possession, note, reading history, ISBN, title, author, or series is changed.
- Unknown quality stays unknown. Browser measurements describe the decoded image and do not prove
  edition identity, source rights, or genuine original sharpness. Flagged identity cases may remain
  unresolved; this workspace does not invent bibliographic corrections.

## Acceptance

Prove administrator-only reads and writes, exact stale-state refusal, durable review and audit,
correct shared replacement without personal changes, source/ingestion validation, bounded paging,
error/retry states, missing/broken/soft images, keyboard use, mobile layout, and nine-room appearance.
Run the complete local gate and one fresh-database full browser suite at the default worker count,
with retries zero. Catalog findings remain review evidence; no incident rows enter migrations and
no production data repairs are performed by this coding session.
