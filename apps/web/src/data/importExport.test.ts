import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tombstoneRows } from './importExport'
import type { BackupSeriesEntryRow } from './importExport'

// A tiny in-memory stand-in for the PostgREST client. It is NOT a PostgREST implementation — it
// understands exactly the queries importExport.ts issues, and resolves the two embedded selects
// (book_tropes→tropes, book_moods→moods) by hand. That is enough to drive the real buildBackup and
// restoreBackup end to end, which is the point: these tests assert that a reader's tropes, moods
// and followed authors come back out of a round trip, not that a hand-written plan looks right.

interface Row {
  [k: string]: unknown
}
/** The tables importExport.ts touches. A literal union (not an index signature) so the strict
 *  `noUncheckedIndexedAccess` build still sees every table as present. */
type Table =
  | 'discovery_sessions'
  | 'books'
  | 'tropes'
  | 'moods'
  | 'book_tropes'
  | 'book_moods'
  | 'author_follows'
  | 'reads'
  | 'lists'
  | 'list_items'
  | 'reviews'
  | 'reading_orders'
  | 'reading_order_items'
  | 'merge_verdicts'
  | 'series'
  | 'series_entries'
  | 'trope_suggestions'
  | 'series_merge_decisions'
  | 'profiles'
type Db = Record<Table, Row[]>

const TABLES: Table[] = [
  'discovery_sessions',
  'books', 'tropes', 'moods', 'book_tropes', 'book_moods', 'author_follows', 'reads', 'lists',
  'list_items', 'reviews', 'reading_orders', 'reading_order_items', 'merge_verdicts', 'series',
  'series_entries', 'trope_suggestions', 'series_merge_decisions', 'profiles',
]

const OWNER = 'user-old'
const NEW_OWNER = 'user-new'

let db: Db
let currentUser = OWNER
let seq = 0
const realisticUuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const uuid = () => realisticUuid(++seq)

/** Read a string column off an untyped fake row. */
const str = (r: Row | undefined, col: string): string => String(r?.[col] ?? '')

/** Every query the code under test issued — the evidence for the coverage guard at the bottom. */
interface Access {
  table: Table
  columns: string
  mode: 'select' | 'insert' | 'upsert' | 'update'
  /** `.range()` was called — i.e. this read pages. */
  ranged: boolean
  /** `.order()` was called — i.e. the pages are disjoint. */
  ordered: boolean
  /** `.single()`/`.maybeSingle()`, or a head-only count: reads no row set, so paging is moot. */
  bounded: boolean
  /** Write payload, retained so ordering-sensitive restore tests can assert the staged state. */
  values?: Row[]
  /** `.in()` filters, retained so URL-size-sensitive writes cannot hide behind the in-memory fake. */
  inclusions?: { column: string; values: unknown[] }[]
}
let access: Access[] = []
/** When true, the fake serves only the first PAGE_CAP rows and ignores the requested window. */
let ignoreRange = false
let unorderedReads = 0
const PAGE_CAP = 1000

/** Embedded-select resolution, keyed by the exact select string the code under test uses. */
function project(table: Table, columns: string, rows: Row[]): Row[] {
  if (table === 'book_tropes' && columns.includes('tropes(')) {
    return rows.map((r) => ({
      book_id: r.book_id,
      emphasis: r.emphasis,
      tropes: db.tropes.find((t) => t.id === r.trope_id) ?? null,
    }))
  }
  if (table === 'book_moods' && columns.includes('moods(')) {
    return rows.map((r) => ({
      book_id: r.book_id,
      moods: db.moods.find((m) => m.id === r.mood_id) ?? null,
    }))
  }
  if (table === 'series_entries' && columns.includes('series(')) {
    return rows.map((r) => ({
      position: r.position, label: r.label, title: r.title, author: r.author,
      source: r.source, removed_at: r.removed_at,
      series: db.series.find((x) => x.id === r.series_id) ?? null,
    }))
  }
  if (table === 'trope_suggestions' && columns.includes('tropes(')) {
    return rows.map((r) => ({
      book_id: r.book_id, state: r.state,
      tropes: db.tropes.find((t) => t.id === r.trope_id) ?? null,
    }))
  }
  if (table === 'books' && columns.includes('book_authors(')) {
    return rows.map((r) => ({ id: r.id, book_authors: [] }))
  }
  if (table === 'reading_orders' && columns.includes('reading_order_items(')) {
    return rows.map((r) => ({
      ...r,
      reading_order_items: db.reading_order_items
        .filter((i) => i.reading_order_id === r.id)
        .map((i) => ({ position: i.position, book_id: i.book_id, series: i.series, note: i.note })),
    }))
  }
  return rows
}

class Query implements PromiseLike<{ data: Row[] | Row | null; error: unknown }> {
  private filters: [string, unknown][] = []
  private inclusions: [string, unknown[]][] = []
  private notEquals: [string, unknown][] = []
  private negated: string[] = []
  private columns = '*'
  private exactCount = false
  private rangeCalled = false
  private head = false
  private orderBy: string[] = []
  private window: { from: number; to: number } | null = null
  private pending: Row[] | null = null
  private mode: 'select' | 'insert' | 'upsert' | 'update' = 'select'
  private patch: Row | null = null

  constructor(private table: Table) {}

  select(columns = '*', opts?: { count?: string; head?: boolean }) {
    this.columns = columns
    this.exactCount = opts?.count === 'exact'
    this.head = opts?.head === true
    return this
  }
  /** Paging, as PostgREST does it: a total order, a window, and a full-set count alongside the
   *  page. The stand-in has to model all three, because buildBackup's truncation guard compares
   *  the rows it read against the count the server reported — a fake that ignored either would
   *  make that guard untestable. */
  order(col: string, _opts?: { ascending?: boolean }) {
    this.orderBy.push(col)
    return this
  }
  range(from: number, to: number) {
    this.rangeCalled = true
    // `ignoreRange` models the pre-fix code path exactly: PostgREST returns its first page and the
    // caller never asks for a second. Not an artificial fault — it is what this file did until
    // this commit, and what a future edit that drops `.range()` would restore.
    if (!ignoreRange) this.window = { from, to }
    return this
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }
  is(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }
  in(col: string, values: unknown[]) {
    this.inclusions.push([col, values])
    return this
  }
  /** `.neq('ruling', 'same')` — the only not-equal filter the code under test uses. */
  neq(col: string, val: unknown) {
    this.notEquals.push([col, val])
    return this
  }
  /** `.not('removed_at', 'is', null)` — the only negated filter the code under test uses. */
  not(col: string, _op: string, _val: unknown) {
    this.negated.push(col)
    return this
  }
  insert(rows: Row | Row[]) {
    this.mode = 'insert'
    this.pending = Array.isArray(rows) ? rows : [rows]
    return this
  }
  upsert(rows: Row | Row[], _opts?: unknown) {
    this.mode = 'upsert'
    this.pending = Array.isArray(rows) ? rows : [rows]
    return this
  }
  update(patch: Row) {
    this.mode = 'update'
    this.patch = patch
    return this
  }
  single() {
    return this.run(true)
  }
  maybeSingle() {
    return this.run(true)
  }
  then<A, B>(
    onOk?: ((v: { data: Row[] | Row | null; error: unknown; count: number | null }) => A | PromiseLike<A>) | null,
    onErr?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run(false).then(onOk, onErr)
  }

