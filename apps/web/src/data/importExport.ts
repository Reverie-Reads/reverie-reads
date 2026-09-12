import { parseDiscoverySession, DISCOVERY_SAVED_LIMIT } from '@reverie/core'
import { nextListSortOrderFor, ORDER_STEP as LIST_ORDER_STEP } from './lists'
import { nextItemPositionFor, ITEM_POSITION_STEP } from './listItems'
import {
  isContributorRole,
  isKnownTrope,
  libraryCsv,
  parseCsvRows,
  TROPE_FACETS,
  type Book,
  type Contributor,
  type ImportItemOutcome,
  type TropeEmphasis,
  type TropeFacet,
} from '@reverie/core'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import type { BookRow } from './types'
import { toBook } from './mappers'
import { applyIncoming, type ReviewCandidate } from './intake'
import { loadVerdicts } from './duplicates'
import { persistContributors } from './contributors'

// Keep URL-sized PostgREST filters comfortably below the local gateway's request-line limit.
// Restore is already a staged, multi-request operation, so run these sequentially and fail at the
// first rejected batch instead of creating a burst of ownership-trigger work.
const RESTORE_OWNERSHIP_BATCH_SIZE = 100
const CURRENT_BACKUP_VERSION = 9

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const id = data.user?.id
  if (!id) throw new Error('Not signed in')
  return id
}

/** PostgREST returns an embedded to-one as an object OR a one-element array, depending on the
 *  relationship it infers. Every embedded read here goes through `one()`. */
type Embedded<T> = T | T[] | null
const one = <T,>(e: Embedded<T>): T | null => (Array.isArray(e) ? (e[0] ?? null) : e)

type EmbeddedAuthor = Embedded<{ name: string }>
interface ContribJoinRow {
  id: string
  book_authors: { position: number; role: string; authors: EmbeddedAuthor }[]
}
const authorName = (a: EmbeddedAuthor): string => one(a)?.name ?? ''

// ── taxonomy round-trip: tropes + moods ──
//
// Both are JOIN tables over a vocabulary that is PART canonical (shared, `owner_id is null`) and
// part personal coinage (`owner_id` = the reader). A trope/mood id therefore means nothing outside
// the account that wrote it — and nothing inside it either, once the account is deleted and
// restored. So the backup carries NAMES, which the schema already treats as the stable key:
// `tropes_canonical_name_uidx` / `tropes_personal_name_uidx` (and the mood equivalents) make
// `lower(name)` unique per owner. Restore resolves each name back to an id and coins a personal
// row for whatever this account is missing, so a reader's own vocabulary survives the move.

/** One assigned trope, as the backup stores it. `facet` is carried so a coined personal row keeps
 *  its classification instead of collapsing to the 'vibe' default. */
export interface BackupTrope {
  name: string
  facet: string
  emphasis: string
}
export interface BackupMood {
  name: string
}
export interface BackupFollow {
  author_name: string
  state: string
}

/** The vocabulary key: `lower(trim(name))`, matching the DB's unique indexes. */
const nameKey = (s: string): string => s.trim().toLowerCase()

interface TropeJoinRow {
  book_id: string
  emphasis: string
  tropes: Embedded<{ name: string; facet: string }>
}
interface MoodJoinRow {
  book_id: string
  moods: Embedded<{ name: string }>
}

/** `book_tropes` join rows → `{ [bookId]: BackupTrope[] }`. A row whose vocabulary row didn't come
 *  back is dropped rather than exported nameless — an unresolvable name is worse than an absence. */
export function tropesByBook(rows: readonly TropeJoinRow[]): Record<string, BackupTrope[]> {
  const out: Record<string, BackupTrope[]> = {}
  for (const r of rows) {
    const t = one(r.tropes)
    if (!t?.name) continue
    ;(out[r.book_id] ??= []).push({ name: t.name, facet: t.facet, emphasis: r.emphasis })
  }
  return out
}

/** `book_moods` join rows → `{ [bookId]: BackupMood[] }`. */
export function moodsByBook(rows: readonly MoodJoinRow[]): Record<string, BackupMood[]> {
  const out: Record<string, BackupMood[]> = {}
  for (const r of rows) {
    const m = one(r.moods)
    if (!m?.name) continue
    ;(out[r.book_id] ??= []).push({ name: m.name })
  }
  return out
}

/**
 * `lower(name)` → id over the vocabulary this account can see. A canonical row WINS over a personal
 * row of the same name: the two can legitimately coexist (the unique indexes are partial, one per
 * owner-ness), and canonical is the row shared features key off.
 */
export function vocabIndex(
  rows: readonly { id: string; name: string; owner_id: string | null }[],
): Map<string, string> {
  const idx = new Map<string, string>()
  for (const r of rows) {
    const k = nameKey(r.name)
    if (!k) continue
    if (r.owner_id === null || !idx.has(k)) idx.set(k, r.id)
  }
  return idx
}

const facetOf = (raw: string): TropeFacet =>
  // 'vibe' is the documented default for a free coinage (see the trope-system migration), so an
  // unrecognized facet lands there rather than failing the whole restore on a check constraint.
  (TROPE_FACETS as readonly string[]).includes(raw) ? (raw as TropeFacet) : 'vibe'

/** Names in the backup that this account's vocabulary lacks — coined as personal rows before the
 *  join rows insert. Deduped by name key, so one coinage covers every book that used it. */
export function missingTropes(
  byBook: Record<string, BackupTrope[]>,
  idx: Map<string, string>,
): { name: string; facet: TropeFacet }[] {
  const out = new Map<string, { name: string; facet: TropeFacet }>()
  for (const list of Object.values(byBook)) {
    for (const t of list) {
      const k = nameKey(t.name)
      if (!k || idx.has(k) || out.has(k)) continue
      out.set(k, { name: t.name.trim(), facet: facetOf(t.facet) })
    }
  }
  return [...out.values()]
}

export function missingMoods(
  byBook: Record<string, BackupMood[]>,
  idx: Map<string, string>,
): { name: string }[] {
  const out = new Map<string, { name: string }>()
  for (const list of Object.values(byBook)) {
    for (const m of list) {
      const k = nameKey(m.name)
      if (!k || idx.has(k) || out.has(k)) continue
      out.set(k, { name: m.name.trim() })
    }
  }
  return [...out.values()]
}

/**
 * The `book_tropes` rows to insert, once every name resolves. A book that didn't come across, or a
 * name that still won't resolve, is SKIPPED rather than thrown on — a partial restore beats none.
 * `emphasis` coerces to the 'present' default: unlike a follow's state, pinned/present are not
 * opposites, so the default is a safe landing rather than an inverted intent.
 */
export function bookTropeRows(
  byBook: Record<string, BackupTrope[]>,
  bookIdMap: Map<string, string>,
  idx: Map<string, string>,
  ownerId: string,
): { book_id: string; trope_id: string; owner_id: string; emphasis: TropeEmphasis }[] {
  const rows = []
  for (const [oldBookId, list] of Object.entries(byBook)) {
    const bookId = bookIdMap.get(oldBookId)
    if (!bookId) continue
    for (const t of list) {
      const tropeId = idx.get(nameKey(t.name))
      if (!tropeId) continue
      rows.push({
        book_id: bookId,
        trope_id: tropeId,
        owner_id: ownerId,
        emphasis: (t.emphasis === 'pinned' ? 'pinned' : 'present') as TropeEmphasis,
      })
    }
  }
  return rows
}

export function bookMoodRows(
  byBook: Record<string, BackupMood[]>,
  bookIdMap: Map<string, string>,
  idx: Map<string, string>,
  ownerId: string,
): { book_id: string; mood_id: string; owner_id: string }[] {
  const rows = []
  for (const [oldBookId, list] of Object.entries(byBook)) {
    const bookId = bookIdMap.get(oldBookId)
    if (!bookId) continue
    for (const m of list) {
      const moodId = idx.get(nameKey(m.name))
      if (!moodId) continue
      rows.push({ book_id: bookId, mood_id: moodId, owner_id: ownerId })
    }
  }
  return rows
}

// ── the two "refusals": data whose whole meaning is that the reader said NO ──
//
// A series-removal tombstone and a dismissed trope suggestion are both negative space: nothing is
// visible when they work. That is exactly why they were easy to leave out of the backup — and why
// leaving them out is worse than losing an ordinary row. Restore without them and the library does
// not merely forget, it ARGUES: a Hardcover refresh resurrects the series slot the reader deleted,
// and suggestions they already waved away come back. A refusal that does not survive is a refusal
// the app overrules.
//
// Only the NEGATIVE half of each table travels. Live series entries and open suggestions are
// genuinely derived and rebuild themselves; carrying them would restore a derived view as if it
// were authored.

