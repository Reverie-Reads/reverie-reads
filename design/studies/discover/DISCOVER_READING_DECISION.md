# Discover: a few books to sit with

Status: **design approved; implementation in PR #444**, 2026-09-06.
The standalone study remains the fixture-based design reference at `http://127.0.0.1:4346/`
while its local server is running. The implementation now lives in the authenticated `/discover`
route. Review [the implementation and release notes](../../../docs/tasks/discover-implementation.md)
for the exact data boundaries and verification results. The capability audit below records the
baseline before implementation; it is not a list of remaining work.

## The decision

Discover helps a reader decide which book deserves a place in their personal library. Next read
helps them choose from the books already there. Both should feel like time spent with a small
selection of books, with room to read, compare, set aside, and return.

The page begins with three ways in: **More like a book I loved**, **Meet me in this mood**, and
**Somewhere a little different**. Known-title search is always visible. A source-backed series gap
can add a quiet invitation below these choices; it is conditional, never an empty fourth card.

This serves the strategy kernel: the diagnosis is decision friction, the guiding policy is a
bounded, personal choice with inspectable reasons, and the actions are a small candidate set,
useful book details, accurate copy relationships, and an easy return. The hypothesis is that
readers return because Reverie helps them decide. It is not yet measured retention evidence.

## What exists, and what this design needs

Audited against public main `dc24877`, including the arrangement release `ab732ee`.

| Capability                               | Evidence in the app                                    | Work required                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search title, author, or ISBN            | `data/search.ts`, `lib/search.ts`, `SearchResults`     | Consolidate the duplicate search/filter mental model; retain provenance and error states.                                                                                 |
| Read shared catalog pages                | `data/works.ts`, bounded `useWorksBrowse`              | Adapt to a bounded candidate pool; preserve stable work IDs, genre evidence and pagination.                                                                               |
| Browse wider genre shelves               | `lib/discover.ts`, cached `releases` function          | Reuse; keep curated local degradation distinct from live results.                                                                                                         |
| Rank external candidates by reader taste | `rankHitsByTaste`, `embed` rank mode                   | Reuse for the existing centroid ranking only. It is not an anchor or mood API.                                                                                            |
| Reader mood search                       | `embed` vibe mode                                      | Currently searches the reader's own books. Add a separately bounded external-candidate ranking mode before promising Discover mood matching.                              |
| Exact book details                       | `DiscoverBookPreview`                                  | Reuse the corpus lookup, ISBN/title-author validation, plain description handling, and failure states.                                                                    |
| Ownership identity                       | `ownedKeys`, `libraryMatch`                            | Stop treating any matched personal row as ownership. Resolve corpus identity, normalized ISBN, then title/contributors; render independent owned/borrowed/wishlist flags. |
| Add or wishlist                          | `useAddFromSearch`, existing Add route                 | Reuse explicit destination/possession mutations; updates to an existing row must preserve its independent flags.                                                          |
| Personal moods                           | `data/moods.ts`, `book_moods`                          | Explicit reader annotations; never backfill them from Discover's editorial or semantic interpretations.                                                                   |
| Series continuation                      | Structured series entries and trusted corpus relations | Require an exact verified membership and order; do not infer a missing installment from a search label or a count.                                                        |
| Saved discovery sessions                 | No production equivalent found                         | Needs account-scoped storage, access rules, export/deletion support and a bounded retention decision. The study saves in memory only.                                     |

The current `DiscoverHit` drops corpus genre and tags in `workToHit`; the design needs evidence
retained before rendering reasons. Existing rank input is title, author, and the requested genre.
It cannot support a claim that two books share a particular theme, tone, pacing, or intensity.

## Entry and selection

Search and guided discovery are alternatives on one page. Typing a known title does not secretly
change the reader's last guided session. Submitting search opens results; clearing/returning restores
the previous choices. Production keeps ISBN support. The four-book study uses title/author search
only and labels it as a sample catalog.

### More like a book I loved

Show up to three eligible starting books from the reader's explicit favourites or positive personal
ratings, using hydrated reads when needed. Do not infer that an owned book was loved or completed.
Also provide a searchable “Choose another book” control; ownership is not required to choose an
anchor. An empty library offers that control and the other two paths, without a required import.

Select an anchor, then request a shortlist. Do not fetch a new candidate pool on every hover or
radio-button change. Identity and actual metadata supply factual reasons such as “Another book by
Ursula K. Le Guin.” An embedding similarity alone may say “Suggested from your starting book”; it
may not invent the qualities the reader supposedly liked.

### Meet me in this mood

Choose one or two optional moods. Intent belongs to this discovery session; it neither assigns a
mood to a book nor updates the reader's general taste. Labels need an accessible pressed state and
a clear two-choice limit. Two selected moods mean **both** when editorial tags provide the match;
the semantic implementation must state how it combines intent and must not silently ignore one.

