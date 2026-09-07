# A reading life — Reflect and Plan

Status: interactive design study for review, September 7, 2026. No production UI, migrations,
account data, or persistence are changed. This replaces the old Stats/Wrapped and calendar
visual direction; it does not revive their retired public sharing or romance-only language.

## The product decision

Reverie should help a reader live with their books. Reflect looks back; Plan looks ahead.
They share a record without treating a reading life as a performance target. Keep the existing
Stats and Planner routes and arrangement preferences during implementation; “Reflect” is a
proposed visible label for Stats, not a silent navigation migration.

The current Stats page gives the impression that its year selector applies to all figures,
while several breakdowns are lifetime or library-wide. Planner displays dates more readily
than it lets a person make and change a plan. A common design and a reliable derived model
should address both before adding more metrics.

## Review the study

- Switch between Reflect and Plan using the same fictional reader.
- Change the reading period. Open a number, month, genre, or format to see its actual reads.
- Open the private retrospective, then turn toward the plan.
- Edit a plan as Soon, a year, a month, or an exact day. Add an optional intention.
- Reorder with arrow buttons, remove a plan, and undo. Reflect remains unchanged.
- Switch between queue and calendar. Flexible dates stay outside the day grid.
- Switch to Just beginning to inspect the first-read and empty-plan experience.
- Try all nine rooms in Day and Night. Study controls reset the fictional reader when changing
  scenarios; all changes reset on refresh. September 7, 2026 is the fixed sample timeline.

The standalone calendar is bounded to 2026. Production must have unrestricted month/year
navigation and explicit handling of past plans. The study supports several books on one day. This is a reviewable
interaction study, not a feature-complete calendar.

## Reflect

Lead with a remembered book and the reader's own note, followed by a small number of useful
facts. A note is never attributed to the user unless it exists in their data; these sample notes
are fictional. Without a note, use a factual book highlight, not a generated personal sentiment.

One period applies to all summaries, genre and format breakdowns, and the record underneath.
Completed reads count reading sessions. Distinct books count unique identities among those
sessions. Rereads are completed sessions marked as returns; stopped attempts have a separate
count and record. A reread outside the selected period can still establish that a later session
is a reread; period filtering must not erase historical context.

The month visualization counts finishes, never reading days or time spent. All-time month
buckets are explicitly across years. Unknown dates are visible separately and contribute only
to all-time totals. Production must also handle year-only and month-only finish dates: include
at known precision, without assigning an invented day. Multiple genres require deduplication
within each read and an explanation that counts can overlap; the study fixtures each have one.

Formats come from individual read logs. Missing formats remain “Not recorded.” Ownership,
borrowed state, current progress, wishlist entries, and planned books do not inflate completed
reading totals. Do not infer page totals, hours, pace, daily streaks, or average ratings.

The retrospective is private and uses the same period/model. No share card, image download,
public score, or export of derived analytics. Keep the existing permitted raw library backup
boundary separate from this experience.

## Plan

Keep current reading nearby, then give the flexible queue most of the space. Ordering expresses
preference, not a deadline; an exact date is optional. A year or month must not become January 1
or the first of a month. A future-self note is a proposed plan attribute, not automatically a book
review or historical reading note.

Direct edit, remove, and undo belong on the plan. Keyboard and touch users can reorder without
dragging. Later drag interaction can supplement these controls. A calendar is an alternate view
of this plan, not the default information architecture. Several plans on one day need a grouped
list before edit; long titles cannot occupy or overflow the day cell. Past plans should stay
visible for deliberate rescheduling, with no silent rollover or “overdue” pressure.

Plan operations never change possession, reading logs, finish dates, ratings, or personal notes.
Starting/finishing a read must use the established beginReadingPatch and completion flows;
production should ask deliberately whether a plan is fulfilled or kept for a later reread.

Releases are a supporting horizon from followed authors or explicit interests. Use verified
publication precision and label changes. No invented date for missing metadata, skin-based genre
filter, or automatic conversion of a release into a plan. The study has no dated future releases
and says so. Real release integration belongs in the production implementation, not fabricated
fixture claims.

## Visual direction

A journal-like composition: expressive heading, breathing room, complete book jackets, quiet
rules and small marginal labels. The warm book-and-note opening gives the statistics a human
purpose. The plan puts a currently read book in a reading-room alcove beside an editable queue.
Use real app room materials and loaded skin fonts; no new background engine. Aphelion keeps its
geometry and grid, Tryst its stars, Marrow its stone, and each room its established mood.

The study uses token colors and familiar native controls. Text entry uses a modest corner radius,
16px input text, and adequate padding. Large text has explicit line height. Full cover jackets use
contain with title/author fallbacks, not crops. Motion is optional and respects reduced motion.

## Implementation order

1. **Shared reading model.** Audit actual read logs, legacy book flags, partial dates, reread
   semantics, and timezone boundaries. Build pure period summaries with meaningful fixtures for
   multiple reads, DNF, unknown formats, partial/unknown dates, and duplicate genres. Reconcile
   legacy data through existing contracts, without writing a guessed history on page load.
2. **Reflect.** Replace Stats layout and selectors, add accessible drilldowns to real book/read
   details, correct all scopes, and build intentional first-read/empty/error/offline states.
3. **Plan.** Preserve existing flexible dates and calendar entries. Implement direct edit/remove,
   queue ordering, and undo using real account persistence. Decide how optional intentions and
   ordering fit the data model before schema changes; include backup/restore and offline behavior.
4. **Private retrospective and releases.** Compose the same trustworthy summaries into a private
   annual view. Integrate existing release sources with honest unknown/change states.
5. **Release audit.** Mobile Safari and Android text entry, keyboard focus/return, both reading
   scenarios, large histories, every room/mode, reduced motion, offline/error recovery, and the
   existing full application checks. Use owner-run production verification where personal writes
   are required. Design approval does not bypass the migration deployment guard.

## Acceptance gates

- Any displayed count can be explained by the reads behind it; all selectors have one scope.
- A plan edit/remove/reorder cannot change a recorded read or possession state.
- Sparse, imported, partially dated, repeated, and stopped histories remain honest.
- Data mutations have pending/error recovery and survive refresh in the app; the study has no
  persistence and does not pretend otherwise.
- Multiple plans on one date, past plans, and unknown publication dates remain usable.
- Mobile dialogs fit, inputs are readable, keyboard focus returns, charts are operable as buttons,
  and no room depends on color or animation to communicate state.
- Personal retrospectives remain private. No aggregate ratings or unsupported activity claims.

## Fixture provenance

Public title/author/genre facts and hotlinked covers reuse `../discover/catalog.ts`, whose source
links point to the author or publisher. Reading notes, dates, progress, formats, and intentions
are authored fictional examples. No private seed or account is loaded and no cover bytes are
redistributed. The production cover selection/cache pipeline remains the intended integration.