/** A removed series slot: identified by series NAME + position, since series ids are per-account. */
export interface BackupTombstone {
  series: string
  position: number
  title: string
  author: string
  label: string | null
  source: string
  removed_at: string
}

export interface BackupSeriesRow {
  id: string
  name: string
  status: string | null
  source: string
  source_ref: string | null
  refreshed_at: string | null
  length: number | null
}

export interface BackupSeriesEntryRow {
  id: string
  series_id: string
  position: number
  /** v8+: private reading order, separate from the canonical volume number. */
  sort_order?: number
  sort_user_edited?: boolean
  label: string | null
  title: string
  author: string
  book_id: string | null
  source: string
  user_edited: boolean
  removed_at: string | null
  is_primary: boolean
  membership_claim: Record<string, unknown>
  position_claim: Record<string, unknown>
}

interface TombstoneJoinRow {
  position: number
  label: string | null
  title: string
  author: string
  source: string
  removed_at: string
  series: Embedded<{ name: string }>
}

/** `series_entries` rows carrying a tombstone → a portable, name-keyed list. */
export function seriesTombstones(rows: readonly TombstoneJoinRow[]): BackupTombstone[] {
  const out: BackupTombstone[] = []
  for (const r of rows) {
    const name = one(r.series)?.name
    if (!name || !r.removed_at) continue
    out.push({
      series: name,
      position: r.position,
      title: r.title ?? '',
      author: r.author ?? '',
      label: r.label ?? null,
      source: r.source ?? 'manual',
      removed_at: r.removed_at,
    })
  }
  return out
}

interface DismissalJoinRow {
  book_id: string
  state: string
  tropes: Embedded<{ name: string }>
}

/** Dismissed suggestions → `{ [bookId]: tropeName[] }`. Only 'dismissed' travels; an OPEN
 *  suggestion is a pending question the catalog can ask again, not a reader decision. */
export function dismissalsByBook(rows: readonly DismissalJoinRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const r of rows) {
    const name = one(r.tropes)?.name
    if (!name || r.state !== 'dismissed') continue
    ;(out[r.book_id] ??= []).push(name)
  }
  return out
}

/**
 * The natural key of a slot. `series_entries` has a synthetic uuid PK and no unique constraint, so
 * the archive has to synthesise one.
 *
 * ── WHY TITLE AND NOT POSITION ──────────────────────────────────────────────────────────────────
 * This used to be `${seriesId}@${position}`, and position is the one thing about a slot that MOVES.
 * Every functional consumer already keys on title instead: `mergeSourceEntries` suppresses a
 * source-refresh resurrection by matching the tombstone's `title`, and the revive-on-re-add pass
 * matches via `matchEntryForBook`, which compares `normTitle` — `trim().toLowerCase()`, the same
 * normalisation `nameKey` does here. Position was the archive's identity while title was the
 * system's, and the two disagreeing is what produced both recorded symptoms: two tombstones at one
 * position silently collapsing to one on restore, and a tombstone skipped because a LIVE entry had
 * since taken its number — dropping the reader's removal so the next refresh resurrects the ghost
 * they dismissed.
 *
 * ── THE EMPTY-TITLE FALLBACK ────────────────────────────────────────────────────────────────────
 * `series_entries.title` is NOT NULL but may be the empty string, and `seriesTombstones` widens
 * that to `?? ''` besides. Keying every untitled tombstone in a series on the same string would
 * collapse them all to one — a fresh instance of the exact bug this change closes. So an untitled
 * slot keeps position as its identity, which is no worse than the old behaviour for that case and
 * strictly better for every titled one. The `t:`/`p:` prefixes keep a numeric-looking title from
 * colliding with a position.
 *
 * NOT PERSISTED — this key exists only in memory during an export/restore. There is no `slot_key`
 * column anywhere, so nothing stored needs re-keying and no migration is required; and backups
 * written under the old scheme already carry `title`, so they restore correctly under the new one.
 */
const slotKey = (seriesId: string, title: string, position: number): string => {
  const key = nameKey(title ?? '')
  return key ? `${seriesId}@t:${key}` : `${seriesId}@p:${position}`
}

/**
 * The `series_entries` tombstone rows to insert, under the series ids resolved by name.
 *
 * `taken` carries the slots that already exist in this account, and anything landing on one is
 * skipped. Two reasons, and the first is a bug this closes: because the parent series is resolved
 * BY NAME it is not recreated per restore, so restoring the same file twice appended a second,
 * byte-identical tombstone to the same series at the same position — a real duplicate, unlike the
 * join tables that upsert on a composite key. Second, if the slot is occupied by a LIVE entry, the
 * account has already said something about it more recently than the backup did (the reader
 * re-added the book); a tombstone beside a live row at the same position is a contradiction, not
 * an addition. Existing state wins either way.
 */
export function tombstoneRows(
  tombstones: readonly BackupTombstone[],
  seriesIdByName: Map<string, string>,
  ownerId: string,
  taken: ReadonlySet<string> = new Set(),
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  const claimed = new Set(taken)
  for (const t of tombstones) {
    const seriesId = seriesIdByName.get(nameKey(t.series ?? ''))
    if (!seriesId) continue
    // Also dedupes WITHIN one file: a hand-edited backup listing the same slot twice inserts once.
    const key = slotKey(seriesId, t.title, t.position)
    if (claimed.has(key)) continue
    claimed.add(key)
    rows.push({
      series_id: seriesId,
      owner_id: ownerId,
      position: t.position,
      label: t.label,
      title: t.title,
      author: t.author,
      // book_id stays null and user_edited stays true — a tombstone is by definition an unlinked
      // slot the reader touched. Re-adding the same book revives it, exactly as before the restore.
      book_id: null,
      source: t.source === 'hardcover' ? 'hardcover' : 'manual',
      user_edited: true,
      removed_at: t.removed_at,
    })
  }
  return rows
}

/** The `trope_suggestions` rows to insert. A name that resolves to no vocabulary row is skipped:
 *  coining a personal trope purely to hold a rejection would invent vocabulary out of a refusal. */
export function dismissalRows(
  byBook: Record<string, string[]>,
  bookIdMap: Map<string, string>,
  idx: Map<string, string>,
  ownerId: string,
): { book_id: string; trope_id: string; owner_id: string; state: string; source: string }[] {
  const rows = []
  for (const [oldBookId, names] of Object.entries(byBook)) {
    const bookId = bookIdMap.get(oldBookId)
    if (!bookId) continue
    const seen = new Set<string>()
    for (const name of names) {
      const tropeId = idx.get(nameKey(name))
      if (!tropeId || seen.has(tropeId)) continue
      seen.add(tropeId)
      rows.push({ book_id: bookId, trope_id: tropeId, owner_id: ownerId, state: 'dismissed', source: 'hardcover' })
    }
  }
  return rows
}

/**
 * Followed/muted authors. No id remap — the app's author identity IS the display name. An
 * unrecognized state is DROPPED, not defaulted: 'followed' and 'muted' are opposites, and guessing
 * would invert what the reader asked for.
 */
export function followRows(
  follows: readonly BackupFollow[],
  ownerId: string,
): { user_id: string; author_name: string; state: string }[] {
  const seen = new Set<string>()
  const rows = []
  for (const f of follows) {
    const name = f.author_name?.trim()
    if (!name || (f.state !== 'followed' && f.state !== 'muted')) continue
    const k = nameKey(name)
    if (seen.has(k)) continue
    seen.add(k)
    rows.push({ user_id: ownerId, author_name: name, state: f.state })
  }
  return rows
}

/**
 * Series-identity ruling rows to upsert, canonically ordered and re-owned to the current account.
 *
 * Only 'distinct' and 'related_but_separate' are refusals in the sense this backup section
 * exists to preserve ("don't ask again" / "these are siblings, not the same series"). 'same' is
 * excluded even if a hand-edited file includes one: the merge it records is already reflected in
 * the merged books/series_entries data, and its surviving_series_id can't be remapped onto this
 * account's regenerated series ids (see the ownedTables.ts entry). Deduped on the canonical pair
 * — a single upsert statement naming the same conflict target twice fails in Postgres, and a
 * hand-edited or twice-restored file is exactly how that could happen.
 */