  private async run(single: boolean): Promise<{ data: Row[] | Row | null; error: unknown; count: number | null }> {
    access.push({
      table: this.table,
      columns: this.columns,
      mode: this.mode,
      ranged: this.rangeCalled,
      ordered: this.orderBy.length > 0,
      bounded: single || this.head,
      values:
        this.mode === 'insert' || this.mode === 'upsert'
          ? structuredClone(this.pending ?? [])
          : this.mode === 'update' && this.patch
            ? [structuredClone(this.patch)]
            : undefined,
      inclusions: this.inclusions.map(([column, values]) => ({
        column,
        values: structuredClone(values),
      })),
    })
    const table = db[this.table]
    if (this.mode === 'insert' || this.mode === 'upsert') {
      const written: Row[] = (this.pending ?? []).map((r) => ({ id: r.id ?? uuid(), ...r }))
      for (const row of written) {
        // Upsert on the join tables' composite key; every other write appends.
        const dupe =
          this.mode === 'upsert'
            ? table.find((e) =>
                this.table === 'book_tropes'
                  ? e.book_id === row.book_id && e.trope_id === row.trope_id
                  : this.table === 'book_moods'
                    ? e.book_id === row.book_id && e.mood_id === row.mood_id
                    : this.table === 'author_follows'
                      ? e.user_id === row.user_id && e.author_name === row.author_name
                      : false,
              )
            : undefined
        if (dupe) Object.assign(dupe, row)
        else table.push(row)
      }
      const data = project(this.table, this.columns, written)
      return { data: single ? (data[0] ?? null) : data, error: null, count: null }
    }
    if (this.mode === 'update') {
      for (const row of table.filter((r) => this.matches(r))) Object.assign(row, this.patch)
      return { data: null, error: null, count: null }
    }
    const matched = table.filter(
      (r) =>
        this.matches(r) &&
        this.notEquals.every(([c, v]) => r[c] !== v) &&
        this.negated.every((c) => r[c] != null),
    )
    if (this.orderBy.length) {
      for (const col of [...this.orderBy].reverse())
        matched.sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')))
    } else {
      // AN UNORDERED SELECT HAS NO STABLE ORDER, and Postgres does not pretend otherwise. Rotated
      // per request so no test can come to depend on insertion order from an unordered read.
      //
      // This is a FAITHFULNESS measure, not the ordering guard: it was written as the guard, and
      // mutation testing showed it does not reliably catch a dropped `.order()` — the rotation is
      // small enough that the windows still happen to tile. The read-must-be-ordered property is
      // asserted at the call site instead (see the every-multi-row-read test).
      unorderedReads++
      const k = unorderedReads % (matched.length || 1)
      matched.push(...matched.splice(0, k))
    }
    // The count is of the WHOLE match, not the window — that is what `{ count: 'exact' }` means,
    // and it is the only reason buildBackup can tell a short page from a finished read.
    const count = this.exactCount ? matched.length : null
    const windowed = this.window
      ? matched.slice(this.window.from, this.window.to + 1)
      : matched.slice(0, PAGE_CAP)
    const hits = project(this.table, this.columns, windowed)
    return { data: single ? (hits[0] ?? null) : hits, error: null, count }
  }

  private matches(row: Row): boolean {
    return (
      this.filters.every(([column, value]) => row[column] === value) &&
      this.inclusions.every(([column, values]) => values.includes(row[column]))
    )
  }
}

/**
 * A hand-made / pre-v6 backup, built by editing a real export.
 *
 * v6 files declare their own row counts and `restoreBackup` refuses one whose payload disagrees —
 * so a fixture that edits the payload has to drop the manifest, because that is what the file it
 * is standing in for actually looks like. Keeping a stale manifest would test the guard, not the
 * tolerance these cases are about; the guard has its own tests, which assert the refusal directly.
 */
const handMade = (parsed: Record<string, unknown>): string => {
  delete parsed.counts
  return JSON.stringify(parsed)
}

const legacySeriesBackup = (parsed: Record<string, unknown>): string => {
  delete parsed.series
  delete parsed.series_entries
  parsed.v = 6
  return handMade(parsed)
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: currentUser } } }) },
    from: (table: string) => new Query(table as Table),
  },
}))
// Contributor persistence has its own RPC and its own tests; it is not what these assert.
vi.mock('./contributors', () => ({ persistContributors: vi.fn(async () => {}) }))

const { buildBackup, restoreBackup, seriesTombstones, dismissalsByBook, seriesRulingRows } = await import('./importExport')
const { BACKED_UP_TABLES, USER_OWNED_TABLES } = await import('./ownedTables')

/** A library with two books, canonical + personal tropes, a mood, and two followed authors. */
function seedOldAccount() {
  db = {
    books: [
      { id: 'book-a', owner_id: OWNER, title: 'Fourth Wing', genre: 'romance' },
      { id: 'book-b', owner_id: OWNER, title: 'Iron Flame', genre: 'romance' },
    ],
    tropes: [
      { id: 't-canon', owner_id: null, name: 'Enemies to Lovers', facet: 'dynamics' },
      { id: 't-mine', owner_id: OWNER, name: 'Dragons With Opinions', facet: 'vibe' },
    ],
    moods: [{ id: 'm-canon', owner_id: null, name: 'Devastating' }],
    book_tropes: [
      { book_id: 'book-a', trope_id: 't-canon', owner_id: OWNER, emphasis: 'pinned' },
      { book_id: 'book-a', trope_id: 't-mine', owner_id: OWNER, emphasis: 'present' },
      { book_id: 'book-b', trope_id: 't-mine', owner_id: OWNER, emphasis: 'pinned' },
    ],
    book_moods: [{ book_id: 'book-a', mood_id: 'm-canon', owner_id: OWNER }],
    author_follows: [
      { user_id: OWNER, author_name: 'Rebecca Yarros', state: 'followed' },
      { user_id: OWNER, author_name: 'A Noisy Newsletter', state: 'muted' },
    ],
    // Every other backed-up table carries at least one row, so the coverage guard below exercises
    // the real write path for each rather than passing because a section happened to be empty.
    reads: [{ id: 'r1', book_id: 'book-a', owner_id: OWNER, read_on: '2026-03-04', format: 'ebook', rating: 5, notes: 'reread' }],
    lists: [{ id: 'l1', owner_id: OWNER, name: 'Imported TBR', kind: 'tbr', is_priority: true }],
    list_items: [{ list_id: 'l1', book_id: 'book-b', owner_id: OWNER, position: 1 }],
    reviews: [{ id: 'rv1', work_key: 'w-fourth-wing', reviewer_id: OWNER, reviewer_name: 'Reader', rating: 5, body: 'Dragons.' }],
    reading_orders: [{ id: 'ro1', owner_id: OWNER, name: 'Empyrean — reading order', description: 'publication order' }],
    reading_order_items: [
      { reading_order_id: 'ro1', owner_id: OWNER, position: 1024, book_id: 'book-a', series: null, note: null },
      { reading_order_id: 'ro1', owner_id: OWNER, position: 2048, book_id: 'book-b', series: null, note: 'read after B1' },
    ],
    merge_verdicts: [{ owner_id: OWNER, book_id: 'book-a', incoming_key: 'fourth wing|yarros', verdict: 'distinct' }],
    // ── the reader's refusals ──
    series: [{ id: 'ser1', owner_id: OWNER, name: 'Empyrean' }],
    series_entries: [
      // A LIVE slot (removed_at null) — must NOT be exported; it is derived and reconciles itself.
      { id: 'se-live', series_id: 'ser1', owner_id: OWNER, position: 1, title: 'Fourth Wing', author: 'Rebecca Yarros', label: null, source: 'hardcover', book_id: 'book-a', user_edited: false, removed_at: null, is_primary: true, membership_claim: { origin: 'reader', source: 'series_review' }, position_claim: { origin: 'corpus', source: 'hardcover' } },
      // A TOMBSTONE — the reader deleted this slot and a refresh must never resurrect it.
      { id: 'se-dead', series_id: 'ser1', owner_id: OWNER, position: 3, title: 'Onyx Storm', author: 'Rebecca Yarros', label: 'Book 3', source: 'hardcover', book_id: null, user_edited: true, removed_at: '2026-07-01T10:00:00.000Z', is_primary: false, membership_claim: { origin: 'reader', source: 'series_remove' }, position_claim: { origin: 'unknown' } },
    ],
    trope_suggestions: [
      // OPEN — a pending question, not a decision; must NOT travel.
      { book_id: 'book-a', trope_id: 't-canon', owner_id: OWNER, state: 'open', source: 'hardcover' },
      // DISMISSED — the reader waved it away; must survive.
      { book_id: 'book-b', trope_id: 't-canon', owner_id: OWNER, state: 'dismissed', source: 'hardcover' },
    ],
    series_merge_decisions: [
      // DISTINCT — the reader said no; must survive so the pair is never re-proposed.
      { id: 'smd-distinct', owner_id: OWNER, name_key_a: 'fourth wing', name_key_b: 'iron flame', ruling: 'distinct', surviving_series_id: null, alias_name: null },
      // RELATED_BUT_SEPARATE — siblings, not duplicates; also a refusal-to-merge and must travel.
      { id: 'smd-siblings', owner_id: OWNER, name_key_a: 'mountain men', name_key_b: 'mountain men matchmaker', ruling: 'related_but_separate', surviving_series_id: null, alias_name: null },
      // SAME — already reflected in the merged books/series_entries data; must NOT travel (its
      // surviving_series_id can't be remapped onto the new account's regenerated series ids).
      { id: 'smd-same', owner_id: OWNER, name_key_a: 'acotar', name_key_b: 'a court of thorns and roses', ruling: 'same', surviving_series_id: 'ser1', alias_name: 'ACOTAR' },
    ],
    discovery_sessions: [{ owner_id: OWNER, id: 'f9100000-0000-4000-8000-000000000001', document: { version: 1, id: 'f9100000-0000-4000-8000-000000000001', createdAt: '2026-09-06T00:00:00.000Z', intent: { kind: 'mood', moods: ['Hopeful'] }, picks: [{ book: { title: 'A welcome', authors: ['Nell Stone'], cover: '', isbn: '', pub: '' }, reason: 'A hopeful description.', basis: 'description' }], dismissed: [] } }],
    profiles: [
      {
        id: OWNER,
        display_name: 'Reader',
        skin: 'tryst',
        arrangement: {
          version: 1,
          priorityDestinations: ['library', 'home', 'stats'],
          homeModules: ['reading', 'year'],
        },
      },
    ],
  }
  // A PERSONAL mood too, so the mood-coining write path is covered like the trope one.
  db.moods.push({ id: 'm-mine', owner_id: OWNER, name: 'Unhinged In A Good Way' })
  db.book_moods.push({ book_id: 'book-b', mood_id: 'm-mine', owner_id: OWNER })
}

