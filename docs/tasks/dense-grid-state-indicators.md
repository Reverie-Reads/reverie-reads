# Dense-grid state indicators

**Status:** Implemented 2026-09-08

**Scope:** Personal reading and possession state on cover grids and small cover thumbnails

## Problem

Mood, trope, series, and Discover browsing already announced DNF and Borrowed in accessible names,
but several of those surfaces showed no equivalent visual state. A reader scanning covers could not
distinguish an abandoned or borrowed book even though a screen-reader user heard the distinction.

The surfaces do not all have the same amount of room. Cover grids can hold the Library's text pills;
a 36–60px thumbnail cannot without obscuring its artwork.

## Shared pattern

`BookStateMarks` owns both densities:

- **Cover:** the existing solid `StatePill` material and words. DNF or Read sits at the upper left;
  Borrowed sits at the lower right. DNF takes precedence over Read when both historical signals are
  present.
- **Thumbnail:** an 18px solid plate with a controlled SVG. Circle-and-slash means DNF; opposed
  arrows mean Borrowed. Ordinary Read stays quiet at this size because it is common and would add
  more visual noise than decision value.

The marks are visual finders, not separate controls. The enclosing book button keeps the complete,
plain-language accessible name through `stateSuffix` or `coverStateSuffix`. The solid surface and
accent come from the contrast-tested state-pill tokens, so a bright or dark cover cannot erase the
signal and every reading room keeps its own silhouette.

## Surfaces

- Mood and trope grids: full Read, DNF, and Borrowed pills.
- Guided and legacy Discover: full pills on main cover cards; compact marks on saved, search, and
  anchor thumbnails when the candidate has an unambiguous personal-library match.
- Series rows and adjacent-book strip: compact DNF and Borrowed marks.

`FromYourAuthors` was named in the historical backlog, but its current release-window selector
removes works that already match the personal library. There is therefore no personal reading or
possession state to display on those candidates.

## Verification boundary

- Core tests pin spoken ordering and DNF-over-Read precedence.
- Component tests pin solid token use, SVG-only thumbnail marks, and decorative semantics.
- Browser coverage creates Read, DNF, and Borrowed examples and checks both visible pills and the
  corresponding accessible names on Mood and Trope grids.
- Desktop and 390px visual checks confirm the labels remain legible without covering book titles or
  creating horizontal overflow.
