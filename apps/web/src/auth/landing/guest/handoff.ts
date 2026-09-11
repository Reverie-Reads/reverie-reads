import { isSkinId, type Book, type Incoming, type ResolvedMode, type SkinId } from '@reverie/core'
import type { GuestState, GuestView } from './state'
import { GUEST_PRESETS } from './state'
import {
  ARRANGEMENT_PRESETS,
  DEFAULT_ARRANGEMENT_PRESET,
  arrangementDocument,
  cloneArrangement,
  type ArrangementConfig,
  type ArrangementDestinationId,
  type ArrangementDocument,
  type HomeModuleId,
} from '../../../design/arrangements'

export const GUEST_HANDOFF_STORAGE_ID = 'reverie.guest-handoff.v1'
export const GUEST_HANDOFF_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface GuestHandoffBook {
  incoming: Incoming
  /** A note on an unfinished book has no honest server-side home yet. Keep it in the explicit
   * handoff so the review screen can warn instead of silently turning it into a completed read. */
  draftNote?: string
}

export interface GuestHandoff {
  version: 1
  createdAt: number
  expiresAt: number
  skin: SkinId
  mode: ResolvedMode
  dock: GuestView[]
  arrangement?: ArrangementDocument
  books: GuestHandoffBook[]
}

export interface GuestHandoffSummary {
  books: number
  activeReads: number
  completedReads: number
  readingNotes: number
  draftNotes: number
}

const allowedCover = (cover: string): string => {
  if (cover.startsWith('/landing-covers/')) return cover
  try {
    const url = new URL(cover)
    return url.protocol === 'https:' && url.hostname === 'covers.openlibrary.org' ? cover : ''
  } catch {
    return ''
  }
}

const GUEST_DESTINATION: Record<GuestView, ArrangementDestinationId> = {
  library: 'library',
  reading: 'home',
  next: 'match',
  history: 'stats',
}
const GUEST_MODULE: Record<GuestView, HomeModuleId> = {
  library: 'priority',
  reading: 'reading',
  next: 'next-read',
  history: 'year',
}

/** Translate the deliberately arranged guest dock into the richer signed-in model. Exact guest
 * presets retain the corresponding full-app preset; a custom dock keeps its order and fills the
 * three-slot navigation contract predictably. */
export function guestDockArrangement(dock: readonly GuestView[]): ArrangementConfig {
  const presetIndex = GUEST_PRESETS.findIndex((preset) => preset.dock.join() === dock.join())
  if (presetIndex >= 0) return cloneArrangement(ARRANGEMENT_PRESETS[presetIndex]!.config)

  const destinations = [...new Set(dock.map((view) => GUEST_DESTINATION[view]))]
  if (!destinations.includes('library')) destinations.unshift('library')
  for (const fallback of DEFAULT_ARRANGEMENT_PRESET.config.destinations) {
    if (destinations.length >= 3) break
    if (!destinations.includes(fallback)) destinations.push(fallback)
  }
  const homeModules = [...new Set(dock.map((view) => GUEST_MODULE[view]))]
  return { destinations: destinations.slice(0, 3), homeModules }
}

/** Copy only reader-owned and bibliographic fields that the ordinary intake path understands.
 * Guest ids and corpus ids never cross the boundary, and private-export cover URLs remain out. */
export function guestBookToIncoming(book: Book): Incoming {
  return {
    title: book.title,
    first: book.first,
    last: book.last,
    contributors: book.contributors.map((contributor) => ({ ...contributor, id: undefined })),
    series: book.series,
    position: book.position,
    seriesCount: book.seriesCount,
    seriesUserChosen: book.seriesUserChosen,
    seriesClaim: book.seriesClaim,
    status: book.status,
    genre: book.genre,
    subgenre: book.subgenre,
    subgenres: [...book.subgenres],
    genres: [...book.genres],
    tags: [...book.tags],
    intensity: book.intensity,
    cover: allowedCover(book.cover),
    isbn: book.isbn,
    pages: book.pages,
    fave: book.fave,
    ownership: book.ownership,
    owned: { ...book.owned },
    borrowed: book.borrowed,
    wishlist: book.wishlist,
    format: book.format,
    rating: book.rating,
    readStatus: book.readStatus,
    source: book.source,
    pub: { ...book.pub },
    reads: book.reads.map((read) => ({ ...read })),
    plan: { ...book.plan },
    progress: book.progress,
    addedTs: book.addedTs,
  }
}

export function createGuestHandoff(
  state: GuestState,
  room: { skin: SkinId; mode: ResolvedMode },
  now = Date.now(),
): GuestHandoff {
  return {
    version: 1,
    createdAt: now,
    expiresAt: now + GUEST_HANDOFF_TTL_MS,
    skin: room.skin,
    mode: room.mode,
    dock: [...state.dock],
    arrangement: arrangementDocument(guestDockArrangement(state.dock)),
    books: state.books.slice(0, 60).map((book) => {
      const draft = state.pendingNotes[book.id]?.trim()
      return { incoming: guestBookToIncoming(book), ...(draft ? { draftNote: draft } : {}) }
    }),
  }
}

export function summarizeGuestHandoff(handoff: GuestHandoff): GuestHandoffSummary {
  return handoff.books.reduce<GuestHandoffSummary>(
    (summary, item) => {
      if (item.incoming.readStatus === 'Reading') summary.activeReads++
      const reads = item.incoming.reads ?? []
      summary.completedReads += reads.length
      summary.readingNotes += reads.filter((read) => !!read.notes.trim()).length
      if (item.draftNote) summary.draftNotes++
      summary.books++
      return summary
    },
    { books: 0, activeReads: 0, completedReads: 0, readingNotes: 0, draftNotes: 0 },
  )
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function saveGuestHandoff(handoff: GuestHandoff): boolean {
  try {
    const target = storage()
    if (!target) return false
    target.setItem(GUEST_HANDOFF_STORAGE_ID, JSON.stringify(handoff))
    return true
  } catch {
    return false
  }
}

export function clearGuestHandoff(): void {
  try {
    storage()?.removeItem(GUEST_HANDOFF_STORAGE_ID)
  } catch {
    /* private mode */
  }
}

export function loadGuestHandoff(now = Date.now()): GuestHandoff | null {
  try {
    const raw = storage()?.getItem(GUEST_HANDOFF_STORAGE_ID)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<GuestHandoff>
    const valid =
      parsed.version === 1 &&
      typeof parsed.createdAt === 'number' &&
      typeof parsed.expiresAt === 'number' &&
      parsed.expiresAt > now &&
      isSkinId(parsed.skin) &&
      (parsed.mode === 'light' || parsed.mode === 'dark') &&
      Array.isArray(parsed.dock) &&
      Array.isArray(parsed.books) &&
      parsed.books.length > 0 &&
      parsed.books.length <= 60 &&
      parsed.books.every(
        (item) =>
          !!item &&
          typeof item === 'object' &&
          !!item.incoming &&
          typeof item.incoming.title === 'string' &&
          item.incoming.title.trim().length > 0 &&
          (item.draftNote === undefined || typeof item.draftNote === 'string'),
      )
    if (valid) return parsed as GuestHandoff
  } catch {
    /* corrupt or unavailable storage */
  }
  clearGuestHandoff()
  return null
}