/** Wipe every owned row — what delete-account's cascade does, verified against a live database —
 *  keeping only the canonical vocabulary, which is shared and correctly survives. */
function wipeToFreshAccount({ keepCanonical = true } = {}) {
  const canonicalTropes = keepCanonical ? db.tropes.filter((t) => t.owner_id === null) : []
  const canonicalMoods = keepCanonical ? db.moods.filter((m) => m.owner_id === null) : []
  db = Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])) as Db
  db.tropes = canonicalTropes
  db.moods = canonicalMoods
  db.profiles = [{ id: NEW_OWNER, display_name: '', skin: 'tryst' }]
  currentUser = NEW_OWNER
}

beforeEach(() => {
  seq = 0
  currentUser = OWNER
  access = []
  ignoreRange = false
  unorderedReads = 0
  seedOldAccount()
})

describe('backup round trip — the data v4 dropped on the floor', () => {
  it('preserves reading-plan membership, order, and intention with the book row', async () => {
    Object.assign(db.books[0]!, {
      plan_y: null,
      plan_m: null,
      plan_d: null,
      plan_position: 2048,
      plan_intention: 'Return when the weather turns.',
    })
    const json = await buildBackup()
    wipeToFreshAccount()

    await restoreBackup(json)

    expect(db.books).toHaveLength(2)
    expect(db.books.find((book) => book.title === 'Fourth Wing')).toMatchObject({
      plan_y: null,
      plan_m: null,
      plan_d: null,
      plan_position: 2048,
      plan_intention: 'Return when the weather turns.',
    })
  })

  it('carries tropes, moods and followed authors through export → restore', async () => {
    const json = await buildBackup()
    wipeToFreshAccount()

    const result = await restoreBackup(json)

    expect(result.books).toBe(2)
    expect(result.tropes).toBe(3)
    expect(result.moods).toBe(2)
    expect(result.follows).toBe(2)

    // Every assignment landed, on the NEW book ids, owned by the NEW account.
    expect(db.book_tropes).toHaveLength(3)
    expect(db.book_tropes.every((r) => r.owner_id === NEW_OWNER)).toBe(true)
    expect(db.book_tropes.some((r) => r.book_id === 'book-a')).toBe(false) // ids remapped, not reused

    const byTitle = (t: string) => str(db.books.find((b) => b.title === t), 'id')
    const tropeName = (r: Row) => str(db.tropes.find((t) => t.id === r.trope_id), 'name')
    const namesOn = (title: string) =>
      db.book_tropes.filter((r) => r.book_id === byTitle(title)).map(tropeName).sort()

    expect(namesOn('Fourth Wing')).toEqual(['Dragons With Opinions', 'Enemies to Lovers'])
    expect(namesOn('Iron Flame')).toEqual(['Dragons With Opinions'])

    // Emphasis is part of the reader's authorship — a pin must not come back as a plain present.
    const pinned = db.book_tropes.find(
      (r) => r.book_id === byTitle('Fourth Wing') && tropeName(r) === 'Enemies to Lovers',
    )
    expect(str(pinned, 'emphasis')).toBe('pinned')

    // Moods — the canonical one and the reader's own coinage.
    expect(db.book_moods).toHaveLength(2)
    const moodNameFor = (title: string) =>
      db.book_moods
        .filter((r) => r.book_id === byTitle(title))
        .map((r) => str(db.moods.find((m) => m.id === r.mood_id), 'name'))
    expect(moodNameFor('Fourth Wing')).toEqual(['Devastating'])
    expect(moodNameFor('Iron Flame')).toEqual(['Unhinged In A Good Way'])

    // Follows, with muted still muted — the states are opposites, so a flip would be a real defect.
    expect(
      db.author_follows
        .map((f) => ({ author: str(f, 'author_name'), state: str(f, 'state') }))
        .sort((a, b) => a.author.localeCompare(b.author)),
    ).toEqual([
      { author: 'A Noisy Newsletter', state: 'muted' },
      { author: 'Rebecca Yarros', state: 'followed' },
    ])
  })

  it('replays historical tropes before restoring owned household eligibility', async () => {
    db.books[0]!.ownership = 'owned'
    db.books[1]!.ownership = 'unowned'
    const json = await buildBackup()
    wipeToFreshAccount()
    access = []

    await restoreBackup(json)

    const firstBookInsert = access.find(
      (entry) => entry.table === 'books' && entry.mode === 'insert',
    )
    const tropeReplayIndex = access.findIndex(
      (entry) => entry.table === 'book_tropes' && entry.mode === 'upsert',
    )
    const ownershipRestoreIndex = access.findIndex(
      (entry) => entry.table === 'books' && entry.mode === 'update',
    )
    expect(firstBookInsert?.values?.[0]?.ownership).toBe('unowned')
    expect(tropeReplayIndex).toBeGreaterThanOrEqual(0)
    expect(ownershipRestoreIndex).toBeGreaterThan(tropeReplayIndex)
    expect(db.books.find((book) => book.title === 'Fourth Wing')?.ownership).toBe('owned')
    expect(db.books.find((book) => book.title === 'Iron Flame')?.ownership).toBe('unowned')
  })

  it('restores more than 300 owned books through bounded UUID filters', async () => {
    const bookCount = 305
    const books = Array.from({ length: bookCount }, (_, index) => ({
      id: realisticUuid(10_000 + index),
      owner_id: OWNER,
      title: `Restored owned book ${index}`,
      genre: 'literary',
      ownership: 'owned',
    }))
    wipeToFreshAccount()
    access = []

    await restoreBackup(JSON.stringify({ books }))

    const ownershipUpdates = access.filter(
      (entry) =>
        entry.table === 'books' &&
        entry.mode === 'update' &&
        entry.values?.[0]?.ownership === 'owned',
    )
    const idBatches = ownershipUpdates.map(
      (entry) => entry.inclusions?.find((filter) => filter.column === 'id')?.values ?? [],
    )
    const restoredIds = idBatches.flat()

    expect(idBatches.map((batch) => batch.length)).toEqual([100, 100, 100, 5])
    expect(restoredIds).toHaveLength(bookCount)
    expect(new Set(restoredIds).size).toBe(bookCount)
    expect(restoredIds.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(String(id)))).toBe(true)
    expect(db.books).toHaveLength(bookCount)
    expect(db.books.every((book) => book.owner_id === NEW_OWNER && book.ownership === 'owned')).toBe(
      true,
    )
  })

  it('re-coins the reader’s personal vocabulary, and reuses canonical rows instead of duplicating them', async () => {
    const json = await buildBackup()
    wipeToFreshAccount() // canonical survives an account deletion; the personal coinage does not

    await restoreBackup(json)

    // The canonical trope was reused, not cloned.
    const enemies = db.tropes.filter((t) => t.name === 'Enemies to Lovers')
    expect(enemies).toHaveLength(1)
    expect(enemies[0]?.owner_id).toBeNull()

    // The personal one was re-coined for the new owner, keeping its facet.
    const dragons = db.tropes.filter((t) => t.name === 'Dragons With Opinions')
    expect(dragons).toHaveLength(1)
    expect(dragons[0]?.owner_id).toBe(NEW_OWNER)
    expect(dragons[0]?.facet).toBe('vibe')
  })

  it('restores into an account with NO canonical vocabulary at all (a bare database)', async () => {
    const json = await buildBackup()
    wipeToFreshAccount({ keepCanonical: false })

    const result = await restoreBackup(json)

    expect(result.tropes).toBe(3)
    expect(result.moods).toBe(2)
    // Everything had to be coined; nothing was silently dropped for want of a vocabulary row.
    expect(db.tropes.map((t) => str(t, 'name')).sort()).toEqual(['Dragons With Opinions', 'Enemies to Lovers'])
    expect(db.moods.map((m) => str(m, 'name')).sort()).toEqual(['Devastating', 'Unhinged In A Good Way'])
  })

  it('matches vocabulary case-insensitively, the way the DB unique index does', async () => {
    const json = await buildBackup()
    wipeToFreshAccount({ keepCanonical: false })
    // The new account already knows the trope, but spelled differently.
    db.tropes.push({ id: 't-other', owner_id: null, name: 'enemies TO lovers', facet: 'dynamics' })

    await restoreBackup(json)

    expect(db.tropes.filter((t) => str(t, 'name').toLowerCase() === 'enemies to lovers')).toHaveLength(1)
    expect(db.book_tropes.some((r) => r.trope_id === 't-other')).toBe(true)
  })

  it('is idempotent: restoring the same file twice does not double the assignments', async () => {
    const json = await buildBackup()
    wipeToFreshAccount()

    await restoreBackup(json)
    const tropesAfterFirst = db.book_tropes.length
    await restoreBackup(json)

    // The books duplicate (a restore is an add, by design), but no book gains a duplicate trope
    // row, and the follow list stays one row per author.
    const perBook = new Map<unknown, number>()
    for (const r of db.book_tropes) perBook.set(`${r.book_id}|${r.trope_id}`, (perBook.get(`${r.book_id}|${r.trope_id}`) ?? 0) + 1)
    expect([...perBook.values()].every((n) => n === 1)).toBe(true)
    expect(db.book_tropes.length).toBe(tropesAfterFirst * 2) // second set of books, still 1:1
    expect(db.author_follows).toHaveLength(2)

    // Each restored book keeps a live membership. The negative ghost tombstone remains one refusal,
    // and the second live copy appends rather than colliding with the first copy's position.
    expect(db.series_entries).toHaveLength(3)
    const dead = db.series_entries.filter((row) => !!row.removed_at)
    expect(dead).toHaveLength(1)
    const livePositions = db.series_entries
      .filter((row) => !row.removed_at)
      .map((row) => `${str(row, 'series_id')}@${row.position}`)
    expect(new Set(livePositions).size).toBe(livePositions.length)
    expect(db.series).toHaveLength(1) // and the parent series was reused, not duplicated

    // Dismissals DO get a row per restored book copy — that is the same additive semantics as
    // book_tropes (each restore makes new books), not a duplicate: the (book_id, trope_id) key is
    // distinct every time. Asserted rather than assumed, since the two tables differ here.
    expect(db.trope_suggestions).toHaveLength(2)
    const perSuggestion = new Set(db.trope_suggestions.map((r) => `${str(r, 'book_id')}|${str(r, 'trope_id')}`))
    expect(perSuggestion.size).toBe(2)
  })

  it('a tombstone is not added beside a LIVE slot the account already has at that position', async () => {
    const parsed = JSON.parse(await buildBackup()) as Record<string, unknown>
    wipeToFreshAccount()
    // The new account re-added the book the backup says was removed — a later decision than the
    // backup's, so it must win.
    db.series.push({ id: 'ser-new', owner_id: NEW_OWNER, name: 'Empyrean' })
    db.series_entries.push({
      id: 'se-live-new', series_id: 'ser-new', owner_id: NEW_OWNER, position: 3,
      title: 'Onyx Storm', author: 'Rebecca Yarros', book_id: 'some-book', user_edited: false, removed_at: null,
    })

    const result = await restoreBackup(legacySeriesBackup(parsed))

    expect(result.tombstones).toBe(0)
    expect(db.series_entries).toHaveLength(1)
    expect(db.series_entries[0]?.removed_at).toBeNull()
  })

  it('dedupes repeated slots WITHIN a single hand-edited file', async () => {
    const parsed = JSON.parse(await buildBackup()) as { series_tombstones: unknown[] }
    parsed.series_tombstones = [parsed.series_tombstones[0], parsed.series_tombstones[0]]
    wipeToFreshAccount()

    const result = await restoreBackup(legacySeriesBackup(parsed as Record<string, unknown>))

    expect(result.tombstones).toBe(1)
    expect(db.series_entries).toHaveLength(1)
  })

  it('reads a v4 file (no tropes/moods/follows) without complaint', async () => {
    const json = await buildBackup()
    const v4 = JSON.parse(json) as Record<string, unknown>
    delete v4.tropes
    delete v4.moods
    delete v4.author_follows
    v4.v = 4
    wipeToFreshAccount()

    // A genuine v4 file predates the counts manifest entirely — see handMade.
    const result = await restoreBackup(legacySeriesBackup(v4))

    expect(result.books).toBe(2)
    expect(result).toMatchObject({ tropes: 0, moods: 0, follows: 0 })
    expect(db.book_tropes).toHaveLength(0)
  })

  it('a v5 archive carrying reading_orders restores everything else, ignoring that key', async () => {
    // Reading orders were dropped (chore/drop-reading-orders): the app stopped touching those
    // tables in S1 and they go in S2. Archives made BEFORE that still carry the key, and a reader
    // restoring one must not meet an error over a subsystem that no longer exists — the key is
    // skipped, and nothing else is disturbed.
    //
    // Hand-built rather than round-tripped, precisely because buildBackup no longer emits the key:
    // an archive produced today could not exercise this path at all.
    const parsed = JSON.parse(await buildBackup()) as Record<string, unknown>
    expect(parsed.reading_orders, 'a current export must not write the key at all').toBeUndefined()

    parsed.reading_orders = [
      {
        name: 'Empyrean — reading order',
        description: 'publication order',
        reading_order_items: [
          { position: 1024, book_id: 'book-a', series: null, note: null },
          { position: 2048, book_id: 'book-b', series: null, note: 'read after B1' },
          { position: 3072, book_id: null, series: 'Crescent City', note: null },
        ],
      },
    ]
    wipeToFreshAccount()

    const result = await restoreBackup(legacySeriesBackup(parsed as Record<string, unknown>))

    // Everything else lands intact…
    expect(result.books).toBe(2)
    expect(db.books).toHaveLength(2)
    expect(db.reads.length).toBeGreaterThan(0)
    expect(db.lists.length).toBeGreaterThan(0)
    expect(db.book_tropes.length).toBeGreaterThan(0)
    expect(db.series_entries.length).toBeGreaterThan(0) // the refusals survive too

    // …and not one reading-order row is written.
    expect(db.reading_orders, 'the dropped subsystem must not be recreated').toHaveLength(0)
    expect(db.reading_order_items).toHaveLength(0)
  })

  it('an archive carrying plan_date restores cleanly, ignoring the key, with the trio intact', async () => {
    // Same contract as reading_orders above, one structural step harder. That was a top-level key
    // nothing read; plan_date is a COLUMN inside every book row, carried into the archive by the
    // export's `select('*')` and previously written straight back by the restore spread. It has to
    // be STRIPPED, not merely skipped.
    //
    // The failure this prevents lands on the NEXT branch, not this one: once the column is dropped,
    // an insert still carrying the key makes PostgREST reject the row and takes the whole restore
    // down with it. So the assertion is not "the plan survives" — it is "the key never reaches the
    // insert", which is what stays true after the column is gone.
    const parsed = JSON.parse(await buildBackup()) as { books: Record<string, unknown>[] }

    // Hand-planted: a current export cannot produce this, because nothing writes plan_date anymore.
    // The trio and the legacy column deliberately DISAGREE, so a restore that wrote plan_date back
    // could not be mistaken for one that merely carried the trio through.
    parsed.books = parsed.books.map((b) => ({
      ...b,
      plan_date: '2019-01-01',
      plan_y: 2026,
      plan_m: 3,
      plan_d: null,
    }))
    wipeToFreshAccount()

    const result = await restoreBackup(legacySeriesBackup(parsed as Record<string, unknown>))

    // It restores rather than throwing — the archive predates the drop and must still be readable.
    expect(result.books).toBe(2)
    expect(db.books).toHaveLength(2)

    // The key never reaches the insert. This is the assertion that survives the column drop, and
    // the one a "silently write it back" implementation fails.
    for (const b of db.books) {
      expect(Object.keys(b), 'plan_date must be stripped before the insert').not.toContain('plan_date')
    }

    // …and the plan itself came through, from the trio, at the precision it was stored at.
    for (const b of db.books) {
      expect(b).toMatchObject({ plan_y: 2026, plan_m: 3, plan_d: null })
    }
  })

  it('exports v8 with taxonomy, structured series authority, and the account arrangement', async () => {
    const parsed = JSON.parse(await buildBackup()) as {
      v: number
      tropes: Record<string, { name: string; emphasis: string }[]>
      moods: Record<string, { name: string }[]>
      author_follows: { author_name: string; state: string }[]
      profile: Record<string, unknown>
    }
    expect(parsed.v).toBe(9)
    expect((parsed.tropes['book-a'] ?? []).map((t) => t.name).sort()).toEqual(['Dragons With Opinions', 'Enemies to Lovers'])
    expect(parsed.moods['book-a']).toEqual([{ name: 'Devastating' }])
    expect(parsed.author_follows).toHaveLength(2)
    expect(parsed.profile.arrangement).toEqual({
      version: 1,
      priorityDestinations: ['library', 'home', 'stats'],
      homeModules: ['reading', 'year'],
    })
  })
})

