// import-corpus-csv.mjs — the corpus CSV import (works-layer Phase 4 tooling).
//
// ── HOW TO RUN (owner-run; a Code session never runs the write) ─────────────────────────────────
//
//   Dry run (DEFAULT — report only, writes nothing):
//     pnpm exec vite-node scripts/import-corpus-csv.mjs -- chism-books-library.csv \
//       --owner-email=you@example.com
//
//   Diagnostics — write out WHAT the classifier decided, not just how many times (dry run is fine,
//   nothing is written to the database):
//     pnpm exec vite-node scripts/import-corpus-csv.mjs -- chism-books-library.csv \
//       --owner-email=you@example.com --dump=corpus-dump
//
//   That produces new.csv, matched.csv and unmatched-library.csv. The third is the one to read:
//   library books NO csv row matched, which the report has never computed. It and new.csv share a
//   sort key, so open them side by side — a missed match reads as near-identical titles in both.
//   `corpus-dump/` is gitignored; these files contain the owner's library and must not be committed.
//
//   Review the report: near-misses, omnibus suspects, empty authors, unmapped genres, collapsed
//   collisions. Resolve what needs resolving in the CSV itself, re-run the dry run, and only then:
//
//     pnpm exec vite-node scripts/import-corpus-csv.mjs -- chism-books-library.csv \
//       --owner-email=you@example.com --write
//
//   Enrichment backfill (repeatable, any time after works rows exist):
//     pnpm exec vite-node scripts/import-corpus-csv.mjs -- --backfill
//
//   Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (default to the well-known LOCAL stack values,
//   the seed-dev.mjs convention — set both explicitly for anything that is not the local stack).
//
// ── WHAT --write DOES, exactly ──────────────────────────────────────────────────────────────────
//   1. Upserts EVERY existing library book's objective fields into `works` (on work_key), so the
//      corpus is complete rather than just the CSV delta, then merges each usable book ISBN into
//      that work's canonical ISBN-13 set.
//   2. Upserts a `works` row per NEW CSV record (objective fields + tags only).
//   3. Inserts a `books` row for the owner per NEW record. GC Read → read_status 'Read', else
//      'unset'. TC READ IS ANOTHER PERSON'S DATA AND IS WRITTEN NOWHERE — it appears in the report
//      as a count of what was deliberately left behind, and that is its entire lifecycle here.
//   4. Idempotent: works upserts on work_key; a re-run's CSV rows classify as matched-existing and
//      are skipped for books insertion.
//
// ── DECISIONS INHERITED, NOT INVENTED ───────────────────────────────────────────────────────────
//   · Identity/normalizers come from corpus-import-lib.mjs (core norm / matchBook /
//     normalizeImportGenres) — see its header for the versioned enrichment cache identity body.
//   · Series: the name lands on books.series and works.series; NO position is invented (the CSV
//     has none) and NO series row/entry is created. Per 20260817010000_sync_book_series.sql's own
//     header, series-row/entry creation is deliberately CLIENT-side (getOrCreateSeries carries the
//     Tier-1 near-match prevention); books.series alone is the standing "claim path" the app
//     already groups by (groupSeries reads b.series). A direct insert therefore bypasses nothing —
//     entries appear when the reader first touches the series in the UI, exactly as for a book
//     added before any series row existed.
//   · Contributors: author_first/author_last land on the row; no book_authors join rows. Core's
//     contributor fallback (contributors.ts) synthesizes the author-role contributor from
//     first/last when the join is empty, so the app renders these identically to the e2e fixtures
//     that use the same shape. `works.contributors` carries the full Contributor[] explicitly.
//   · Possession: every inserted book is ownership='owned', borrowed=false, wishlist=false. THE
//     CSV CARRIES NO POSSESSION DATA, so this is an assumption, stated here and in the report: the
//     file is the owner's library list. Override per-run with --possession=unowned if that read is
//     wrong for some batch.
//   · Every books row carries EVERY column the batch uses, defaults included — PostgREST builds
//     one INSERT whose column list is the union of all rows' keys, and an omitted key arrives as
//     an explicit NULL, not the column default (the a11y.spec seeding incident).
//
// ── ENRICHMENT BACKFILL (--backfill) ────────────────────────────────────────────────────────────
//   For EVERY works row: look up enrichment_cache at key
//   enrichmentCacheKey('ta:' + work_key) (exact construction — no legacy-key fallback), and copy the resolved identity
//   (work_id), cover fields, and canonical edition ISBNs out of the cached record. Existing ISBNs
//   are unioned, never replaced. The ~new books rows enrich through the EXISTING per-book pipeline
//   as the reader uses the app; this promotes those results into the corpus whenever it is re-run.
//   Retired-provider cache rows remain excluded, even when their scalar provenance looks free-only.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  parseCsv,
  toRecords,
  normalizeRecord,
  dropAndCollapse,
  classify,
  buildReport,
  unmatchedLibrary,
  normTitleKey,
  csvFile,
  canonicalIsbns,
  assertNoCrossWorkIsbnCollisions,
} from './corpus-import-lib.ts'
import { runBackfill } from './corpus-backfill.ts'
import { workKeyOf } from '../packages/core/src/normalize.ts'

