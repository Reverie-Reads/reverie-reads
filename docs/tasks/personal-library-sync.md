# Personal library live synchronization

September 9, 2026. Implemented for public review.

## Reader outcome

When a reader changes a book, reading record, shelf, or shelf placement in another Reverie tab or
device, an already-open app refreshes the affected view without a manual reload. A burst such as a
large import settles into one refresh per cache family rather than one request per changed row.

## Privacy and correctness boundary

Supabase recommends Database Broadcast for scalable, secure database change subscriptions. A
single private `library:<reader id>` topic handles inserts, updates, and deletes. Realtime
authorization lets only that signed-in reader join. The database message carries the table name and
operation only; title, notes, rating, shelf names, row ids, and all other library content stay out of
the message. The client treats it only as an invalidation signal and reads the changed rows through
the normal RLS policies.

The channel waits for Realtime auth, refreshes once when subscribed to close the initial
fetch/subscribe race, debounces subsequent signals for 160ms, and is removed whenever its reader id
changes or the component unmounts. If Realtime is unavailable, normal reads and writes continue;
confirmed-lookup guards still recover stale absences. This is not a durable offline write queue.

## Deployment and verification

Migration `20260930010000_personal_library_sync.sql` adds the private receive policy and four
after-write triggers. Because those triggers add a side effect to existing user-data writes, the
owner must deploy this migration through the guarded migration command after merge and answer its
prompt at the keyboard. No function or data backfill deploy is required.

Verification covers private-topic construction, burst coalescing, dependent-cache mapping,
subscription-time refresh, session cleanup, auth-race cleanup, trigger ACLs, empty search path,
topic policy, and successful insert/update/delete behavior on every source table. A browser flow
paired with a second authenticated client proves that a change written outside the open app appears
without navigation or reload.