describe('backup round trip — hostile and partial files', () => {
  it('drops a follow whose state is neither followed nor muted rather than guessing', async () => {
    const parsed = JSON.parse(await buildBackup()) as Record<string, unknown>
    parsed.author_follows = [
      { author_name: 'Rebecca Yarros', state: 'followed' },
      { author_name: 'Someone', state: 'banished' },
      { author_name: '', state: 'followed' },
    ]
    wipeToFreshAccount()

    const result = await restoreBackup(handMade(parsed))

    expect(result.follows).toBe(1)
    expect(db.author_follows.map((f) => str(f, 'author_name'))).toEqual(['Rebecca Yarros'])
  })

  it('coerces an unknown emphasis to present, and an unknown facet to vibe', async () => {
    const parsed = JSON.parse(await buildBackup()) as {
      tropes: Record<string, { name: string; facet: string; emphasis: string }[]>
    }
    parsed.tropes['book-a'] = [{ name: 'Brand New Thing', facet: 'nonsense', emphasis: 'shouted' }]
    wipeToFreshAccount({ keepCanonical: false })

    await restoreBackup(handMade(parsed))

    const coined = db.tropes.find((t) => t.name === 'Brand New Thing')
    expect(str(coined, 'facet')).toBe('vibe')
    expect(str(db.book_tropes.find((r) => r.trope_id === coined?.id), 'emphasis')).toBe('present')
  })

  it('skips assignments for a book that did not come across, instead of failing the restore', async () => {
    const parsed = JSON.parse(await buildBackup()) as {
      tropes: Record<string, { name: string; facet: string; emphasis: string }[]>
    }
    parsed.tropes['book-that-never-existed'] = [{ name: 'Enemies to Lovers', facet: 'dynamics', emphasis: 'pinned' }]
    wipeToFreshAccount()

    const result = await restoreBackup(handMade(parsed))

    expect(result.books).toBe(2)
    expect(result.tropes).toBe(3) // the three real ones; the orphan is skipped, not thrown on
  })
})