const URL_DEFAULT = 'http://127.0.0.1:55321'
const SERVICE_DEFAULT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const args = process.argv.slice(2).filter((a) => a !== '--')
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.includes('=')))
const opt = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : null
}
const csvPath = args.find((a) => !a.startsWith('--'))
const WRITE = flags.has('--write')
const BACKFILL = flags.has('--backfill')

const supabase = createClient(
  process.env.SUPABASE_URL ?? URL_DEFAULT,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? SERVICE_DEFAULT,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const fail = (msg) => {
  console.error(`import-corpus-csv: ${msg}`)
  process.exit(1)
}

async function resolveOwnerId() {
  const direct = opt('owner-id')
  if (direct) return direct
  const email = opt('owner-email')
  if (!email) fail('pass --owner-email=<email> or --owner-id=<uuid> — never hardcoded')
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) fail(`listUsers: ${error.message}`)
  const u = data.users.find((x) => x.email === email)
  if (!u) fail(`no auth user with email ${email}`)
  return u.id
}

/** The owner's whole library, mapped just far enough for matchBook + works promotion.
 *
 *  PAGINATED, and the loop is load-bearing: PostgREST caps an un-ranged select at 1,000 rows and
 *  says nothing. The local --write exercise found it the hard way — a 1,136-book library fetched
 *  as exactly 1,000, the 136 past the cap were invisible to both the classifier and the skip set,
 *  and the "idempotent" re-run inserted all 136 again. Every scripted fetch of a whole table in
 *  this file pages until a short page for the same reason. */
async function fetchLibrary(ownerId) {
  const PAGE = 1000
  const data = []
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await supabase
      .from('books')
      .select(
        'id, title, author_first, author_last, series, position, series_count, status, pages, pub_y, pub_m, pub_d, cover_url, cover_source, cover_source_url, cover_color, cover_confidence, genre, tags, isbn',
      )
      .eq('owner_id', ownerId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) fail(`fetch books: ${error.message}`)
    data.push(...page)
    if (page.length < PAGE) break
  }
  return data.map((b) => ({
    id: b.id,
    title: b.title,
    first: b.author_first ?? '',
    last: b.author_last ?? '',
    series: b.series ?? '',
    position: b.position ?? '',
    isbn: b.isbn ?? '',
    row: b,
  }))
}

/** The whole shared corpus identity surface, paged for the same silent-1,000 cap as books. */
async function fetchWorksIsbns() {
  const PAGE = 1000
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('works')
      .select('work_key, isbns')
      .order('work_key', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) fail(`works identity select: ${error.message}`)
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE) break
  }
  return rows
}