export function seriesRulingRows(
  rulings: readonly { name_key_a: string; name_key_b: string; ruling: string }[],
  ownerId: string,
): { owner_id: string; name_key_a: string; name_key_b: string; ruling: 'distinct' | 'related_but_separate' }[] {
  const seen = new Set<string>()
  const rows: { owner_id: string; name_key_a: string; name_key_b: string; ruling: 'distinct' | 'related_but_separate' }[] = []
  for (const r of rulings) {
    if (r.ruling !== 'distinct' && r.ruling !== 'related_but_separate') continue
    const a = r.name_key_a?.trim()
    const b = r.name_key_b?.trim()
    if (!a || !b) continue
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    const key = `${lo}\u0000${hi}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ owner_id: ownerId, name_key_a: lo, name_key_b: hi, ruling: r.ruling })
  }
  return rows
}

/**
 * Serialize the WHOLE account to a JSON backup (v9): books (incl. genre/tags/intensity/owned
 * formats), per-book contributors, assigned tropes (with emphasis) and moods, reads, lists +
 * memberships, the user's reviews, merge verdicts, followed/muted authors,
 * the reader's REFUSALS (removed series slots and dismissed trope suggestions), and the profile
 * (skin/mode + adaptive taste state + goal + arrangement).
 *
 * The bar is the one deletion sets: `delete-account` removes the auth user and every owned row
 * cascades with it (verified against a live database, not just read off the migrations — tropes,
 * moods and follows all go). Anything deletion can erase, export must be able to hand back, or the
 * "export anytime, no lock-in" promise is only half true. v4 dropped tropes, moods and author
 * follows on the floor; v5 carries them.
 *
 * Reading a v4 file still works — the new sections are optional and simply arrive empty.
 */
/** Sum of the arrays inside a `{ key: T[] }` section — what the FILE actually carries. */
const nested = (o: Record<string, readonly unknown[]>): number =>
  Object.values(o).reduce((n, v) => n + v.length, 0)

/**
 * Row counts for every section, as written. `restoreBackup` asserts the payload still matches
 * before it writes anything, so a truncated or damaged FILE fails loudly instead of restoring
 * cleanly and quietly missing books.
 *
 * These are counts of what is IN THE FILE, which is a different job from the write-time check in
 * `pageAll` above (fetched rows vs the server's own count). One catches a bad read, the other
 * catches a bad file; neither can stand in for the other.
 */
export interface BackupCounts {
  [section: string]: number
}

export interface BackupPreview {
  version: number | null
  isNewerVersion: boolean
  exportedAt: string | null
  /** Current backups carry a manifest whose declared counts match the payload. */
  integrity: 'verified' | 'legacy'
  unknownSections: string[]
  restoresProfile: boolean
  counts: {
    books: number
    activeBooks: number
    removedBooks: number
    reads: number
    notes: number
    lists: number
    listItems: number
    reviews: number
    contributors: number
    tropes: number
    moods: number
    authorFollows: number
    series: number
    seriesEntries: number
    tombstones: number
    dismissals: number
    discoveries: number
    plannedBooks: number
    favoriteBooks: number
  }
}

export async function buildBackup(): Promise<string> {
  const ownerId = await currentUserId()
  // `pageAll` is shared with reads that write nothing, so its message cannot promise this — but
  // here it is both true and the first thing a reader needs to know, because the alternative they
  // will assume is a half-written file.
  return backupAborted(async () => {
  const [books, contribs, bookTropes, bookMoods, reads, lists, items, reviews, verdicts, follows, rulings, seriesRows, seriesEntries, tombstones, dismissals, discoveries, profile] =
    await Promise.all([
      pageAll<BookRow>('books', (from, to) =>
        supabase.from('books').select('*', { count: 'exact' }).order('id').range(from, to),
      ),
      pageAll<ContribJoinRow>('contributor', (from, to) =>
        supabase
          .from('books')
          .select('id, book_authors(position, role, authors(name))', { count: 'exact' })
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: ContribJoinRow[] | null; error: unknown; count: number | null }>,
      ),
      // Names, not ids — see the taxonomy round-trip note above.
      pageAll<TropeJoinRow>('book_tropes', (from, to) =>
        supabase
          .from('book_tropes')
          .select('book_id, emphasis, tropes(name, facet)', { count: 'exact' })
          .order('book_id')
          .order('trope_id')
          .range(from, to) as unknown as PromiseLike<{ data: TropeJoinRow[] | null; error: unknown; count: number | null }>,
      ),
      pageAll<MoodJoinRow>('book_moods', (from, to) =>
        supabase
          .from('book_moods')
          .select('book_id, moods(name)', { count: 'exact' })
          .order('book_id')
          .order('mood_id')
          .range(from, to) as unknown as PromiseLike<{ data: MoodJoinRow[] | null; error: unknown; count: number | null }>,
      ),
      pageAll<NonNullable<BackupShape['reads']>[number]>('reads', (from, to) =>
        supabase.from('reads').select('*', { count: 'exact' }).order('id').range(from, to),
      ),
      pageAll<NonNullable<BackupShape['lists']>[number]>('lists', (from, to) =>
        supabase.from('lists').select('*', { count: 'exact' }).order('id').range(from, to),
      ),
      pageAll<NonNullable<BackupShape['list_items']>[number]>('list_items', (from, to) =>
        supabase
          .from('list_items')
          .select('*', { count: 'exact' })
          .order('list_id')
          .order('book_id')
          .range(from, to),
      ),
      pageAll<NonNullable<BackupShape['reviews']>[number]>('reviews', (from, to) =>
        supabase
          .from('reviews')
          .select('work_key, reviewer_name, rating, body, created_at', { count: 'exact' })
          .eq('reviewer_id', ownerId)
          .order('id')
          .range(from, to),
      ),
      pageAll<NonNullable<BackupShape['merge_verdicts']>[number]>('merge_verdicts', (from, to) =>
        supabase
          .from('merge_verdicts')
          .select('book_id, incoming_key, verdict', { count: 'exact' })
          .order('book_id')
          .order('incoming_key')
          .range(from, to),
      ),
      pageAll<NonNullable<BackupShape['author_follows']>[number]>('author_follows', (from, to) =>
        supabase
          .from('author_follows')
          .select('author_name, state', { count: 'exact' })
          .order('author_name')
          .range(from, to),
      ),
      // Only the two refusal rulings travel — see the ownedTables.ts entry for why 'same' does
      // not (it's already reflected in the merged books/series_entries data, and its
      // surviving_series_id can't be remapped onto a restored account's regenerated series ids).
      pageAll<NonNullable<BackupShape['series_merge_decisions']>[number]>('series_merge_decisions', (from, to) =>
        supabase
          .from('series_merge_decisions')
          .select('name_key_a, name_key_b, ruling', { count: 'exact' })
          .neq('ruling', 'same')
          .order('id')
          .range(from, to),
      ),
      pageAll<BackupSeriesRow>('series', (from, to) =>
        supabase
          .from('series')
          .select('id, name, status, source, source_ref, refreshed_at, length', { count: 'exact' })
          .order('id')
          .range(from, to),
      ),
      pageAll<BackupSeriesEntryRow>('series_entries', (from, to) =>
        supabase
          .from('series_entries')
          .select('id, series_id, position, sort_order, sort_user_edited, label, title, author, book_id, source, user_edited, removed_at, is_primary, membership_claim, position_claim', { count: 'exact' })
          .order('series_id')
          .order('position')
          .order('id')
          .range(from, to),
      ),
      // The two refusals — see the note above. Tombstones key on the series NAME; dismissals on
      // the trope name, for the same reason every other taxonomy reference does.
      pageAll<TombstoneJoinRow>('series_entries', (from, to) =>
        supabase
          .from('series_entries')
          .select('position, label, title, author, source, removed_at, series(name)', { count: 'exact' })
          .not('removed_at', 'is', null)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: TombstoneJoinRow[] | null; error: unknown; count: number | null }>,
      ),
      pageAll<DismissalJoinRow>('trope_suggestions', (from, to) =>
        supabase
          .from('trope_suggestions')
          .select('book_id, state, tropes(name)', { count: 'exact' })
          .eq('state', 'dismissed')
          .order('book_id')
          .order('trope_id')
          .range(from, to) as unknown as PromiseLike<{ data: DismissalJoinRow[] | null; error: unknown; count: number | null }>,
      ),
      pageAll<NonNullable<BackupShape['discovery_sessions']>[number]>('discovery_sessions', (from, to) =>
        supabase.from('discovery_sessions').select('id, document', { count: 'exact' }).eq('owner_id', ownerId).order('id').range(from, to),
      ),
      supabase
        .from('profiles')
        .select('display_name, goal_year, goal_target, auto_merge_duplicates, default_store_id, default_store_name, default_store_website, skin, mode, adaptive_skin, adaptive_locked, arrangement, guidance, show_reading_tips')
        .eq('id', ownerId)
        .maybeSingle(),
    ])

  // Per-book contributors, keyed by (old) book id.
  const contributorsByBook: Record<string, { name: string; role: string; position: number }[]> = {}
  for (const row of contribs) {
    const list = (row.book_authors ?? [])
      .map((ba) => ({ name: authorName(ba.authors), role: ba.role, position: ba.position }))
      .filter((c) => c.name)
      .sort((a, b) => a.position - b.position)
    if (list.length) contributorsByBook[row.id] = list
  }

  const tropes = tropesByBook(bookTropes)
  const moods = moodsByBook(bookMoods)
  const series_tombstones = seriesTombstones(tombstones)
  const trope_dismissals = dismissalsByBook(dismissals)

  return JSON.stringify({
    v: CURRENT_BACKUP_VERSION,
    app: 'reverie',
    exportedAt: new Date().toISOString(),
    // The file's own completeness check — see BackupCounts. Written LAST in spirit: every number
    // is taken from the value actually being serialized on the line above it, never from the
    // query that produced it, so a section that lost rows between fetch and write is still caught.
    counts: {
      discovery_sessions: discoveries.length,
      books: books.length,
      contributors: nested(contributorsByBook),
      tropes: nested(tropes),
      moods: nested(moods),
      reads: reads.length,
      lists: lists.length,
      list_items: items.length,
      reviews: reviews.length,
      merge_verdicts: verdicts.length,
      author_follows: follows.length,
      series_merge_decisions: rulings.length,
      series: seriesRows.length,
      series_entries: seriesEntries.length,
      series_tombstones: series_tombstones.length,
      trope_dismissals: nested(trope_dismissals),
    } satisfies BackupCounts,
    discovery_sessions: discoveries.map(({ id, document }) => ({ id, document })),
    books,
    contributors: contributorsByBook,
    tropes,
    moods,
    reads,
    lists,
    list_items: items,
    reviews,
    merge_verdicts: verdicts,
    author_follows: follows,
    series_merge_decisions: rulings,
    series: seriesRows,
    series_entries: seriesEntries,
    series_tombstones,
    trope_dismissals,
    profile: profile.data ?? null,
  })
  })
}

/** Re-throw a failed backup read with the reassurance that belongs to THIS caller. */
async function backupAborted<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Backup aborted: ${msg} Nothing was written — a partial backup is worse than none, because it restores cleanly.`)
  }
}

