# Sharing, households, and book clubs

This reference describes the shipped React application and database, reviewed October 2, 2026.
The prototype's `window.storage`, pasted backend keys, export-code blobs, and optional cloud setup
are historical mechanisms, not current setup instructions.

## Personal library, household library, and shared catalog

These are independent records, not three views of one writable personal library.

| Record              | Purpose                                                                                        | Effect of an ordinary change                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Personal book       | A reader's editions/copies, possession, reading state, rating, private history and annotations | Stays with that reader, subject to the explicit sharing rules below                                                        |
| Household work      | Collective membership with eligible personal-copy attribution                                  | Can exist without a personal book or possession; removing a personal book does not automatically remove the household work |
| Shared catalog work | Bibliographic identity and reviewed shared metadata                                            | Supplies eligible defaults; ordinary personal edits do not grant catalog authority                                         |

Library offers **My library** and **Household library**. Each household work appears once, with its
members' eligible copies identified. Owned copies enter automatically. A borrowed copy appears only
when its owner deliberately shares that exact copy. Wishlist, reading progress, and ratings do not
create household membership. The household may also add a work directly without creating a personal
book.

Household membership is provisioned through the owner-operated household commands. The app can show
“No household linked”; it does not currently offer a self-service invitation/join wizard. Membership
and work access are verified server-side. The household view refuses cached access while offline or
while membership cannot be verified. A failed load offers a membership-validating retry and preserves
an exit to My library.

The household projection excludes private ratings, favorites, reading logs/notes, reading state,
progress, plans, wishlist, moods, and personal lists. Copy covers follow the curated URL rules in
[the data model](DATA_MODEL.md); arbitrary third-party personal hotlinks are not sent to peers.

### Shared enrichment and personal choices

Historical personal tags and tropes are not published merely because an owned book joins a
household. Later tag/trope edits on an eligible household copy can synchronize the corresponding
household enrichment field. Each field preserves the other field. The tag picker explains this sharing consequence
at the edit control; it is distinct from private reading notes and moods.

Household owners or catalog administrators can edit the allowed shared bibliographic fields. An
ordinary member cannot edit an existing shared work simply by having a paid product account.
“Use shared details” is a deliberate personal adoption of allowed genre, cover, series, and
edition-compatible publication information. It does not adopt somebody else's reading history,
rating, possession, ISBN, or notes. Trusted shared series can also reconcile eligible automatic
personal defaults; reader and import choices remain protected.

A member must consent before peers can add neutral records to that member's personal library.
Those additions do not assign ownership, reading state, a rating, or private details. A neutral
record can be absent from the default possessed/history filter even though it was saved; see the
[workflow audit](../audits/end-user-workflows-2026-10.md) for the remaining discoverability work.

## Shared lists and club TBRs

Clubs includes shared lists identified by a short code. The current data layer stores a JSON
list in `shared_docs` and each reader's joined-list reference in `shared_refs`. A list item contains
bibliographic display information and the contributor's display name; it does not copy private
reading notes or ratings. Readers can add from My library or enter a title manually, remove an item,
copy a code, and leave their own joined-list reference. Leaving does not delete the shared document.

The legacy list-access contract requires a coordinated database/API review before a sharing release.
Do not infer a privacy guarantee from the browser's lookup or code-copy control. Restricted access
findings and the repair packet are retained in the maintainer audit; this documentation refresh does
not change the deployed access contract.

Writes currently read and replace a whole JSON document. Concurrent updates can overwrite one
another; there is no revision conflict check. A successful list lookup also does not yet guarantee
that saving the reader's joined-list reference succeeded. W09 tracks both shortcomings.

The app subscribes to database change notifications and invalidates its query cache. This is not
prototype polling or a promise of offline collaborative editing.

## Read-alongs

Read-alongs use separate relational records: `clubs`, `club_members`, and `club_comments`. Creating
or joining establishes membership; each member has their own chapter/page/percent progress. A comment
has an associated unit, author, text, and moderation state.

The spoiler boundary is enforced by database row-level policies, not merely by hiding text in the
browser. An authorized member sees their own comments; other non-hidden comments become readable
when their unit is at or before that member's progress. The locked-comment helper returns bounded
count/next-unit information. A content-free activity change can refresh a behind-progress member's
locked count without delivering the hidden comment body.

Members can advance/retreat progress, post, report, and hide their own comments through the current
controls. Leaving removes their membership. Read-along progress is separate from a personal book's
reading history and does not imply owning or finishing a personal copy.

The current club detail and secondary-query error states still need clearer failure/retry handling;
see W08. A failed query must not be presented as “no comments,” no progress, or proof a club is missing.

## Implementation references

- [Data model](DATA_MODEL.md): possession, household projections, catalog/personal adoption, history.
- `apps/web/src/data/household.ts` and `LibraryRoute.tsx`: household authorization and presentation.
- `apps/web/src/data/sharedLists.ts` and `SharedListRoute.tsx`: current shared-document operations.
- `apps/web/src/data/clubs.ts`, `ClubRoute.tsx`, and `useRealtimeRefetch.ts`: read-alongs and refresh.
- Database household, RLS, and spoiler tests exercise authorization separately from UI presentation.

Account products and Free/Pro access never replace workspace membership or catalog authority.