/** A book row → its works upsert payload. The book's own fields are the survivor identity. */
function workFromBook(b) {
  const author = [b.author_first, b.author_last].filter(Boolean).join(' ').trim()
  return {
    work_key: workKeyOf({ title: b.title, last: author }),
    title: b.title,
    contributors: author ? [{ name: author, role: 'author', position: 0 }] : [],
    author_text: author,
    series: b.series ?? null,
    position: b.position ?? null,
    series_count: b.series_count ?? null,
    status: b.status ?? null,
    pages: b.pages ?? null,
    pub_y: b.pub_y ?? null,
    pub_m: b.pub_m ?? null,
    pub_d: b.pub_d ?? null,
    cover_url: b.cover_url ?? null,
    cover_source: b.cover_source ?? null,
    cover_source_url: b.cover_source_url ?? null,
    cover_color: b.cover_color ?? null,
    cover_confidence: b.cover_confidence != null ? Number(b.cover_confidence) : null,
    genre: b.genre ?? null,
    tags: b.tags ?? [],
  }
}

/** A fresh CSV record → its works upsert payload. Objective fields only; nothing personal. */
function workFromRecord(r) {
  return {
    work_key: r.workKey,
    title: r.title,
    contributors: r.author ? [{ name: r.author, role: 'author', position: 0 }] : [],
    author_text: r.author,
    series: r.series || null,
    position: null, // the CSV carries none; inventing one is exactly what the integrity rule bans
    series_count: null,
    status: r.status,
    pages: null,
    pub_y: null,
    pub_m: null,
    pub_d: null,
    cover_url: null,
    cover_source: null,
    cover_source_url: null,
    cover_color: null,
    cover_confidence: null,
    genre: r.genre,
    tags: r.tags,
  }
}

/** A fresh CSV record → the owner's books insert. Every column the batch uses, on every row. */
function bookFromRecord(r, ownerId, possession) {
  return {
    owner_id: ownerId,
    title: r.title,
    author_first: r.first || null,
    author_last: r.last || null,
    series: r.series || null,
    position: null,
    series_count: null,
    status: r.status,
    // '' for unmapped, NEVER the column's historical 'romance' default — #255 removed exactly that
    // silent guess (a book added without a genre saves with NONE), and the app writes '' since.
    genre: r.genre ?? '',
    genres: r.genres,
    subgenre: null,
    tags: r.tags,
    ownership: possession,
    borrowed: false,
    wishlist: false,
    // null = NOT ASSESSED, never 0 (assessed as none) — the seeder's own rule, kept
    intensity: null,
    read_status: r.gcRead ? 'Read' : 'unset',
    rating: 0,
    fave: false,
    format: null,
    isbn: null,
    cover_url: null,
    source: 'Owned',
    pub_y: null,
    pub_m: null,
    pub_d: null,
    progress: 0,
  }
}

async function upsertWorks(rows, label) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    const { error } = await supabase.from('works').upsert(chunk, { onConflict: 'work_key' })
    if (error) fail(`works upsert (${label}, chunk at ${i}): ${error.message}`)
  }
  console.log(`works: upserted ${rows.length} (${label})`)
}

const sameStrings = (a, b) => a.length === b.length && a.every((value, i) => value === b[i])

/** Merge the owner's known edition identifiers into work-level rows after the objective-field
 * upsert. ISBNs stay out of the upsert payload itself so a later rerun with an empty book ISBN can
 * never replace a richer set previously obtained from enrichment_cache. */