// ── the structural guard: the registry must describe what the code actually does ──
//
// ownedTables.test.ts proves nothing user-owned escapes the registry and that deletion cascades to
// all of it. This half proves the other direction: a table declared `backup: true` is genuinely
// read by buildBackup AND written by restoreBackup. Together they close the v4 gap — a new
// user-owned table cannot be added without a written decision, and a decision to back it up cannot
// be left unimplemented.
describe('backup coverage matches the ownedTables registry', () => {
  /** Drive a full export → restore and report every table the two touched. */
  async function recordFullCycle() {
    const json = await buildBackup()
    const reads = access.filter((a) => a.mode === 'select')
    access = []
    wipeToFreshAccount()
    await restoreBackup(json)
    const writes = access.filter((a) => a.mode !== 'select')
    return { reads, writes }
  }

  it('every table declared backup:true is read by buildBackup and written by restoreBackup', async () => {
    const { reads, writes } = await recordFullCycle()
    const readTables = new Set<string>(reads.map((a) => a.table))
    const writtenTables = new Set<string>(writes.map((a) => a.table))

    const missing: string[] = []
    for (const entry of BACKED_UP_TABLES) {
      const plan = entry.plan as { backup: true; via?: string }
      if (plan.via) {
        // Read through a parent's embedded select (PostgREST `parent(child(...))`).
        const embedded = reads.some((a) => a.table === plan.via && a.columns.includes(`${entry.table}(`))
        if (!embedded) missing.push(`${entry.table} (not embedded in a ${plan.via} select)`)
      } else if (!readTables.has(entry.table)) {
        missing.push(`${entry.table} (never read by buildBackup)`)
      }
      if (!writtenTables.has(entry.table)) missing.push(`${entry.table} (never written by restoreBackup)`)
    }

    expect(
      missing,
      'Declared backup:true in ownedTables.ts but not actually carried by the backup. Either wire ' +
        'it into buildBackup/restoreBackup, or change its plan to backup:false with a reason.',
    ).toEqual([])
  })

  it('the three tables v4 dropped are all declared backup:true', () => {
    // The regression that started this. Named explicitly so a future edit that quietly flips one
    // back to backup:false has to argue with a test rather than slip through a diff.
    for (const t of ['book_tropes', 'book_moods', 'author_follows']) {
      const entry = USER_OWNED_TABLES.find((e) => e.table === t)
      expect(entry, `${t} vanished from the registry`).toBeDefined()
      expect(entry!.plan.backup, `${t} must be backed up — v4 dropping it is the bug this guards`).toBe(true)
    }
  })
})

