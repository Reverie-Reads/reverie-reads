# Offline mirror & conflict policy

## Live library refresh

The IndexedDB mirror remains a read cache; this feature does not turn it into an offline write
queue. While a reader is online, database triggers on `books`, `reads`, `lists`, and `list_items`
send a content-free `library_changed` signal to the private `library:<reader id>` Broadcast topic.
The client receives one owner-authorized topic, batches a burst for 160ms, and invalidates only the
affected TanStack Query families. It then fetches the actual rows through the existing RLS-checked
queries.

The channel is keyed to the current session and removed on unmount/sign-out. Realtime accelerates
freshness across tabs and devices; ordinary queries, the per-reader IndexedDB mirror, mutation error
handling, and confirmed-lookup guards remain the correctness boundaries when the socket is absent.
The broadcast payload includes only the table name and operation. It does not copy titles, notes,
ratings, shelf names, row ids, or other library content into Realtime messages.

## Mirror

The TanStack Query cache (library, lists, reads, clubs, …) is persisted to IndexedDB via a
Dexie-backed persister (`apps/web/src/lib/offlineCache.ts`, wired in `main.tsx` through
`PersistQueryClientProvider`). On launch the cache is restored before render, so the app
**opens, browses, searches, and filters with the network off**. `gcTime` (7 days) outlasts
`maxAge` so cached queries survive to be restored.

## Writes while offline

The IndexedDB mirror is not a durable write queue. Many mutations are optimistic, and TanStack may
pause them while the same tab remains offline, but the app does not register serializable mutation
defaults that can safely replay an arbitrary write after a reload or sign-in change. Readers should
not be promised that a pending edit survives closing the app. Building a real outbox requires an
account-bound operation format, conflict rules, retry/inspection UI, and tests across reload and
sign-out; the live-refresh channel here does not change that boundary.

## Conflict policy — reconcile, don't clobber

- **Books: field-level last-write-wins.** Mutations send a _partial_ row
  (`toBookRow(patch)` emits only the fields the user actually changed). An offline edit to
  `fave` therefore updates only `owned_*`/`fave`/whatever changed — it does **not** overwrite a
  concurrent server-side change to `rating` or `progress`. Two readers editing _different_
  fields of the same book both keep their change. Two readers editing the _same_ field resolve
  to the later write.
- **Child rows merge, never replace.** Reread-log entries (`reads`), `reviews`, and list
  memberships (`list_items`) are inserted/deleted as individual rows — they accumulate across
  clients rather than overwriting each other. Reads dedupe by date; reviews are unique per
  `(work_key, reviewer)`; list items are unique per `(list, book)`.
- **Shared docs (capability lists)** are read-modify-write with last-write-wins on the whole
  document, re-read immediately before each edit to minimize clobbering (the prototype's model).

### Verification

`tests/two-client reconcile` (run against the local stack): client A sets `fave`, client B sets
`rating` on the same book while "offline", both flush on reconnect → the final row carries
**both** changes (no clobber). Field-level merge confirmed.