async function mergeLibraryWorkIsbns(books) {
  const incomingByWork = new Map()
  for (const b of books) {
    const incoming = canonicalIsbns([b.isbn])
    if (!incoming.length) continue
    const workKey = workKeyOf({
      title: b.title,
      first: b.author_first ?? '',
      last: b.author_last ?? '',
    })
    incomingByWork.set(
      workKey,
      canonicalIsbns([...(incomingByWork.get(workKey) ?? []), ...incoming]),
    )
  }

  const keys = [...incomingByWork.keys()]
  let updated = 0
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200)
    const { data, error } = await supabase
      .from('works')
      .select('work_key, isbns')
      .in('work_key', chunk)
    if (error) fail(`works ISBN select (chunk at ${i}): ${error.message}`)
    for (const row of data ?? []) {
      const merged = canonicalIsbns([
        ...(row.isbns ?? []),
        ...(incomingByWork.get(row.work_key) ?? []),
      ])
      if (sameStrings(row.isbns ?? [], merged)) continue
      const { error: updateError } = await supabase
        .from('works')
        .update({ isbns: merged })
        .eq('work_key', row.work_key)
      if (updateError) fail(`works ISBN update ${row.work_key}: ${updateError.message}`)
      updated++
    }
  }
  console.log(`works: merged library ISBNs into ${updated} of ${keys.length} ISBN-bearing works`)
}

/**
 * `--dump=<dir>` — write what the classifier DECIDED, not just how many times.
 *
 * The report has only ever printed counts and the near-miss list, so "231 library books matched
 * nothing" is unreadable: it cannot distinguish a CSV that genuinely lacks those books from a
 * matcher that missed them. These three files make that difference visible to a person.
 *
 * `new.csv` and `unmatched-library.csv` are BOTH sorted by the same normalised title, so the two
 * can be read side by side — a missed match shows up as near-identical titles at the same place in
 * each. That alignment is the diagnostic; the files individually are just lists.
 *
 * WRITES NOTHING TO THE DATABASE and is available in a dry run, which is the only time anyone
 * should need it.
 */
function writeDump(dir, { fresh, existing, library }) {
  mkdirSync(dir, { recursive: true })

  const newRows = [...fresh]
    .sort((a, b) => normTitleKey(a.title).localeCompare(normTitleKey(b.title)))
    .map((r) => [r.title, r.first, r.last, r.series, r.workKey])
  writeFileSync(
    join(dir, 'new.csv'),
    csvFile(['title', 'first', 'last', 'series', 'work_key'], newRows),
  )

  const matchedRows = existing.map((e) => [
    e.record.title,
    e.record.first,
    e.record.last,
    e.book.title,
    [e.book.first, e.book.last].filter(Boolean).join(' '),
    e.strength,
  ])
  writeFileSync(
    join(dir, 'matched.csv'),
    csvFile(
      ['csv_title', 'csv_first', 'csv_last', 'library_title', 'library_author', 'strength'],
      matchedRows,
    ),
  )

  const unmatched = unmatchedLibrary(library, existing)
  writeFileSync(
    join(dir, 'unmatched-library.csv'),
    csvFile(
      ['title', 'author', 'id'],
      unmatched.map((b) => [b.title, [b.first, b.last].filter(Boolean).join(' '), b.id]),
    ),
  )
  return { new: newRows.length, matched: matchedRows.length, unmatchedLibrary: unmatched.length }
}