/**
 * Compare a backup's declared counts against what the payload actually carries.
 *
 * Returns the mismatches, so the caller can name ALL of them at once rather than failing on the
 * first — a file that lost three sections should say so in one message.
 *
 * A file with no `counts` (v5 and earlier) yields no mismatches and restores as it always did.
 * That is a deliberate hole with a floor under it: those files were written before this check
 * existed, so refusing them would strand every backup taken to date. It is stated here rather than
 * left to be inferred, because "no mismatches" from an older file means "not checked", not "sound".
 */
export function countMismatches(data: BackupShape): string[] {
  const counts = data.counts
  if (!counts) return []
  const actual: Record<string, number> = {
    discovery_sessions: (data.discovery_sessions ?? []).length,
    books: (data.books ?? []).length,
    contributors: nested(data.contributors ?? {}),
    tropes: nested(data.tropes ?? {}),
    moods: nested(data.moods ?? {}),
    reads: (data.reads ?? []).length,
    lists: (data.lists ?? []).length,
    list_items: (data.list_items ?? []).length,
    reviews: (data.reviews ?? []).length,
    merge_verdicts: (data.merge_verdicts ?? []).length,
    author_follows: (data.author_follows ?? []).length,
    series_merge_decisions: (data.series_merge_decisions ?? []).length,
    series: (data.series ?? []).length,
    series_entries: (data.series_entries ?? []).length,
    series_tombstones: (data.series_tombstones ?? []).length,
    trope_dismissals: nested(data.trope_dismissals ?? {}),
  }
  const out: string[] = []
  for (const [section, declared] of Object.entries(counts)) {
    const got = actual[section]
    // A section the file declares but this build doesn't know: not a mismatch, and not silently
    // ignored either — a newer backup restored by an older build should say what it skipped.
    if (got === undefined) continue
    if (got !== declared) out.push(`${section}: expected ${declared}, found ${got}`)
  }
  return out
}

interface BackupShape {
  v?: number
  app?: string
  exportedAt?: string
  discovery_sessions?: { id: string; document: unknown }[]
  /** v6+. Row counts as written — see BackupCounts and countMismatches. Absent in v5 and earlier,
   *  which restore unchecked rather than being refused. */
  counts?: BackupCounts
  books: BookRow[]
  contributors?: Record<string, { name: string; role: string; position: number }[]>
  /** v5+; absent in a v4 file, which simply restores without them. */
  tropes?: Record<string, BackupTrope[]>
  moods?: Record<string, BackupMood[]>
  reads?: { book_id: string; read_on: string | null; format: string | null; rating: number | null; notes: string | null }[]
  lists?: { id: string; name: string; kind: string; is_priority: boolean; sort_order?: number | null }[]
  list_items?: { list_id: string; book_id: string; position: number | null }[]
  reviews?: { work_key: string; reviewer_name: string | null; rating: number | null; body: string }[]
  /**
   * Present in v4 and v5 archives, IGNORED on restore and never written by a current export.
   *
   * Reading orders were dropped (chore/drop-reading-orders); series position is the single
   * ordering mechanism now. The key stays declared so an older archive keeps restoring everything
   * ELSE without complaint — a reader whose backup predates the demolition should not meet an
   * error over a subsystem that no longer exists. Deliberately not deleted from the type: the
   * declaration is what documents that we looked at this key and chose to skip it.
   */
  reading_orders?: unknown
  merge_verdicts?: { book_id: string; incoming_key: string; verdict: string }[]
  author_follows?: BackupFollow[]
  /** v5+: the reader's refusals on candidate duplicate series pairs — 'distinct' or
   *  'related_but_separate' only. A 'same' ruling never appears here; see buildBackup. */
  series_merge_decisions?: { name_key_a: string; name_key_b: string; ruling: string }[]
  /** v7+: complete structured series authority, including primary/secondary memberships, ghosts,
   *  tombstones, and the independent membership/order claims. v8 adds `sort_order`. */
  series?: BackupSeriesRow[]
  series_entries?: BackupSeriesEntryRow[]
  /** v5+: the reader's refusals. */
  series_tombstones?: BackupTombstone[]
  trope_dismissals?: Record<string, string[]>
  profile?: Record<string, unknown> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const arraySections = [
  'discovery_sessions',
  'books',
  'reads',
  'lists',
  'list_items',
  'reviews',
  'merge_verdicts',
  'author_follows',
  'series_merge_decisions',
  'series',
  'series_entries',
  'series_tombstones',
] as const

const nestedSections = ['contributors', 'tropes', 'moods', 'trope_dismissals'] as const

/**
 * Parse and validate the immutable file text used by both preview and restore. This is deliberately
 * local and synchronous: choosing a file cannot touch the account. The restore calls it again on
 * the exact same text before its first request, so a preview can never become an alternate, weaker
 * validation path.
 */
function parseBackupFile(json: string): BackupShape {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('That file isn’t readable JSON. Choose a Reverie backup ending in .json.')
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.books)) {
    throw new Error('That file doesn’t look like a Reverie backup.')
  }
  const data = parsed as unknown as BackupShape

  if (
    isRecord(data.profile) &&
    'show_reading_tips' in data.profile &&
    typeof data.profile.show_reading_tips !== 'boolean'
  ) {
    throw new Error('That backup has an unreadable reading tips preference. Nothing was restored.')
  }

  for (const section of arraySections) {
    const value = data[section]
    if (value !== undefined && !Array.isArray(value))
      throw new Error(`That backup has an unreadable ${section} section. Nothing was restored.`)
  }
  for (const section of nestedSections) {
    const value = data[section]
    if (value === undefined) continue
    if (!isRecord(value) || Object.values(value).some((rows) => !Array.isArray(rows)))
      throw new Error(`That backup has an unreadable ${section} section. Nothing was restored.`)
  }
  if (data.counts !== undefined) {
    if (
      !isRecord(data.counts) ||
      Object.values(data.counts).some(
        (count) => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0,
      )
    ) {
      throw new Error('That backup has an unreadable completeness record. Nothing was restored.')
    }
  }

  const mismatches = countMismatches(data)
  if (mismatches.length)
    throw new Error(
      `That backup is incomplete — nothing was restored. ${mismatches.join('; ')}. ` +
        `Re-export from the account it came from.`,
    )

  // Saved Discover snapshots are validated in the same no-write pass. Opening the preview therefore
  // cannot promise a restore that the first saved shortlist will later reject.
  for (const row of data.discovery_sessions ?? []) {
    const document = parseDiscoverySession(row.document)
    if (!document || document.id !== row.id || !document.picks.length)
      throw new Error('That backup contains an unreadable shortlist. Nothing was restored.')
  }
  return data
}