Editorial mood tags require their own provenance, separated from personal `book_moods`. If only a
description similarity supports a match, label it as a suggestion and expose the description. If
the pool cannot support the intent, show fewer books or no strong matches. Do not pad with unrelated
picks while continuing to claim that they match the mood.

### Somewhere a little different

Offer an explicit genre choice. With enough library context, identify a lightly explored genre using
the reader's actual primary and secondary genres; otherwise present genre choices without claiming
they are new to this reader. No automatic “adjacent genre” relationship exists today: initially
the reader chooses the destination. A later, reviewed adjacency model can suggest destinations.

The room/skin is never a genre filter. Switching among the nine rooms changes presentation only.

### Continue a series

Show only when the reader's active structured series and a trusted shared relation identify an
exact missing work. Label whether it is the next in order or a gap earlier in the sequence. Keep
publication/reading order explicit when they differ. Unknown order, a singleton, provider conflict,
an unresolved provisional work, or a removed personal category suppresses the invitation.

The study's Earthsea example is a synthetic reader who has the first book, with the order verified
on [the author's series page](https://www.ursulakleguin.com/the-books-of-earthsea). It is not a live
corpus claim, and the demonstration must not create or reconcile memberships.

## The shortlist

Aim for three to five candidates. One or two credible results are preferable when data is thin;
show the actual count. Deduplicate at the work level before slicing, preserve edition identity for
cover/add operations, and suppress the anchor itself. Guided defaults favour books outside the
personal library. Existing wishlist books may appear as “On your wishlist”; owned/borrowed matches
belong in a clearly labelled alternative section or appear only after explicit inclusion. Known-title
search returns matching personal books and offers to open the existing record.

Each candidate includes:

- A sharp, uncropped cover with stable geometry and a designed missing-image state.
- Complete title, contributors, reliable genre and known publication date; no fabricated values.
- A short source-backed description, or an explicit missing-description state.
- A plain, inspectable reason and the reader's actual relationship to the work.
- **Read about it** and **Not this time**. Selecting a cover or title opens the same details.

“Not this time” is session-only. It leaves an undo space in the same card position, preventing an
unexpected scroll jump. It does not mean “dislike”, change personal ratings, train long-term taste,
or modify reading status. A separate, explicit feedback action can be designed later.

There is a visible end to each shortlist. An explicit request for another set may draw from the
remaining pool and should state when the pool is exhausted; no automatic replenishment, looping
“new” results, or standing freshness pipeline is part of this work.

## Book details and deliberate actions

The detail sheet preserves the session behind it, uses the existing accessible modal behavior, and
restores focus to the opener without scrolling when it closes. Browser Back closes details before
leaving the shortlist. A detail fetch failure keeps the already-known identity visible and offers
retry; a provider timeout does not become “this book has no description”.

The primary action is **Add to wishlist** for a new work. A matched wishlist row shows its state and
opens that record rather than adding a duplicate. **I already have a copy** reveals explicit owned
and borrowed choices; existing format, wishlist, annotations, ratings and history survive any update.
Use current Add/search mutations and their household destination controls. A shortlist save never
creates a personal book or implies possession.

Opening a matched owned book remains an action to its current record. When that route changes the
page, preserve the originating session and scroll position for the return.

## Saved choices, history and privacy

The production session contains a version, owner, chosen path, stable anchor identity when present,
intent, exact candidate identities, evidence references/revisions, dismissals, and timestamps. Store
a bounded snapshot of displayed order; do not re-rank it merely because the reader opens details,
changes rooms, goes Back, or returns from Add. Refresh is an explicit choice.

“Save shortlist” persists its visible candidates without adding them to the library. Removing a
shortlist removes that session only. Do not create a public share URL. Session content belongs in
the reader's complete backup and account deletion, with owner-scoped access and cache keys. On
sign-out/account switching, clear in-memory/session caches; no previous reader's session may render.

In-flight requests must be cancellable or ignored after a new session starts. Work removed from the
catalog remains a labelled unavailable candidate in a saved session, rather than silently resolving
to a similarly titled book. Offline reads may show a cached saved session; writes need a confirmed
online save unless an actual conflict-safe offline queue exists.

The study uses memory and browser history only. Reload resets it. All personal states are fictional.
External cover hosts receive requests to display sample images; the study performs no catalog,
Supabase, analytics, account, embedding, or telemetry requests.

## Visual direction

Use the authored room material around a calm, readable library surface. The three directions are
compact invitations; the selection panel makes the next action obvious. The results feel like a
few books laid out for consideration: upright covers, clear titles, and comfortable descriptions.
Avoid card tilt, animated text, confetti, badge stacks, and a single oversized “winner”.

The study imports the actual `SkinAtmosphereCanvas`, `Button`, `Modal`, `ReverieMark`, runtime tokens,
skin kit and self-hosted fonts. It supplies study layout CSS, fixture selection and cover presentation;
those are not replacements for production data hooks or `CoverImage`. All nine rooms are selectable,
in Day and Night. The default Marginalia/Day is an inspection starting point, not a new brand choice.

At desktop width, use three equal candidates. At intermediate width, use two columns. At phone
width, use one readable card per row; retain the small bounded shortlist and a count. Selected-path
headings, long titles and button labels must wrap without overlap at 320px and at 200% zoom. Primary
targets are at least 44px. Source prose stays on an opaque surface. Respect reduced motion.

## Cover quality

Reuse the shipped `CoverImage` resolution/fallback chain in production. Aim for a real source width
at least twice the rendered cover width, and do not manufacture pixels with an upscale. Detail views
use the best known source tier; normal cards use the 720px stored derivative when rights permit.
Preserve the full jacket with `object-fit: contain` and a stable portrait frame. Respect reader-locked
edition choices. A broken or soft image never changes the recommendation's factual ranking.

The study links to official-site images for Earthsea and Macmillan's cover CDN for Psalm, plus the
already-reviewed Google Books edition URLs used by the landing. This is a local review, not a grant
to mirror or redistribute publisher artwork in the CC0 corpus. Production sourcing stays under
`docs/reference/COVER_SOURCING_AND_STUDIO.md` and its source-specific rights policy.

Fixture summaries are short original paraphrases grounded in:

- [A Wizard of Earthsea — official author site](https://www.ursulakleguin.com/a-wizard-of-earthsea).
- [The Tombs of Atuan — official author site](https://www.ursulakleguin.com/the-tombs-of-atuan).
- [A Psalm for the Wild-Built — Macmillan](https://us.macmillan.com/books/9781250236210/apsalmforthewildbuilt/).
- [Braiding Sweetgrass — Milkweed Editions](https://milkweed.org/book/braiding-sweetgrass).

These sources support book facts, not measured recommendation quality. Mood interpretations and
the fictional reader's choices are clearly identified as design fixtures.

## Build order after review

1. **Decision surface and reliable return.** Refactor `/discover` around one search and guided entry;
   retain corpus/wider-source browse as an explicit alternative. Introduce a candidate/evidence
   adapter, exact library relationships, source descriptions, and work-level deduplication. Reuse
   current details/add flows and new arrangement reachability. No new paid gate.
2. **Anchor and mood ranking.** Add a bounded authenticated external-candidate scoring contract,
   separate from the private-library vibe search. Include evidence-backed descriptions/genres in
   ranking input only when available and permitted. Cap pool, calls, input lengths, cache lifetime,
   and execution time; existing no-network fallback must remain honest. Calibrate examples before
   enabling claims about recommendation quality. The study's editorial fixtures never ship as the
   live ranking implementation.
3. **Saved sessions and conditional continuation.** Add owner-scoped persistence and full backup/
   deletion coverage, then connect series invitations only to verified ordered memberships. Prepare
   migrations/functions through the usual public PR then private release path, with hosted writes
   deployed through the owner-run guard when required.
4. **Observe decisions.** Walk through with readers, record assistance and reasons for rejecting
   picks, and measure whether they can find and keep a credible choice within two minutes. Treat
   this as a proposed usability target, not an achieved metric. Content-free optional funnel events
   may count starts, details opened and saves; never record titles, notes, free-text moods, reader
   IDs or shareable sessions in analytics. Useful guided discovery stays free. Any paid automation
   is a later monetization decision, not part of this release.

## Acceptance before production

- Every selected path actually changes eligible candidates. No dummy API or label-only matching.
- Reasons are traceable to the exact book evidence and selected intent; missing evidence is visible.
- No duplicate work in a shortlist, no anchor recommended to itself, no false ownership claims.
- Own + borrowed + wishlist combinations remain independent; search can open an existing record.
- Detail open/close, browser Back/Forward, Add return, skin changes and refresh preserve the right
  session and viewport; no focus-induced jump like the landing demo regression.
- Dismiss/undo and saved-shortlist removal never mutate book data or permanent taste.
- Empty library, thin pool, source failure, detail failure, missing cover, offline read, unavailable
  saved work and account switching all have verified flows.
- Browser inspection at 320, 390, 768 and 1440px; all nine skins in both modes, keyboard and reduced
  motion. Complete the repository's required fresh-DB, retries-zero e2e pass for implementation.
- No new production claim appears on the landing until its corresponding behavior ships.

## Review the study

From the repository root, run the verified command:

```sh
pnpm --filter @reverie/web exec vite --config ../../design/studies/discover/vite.config.mjs
```

The study lives entirely under `design/`. Browser verification of its interactions is meaningful;
the application's DB/e2e suite is not a substitute for that inspection. It has no app-route, schema,
function, or deployed behavior changes. Production implementation begins after this design review.