async function runImport() {
  if (!csvPath) fail('pass the CSV path as an argument')
  const ownerId = await resolveOwnerId()
  const text = readFileSync(csvPath, 'utf8')
  const records = toRecords(parseCsv(text)).map(normalizeRecord)
  const { kept, collapsed, duplicatesDropped } = dropAndCollapse(records)
  const library = await fetchLibrary(ownerId)
  const { existing, fresh, nearMiss } = classify(kept, library)

  const report = buildReport({
    records,
    kept,
    collapsed,
    duplicatesDropped,
    existing,
    fresh,
    nearMiss,
  })
  report.assumptions = {
    possession: `all NEW books insert as ownership='${opt('possession') ?? 'owned'}' — the CSV carries no possession data; override with --possession=`,
    libraryBooks: library.length,
  }
  const dumpDir = opt('dump')
  if (dumpDir) {
    report.dump = { dir: dumpDir, ...writeDump(dumpDir, { fresh, existing, library }) }
  }
  console.log(JSON.stringify(report, null, 2))

  if (!WRITE) {
    console.log(
      '\nDRY RUN — nothing written. Review the near-miss and omnibus lists above, then re-run with --write.',
    )
    return
  }

  if (nearMiss.length) {
    console.log(
      `\nNOTE: ${nearMiss.length} near-miss rows are NOT imported — they stay for the owner to resolve in the CSV (rename to match, or mark Duplicate) and re-run. Auto-resolving them is what the data-integrity rule forbids.`,
    )
  }

  // Preflight the FINAL edition identity before the first upsert. Existing rows and this owner's
  // library are considered together; duplicate rows for one work collapse, but one ISBN on two
  // distinct work keys aborts the owner-run write with the exact keys to resolve.
  const existingWorks = await fetchWorksIsbns()
  try {
    assertNoCrossWorkIsbnCollisions([
      ...existingWorks.map((row) => ({ workKey: row.work_key, isbns: row.isbns ?? [] })),
      ...library.map((book) => ({
        workKey: workKeyOf({
          title: book.row.title,
          first: book.row.author_first ?? '',
          last: book.row.author_last ?? '',
        }),
        isbns: [book.row.isbn],
      })),
    ])
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }

  // 1) the whole existing library → corpus (idempotent on work_key)
  await upsertWorks(
    library.map((b) => workFromBook(b.row)),
    'promoted from existing library',
  )
  await mergeLibraryWorkIsbns(library.map((b) => b.row))

  // 2) fresh CSV rows → corpus
  await upsertWorks(fresh.map(workFromRecord), 'new from CSV')

  // 3) fresh CSV rows → the owner's books (skip any that appeared since classification)
  const possession = opt('possession') ?? 'owned'
  const current = await fetchLibrary(ownerId)
  const have = new Set(
    current.map((b) => workKeyOf({ title: b.title, first: b.first, last: b.last })),
  )
  const toInsert = fresh
    .filter((r) => !have.has(r.workKey))
    .map((r) => bookFromRecord(r, ownerId, possession))
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200)
    const { error } = await supabase.from('books').insert(chunk)
    if (error) fail(`books insert (chunk at ${i}): ${error.message}`)
  }
  console.log(
    `books: inserted ${toInsert.length} for owner ${ownerId} (${fresh.length - toInsert.length} skipped as already present)`,
  )
  console.log('\nDone. Re-running is safe: works upserts, books skips.')
}

async function runBackfillCommand() {
  const PAGE = 1000
  const store = {
    async fetchWorks() {
      const rows = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('works')
          .select('work_key, work_id, cover_url, isbns')
          .order('work_key', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) throw new Error(`works select: ${error.message}`)
        rows.push(...(data ?? []))
        if ((data ?? []).length < PAGE) break
      }
      return rows
    },
    async fetchEnrichments(keys) {
      const rows = []
      for (let i = 0; i < keys.length; i += 200) {
        const { data, error } = await supabase
          .from('enrichment_cache')
          .select('key, work_id, record')
          .in('key', keys.slice(i, i + 200))
        if (error) throw new Error(`enrichment cache select (chunk at ${i}): ${error.message}`)
        rows.push(...(data ?? []))
      }
      return rows
    },
    async updateWork(workKey, patch) {
      const { error } = await supabase.from('works').update(patch).eq('work_key', workKey)
      if (error) throw new Error(`works update ${workKey}: ${error.message}`)
    },
  }
  try {
    const result = await runBackfill(store)
    console.log(
      `backfill: examined ${result.examined} works, found ${result.cacheHits} cache rows, updated ${result.updated} (repeatable — re-run after more books enrich)`,
    )
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}

if (BACKFILL) await runBackfillCommand()
else await runImport()
