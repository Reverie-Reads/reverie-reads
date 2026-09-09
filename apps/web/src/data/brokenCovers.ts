import { useSyncExternalStore } from 'react'
import { captureMessage, summarizeBrokenCovers, type BrokenCover } from '@reverie/core'

// Tracks covers whose link failed to load (client <img> onerror). Two jobs:
//  1) expose a reactive set of broken book ids to import review and the personal Cover Studio;
//  2) report to owner telemetry AGGREGATED — one debounced captureMessage per burst, never one per
//     cover (docs/reference/COVER_SOURCING_AND_STUDIO.md quota caveat). captureMessage routes to Sentry when a
//     DSN is set, else the console (H4 wrapper).

const broken = new Map<string, BrokenCover>()
const listeners = new Set<() => void>()
let snapshot: ReadonlySet<string> = new Set()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let reportedCount = 0

const FLUSH_DELAY_MS = 4000

function emit() {
  snapshot = new Set(broken.keys())
  for (const l of listeners) l()
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (broken.size <= reportedCount) return // nothing new since the last summary
    reportedCount = broken.size
    const { count, message } = summarizeBrokenCovers([...broken.values()])
    captureMessage(message, { kind: 'broken_covers', count })
  }, FLUSH_DELAY_MS)
}

/** Record a book whose cover link is dead. Idempotent per book; schedules an aggregated report. */
export function markCoverBroken(book: { id: string; title?: string; first?: string; last?: string }): void {
  if (!book.id || broken.has(book.id)) return
  broken.set(book.id, {
    ref: book.id,
    title: book.title,
    author: [book.first, book.last].filter(Boolean).join(' '),
  })
  emit()
  scheduleFlush()
}

/** Clear a book's broken flag (e.g. after the user picks a working cover). */
export function clearCoverBroken(id: string): void {
  if (broken.delete(id)) emit()
}

/** Reactive set of book ids with a broken cover (drives the review brokenCover bucket). */
export function useBrokenCoverIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => snapshot,
    () => snapshot,
  )
}
