# Reading progress editor

Status: implemented for review.

## Decision

Keep `books.progress` as one whole percentage from 0 through 100. It is a format-neutral summary of
the reader's current place, not a page, chapter, listening timestamp, or completion record.

Home, book details, Planner, and the landing guest library use the same editing rules:

- the slider, five-point step controls, and exact number field edit one local draft;
- only **Save progress** or the guest form's **Save changes** writes that draft;
- blur, pointer release, and Cancel do not write;
- invalid, fractional, and out-of-range entries remain visible with a clear correction instead of
  being silently rounded or clamped;
- a failed request leaves the exact draft available for retry;
- entering 100% does not create a reading-history entry. **Finish this read** remains the deliberate
  completion path.

The completion dialog names that action directly and offers **Not recorded** when the reading
format is unknown; it does not invent Paperback.

The mutation is scoped to the book so successive saves for one book serialize. A clean open editor
adopts a newer server value; an actively edited draft is not replaced underneath the reader.

## Related corrections

`readingNowHidden` is a Home display choice. Planner still includes every active read. Setting a
reread aside retains a progress value from 1 through 99, and resuming it keeps that place even when
the book has earlier completed reads. Starting again from a completed state still resets to zero.

## Deferred exact-position model

Page entry needs both an exact position and a reader-confirmed edition denominator. Catalog page
metadata can change and must not move a bookmark. A later page feature therefore needs a coordinated
schema, merge, import/export, offline-cache, and UI release. Chapter progress remains separate from
book-club spoiler coordinates and cannot be inferred from percentage because chapter lengths vary.

## Review gate

1. Save 37% from Home, book details, Planner, and the guest demo; reload the signed-in app and
   confirm the three signed-in surfaces agree.
2. Confirm Cancel and ordinary blur produce no write.
3. Try blank, fractional, negative, and above-100 values; each remains visible and receives the
   whole-number 0–100 correction.
4. Simulate one failed save, then retry the same value without re-entering it.
5. Set 100% and confirm no read is logged until **Finish this read** completes.
6. Hide an active book from Home and confirm it remains in Planner.
7. Set aside a reread at 37%, resume it, and confirm the earlier read and the 37% place both remain.
8. Check keyboard entry, slider arrows, Enter to save, Escape to cancel, focus return, 44px controls,
   320px/390px containment, all nine rooms, and reduced motion.
