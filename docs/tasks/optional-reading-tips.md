# Optional reading tips

Status: implementation in progress, requested September 11.

Experienced readers should be able to quiet the repeated introductions and workflow instructions
around their library. Settings will offer **Show reading tips**, enabled by default and independent
of the gentle/full onboarding choice. Turning it off changes presentation only; it cannot hide a
destination, grant access, change a reading record, or prevent the reader from reopening the full
library guide.

The first pass covers explicit instructional copy on Home, Next read, Discover, Planner, Stats,
Library, Shelves, Series, Tropes, Appearance and related reader surfaces where it repeats an established workflow.
Each passage is selected explicitly. Labels, controls, counts, recommendation reasons, saved reader
content, empty/error states, data-quality qualifications, privacy, attribution and explanations
needed for a consequential choice remain visible. This is not a blanket rule for all paragraphs.

## Copy audit

The repeated copy is most noticeable immediately below page headings and beside controls that a
returning reader already recognizes. Keep the room's tone in headings and materials; make those
extra paragraphs optional instead of replacing them with more icons or unexplained controls.

| Surface                  | Optional                                               | Always visible                                                                           |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Home                     | How to choose or swipe a populated shelf               | Available-book counts and first-book invitations                                         |
| Next read                | Page introduction                                      | Scope meaning, filters, match reasons and empty selections                               |
| Discover                 | Page introductions and starting-direction descriptions | Choice limits, ownership relationships, shortlist reasons and source attribution         |
| Planner                  | Queue introduction and calendar click instructions     | Dates, precision, empty-state actions and reading-history protections                    |
| Stats                    | Introduction, click-to-open hints                      | Private notes, counts, date/format qualifications, chart definitions and record controls |
| Library                  | Personal-library introduction                          | Book counts, empty states, search/filter controls and household scope explanation        |
| Tropes                   | Vocabulary browsing instructions                       | Search, counts, actual reader vocabulary and empty states                                |
| Shelves                  | Page introduction and scrolling hint                   | Shelf counts, overlapping membership and unmarked-format explanation                     |
| Series                   | Catalog introduction                                   | Scope controls, unresolved membership, gaps and removal consequences                     |
| Appearance               | Page and Adaptive introductions                        | Active room, mode, regenerate/lock controls and their state                              |
| Settings / library guide | None in this pass                                      | Preference explanations and the complete walkthrough                                     |

The `ReadingTipsProvider` reads the shell's existing profile result; each optional passage consumes
only its boolean context. It adds no per-passage data request. Public landing examples retain their
explanations. Appearance's obsolete “Tier-1 skins” language is replaced with a plain description of
a palette drawn from the reader's books.

The Next read **Refine choices** disclosure becomes a smaller, medium-weight control label while
retaining its existing keyboard behavior and minimum touch target.

## Persistence and delivery

Use an owner-scoped `profiles.show_reading_tips` boolean, default true, through the existing profile
query/update path. Keep it separate from learning milestones so observations cannot overwrite an
explicit preference. Export it with the profile; old backups without it preserve the current
choice, and malformed values fail restore preflight before writes.

The combined public/private history was checked through `20261010010000`; this preference uses
`20261011010000_reading_tips.sql`. Apply it from private main before publishing the UI that selects
the new field. There is no function deployment or data recovery job for this feature.

## Verification

- Check the actual disclosure font size and unchanged touch target in the browser.
- Save the setting, navigate and reload; verify optional text disappears and essential information
  stays available. Another reader retains their own preference.
- Verify both toggle states and keyboard focus across all nine rooms and both modes.
- Verify profile export/restore and invalid-value preflight, plus owner RLS/default behavior.
- Run the ordinary code/database gates and one fresh-database full browser suite at one worker and
  zero local retries. Coordinate the shared local stack with the source-trial thread.

## Recorded checks

- Format, lint, typecheck and production build pass. Ordinary tests pass: 4,188 unit checks and
  98 isolated recovery checks, without provider or production calls.
- Fresh local migration and all SQL tests pass: 53 files, 1,652 assertions. Owner/default/RLS
  coverage includes guide observations preserving the reader's explicit off choice.
- Focused real-browser checks pass: two scenarios, all nine rooms in both modes at 320px, checked
  and unchecked preference states, keyboard focus and contrast, 13px/500 disclosure type and at
  least 44px target height. A second browser session retains the saved preference. Failed writes
  preserve the last saved state and report an error; the complete guide remains available.
- Phone screenshots were inspected for Next read in Aphelion/day and Settings in Marginalia/day.
- The complete fresh-database regression suite is the remaining local check before review.