// ── the refusals: negative space that must survive a round trip ──
describe('backup round trip — the reader’s refusals', () => {
  it('a removed slot stays removed while confirmed live authority also survives', async () => {
    const parsed = JSON.parse(await buildBackup()) as {
      series_tombstones: { series: string; position: number; title: string; removed_at: string }[]
      series_entries: BackupSeriesEntryRow[]
    }
    // The portable refusal remains for old restores; v7 additionally carries the complete
    // structured relation because confirmed primary/secondary membership is no longer derived.
    expect(parsed.series_tombstones).toHaveLength(1)
    expect(parsed.series_tombstones[0]).toMatchObject({ series: 'Empyrean', position: 3, title: 'Onyx Storm' })
    expect(parsed.series_entries).toHaveLength(2)

    wipeToFreshAccount()
    const result = await restoreBackup(handMade(parsed))

    expect(result.tombstones).toBe(1)
    // The parent series was materialized so the tombstone has somewhere to live.
    const series = db.series.find((x) => str(x, 'name') === 'Empyrean')
    expect(series).toBeDefined()
    expect(str(series, 'owner_id')).toBe(NEW_OWNER)

    expect(db.series_entries).toHaveLength(2)
    const dead = db.series_entries.find((entry) => !!entry.removed_at)!
    expect(str(dead, 'series_id')).toBe(str(series, 'id'))
    expect(dead.removed_at).toBe('2026-07-01T10:00:00.000Z')
    // A tombstone is by definition an unlinked slot the reader touched.
    expect(dead.book_id).toBeNull()
    expect(dead.user_edited).toBe(true)
    expect(str(dead, 'title')).toBe('Onyx Storm')
    expect(dead.position).toBe(3)
  })

  it('a dismissed trope suggestion stays dismissed, and an open one does not travel', async () => {
    const parsed = JSON.parse(await buildBackup()) as { trope_dismissals: Record<string, string[]> }
    // book-b's dismissal travels; book-a's OPEN suggestion is a question the catalog may ask again.
    expect(parsed.trope_dismissals).toEqual({ 'book-b': ['Enemies to Lovers'] })

    wipeToFreshAccount()
    const result = await restoreBackup(handMade(parsed))

    expect(result.dismissals).toBe(1)
    expect(db.trope_suggestions).toHaveLength(1)
    const row = db.trope_suggestions[0]!
    expect(row.state).toBe('dismissed')
    expect(str(row, 'owner_id')).toBe(NEW_OWNER)
    // Resolved by NAME onto the new account's canonical trope, and onto the new book id.
    expect(str(row, 'trope_id')).toBe(str(db.tropes.find((t) => str(t, 'name') === 'Enemies to Lovers'), 'id'))
    expect(str(row, 'book_id')).toBe(str(db.books.find((b) => str(b, 'title') === 'Iron Flame'), 'id'))
  })

  it('skips a dismissal whose trope exists in no vocabulary rather than coining one for a refusal', async () => {
    const parsed = JSON.parse(await buildBackup()) as {
      trope_dismissals: Record<string, string[]>
      tropes: Record<string, unknown>
    }
    parsed.trope_dismissals = { 'book-b': ['A Trope Nobody Has'] }
    parsed.tropes = {} // and it is not assigned anywhere either, so nothing coins it
    wipeToFreshAccount({ keepCanonical: false })

    const result = await restoreBackup(handMade(parsed))

    expect(result.dismissals).toBe(0)
    expect(db.tropes).toHaveLength(0) // no vocabulary invented out of a rejection
  })

  it('drops a tombstone whose series name is missing rather than orphaning it', async () => {
    const parsed = JSON.parse(await buildBackup()) as { series_tombstones: { series: string }[] }
    parsed.series_tombstones = [{ series: '   ' } as { series: string }]
    wipeToFreshAccount()

    const result = await restoreBackup(
      legacySeriesBackup(parsed as Record<string, unknown>),
    )

    expect(result.tombstones).toBe(0)
    expect(db.series_entries).toHaveLength(0)
  })

  it('a "distinct"/"related_but_separate" series ruling survives, and a "same" ruling does not travel', async () => {
    const parsed = JSON.parse(await buildBackup()) as {
      series_merge_decisions: { name_key_a: string; name_key_b: string; ruling: string }[]
    }
    // 'same' is excluded server-side (buildBackup's .neq) — only the two refusals travel.
    expect(parsed.series_merge_decisions).toHaveLength(2)
    expect(parsed.series_merge_decisions.map((r) => r.ruling).sort()).toEqual(['distinct', 'related_but_separate'])

    wipeToFreshAccount()
    await restoreBackup(handMade(parsed))

    expect(db.series_merge_decisions).toHaveLength(2)
    expect(db.series_merge_decisions.every((r) => str(r, 'owner_id') === NEW_OWNER)).toBe(true)
    const distinct = db.series_merge_decisions.find((r) => str(r, 'ruling') === 'distinct')
    expect(distinct).toMatchObject({ name_key_a: 'fourth wing', name_key_b: 'iron flame' })
    const siblings = db.series_merge_decisions.find((r) => str(r, 'ruling') === 'related_but_separate')
    expect(siblings).toMatchObject({ name_key_a: 'mountain men', name_key_b: 'mountain men matchmaker' })
  })
})

// The round-trip tests above cannot catch OVER-capture in these two shapers: the queries filter
// server-side (`.not('removed_at','is',null)` / `.eq('state','dismissed')`), so a live row never
// reaches them through that path. Mutation-testing showed exactly that blind spot — widening either
// shaper left the suite green. These exercise the functions directly, with mixed input, so the
// "only the refusal travels" rule is guarded on its own and not just by the query.
describe('refusal shapers reject the positive half on their own', () => {
  it('seriesTombstones keeps only rows with a removed_at', () => {
    const rows = [
      { position: 1, label: null, title: 'Live', author: 'A', source: 'hardcover', removed_at: null, series: { name: 'S' } },
      { position: 3, label: 'B3', title: 'Dead', author: 'A', source: 'hardcover', removed_at: '2026-07-01T00:00:00.000Z', series: { name: 'S' } },
      // a tombstone whose series row didn't come back — unkeyable, so it is dropped
      { position: 4, label: null, title: 'Orphan', author: 'A', source: 'manual', removed_at: '2026-07-02T00:00:00.000Z', series: null },
    ] as unknown as Parameters<typeof seriesTombstones>[0]
    expect(seriesTombstones(rows).map((t) => t.title)).toEqual(['Dead'])
  })

  it('dismissalsByBook keeps only dismissed suggestions', () => {
    const rows = [
      { book_id: 'b1', state: 'open', tropes: { name: 'Open One' } },
      { book_id: 'b1', state: 'dismissed', tropes: { name: 'Waved Away' } },
      { book_id: 'b2', state: 'dismissed', tropes: null },
    ] as unknown as Parameters<typeof dismissalsByBook>[0]
    expect(dismissalsByBook(rows)).toEqual({ b1: ['Waved Away'] })
  })

  it('seriesRulingRows drops "same" even when fed one directly, canonicalizes pair order, and dedupes', () => {
    const rows = [
      // 'same' must be dropped here too — buildBackup's server-side .neq is not the only guard.
      { name_key_a: 'acotar', name_key_b: 'a court of thorns and roses', ruling: 'same' },
      // out of alphabetical order — must come back canonicalized (a <= b)
      { name_key_a: 'iron flame', name_key_b: 'fourth wing', ruling: 'distinct' },
      // a duplicate of the same pair, keys reversed — a real upsert would fail on this twice in
      // one statement, so only one row may survive
      { name_key_a: 'fourth wing', name_key_b: 'iron flame', ruling: 'distinct' },
      { name_key_a: 'mountain men', name_key_b: 'mountain men matchmaker', ruling: 'related_but_separate' },
      // unkeyable — dropped rather than restored with an empty key
      { name_key_a: '', name_key_b: 'iron flame', ruling: 'distinct' },
    ] as unknown as Parameters<typeof seriesRulingRows>[0]
    const out = seriesRulingRows(rows, NEW_OWNER)
    expect(out).toEqual([
      { owner_id: NEW_OWNER, name_key_a: 'fourth wing', name_key_b: 'iron flame', ruling: 'distinct' },
      { owner_id: NEW_OWNER, name_key_a: 'mountain men', name_key_b: 'mountain men matchmaker', ruling: 'related_but_separate' },
    ])
  })
})