/** Inspect a restore locally. No auth lookup, query, mutation, or cache write occurs here. */
export function inspectBackup(json: string): BackupPreview {
  const data = parseBackupFile(json)
  const actual = {
    discovery_sessions: (data.discovery_sessions ?? []).length,
    books: data.books.length,
    contributors: nested(data.contributors ?? {}),
    tropes: nested(data.tropes ?? {}),
    moods: nested(data.moods ?? {}),
    reads: (data.reads ?? []).length,
    lists: (data.lists ?? []).length,
    list_items: (data.list_items ?? []).length,
    reviews: (data.reviews ?? []).length,
    author_follows: (data.author_follows ?? []).length,
    series: (data.series ?? []).length,
    series_entries: (data.series_entries ?? []).length,
    series_tombstones: (data.series_tombstones ?? []).length,
    trope_dismissals: nested(data.trope_dismissals ?? {}),
  }
  const knownSections = new Set<string>([
    ...arraySections,
    ...nestedSections,
    'merge_verdicts',
    'series_merge_decisions',
  ])
  const unknownSections = Object.keys(data.counts ?? {})
    .filter((section) => !knownSections.has(section))
    .sort()
  const books = data.books

  return {
    version: typeof data.v === 'number' && Number.isFinite(data.v) ? data.v : null,
    isNewerVersion:
      typeof data.v === 'number' && Number.isFinite(data.v) && data.v > CURRENT_BACKUP_VERSION,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
    integrity: data.counts ? 'verified' : 'legacy',
    unknownSections,
    restoresProfile: isRecord(data.profile),
    counts: {
      books: actual.books,
      activeBooks: books.filter((book) => !book.removed_at).length,
      removedBooks: books.filter((book) => Boolean(book.removed_at)).length,
      reads: actual.reads,
      notes: (data.reads ?? []).filter((read) => Boolean(read.notes?.trim())).length,
      lists: actual.lists,
      listItems: actual.list_items,
      reviews: actual.reviews,
      contributors: actual.contributors,
      tropes: actual.tropes,
      moods: actual.moods,
      authorFollows: actual.author_follows,
      series: actual.series,
      seriesEntries: actual.series_entries,
      tombstones: actual.series_tombstones,
      dismissals: actual.trope_dismissals,
      discoveries: actual.discovery_sessions,
      plannedBooks: books.filter(
        (book) =>
          book.plan_position != null || book.plan_y != null || book.plan_m != null || book.plan_d != null,
      ).length,
      favoriteBooks: books.filter((book) => book.fave === true).length,
    },
  }
}

/** Restore v7's complete structured authority. Trusted book rows may already have materialized
 * their primary entry through the database trigger during the books pass; reuse and overwrite that
 * exact entry from the backup rather than inserting a duplicate. Secondary memberships, ghosts,
 * unknown historical rows, and tombstones then replay independently. */
async function restoreStructuredSeries(
  seriesRows: readonly BackupSeriesRow[],
  entries: readonly BackupSeriesEntryRow[],
  bookIdMap: ReadonlyMap<string, string>,
  ownerId: string,
): Promise<{ entries: number; tombstones: number }> {
  if (!seriesRows.length && !entries.length) return { entries: 0, tombstones: 0 }

  const existing = await pageAll<{ id: string; name: string }>('series', (from, to) =>
    supabase.from('series').select('id, name', { count: 'exact' }).order('id').range(from, to),
  )
  const byName = new Map(existing.map((row) => [row.name, row.id]))
  const seriesIdMap = new Map<string, string>()

  for (const row of seriesRows) {
    let id = byName.get(row.name)
    if (!id) {
      const { data, error } = await supabase
        .from('series')
        .insert({
          owner_id: ownerId,
          name: row.name,
          status: row.status,
          source: row.source === 'hardcover' ? 'hardcover' : 'manual',
          source_ref: row.source_ref,
          refreshed_at: row.refreshed_at,
          length: row.length,
        })
        .select('id')
        .single()
      if (error) throw error
      id = (data as { id: string }).id
      byName.set(row.name, id)
    } else {
      const { error } = await supabase
        .from('series')
        .update({
          status: row.status,
          source: row.source === 'hardcover' ? 'hardcover' : 'manual',
          source_ref: row.source_ref,
          refreshed_at: row.refreshed_at,
          length: row.length,
        })
        .eq('id', id)
      if (error) throw error
    }
    seriesIdMap.set(row.id, id)
  }

  const occupied = await pageAll<{
    id: string
    series_id: string
    position: number
    title: string
    removed_at: string | null
  }>('series_entries', (from, to) =>
    supabase
      .from('series_entries')
      .select('id, series_id, position, title, removed_at', { count: 'exact' })
      .order('id')
      .range(from, to),
  )

  let restored = 0
  let restoredTombstones = 0
  for (const entry of entries) {
    const seriesId = seriesIdMap.get(entry.series_id)
    if (!seriesId) throw new Error('A series entry in the backup has no parent series.')
    const bookId = entry.book_id ? bookIdMap.get(entry.book_id) : null
    if (entry.book_id && !bookId)
      throw new Error('A series entry in the backup points to a missing book.')

    if (
      entry.removed_at &&
      occupied.some(
        (slot) =>
          slot.series_id === seriesId &&
          slotKey(seriesId, slot.title, slot.position) ===
            slotKey(seriesId, entry.title, entry.position),
      )
    )
      continue

    let existingEntryId: string | undefined
    if (bookId && !entry.removed_at) {
      const { data, error } = await supabase
        .from('series_entries')
        .select('id')
        .eq('series_id', seriesId)
        .eq('book_id', bookId)
        .is('removed_at', null)
        .maybeSingle()
      if (error) throw error
      existingEntryId = (data as { id: string } | null)?.id
    }

    let restoredPosition = entry.position
    let restoredPositionClaim = entry.position_claim ?? { origin: 'unknown' }
    if (
      !entry.removed_at &&
      occupied.some(
        (slot) =>
          slot.series_id === seriesId &&
          !slot.removed_at &&
          slot.position === restoredPosition &&
          slot.id !== existingEntryId,
      )
    ) {
      restoredPosition =
        Math.floor(
          Math.max(
            0,
            ...occupied
              .filter((slot) => slot.series_id === seriesId && !slot.removed_at)
              .map((slot) => slot.position),
          ),
        ) + 1
      restoredPositionClaim = { origin: 'unknown' }
    }

    const payload = {
      series_id: seriesId,
      owner_id: ownerId,
      position: restoredPosition,
      sort_order: entry.sort_order ?? restoredPosition,
      sort_user_edited: entry.sort_user_edited ?? entry.user_edited,
      label: entry.label,
      title: entry.title,
      author: entry.author,
      book_id: bookId,
      source: entry.source === 'hardcover' ? 'hardcover' : 'manual',
      user_edited: entry.user_edited,
      removed_at: entry.removed_at,
      is_primary: entry.is_primary,
      membership_claim: entry.membership_claim ?? { origin: 'unknown' },
      position_claim: restoredPositionClaim,
    }
    if (existingEntryId) {
      const { owner_id: _owner, series_id: _series, ...patch } = payload
      const { error } = await supabase
        .from('series_entries')
        .update(patch)
        .eq('id', existingEntryId)
      if (error) throw error
    } else {
      const { error } = await supabase.from('series_entries').insert(payload)
      if (error) throw error
    }
    const at = occupied.findIndex((slot) => slot.id === existingEntryId)
    const occupiedRow = {
      id: existingEntryId ?? `restored-${restored}`,
      series_id: seriesId,
      position: restoredPosition,
      title: entry.title,
      removed_at: entry.removed_at,
    }
    if (at >= 0) occupied[at] = occupiedRow
    else occupied.push(occupiedRow)
    restored++
    if (entry.removed_at) restoredTombstones++
  }
  return { entries: restored, tombstones: restoredTombstones }
}

/**
 * Re-create the removed-series-slot tombstones. They need parent `series` rows to hang off, so this
 * materializes them by name — the same rows the series shelf would reconcile into existence on its
 * next read, created early here so a tombstone has somewhere to live.
 */
