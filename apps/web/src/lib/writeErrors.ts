import { useSyncExternalStore } from 'react'

/**
 * The write-failure channel.
 *
 * Every mutation in the data layer used to handle failure the same way: roll the optimistic patch
 * back and say nothing. A rejected write was therefore indistinguishable from a successful one —
 * the edit appeared, then quietly reverted. That is exactly how a CHECK-constraint rejection on a
 * publication date went unexplained (and took every other field in the dialog with it).
 *
 * Failures land here and get shown. The reporting is wired ONCE, at the QueryClient's MutationCache,
 * so it covers the whole data layer rather than each hook remembering to opt in.
 */

export interface WriteError {
  id: number
  /** what the reader was doing, from the mutation's `meta.action` */
  action: string
  /** a short, human reading of the failure — never a raw Postgres string */
  detail: string
}

/** Mutations name themselves through `meta` so the toast can say what failed. */
export interface MutationMeta {
  action?: string
  /** The calling surface owns an accessible error and retry; avoid a contradictory toast. */
  errorPresentation?: 'inline'
}

// Register the shape app-wide, so `meta: { action: … }` is type-checked at every call site and
// `mutation.options.meta` arrives typed at the MutationCache handler.
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: MutationMeta
  }
}

let nextId = 1
let errors: WriteError[] = []
const listeners = new Set<() => void>()

const emit = () => {
  for (const l of listeners) l()
}

/** Postgres speaks in constraint names. Translate the ones a reader can actually act on. */
export function readableWriteError(error: unknown): string {
  const obj =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : null
  const raw = obj && 'message' in obj ? String(obj.message) : String(error ?? '')
  // `code` as well as `message`, because the one error this file most needs to name carries its
  // identity ONLY in the code. Read straight off a local PostgREST, not from memory:
  //   read : { code: '42703',    message: "column books.darkness_nonexistent does not exist" }
  //   write: { code: 'PGRST204', message: "Could not find the 'darkness_nonexistent' column of
  //            'books' in the schema cache" }
  const code = obj && 'code' in obj ? String(obj.code) : ''

  // A COLUMN THIS BUILD EXPECTS IS NOT IN THE DATABASE — i.e. app code shipped ahead of its
  // migration. Named first because it is a deploy fault, not a data fault: every other branch here
  // tells a reader something they can fix, and this one cannot be fixed by retyping anything.
  //
  // Worth the branch because of what its absence cost. On 2026-08-27 `books.darkness` shipped while
  // its migration sat undeployed; every save failed for hours behind "The change didn't save." —
  // the least specific sentence in this file — and it took a human noticing to find it. The message
  // does not blame the reader and does not pretend the value was rejected.
  //
  // MATCHED ON `code`, NOT ON PROSE. PostgREST's wording carries the column and table names, so a
  // message regex would be matching a template that varies per column; the codes do not vary. The
  // message patterns below are a narrow fallback for a re-thrown error that lost its code, anchored
  // to PostgREST's exact phrasing so they cannot widen into a catch-all.
  if (
    code === 'PGRST204' ||
    code === '42703' ||
    /Could not find the '.+' column of '.+' in the schema cache/.test(raw) ||
    /^column .+ does not exist$/.test(raw)
  )
    return 'This build expects a database change that hasn’t been deployed yet.'

  if (/books_pub_m_check/.test(raw)) return 'The publication month has to be between 1 and 12.'
  if (/books_pub_d_check/.test(raw)) return 'The publication day has to be between 1 and 31.'
  if (/books_status_check/.test(raw)) return 'That series status isn’t one of the allowed values.'
  if (/books_ownership_check/.test(raw))
    return 'That ownership value isn’t one of the allowed values.'
  if (/books_rating_check|reads_rating_check/.test(raw))
    return 'A rating has to be between 0 and 5.'
  // The series-position clashes come FIRST, because the generic duplicate-key line below would
  // otherwise swallow `series_entries_position_uidx` into "That already exists." — true, useless,
  // and it throws away the one thing set_series_order goes out of its way to say: WHICH slot lost.
  // A reader typing a number another book already holds is a case they can fix in one keystroke,
  // so it earns a sentence of its own rather than the catch-all.
  if (/a target position is already held|series_entries_position_uidx/.test(raw))
    return 'Another book in this series is already at that number.'
  if (/two slots claim the same position/.test(raw))
    return 'Two books can’t share the same number in a series.'
  if (/does not name a live entry/.test(raw))
    return 'That slot isn’t in this series any more — reopen the series and try again.'
  if (/personal book corpus binding is ambiguous/.test(raw))
    return 'This book’s shared identity needs reconciliation before its cover can be reviewed.'
  if (/cover context changed before review|cover is no longer available for review/.test(raw))
    return 'That cover changed — refresh the library before reviewing it again.'
  if (/cover must use the reviewed cover-ingestion boundary/.test(raw))
    return 'Save this image through the cover picker before sharing it with the corpus.'
  if (/duplicate key|already exists|_uidx/.test(raw)) return 'That already exists.'
  if (/row-level security|permission denied|JWT|401|403/i.test(raw))
    return 'You’re signed out, or that isn’t yours to change.'
  if (/Failed to fetch|NetworkError|network/i.test(raw))
    return 'No connection — the change didn’t reach the server.'
  if (/violates check constraint/.test(raw)) return 'One of those values isn’t allowed.'
  return 'The change didn’t save.'
}

export function reportWriteError(error: unknown, meta?: MutationMeta): void {
  if (meta?.errorPresentation === 'inline') return
  const entry: WriteError = {
    id: nextId++,
    action: meta?.action ?? 'Saving',
    detail: readableWriteError(error),
  }
  // Keep the last few; a burst from one failed dialog shouldn't bury the screen.
  errors = [...errors, entry].slice(-3)
  emit()
}

export function dismissWriteError(id: number): void {
  errors = errors.filter((e) => e.id !== id)
  emit()
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const snapshot = (): WriteError[] => errors

export function useWriteErrors(): WriteError[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
