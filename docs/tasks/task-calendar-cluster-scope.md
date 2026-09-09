# Calendar and Releases redesign

Status: **implemented for public review** on `codex/calendar-releases-redesign`, revalidated against
`main` after Cover Studio merged in PR #500 on September 9, 2026.

## Diagnosis

The earlier scope in this file described the pre-reading-life Planner and had become inaccurate.
The shipped route now has a writable, ordered Plan queue; exact-day planning from the calendar;
recorded finishes from `useReadingHistory`; honest year/month/day precision; and a source-aware
followed-author release feed. The remaining problem was experience coherence:

- Tryst's pill radius turned square day controls into large circles at desktop widths. The month
  became sparse and the lower weeks fell below a normal viewport.
- exact-day plans, month plans, year plans, and Soon entries appeared under one ambiguous “Without a
  fixed day” heading;
- the route switcher displayed internal identifiers and crowded the page heading on phones;
- Releases presented tiny cover grids, then repeated the reader's full historical publication
  record and a list of every undated book. That obscured the actual release horizon;
- the followed-author feed disappeared while loading or unavailable, and manual entry required the
  reader to type a technical date shape.

## Implemented direction

### One reading-life route, three explicit views

Plan, Calendar, and Releases remain peers because each answers a distinct question. Their display
labels and short descriptions are authored independently from route ids. The full-width switcher
sits below the page introduction, stays legible on phone and desktop, and retains URL-backed tab
state.

### Calendar as an open almanac

The calendar remains both a record and a planning surface. It uses two forms on one screen:

- a compact month grid for exact dates, with bounded planned/finished counts;
- named bands for **This month**, **This year**, and **Soon**, each containing only plans at that
  precision.

Empty days continue to begin an exact-day plan. Marked days continue to open a detail with separate
Planned and Finished sections. The current day uses `aria-current="date"`; the header adds a direct
return to today; the visible month summarizes planned and finished records without converting one
into the other. Day geometry is capped independently from room radius, so a rounded room cannot turn
the month into oversized circles. All color and material remain token-driven.

### Releases as an arrivals horizon

Releases now focuses on what is coming or newly arrived:

- followed-author results appear as readable editorial cards with the release date, author, edition
  detail, provenance, and an explicit “Keep on my horizon” action;
- loading, unavailable, empty, and muted-author states are visible;
- manual tracking asks whether the known date is a year, month, or exact day and preserves that
  precision through the existing Add review flow;
- the personal section shows only future books, current partial-date windows, and the last six
  months of arrivals. Old backlist and unknown publication dates remain on book screens instead of
  filling the release view.

Opening or tracking an external release still creates nothing automatically. The reader reviews it
in Add first. Release results never create a reading plan.

## Data boundaries

- `buildReadingHistory` / `useReadingHistory` remain the sole source for finished calendar records.
- The five reading-plan fields continue to move together. Removing or moving a plan does not touch
  history.
- Publication and plan dates preserve their stored precision. A current year/month interval is
  labelled uncertain; the interface never invents a day.
- `personalReleaseWindow` is a pure bounded-horizon view over existing personal books. It performs no
  identity merge, provider fetch, or write.
- Followed-author provider provenance remains visible. A provider failure leaves saved plans and
  books untouched.
- No migration, new provider, production-data write, or Edge Function change is part of this work.

## Verification

Required before merge:

- focused unit/component coverage for personal release windowing, partial-date behavior, current-day
  semantics, flexible plan grouping, and existing calendar history detail;
- lint, typecheck, build, and full unit suite;
- browser interaction and visual review at 390x844 and desktop widths in contrasting rounded/dark and
  angular/light rooms;
- Planner route horizontal-overflow, tab-navigation, mobile, and accessibility coverage;
- hosted exact-head checks, followed by the repository's landed-commit verification.

The local release function may be deliberately unavailable during visual review. In that condition,
the explicit unavailable state is the expected UI; it is not evidence about the deployed provider.