async function restoreTombstones(tombstones: readonly BackupTombstone[], ownerId: string): Promise<number> {
  if (!tombstones.length) return 0

  const wanted = new Map<string, string>()
  for (const t of tombstones) if (t.series?.trim()) wanted.set(nameKey(t.series), t.series.trim())
  if (!wanted.size) return 0

  // PAGED: a short read here does not fail, it MIS-MATCHES — every series past the cap looks
  // absent, so the insert below re-creates one that already exists.
  const existing = await pageAll<{ id: string; name: string }>('series', (from, to) =>
    supabase.from('series').select('id, name', { count: 'exact' }).order('id').range(from, to),
  )
  const seriesIdByName = new Map<string, string>()
  for (const row of existing) seriesIdByName.set(nameKey(row.name), row.id)

  const toCreate = [...wanted.entries()].filter(([k]) => !seriesIdByName.has(k)).map(([, name]) => name)
  if (toCreate.length) {
    const { data: made, error } = await supabase
      .from('series')
      .insert(toCreate.map((name) => ({ owner_id: ownerId, name })))
      .select('id, name')
    if (error) throw error
    for (const row of (made as { id: string; name: string }[]) ?? []) seriesIdByName.set(nameKey(row.name), row.id)
  }

  // Which slots this account already has — live or dead — so a re-restore can't duplicate one.
  const seriesIds = [...seriesIdByName.values()]
  // PAGED, and this one is a GUARD: `taken` is what stops a re-restore duplicating a slot. Read
  // short, it does not report fewer slots — it silently stops preventing duplicates, which is the
  // failure it exists to prevent.
  const occupied = await pageAll<{ series_id: string; position: number; title: string }>(
    'series_entries',
    (from, to) =>
      supabase
        .from('series_entries')
        .select('series_id, position, title', { count: 'exact' })
        .order('id')
        .range(from, to),
  )
  const taken = new Set<string>()
  for (const row of occupied) {
    if (seriesIds.includes(row.series_id))
      taken.add(slotKey(row.series_id, row.title, row.position))
  }

  const rows = tombstoneRows(tombstones, seriesIdByName, ownerId, taken)
  if (rows.length) {
    const { error } = await supabase.from('series_entries').insert(rows)
    if (error) throw error
  }
  return rows.length
}

/**
 * Re-create the trope + mood assignments: resolve every backed-up NAME against the vocabulary this
 * account can see, coin a personal row for anything missing, then insert the join rows on the new
 * book ids. Returns what landed, so the restore can report it.
 */
async function restoreTaxonomy(
  data: BackupShape,
  bookIdMap: Map<string, string>,
  ownerId: string,
): Promise<{ tropes: number; moods: number; dismissals: number }> {
  const tropesByBookId = data.tropes ?? {}
  const moodsByBookId = data.moods ?? {}
  // Dismissals resolve against the SAME trope index, so they belong to this pass.
  const dismissalsByBookId = data.trope_dismissals ?? {}
  if (
    !Object.keys(tropesByBookId).length &&
    !Object.keys(moodsByBookId).length &&
    !Object.keys(dismissalsByBookId).length
  ) {
    return { tropes: 0, moods: 0, dismissals: 0 }
  }

  // PAGED: a name past the cap reads as "not in the vocabulary", and the caller coins a personal
  // duplicate of a trope or mood the account already has.
  const [tvRows, mvRows] = await Promise.all([
    pageAll<{ id: string; name: string; owner_id: string | null }>('tropes', (from, to) =>
      supabase.from('tropes').select('id, name, owner_id', { count: 'exact' }).order('id').range(from, to),
    ),
    pageAll<{ id: string; name: string; owner_id: string | null }>('moods', (from, to) =>
      supabase.from('moods').select('id, name, owner_id', { count: 'exact' }).order('id').range(from, to),
    ),
  ])
  const tv = { data: tvRows, error: null }
  const mv = { data: mvRows, error: null }

  type VocabRow = { id: string; name: string; owner_id: string | null }
  const tropeIdx = vocabIndex((tv.data as VocabRow[]) ?? [])
  const moodIdx = vocabIndex((mv.data as VocabRow[]) ?? [])

  // Coin the personal vocabulary this account lacks, then fold the new ids into the index so the
  // join rows below resolve. Without this a restore into a fresh account would silently drop every
  // trope the reader ever invented.
  const coinTropes = missingTropes(tropesByBookId, tropeIdx)
  if (coinTropes.length) {
    const { data: made, error } = await supabase
      .from('tropes')
      // DELIBERATELY NOT titleCase'd, unlike the hand-typed creation paths.
      //
      // This is restoreTaxonomy — the backup RESTORE path, not foreign-data import. A restore must
      // give the reader back what they backed up; normalizing here rewrites their own names on the
      // way in. Caught by importExport.test.ts's round-trip suite, which went red on exactly this:
      // a personal trope exported as "Dragons With Opinions" came back as "Dragons with Opinions",
      // because `with` is a minor word.
      //
      // Normalization belongs where a human TYPES a name (useCreatePersonalTrope,
      // useCreatePersonalMood, useRenamePersonalTrope), not where the system replays stored data.
      .insert(coinTropes.map((t) => ({ owner_id: ownerId, name: t.name, facet: t.facet })))
      .select('id, name, owner_id')
    if (error) throw error
    for (const [k, v] of vocabIndex((made as VocabRow[]) ?? [])) tropeIdx.set(k, v)
  }

  const coinMoods = missingMoods(moodsByBookId, moodIdx)
  if (coinMoods.length) {
    const { data: made, error } = await supabase
      .from('moods')
      // Same reasoning as coinTropes above — a restore replays, it does not re-author.
      .insert(coinMoods.map((m) => ({ owner_id: ownerId, name: m.name })))
      .select('id, name, owner_id')
    if (error) throw error
    for (const [k, v] of vocabIndex((made as VocabRow[]) ?? [])) moodIdx.set(k, v)
  }

  const tRows = bookTropeRows(tropesByBookId, bookIdMap, tropeIdx, ownerId)
  if (tRows.length) {
    const { error } = await supabase.from('book_tropes').upsert(tRows, { onConflict: 'book_id,trope_id' })
    if (error) throw error
  }

  const mRows = bookMoodRows(moodsByBookId, bookIdMap, moodIdx, ownerId)
  if (mRows.length) {
    const { error } = await supabase.from('book_moods').upsert(mRows, { onConflict: 'book_id,mood_id' })
    if (error) throw error
  }

  // Dismissed suggestions last: they resolve against the index AFTER coining, so a dismissal for a
  // trope the reader also has assigned still finds its row.
  const dRows = dismissalRows(dismissalsByBookId, bookIdMap, tropeIdx, ownerId)
  if (dRows.length) {
    const { error } = await supabase.from('trope_suggestions').upsert(dRows, { onConflict: 'book_id,trope_id' })
    if (error) throw error
  }

  return { tropes: tRows.length, moods: mRows.length, dismissals: dRows.length }
}

/** Restore a backup as new rows owned by the current user (ids are remapped, not reused). Reads v4
 *  and v5 files; a v4 file simply carries no tropes, moods or follows to restore. */