describe('archived tombstones are keyed on title, not on a position that moves', () => {
  const SERIES = 'ser-1'
  const byName = new Map([['fourth wing', SERIES]])
  const OWNER = 'owner-1'
  const stone = (title: string, position: number) => ({
    series: 'Fourth Wing',
    position,
    title,
    author: 'R. Yarros',
    label: null,
    source: 'manual',
    removed_at: '2026-01-01T00:00:00Z',
  })

  // SYMPTOM 1 — "two tombstones at one position lose one". Reachable by: remove #2, re-add,
  // reposition, remove again. Under the (series, position) key the second collapsed onto the first
  // and was dropped without a word.
  it('keeps two distinct removals that share a position', () => {
    const rows = tombstoneRows([stone('Iron Flame', 2), stone('Onyx Storm', 2)], byName, OWNER)
    expect(rows.map((r) => r.title)).toEqual(['Iron Flame', 'Onyx Storm'])
  })

  // SYMPTOM 2 — "a restore into a non-empty library can drop a refusal". A LIVE entry now sits at
  // the archived tombstone's old number, so the slot read as taken and the removal was discarded —
  // and the next source refresh resurrects the ghost the reader dismissed.
  it('restores a removal whose old position is now held by a different live entry', () => {
    const taken = new Set([`${SERIES}@t:some other book`])
    const rows = tombstoneRows([stone('Iron Flame', 2)], byName, OWNER, taken)
    expect(rows).toHaveLength(1)
  })

  it('still skips a tombstone for a title the account already holds', () => {
    const taken = new Set([`${SERIES}@t:iron flame`])
    expect(tombstoneRows([stone('Iron Flame', 2)], byName, OWNER, taken)).toEqual([])
  })

  it('dedupes within one file by title, whatever the position says', () => {
    const rows = tombstoneRows([stone('Iron Flame', 2), stone('iron flame', 9)], byName, OWNER)
    expect(rows).toHaveLength(1)
  })

  // The fallback: an untitled slot keeps position as its identity, so untitled tombstones do not
  // all collapse onto one another — which would be this same bug in a new place.
  it('falls back to position for untitled slots rather than collapsing them', () => {
    const rows = tombstoneRows([stone('', 2), stone('', 3)], byName, OWNER)
    expect(rows).toHaveLength(2)
  })
})

describe('shelf manual order — the lists sort_order round trip (the WebKit probe incident)', () => {
  /**
   * The defect: the export always captured sort_order (select('*') serialized wholesale), but the
   * restore dropped it — every restored shelf landed NULL, and the reader's manual arrangement
   * degraded to Postgres scan order in the one operation whose purpose is destroying nothing.
   * These assert BY VALUE, at the write layer, which is where the drop happened.
   */
  it('preserves each shelf\'s exported sort_order through export → restore', async () => {
    db.lists = [
      // manual order deliberately different from array order AND from name order
      { id: 'l-b', owner_id: OWNER, name: 'Bbb Shelf', kind: 'collection', is_priority: false, sort_order: 1000 },
      { id: 'l-a', owner_id: OWNER, name: 'Aaa Shelf', kind: 'collection', is_priority: false, sort_order: 3000 },
      { id: 'l-c', owner_id: OWNER, name: 'Ccc Shelf', kind: 'tbr', is_priority: true, sort_order: 2000 },
    ]
    const json = await buildBackup()
    wipeToFreshAccount()
    await restoreBackup(json)

    const byName = Object.fromEntries(db.lists.map((l) => [l.name, l.sort_order]))
    expect(byName).toEqual({ 'Bbb Shelf': 1000, 'Aaa Shelf': 3000, 'Ccc Shelf': 2000 })
    // and the manual order those values encode: Bbb, Ccc, Aaa
    const ordered = [...db.lists].sort((a, b) => (a.sort_order as number) - (b.sort_order as number)).map((l) => l.name)
    expect(ordered).toEqual(['Bbb Shelf', 'Ccc Shelf', 'Aaa Shelf'])
  })

  it('an old-shape backup (no sort_order field) restores to a stable sequential order, never NULLs', async () => {
    seedOldAccount()
    const json = await buildBackup()
    // simulate a backup written before the column existed: strip the field entirely
    const parsed = JSON.parse(json) as { lists: Record<string, unknown>[] }
    for (const l of parsed.lists) delete l.sort_order
    wipeToFreshAccount()
    await restoreBackup(handMade(parsed))

    expect(db.lists.length).toBeGreaterThan(0)
    for (const l of db.lists) expect(l.sort_order, `NULL sort_order restored onto ${String(l.name)}`).not.toBeNull()
    // sequential in the file's own array order, spaced by the step
    const orders = db.lists.map((l) => l.sort_order)
    expect(orders).toEqual(orders.map((_, i) => (i + 1) * 1000))
  })

  it('a MIXED backup appends the missing ones after the highest preserved value, in file order', async () => {
    db.lists = [
      { id: 'l-1', owner_id: OWNER, name: 'Kept', kind: 'collection', is_priority: false, sort_order: 5000 },
      { id: 'l-2', owner_id: OWNER, name: 'Lost A', kind: 'collection', is_priority: false, sort_order: null },
      { id: 'l-3', owner_id: OWNER, name: 'Lost B', kind: 'tbr', is_priority: false, sort_order: null },
    ]
    const json = await buildBackup()
    wipeToFreshAccount()
    await restoreBackup(json)

    const byName = Object.fromEntries(db.lists.map((l) => [l.name, l.sort_order]))
    expect(byName).toEqual({ Kept: 5000, 'Lost A': 6000, 'Lost B': 7000 })
  })
})

describe('list_items.position — add paths append, never NULL (nullable-ordering class, member 3)', () => {
  /**
   * The CSV import's placement path left every membership NULL, which is the largest-shelf case of
   * the reshuffle defect (a 200-book imported shelf, entirely unpositioned). Asserted at the write
   * layer, by value, where the NULL was written.
   */
  it('the CSV import places books at sequential positions from the shelf max', async () => {
    db.lists = [{ id: 'l-imp', owner_id: OWNER, name: 'Imported TBR', kind: 'tbr', is_priority: false, sort_order: 1000 }]
    db.list_items = [
      { list_id: 'l-imp', book_id: 'pre-existing', owner_id: OWNER, position: 5000, added_at: '2026-01-01T00:00:00Z' },
    ]
    const { nextItemPositionFor } = await import('./listItems')
    // the helper the three add paths now share: max + step, never NULL
    expect(await nextItemPositionFor('l-imp')).toBe(6000)
  })

  it('an empty shelf starts at the step, not at NULL or 0', async () => {
    db.lists = [{ id: 'l-new', owner_id: OWNER, name: 'Fresh', kind: 'collection', is_priority: false, sort_order: 1000 }]
    db.list_items = []
    const { nextItemPositionFor } = await import('./listItems')
    expect(await nextItemPositionFor('l-new')).toBe(1000)
  })

  it('restore still preserves each item position untouched (unchanged by this fix)', async () => {
    seedOldAccount()
    db.list_items = [
      { list_id: 'l1', book_id: 'book-a', owner_id: OWNER, position: 3000, added_at: '2026-01-01T00:00:00Z' },
      { list_id: 'l1', book_id: 'book-b', owner_id: OWNER, position: 1000, added_at: '2026-01-02T00:00:00Z' },
    ]
    const json = await buildBackup()
    wipeToFreshAccount()
    await restoreBackup(json)
    expect([...db.list_items].map((i) => i.position).sort((a, b) => (a as number) - (b as number))).toEqual([1000, 3000])
  })
})