export async function restoreBackup(
  json: string,
): Promise<{ books: number; lists: number; reads: number; tropes: number; moods: number; follows: number; tombstones: number; dismissals: number }> {
  // Re-run the same local validation the preview used against the exact retained file text. This is
  // intentionally before even the auth lookup and, more critically, before the first account write.
  const data = parseBackupFile(json)
  const ownerId = await currentUserId()

  // Validate all saved snapshots before any restore write. Never copy a source owner id.
  const discoveries = (data.discovery_sessions ?? []).map((row) => {
    // parseBackupFile already proved this shape. Keep the local guard because this value is crossing
    // into a write payload and a future parser change must still fail closed here.
    const document = parseDiscoverySession(row.document)
    if (!document) throw new Error('That backup contains an unreadable shortlist. Nothing was restored.')
    return { owner_id: ownerId, id: document.id, document }
  })
  if (discoveries.length) {
    const existing = await pageAll<{ id: string }>('discovery_sessions', (from, to) =>
      supabase.from('discovery_sessions').select('id', { count: 'exact' }).eq('owner_id', ownerId).order('id').range(from, to))
    if (new Set([...existing, ...discoveries].map(row => row.id)).size > DISCOVERY_SAVED_LIMIT)
      throw new Error('This restore would exceed 50 saved shortlists. Remove some saved shortlists first. Nothing was restored.')
  }

  // Lists first, mapping old → new ids.
  //
  // sort_order POLICY (the lists sort_order incident): the export has always captured it
  // (select('*') serialized wholesale — only the restore dropped it), so PRESERVE the exported
  // value when present. Backups whose lists predate the column (or hand-made files) may lack it;
  // those get sequential slots APPENDED AFTER the highest preserved value, in the file's own array
  // order — stable, reproducing at worst the order the file was written in. What is not
  // acceptable is writing NULL into the column whose nullability was the bug: a restored account
  // would order its shelves by Postgres scan order, destroying the reader's manual arrangement in
  // the one operation whose purpose is destroying nothing.
  const listIdMap = new Map<string, string>()
  const backupLists = data.lists ?? []
  const maxPreserved = Math.max(0, ...backupLists.map((l) => l.sort_order ?? 0))
  let appended = 0
  for (const l of backupLists) {
    const sortOrder = l.sort_order ?? maxPreserved + ++appended * LIST_ORDER_STEP
    const { data: created, error } = await supabase
      .from('lists')
      .insert({
        owner_id: ownerId,
        name: l.name,
        kind: l.kind,
        is_priority: l.is_priority,
        sort_order: sortOrder,
      })
      .select('id')
      .single()
    if (error) throw error
    listIdMap.set(l.id, (created as { id: string }).id)
  }

  // Books next.
  const bookIdMap = new Map<string, string>()
  const restoredOwnedBookIds: string[] = []
  for (const b of data.books) {
    // plan_date is DROPPED from the row rather than restored. Same contract as `reading_orders`
    // above, but it needs stripping rather than skipping: that was a top-level key nothing read,
    // this is a COLUMN inside every book row, carried here by the export's `select('*')` and
    // written straight back by the spread. Once the column is gone, passing the key would make
    // PostgREST reject the insert and take the whole restore down with it — so an archive made
    // before the drop must have it removed here, not merely ignored. The plan itself is carried by
    // plan_y/plan_m/plan_d, which are in `rest` and restore normally.
    const {
      id: _id,
      owner_id: _owner,
      added_at: _a,
      updated_at: _u,
      plan_date: _planDate,
      ...rest
    } = b
    const { data: created, error } = await supabase
      .from('books')
      // Restore historical annotations before re-enabling owned household membership. Inserting an
      // owned row first would create household_work, then the trope replay below would look like a
      // new consenting edit and publish private backup history into the household overlay.
      .insert({ ...rest, ownership: 'unowned', owner_id: ownerId })
      .select('id')
      .single()
    if (error) throw error
    const newId = (created as { id: string }).id
    bookIdMap.set(b.id, newId)
    if (b.ownership === 'owned') restoredOwnedBookIds.push(newId)
    // Restore the book's full contributor list (v4) via the owner-scoped RPC.
    const contribs = data.contributors?.[b.id]
    if (contribs?.length) {
      const list: Contributor[] = contribs.map((c, i) => ({
        name: c.name,
        role: isContributorRole(c.role) ? c.role : 'author',
        position: c.position ?? i,
      }))
      await persistContributors(newId, list)
    }
  }

  const structuredSeries = await restoreStructuredSeries(
    data.series ?? [],
    data.series_entries ?? [],
    bookIdMap,
    ownerId,
  )

  // Reads + memberships, remapped onto the new ids.
  const reads = (data.reads ?? [])
    .map((r) => {
      const bookId = bookIdMap.get(r.book_id)
      return bookId
        ? { book_id: bookId, owner_id: ownerId, read_on: r.read_on, format: r.format, rating: r.rating, notes: r.notes }
        : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
  if (reads.length) {
    const { error } = await supabase.from('reads').insert(reads)
    if (error) throw error
  }

  const items = (data.list_items ?? [])
    .map((it) => {
      const listId = listIdMap.get(it.list_id)
      const bookId = bookIdMap.get(it.book_id)
      return listId && bookId
        ? { list_id: listId, book_id: bookId, owner_id: ownerId, position: it.position }
        : null
    })
    .filter((it): it is NonNullable<typeof it> => it !== null)
  if (items.length) {
    const { error } = await supabase.from('list_items').insert(items)
    if (error) throw error
  }

  // The user's own reviews, re-owned to the current account (work_key is stable).
  const reviews = (data.reviews ?? []).map((rv) => ({
    work_key: rv.work_key,
    reviewer_id: ownerId,
    reviewer_name: rv.reviewer_name,
    rating: rv.rating,
    body: rv.body ?? '',
  }))
  if (reviews.length) {
    const { error } = await supabase
      .from('reviews')
      .upsert(reviews, { onConflict: 'work_key,reviewer_id' })
    if (error) throw error
  }

  // Reading orders are NOT restored. v4 and v5 archives may carry `reading_orders`; the tables are
  // being dropped and the key is skipped on purpose. Skipping rather than throwing is the contract:
  // an archive made before the demolition must still restore its books, shelves and refusals.

  // Merge verdicts (v4), remapped onto the new book ids.
  const verdicts = (data.merge_verdicts ?? [])
    .map((v) => {
      const bookId = bookIdMap.get(v.book_id)
      return bookId ? { owner_id: ownerId, book_id: bookId, incoming_key: v.incoming_key, verdict: v.verdict } : null
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)
  if (verdicts.length) {
    const { error } = await supabase.from('merge_verdicts').upsert(verdicts, { onConflict: 'owner_id,book_id,incoming_key' })
    if (error) throw error
  }

  // Series-identity rulings (v5+): the reader's 'no, don't merge these' / 'these are siblings'
  // decisions, keyed purely by name so there is nothing to remap (unlike merge_verdicts's book
  // ids). Defensively re-excludes 'same' and re-canonicalizes the pair order in case a
  // hand-edited file violates either — the table's own check constraints would otherwise reject
  // the row and take the whole restore down with it.
  const rulings = seriesRulingRows(data.series_merge_decisions ?? [], ownerId)
  if (rulings.length) {
    const { error } = await supabase
      .from('series_merge_decisions')
      .upsert(rulings, { onConflict: 'owner_id,name_key_a,name_key_b' })
    if (error) throw error
  }

  // Tropes + moods (v5), resolved by name onto the new book ids.
  const taxonomy = await restoreTaxonomy(data, bookIdMap, ownerId)

  // Re-enable the backed-up ownership only after historical trope joins exist. This update creates
  // required household membership but does not fire either annotation trigger, so restore remains
  // faithful without inventing household-sharing consent.
  for (let start = 0; start < restoredOwnedBookIds.length; start += RESTORE_OWNERSHIP_BATCH_SIZE) {
    const batch = restoredOwnedBookIds.slice(start, start + RESTORE_OWNERSHIP_BATCH_SIZE)
    const { error } = await supabase
      .from('books')
      .update({ ownership: 'owned' })
      .in('id', batch)
      .eq('owner_id', ownerId)
    if (error) throw error
  }

  // Followed/muted authors (v5) — keyed by display name, so nothing to remap.
  const follows = followRows(data.author_follows ?? [], ownerId)
  if (follows.length) {
    const { error } = await supabase.from('author_follows').upsert(follows, { onConflict: 'user_id,author_name' })
    if (error) throw error
  }

  // The reader's refusals (v5): removed series slots stay removed, dismissed suggestions stay
  // dismissed. After books, so the tombstones' series sit alongside the restored library.
  // v7 already restored every tombstone with its full claim fields. The name-keyed refusal section
  // remains in the file for older builds and is used only for v6-and-earlier archives.
  const tombstoneCount = data.series_entries?.length
    ? structuredSeries.tombstones
    : await restoreTombstones(data.series_tombstones ?? [], ownerId)

  if (discoveries.length) {
    const { error } = await supabase.from('discovery_sessions').upsert(discoveries, { onConflict: 'owner_id,id' })
    if (error) throw error
  }

  // Profile: restore appearance + adaptive taste state + goal + arrangement onto the account.
  if (data.profile) {
    const { error } = await supabase.from('profiles').update(data.profile).eq('id', ownerId)
    if (error) throw error
  }

  return {
    books: bookIdMap.size,
    lists: listIdMap.size,
    reads: reads.length,
    tropes: taxonomy.tropes,
    moods: taxonomy.moods,
    follows: follows.length,
    tombstones: tombstoneCount,
    dismissals: taxonomy.dismissals,
  }
}

/** The name of the default TBR that catches Goodreads `to-read` rows (created on first import). */
export const IMPORTED_TBR_NAME = 'Imported TBR'

/** Bulk-empty + placement facts the import summary speaks honestly about. */
export interface ImportExtras {
  /** to-read rows placed on the Imported TBR */
  tbrPlaced: number
  /** Reverie shelves newly created from Goodreads custom Bookshelves */
  shelvesCreated: string[]
  /** shelf memberships appended (all shelves, incl. the Imported TBR) */
  shelved: number
  /** imported/merged books still without a cover — the enrichment pass will fetch what it can */
  noCover: number
  /** imported/merged books without an ISBN (weaker future matching; enrichment may resolve one) */
  noIsbn: number
  /** rows whose My Review / Private Notes had no read entry to land on (to-read rows) */
  unplacedNotes: number
  /** custom shelves that look like canonical tropes — noted for a FUTURE mapping, never converted */
  tropeLikeShelves: string[]
}

/** 'dark-romance' → 'Dark Romance' (Goodreads shelves are slugs; Reverie shelves are names). */
const shelfDisplayName = (slug: string): string =>
  slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

/** Find-or-create a list by (case-insensitive) name; returns its id and whether it was created. */
async function ensureList(
  ownerId: string,
  name: string,
  kind: 'tbr' | 'collection',
  cache: Map<string, string>,
): Promise<{ id: string; created: boolean }> {
  const key = name.trim().toLowerCase()
  const hit = cache.get(key)
  if (hit) return { id: hit, created: false }
  // Appends to the end of the manual order like every other list creation — the CSV import's
  // shelves used to insert NULL sort_order here and pile, unorderable-by-intent, at the end.
  const sortOrder = await nextListSortOrderFor(ownerId)
  const { data: created, error } = await supabase
    .from('lists')
    .insert({ owner_id: ownerId, name, kind, sort_order: sortOrder })
    .select('id')
    .single()
  if (error) throw error
  const id = (created as { id: string }).id
  cache.set(key, id)
  return { id, created: true }
}

/**
 * Import a Goodreads/StoryGraph CSV. Each row is matched against the library (ISBN 10↔13 →
 * title+author → title+series+position → fuzzy). Strong matches fold into the EXISTING record
 * (its id, list/club memberships, reads, and calendar attribution survive; user-authored fields
 * win); fuzzy near-matches are returned for review (never auto-merged); the rest are inserted.
 * Real reads are loaded up front so re-importing the same file is a no-op.
 *
 * Row extras land here too: `to-read` rows are placed on the "Imported TBR" (created on first
 * sight); custom Bookshelves become Reverie shelves (created on first sight, membership appended,
 * idempotent via the (list_id, book_id) key). Shelves that match canonical tropes are COUNTED for
 * the summary — a future mapping may offer them as tropes; this import never auto-converts.
 */
export async function importCsvToBackend(
  currentBooks: Book[],
  text: string,
  opts: { autoMerge: boolean },
): Promise<{
  added: number
  merged: number
  review: ReviewCandidate[]
  outcomes: ImportItemOutcome[]
  bookIds: string[]
  extras: ImportExtras
}> {
  const ownerId = await currentUserId()
  const rows = parseCsvRows(text)
  const verdicts = await loadVerdicts()

  // PAGED: reading history past the cap would read as "never read".
  const readRows = await pageAll<Record<string, unknown>>('reads', (from, to) =>
    supabase
      .from('reads')
      .select('book_id, read_on, format, rating, notes', { count: 'exact' })
      .order('id')
      .range(from, to),
  )
  const readsByBook = new Map<string, Book['reads']>()
  for (const r of (readRows as {
    book_id: string
    read_on: string | null
    format: string | null
    rating: number | null
    notes: string | null
  }[]) ?? []) {
    const arr = readsByBook.get(r.book_id) ?? []
    arr.push({ date: r.read_on ?? '', format: r.format ?? '', rating: r.rating ?? 0, notes: r.notes ?? '' })
    readsByBook.set(r.book_id, arr)
  }
  const library = currentBooks.map((b) => ({ ...b, reads: readsByBook.get(b.id) ?? [] }))

  let added = 0
  let merged = 0
  let unplacedNotes = 0
  const review: ReviewCandidate[] = []
  const outcomes: ImportItemOutcome[] = []
  const bookIds: string[] = []
  const tbrBookIds: string[] = []
  const shelfBooks = new Map<string, string[]>() // shelf slug → book ids

  for (const row of rows) {
    const res = await applyIncoming(row.incoming, library, ownerId, {
      fuzzy: 'review',
      autoMergeStrong: opts.autoMerge,
      verdicts,
    })
    if (res.outcome === 'added') added++
    else if (res.outcome === 'merged') merged++
    else if (res.outcome === 'review' && res.review) review.push(res.review)
    if (row.unplacedNotes) unplacedNotes++
    if (!res.bookId) continue
    bookIds.push(res.bookId)
    if (res.outcome === 'added' || res.outcome === 'merged') {
      outcomes.push({ bookId: res.bookId, disposition: res.outcome })
    }
    if (row.incoming.wishlist) tbrBookIds.push(res.bookId)
    for (const shelf of row.shelves) {
      const arr = shelfBooks.get(shelf) ?? []
      arr.push(res.bookId)
      shelfBooks.set(shelf, arr)
    }
  }

  // ── placements: Imported TBR + custom shelves (create on first sight, membership appended) ──
  // PAGED: a shelf past the cap looks absent and gets created a second time.
  const listRows = await pageAll<{ id: string; name: string }>('lists', (from, to) =>
    supabase.from('lists').select('id, name', { count: 'exact' }).order('id').range(from, to),
  )
  const listCache = new Map<string, string>(
    listRows.map((l) => [l.name.trim().toLowerCase(), l.id]),
  )

  const shelvesCreated: string[] = []
  let shelved = 0
  const place = async (listId: string, ids: string[]) => {
    if (!ids.length) return
    // Sequential positions from the shelf's current max — the CSV import used to leave every
    // placement NULL, which is exactly the largest-shelf case of the reshuffling defect.
    const base = await nextItemPositionFor(listId)
    const items = [...new Set(ids)].map((book_id, i) => ({
      list_id: listId,
      book_id,
      owner_id: ownerId,
      position: base + i * ITEM_POSITION_STEP,
    }))
    // (list_id, book_id) is the PK — re-imports append nothing, never duplicate.
    const { error, count } = await supabase
      .from('list_items')
      .upsert(items, { onConflict: 'list_id,book_id', ignoreDuplicates: true, count: 'exact' })
    if (error) throw error
    shelved += count ?? 0
  }

  if (tbrBookIds.length) {
    const { id, created } = await ensureList(ownerId, IMPORTED_TBR_NAME, 'tbr', listCache)
    if (created) shelvesCreated.push(IMPORTED_TBR_NAME)
    await place(id, tbrBookIds)
  }
  const tropeLikeShelves: string[] = []
  for (const [slug, ids] of shelfBooks) {
    const name = shelfDisplayName(slug)
    // Trope-shaped shelves ('enemies-to-lovers', 'fae') are still shelves here — the trope system
    // (PR #53) is the right home, but converting is a FUTURE mapping the reader opts into.
    if (isKnownTrope(name)) tropeLikeShelves.push(name)
    const { id, created } = await ensureList(ownerId, name, 'collection', listCache)
    if (created) shelvesCreated.push(name)
    await place(id, ids)
  }

  // ── bulk-empty facts for the honest summary (queried post-merge, so folded rows count right) ──
  const ids = [...new Set(bookIds)]
  const countWhere = async (col: 'cover_url' | 'isbn'): Promise<number> => {
    if (!ids.length) return 0
    const { count, error } = await supabase
      .from('books')
      .select('id', { count: 'exact', head: true })
      .in('id', ids)
      .is(col, null)
    if (error) throw error
    return count ?? 0
  }
  const [noCover, noIsbn] = await Promise.all([countWhere('cover_url'), countWhere('isbn')])

  return {
    added,
    merged,
    review,
    outcomes,
    bookIds: ids,
    extras: { tbrPlaced: tbrBookIds.length, shelvesCreated, shelved, noCover, noIsbn, unplacedNotes, tropeLikeShelves },
  }
}

/**
 * The full library, PAGED — through the same helper the backup uses, so there is one paging
 * discipline in this file rather than two that can drift. Display order is applied afterwards, in
 * libraryCsv.
 */
export async function fetchLibraryPaged(): Promise<Book[]> {
  const rows = await pageAll<BookRow>('books', (from, to) =>
    supabase
      .from('books')
      .select(
        '*, book_authors(position, role, authors(id, name)), book_tropes(emphasis, tropes(id, name)), book_moods(moods(id, name))',
        { count: 'exact' },
      )
      .order('id', { ascending: true })
      .range(from, to),
  )
  return rows.map(toBook)
}

/**
 * The library in the SOURCE FILE'S OWN SCHEMA — see packages/core/src/libraryCsv.ts for why the
 * shape is what it is. Reads through fetchLibraryPaged rather than the useBooks cache on purpose:
 * that query is itself un-ranged, so an export served from it would inherit the very cap this is
 * written to avoid.
 */
export async function buildLibraryCsv(): Promise<string> {
  return libraryCsv(await fetchLibraryPaged())
}