describe('a backup cannot silently lose rows — paging, and the file’s own completeness check', () => {
  /** Books beyond the page cap, so a single un-ranged read would come back short. */
  const seedManyBooks = (n: number) => {
    db.books = Array.from({ length: n }, (_, i) => ({
      id: `bulk-${String(i).padStart(5, '0')}`,
      owner_id: OWNER,
      title: `Bulk ${i}`,
      read_status: 'Unread',
      genres: [],
      tags: [],
    }))
  }

  it('exports EVERY book when the library is larger than one page', async () => {
    seedManyBooks(2500)
    const parsed = JSON.parse(await buildBackup()) as { books: Row[]; counts: Record<string, number> }
    expect(parsed.books).toHaveLength(2500)
    expect(parsed.counts.books).toBe(2500)
    // Not merely the count: the last book must be present. A loop that re-read page one three
    // times would also produce 2500 rows against a less careful fake.
    expect(parsed.books.at(-1)?.id).toBe('bulk-02499')
    expect(new Set(parsed.books.map((b) => b.id)).size).toBe(2500)
  })

  it('REFUSES to write a backup when the read stops advancing', async () => {
    // The regression this guard exists for: `.range()` stops being honoured and every request
    // returns page one. Before this change that shape had TWO failure modes and no guard against
    // either — the old un-ranged code silently serialized 1,000 rows, and a ranged loop whose
    // window is ignored spins forever. It now aborts, named, having written nothing.
    seedManyBooks(2500)
    ignoreRange = true
    await expect(buildBackup()).rejects.toThrow(/Backup aborted: Paging did not advance for books/)
  })

  it('says nothing was written, so the failure cannot be mistaken for a partial success', async () => {
    seedManyBooks(1200)
    ignoreRange = true
    await expect(buildBackup()).rejects.toThrow(/Nothing was written/)
  })

  it('counts every section the export writes — a new section cannot ship uncounted', async () => {
    // Keyed to the payload itself rather than to a hand-kept list: add a section to buildBackup
    // without counting it and this fails, which is the only way the manifest stays honest.
    const parsed = JSON.parse(await buildBackup()) as Record<string, unknown>
    const bookkeeping = new Set(['v', 'app', 'exportedAt', 'counts', 'profile'])
    const sections = Object.keys(parsed).filter((k) => !bookkeeping.has(k))
    expect(Object.keys(parsed.counts as object).sort()).toEqual(sections.sort())
  })

  it('counts what the FILE carries, not what the query returned — they are not the same number', async () => {
    // Found by mutation: swapping a section's count from the serialized value to its source query
    // left every test green, because the fixture had no row that the export DROPS on the way out.
    // A book_trope pointing at a trope that resolves to no name is exactly that row — the query
    // returns 4, the file carries 3 — so the manifest has to describe the payload or it certifies
    // a number nothing in the file can be checked against.
    db.book_tropes.push({ book_id: 'book-a', trope_id: 't-ghost', owner_id: OWNER, emphasis: 'present' })

    const parsed = JSON.parse(await buildBackup()) as Record<string, unknown>
    const counts = parsed.counts as Record<string, number>

    expect(counts.tropes, 'the dropped row must not be counted').toBe(3)

    // The general invariant, so this holds for every section rather than the one that caught it.
    const size = (v: unknown): number =>
      Array.isArray(v) ? v.length : Object.values(v as Record<string, unknown[]>).reduce((n, a) => n + a.length, 0)
    for (const [section, declared] of Object.entries(counts))
      expect(size(parsed[section]), `counts.${section} must describe the payload`).toBe(declared)
  })

  it('refuses a file whose payload lost rows, and writes NOTHING before refusing', async () => {
    const parsed = JSON.parse(await buildBackup()) as Record<string, unknown>
    ;(parsed.books as Row[]).pop() // the truncation a partial download or a bad export leaves
    wipeToFreshAccount()

    await expect(restoreBackup(JSON.stringify(parsed))).rejects.toThrow(/incomplete/)
    // The refusal has to come before the first insert — a half-restored account is worse than a
    // refused one, and `lists` are written first, so they are where a late check would show.
    expect(db.books).toHaveLength(0)
    expect(db.lists).toHaveLength(0)
  })

  it('refuses a file that GAINED rows too — a mismatch is a mismatch in either direction', async () => {
    const parsed = JSON.parse(await buildBackup()) as Record<string, unknown>
    ;(parsed.books as Row[]).push({ id: 'smuggled', title: 'Smuggled' })
    wipeToFreshAccount()
    await expect(restoreBackup(JSON.stringify(parsed))).rejects.toThrow(/books: expected 2, found 3/)
  })

  it('catches a nested section losing rows, not just the top-level arrays', async () => {
    const parsed = JSON.parse(await buildBackup()) as Record<string, unknown>
    const tropes = parsed.tropes as Record<string, unknown[]>
    const first = Object.keys(tropes)[0] as string
    tropes[first] = []
    wipeToFreshAccount()
    await expect(restoreBackup(JSON.stringify(parsed))).rejects.toThrow(/tropes: expected 3/)
  })

  it('names EVERY damaged section at once rather than failing on the first', async () => {
    const parsed = JSON.parse(await buildBackup()) as Record<string, unknown>
    ;(parsed.books as Row[]).pop()
    ;(parsed.reads as Row[]).pop()
    await expect(restoreBackup(JSON.stringify(parsed))).rejects.toThrow(/books: .*; reads: /)
  })

  it('a pre-v6 file has no manifest and restores unchecked — deliberately', async () => {
    // Refusing these would strand every backup taken before this change. The hole is real; it is
    // bounded to files that predate the manifest, and it is why `handMade` exists above.
    const parsed = JSON.parse(await buildBackup()) as Record<string, unknown>
    ;(parsed.books as Row[]).pop()
    wipeToFreshAccount()

    const result = await restoreBackup(handMade(parsed))
    expect(result.books).toBe(1)
  })

  it('finds a vocabulary name that sits PAST the page cap instead of coining a duplicate', async () => {
    // The restore path reads whole tables too, and truncation there does not surface as a short
    // list — it surfaces as a name that "isn't in the vocabulary", so the restore coins a personal
    // duplicate of a canonical trope the account already has. A guard that silently stops
    // guarding, which is why it is asserted on the OUTCOME (no duplicate row) rather than on the
    // number of rows read.
    const json = await buildBackup()
    // Ids sort before 't-canon', so the trope the backup needs lands past the first page.
    db.tropes = [
      ...Array.from({ length: 1500 }, (_, i) => ({
        id: `t-aaa-${String(i).padStart(5, '0')}`,
        owner_id: null,
        name: `Filler ${i}`,
        facet: 'vibe',
      })),
      ...db.tropes,
    ]
    wipeToFreshAccount()

    const result = await restoreBackup(json)

    expect(result.tropes).toBe(3)
    const named = db.tropes.filter((t) => t.name === 'Enemies to Lovers')
    expect(named, 'the canonical trope must be reused, not duplicated').toHaveLength(1)
    expect(named[0]?.owner_id).toBe(null)
  })

  it('EVERY multi-row read in export AND restore pages, and orders its pages', async () => {
    // The exhaustive guard, keyed to the call sites rather than to a fixture per table.
    //
    // Two per-table tests were written first and BOTH were proxies: dropping `.order()` from the
    // vocabulary read and `.range()` from the anti-duplicate read each left the suite green,
    // because catching those needs a fixture with over a thousand rows IN THAT TABLE, and adding
    // one per table is both unaffordable and permanently one table behind the code. This asserts
    // the property directly — a read that returns a row set declares a window and a total order —
    // so a new un-paged read added tomorrow fails without anyone remembering to seed for it.
    //
    // `bounded` reads are exempt with a reason, not by omission: `.maybeSingle()` returns one row
    // and `head: true` returns none, so neither can be truncated.
    access = []
    const json = await buildBackup()
    wipeToFreshAccount()
    await restoreBackup(json)

    const unpaged = access
      .filter((a) => a.mode === 'select' && !a.bounded)
      .filter((a) => !a.ranged || !a.ordered)
      .map((a) => `${a.table}${a.ranged ? '' : ' (no .range)'}${a.ordered ? '' : ' (no .order)'}`)

    expect([...new Set(unpaged)]).toEqual([])
    // …and the guard is looking at something: if this is 0, the filter above proves nothing.
    expect(access.filter((a) => a.mode === 'select' && !a.bounded).length).toBeGreaterThan(10)
  })

  it('an intact file still restores — the guard does not refuse healthy backups', async () => {
    const json = await buildBackup()
    wipeToFreshAccount()
    await expect(restoreBackup(json)).resolves.toMatchObject({ books: 2 })
  })
})

describe('saved discoveries in reader backups', () => {
  it('round-trips ordered public snapshots into the current account without adding books', async () => {
    const original = structuredClone(db.discovery_sessions[0])
    const backup = await buildBackup()
    const file = JSON.parse(backup)
    expect(file.counts.discovery_sessions).toBe(1)
    expect(file.discovery_sessions[0].owner_id).toBeUndefined()
    wipeToFreshAccount()
    await restoreBackup(backup)
    expect(db.discovery_sessions[0]?.owner_id).toBe(NEW_OWNER)
    expect(db.discovery_sessions[0]?.id).toBe(original?.id)
    expect((db.discovery_sessions[0]?.document as { picks: { book: {title: string} }[] }).picks[0]?.book.title).toBe('A welcome')
    expect(db.books.some(book => book.title === 'A welcome')).toBe(false)
  })
  it('rejects an unreadable snapshot before restoring any section', async () => {
    const file = JSON.parse(await buildBackup())
    file.discovery_sessions[0].document.version = 999
    wipeToFreshAccount(); access=[]
    await expect(restoreBackup(JSON.stringify(file))).rejects.toThrow('unreadable shortlist')
    expect(access.some(a => a.mode !== 'select')).toBe(false)
  })
})
