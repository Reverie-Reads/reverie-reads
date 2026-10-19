import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RECONCILIATION_BACKUP_PRIMARY_KEYS,
  RECONCILIATION_HOUSEHOLD_BACKUP_SPECS,
} from '../../../../scripts/household-reconciliation-lib'
import { USER_OWNED_TABLES } from './ownedTables'

// Structural guards over the SCHEMA, read from supabase/migrations rather than restated here — a
// list restated in a test drifts from the database exactly as the v4 backup drifted from it.
//
// Deletion is asserted as a PROPERTY, not a checklist: `delete-account` deletes the auth user and
// lets Postgres cascade, so what must hold is that every user-owned table reaches auth.users
// through an unbroken chain of ON DELETE CASCADE. That stays true when someone adds a table and
// false the moment they attach one with ON DELETE SET NULL or no action — which no list of
// expected delete statements would ever notice.

const MIGRATIONS = join(__dirname, '../../../../supabase/migrations')
const RECONCILIATION_SCRIPT = readFileSync(
  join(__dirname, '../../../../scripts/reconcile-chism-household.mjs'),
  'utf8',
)

interface Fk {
  target: string
  action: string
}

/**
 * table → its outbound foreign keys, parsed from the accumulated migrations.
 *
 * Migrations are read in FILENAME ORDER (timestamps) and applied as a log: a `create table` adds
 * the table, a `drop table` removes it. This matters — the migrations directory is never edited
 * after the fact, so a table's lifetime is only visible by replaying the whole sequence in order.
 * Reading files unordered, or only scanning for `create table` and ignoring drops, would leave a
 * dropped table's schema-era entry behind forever: the registry guards below would then either
 * refuse to let it be de-registered (still "found" in the schema) or, worse, silently pass a
 * registry entry for a table that no longer exists in the real database.
 */
function parseSchema(): Map<string, Fk[]> {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const tables = new Map<string, Fk[]>()
  const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(/gi
  const drop = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/gi

  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')

    for (let m = create.exec(sql); m; m = create.exec(sql)) {
      const name = m[1]!
      // Walk to the matching close paren so nested parens (checks, defaults) don't end the block early.
      let depth = 0
      let end = m.index
      for (let i = m.index + m[0].length - 1; i < sql.length; i++) {
        if (sql[i] === '(') depth++
        else if (sql[i] === ')') {
          depth--
          if (depth === 0) {
            end = i
            break
          }
        }
      }
      const body = sql.slice(m.index + m[0].length, end)
      const fks: Fk[] = []
      const ref = /references\s+(?:(?:auth|public)\.)?(\w+)\s*\(\s*\w+\s*\)\s*((?:on\s+delete\s+(?:cascade|restrict|no\s+action|set\s+null|set\s+default))?)/gi
      for (let r = ref.exec(body); r; r = ref.exec(body)) {
        fks.push({ target: r[1]!, action: (r[2] ?? '').replace(/\s+/g, ' ').trim().toLowerCase() })
      }
      tables.set(name, fks)
    }
    create.lastIndex = 0

    for (let m = drop.exec(sql); m; m = drop.exec(sql)) {
      tables.delete(m[1]!)
    }
    drop.lastIndex = 0
  }
  return tables
}

const schema = parseSchema()

/** Does `table` reach auth.users through a chain where EVERY hop is ON DELETE CASCADE? */
function cascadePathToUsers(table: string, seen = new Set<string>()): string[] | null {
  if (seen.has(table)) return null
  seen.add(table)
  for (const fk of schema.get(table) ?? []) {
    if (fk.action !== 'on delete cascade') continue
    if (fk.target === 'users') return [table, 'auth.users']
    const rest = cascadePathToUsers(fk.target, new Set(seen))
    if (rest) return [table, ...rest]
  }
  return null
}

/**
 * Is `table` owner-scoped — i.e. does its data belong to some user?
 *
 * Deliberately independent of the cascade check, and it must stay that way. Defining "owned" as
 * "has a cascade path" would let a table attached with ON DELETE SET NULL slip out of the registry
 * AND out of the cascade assertion at the same time — the guard would go quiet on exactly the row
 * that would survive its owner's deletion. Reachability here is over ANY foreign key action.
 */
function ownerScoped(table: string, seen = new Set<string>()): boolean {
  if (seen.has(table)) return false
  seen.add(table)
  for (const fk of schema.get(table) ?? []) {
    if (fk.target === 'users' || fk.target === 'profiles') return true
    if (ownerScoped(fk.target, new Set(seen))) return true
  }
  return false
}

describe('schema parse (the guard is only as good as this)', () => {
  it('finds the tables and their cascades', () => {
    expect(schema.size).toBeGreaterThan(20)
    expect(schema.get('book_tropes')).toContainEqual({ target: 'users', action: 'on delete cascade' })
    // A non-cascading FK must be read as such, or the cascade assertion below proves nothing.
    expect(schema.get('series_entries')).toContainEqual({ target: 'books', action: 'on delete set null' })
  })

  it('a table created in one migration and dropped in a later one is gone from the parse', () => {
    // reading_orders / reading_order_items: created 20260626180000, dropped
    // 20260730010000 (chore/drop-reading-orders-schema). Before the parser learned to replay
    // migrations in order and honour DROP TABLE, this table's CREATE-era entry would live in the
    // parse forever — the exact bug that would have made deleting these two ownedTables.ts rows
    // fail the "no unregistered owned table" guard below instead of passing it.
    expect(schema.has('reading_orders')).toBe(false)
    expect(schema.has('reading_order_items')).toBe(false)
  })
})

describe('account deletion reaches every user-owned table', () => {
  // delete-account deletes the auth user; everything owned must fall out by cascade. Verified
  // empirically against a live database too (auth.users delete → book_tropes/book_moods/
  // author_follows all emptied); this keeps it true as the schema grows.
  it.each(USER_OWNED_TABLES.filter((t) => !t.collective).map((t) => t.table))(
    '%s cascades to auth.users',
    (table) => {
    expect(schema.has(table)).toBe(true)
    expect(cascadePathToUsers(table)).not.toBeNull()
    },
  )
})

describe('no user-owned table may go unregistered', () => {
  it('retains source-use receipts through their shared review without personal export or restore', () => {
    expect(
      USER_OWNED_TABLES.find(
        (entry) => entry.table === 'corpus_edition_credit_source_use_receipts',
      ),
    ).toMatchObject({
      owner: 'review_id',
      ownerRelation: { table: 'corpus_edition_credit_reviews', key: 'id', owner: 'reviewer_id' },
      collective: true,
      plan: { backup: false },
    })
    expect(schema.get('corpus_edition_credit_source_use_receipts')).toContainEqual({
      target: 'corpus_edition_credit_reviews',
      action: 'on delete restrict',
    })
    expect(schema.get('corpus_edition_credit_reviews')).toContainEqual({
      target: 'profiles',
      action: 'on delete set null',
    })
    expect(RECONCILIATION_SCRIPT).toContain('filterSql: entry.ownerRelation')
    expect(RECONCILIATION_SCRIPT).toContain(
      'where ${identifier(entry.ownerRelation.owner)} = any(${accounts})',
    )
  })
  it('every table the schema owns is declared in ownedTables.ts', () => {
    const registered = new Set(USER_OWNED_TABLES.map((t) => t.table))
    const owned = [...schema.keys()].filter((t) => t !== 'profiles' && ownerScoped(t))
    const unregistered = owned.filter((t) => !registered.has(t))
    expect(
      unregistered,
      `These tables are owner-scoped but are not declared in ownedTables.ts. Add each one with a ` +
        `backup plan — "backup: true" if it holds reader-authored data, or "backup: false" with a ` +
        `reason. (This is the check that v4 did not have when book_tropes was added.)`,
    ).toEqual([])
  })

  it('declares nothing that the schema does not actually own', () => {
    const stale = USER_OWNED_TABLES.filter((t) => !schema.has(t.table)).map((t) => t.table)
    expect(stale, 'Declared in ownedTables.ts but absent from the migrations').toEqual([])
  })

  it('every exclusion carries a reason', () => {
    for (const t of USER_OWNED_TABLES) {
      if (!t.plan.backup) expect(t.plan.why.length, `${t.table} is excluded without a reason`).toBeGreaterThan(20)
    }
  })

  it('gives every reconciliation-backup table a stable primary-key order', () => {
    expect(Object.keys(RECONCILIATION_BACKUP_PRIMARY_KEYS).sort()).toEqual(
      USER_OWNED_TABLES.map((entry) => entry.table).sort(),
    )
    for (const entry of USER_OWNED_TABLES) {
      expect(
        RECONCILIATION_BACKUP_PRIMARY_KEYS[entry.table]?.length,
        `${entry.table} cannot be deterministically serialized without a total order`,
      ).toBeGreaterThan(0)
    }
  })

  it('declares a total order for every collective household rollback section', () => {
    expect(RECONCILIATION_HOUSEHOLD_BACKUP_SPECS).toEqual([
      { key: 'households', table: 'households', primaryKey: ['id'] },
      {
        key: 'members',
        table: 'household_members',
        primaryKey: ['household_id', 'user_id'],
      },
      { key: 'works', table: 'household_works', primaryKey: ['household_id', 'work_id'] },
      { key: 'shares', table: 'household_book_shares', primaryKey: ['book_id'] },
      {
        key: 'enrichment',
        table: 'household_work_enrichment',
        primaryKey: ['household_id', 'work_id'],
      },
    ])
  })

  it('captures every rollback section inside one read-only repeatable-read snapshot', () => {
    const start = RECONCILIATION_SCRIPT.indexOf('function backupOwnerState')
    const end = RECONCILIATION_SCRIPT.indexOf('async function currentPlan', start)
    const block = RECONCILIATION_SCRIPT.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(block).toContain('begin isolation level repeatable read read only')
    expect(block).toContain('executePsql(')
    expect(block).toContain('snapshotAggregateSql(')
    expect(block).toContain("'ownerTables', jsonb_build_object")
    expect(block).toContain("'household', jsonb_build_object")
    expect(block).not.toContain('pageQuery(')
    expect(block).not.toContain('Promise.all')
  })

  it('uses true primary-key ordering for personal and collective snapshot rows', () => {
    const start = RECONCILIATION_SCRIPT.indexOf('function backupOwnerState')
    const end = RECONCILIATION_SCRIPT.indexOf('async function currentPlan', start)
    const block = RECONCILIATION_SCRIPT.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(block).toContain('orderColumns: [entry.owner, ...primaryKey]')
    expect(block).toContain('orderColumns: entry.primaryKey')
    expect(block).toContain('reconciliationFence')
    expect(block).toContain('booksFingerprint')
    expect(block).toContain('householdWorksFingerprint')
  })

  it('requires the complete displayed roster and passes the snapshot fence to the write RPC', () => {
    expect(RECONCILIATION_SCRIPT).toContain(
      'the reviewed household roster must contain exactly Account A and Account B',
    )
    expect(RECONCILIATION_SCRIPT).toContain(
      'p_expected_roster: snapshot.reconciliationFence.roster',
    )
    expect(RECONCILIATION_SCRIPT).toContain(
      'p_expected_books_fingerprint: snapshot.reconciliationFence.booksFingerprint',
    )
    expect(RECONCILIATION_SCRIPT).toContain(
      'snapshot.reconciliationFence.householdWorksFingerprint',
    )
  })

  it('binds the write plan to the same snapshot and refuses a changed preflight', () => {
    expect(RECONCILIATION_SCRIPT).toContain("'planningWorks', ${snapshotPlanningWorksSql}")
    expect(RECONCILIATION_SCRIPT).toContain('works: snapshotState.planningWorks')
    expect(RECONCILIATION_SCRIPT).toContain('books: snapshot.ownerTables.books')
    expect(RECONCILIATION_SCRIPT).toContain('householdWorks: snapshot.household.works')
    expect(RECONCILIATION_SCRIPT).toContain(
      'reconciliation inputs changed after preflight; review a new dry run',
    )
    expect(RECONCILIATION_SCRIPT).toContain('snapshotPlan.resolved')
    expect(RECONCILIATION_SCRIPT).toContain('await main().catch')
    expect(RECONCILIATION_SCRIPT).toContain(
      'ensurePrivateArtifactDirectory(artifactDir, repo)',
    )
    expect(RECONCILIATION_SCRIPT).toContain('private artifact permissions are broader than 0600')
    expect(RECONCILIATION_SCRIPT).toContain("flag: 'wx'")
    expect(RECONCILIATION_SCRIPT).toContain('must not be a symbolic link')
    expect(RECONCILIATION_SCRIPT).toContain('info.nlink !== 1')
  })

  it('separates dry-run approval, read-only backup, and write approval into three phases', () => {
    expect(RECONCILIATION_SCRIPT).toContain("args.includes('--backup-only')")
    expect(RECONCILIATION_SCRIPT).toContain(
      "requireApprovedSha256('dry-run', approvedDryRunSha256, detail.sha256)",
    )
    expect(RECONCILIATION_SCRIPT).toContain(
      "const approved = readApprovedBackup(approvedBackupInput)",
    )
    expect(RECONCILIATION_SCRIPT).toContain('reconciliationRollbackScope(snapshot)')
    expect(RECONCILIATION_SCRIPT).toContain('reconciliationRollbackScope(approved.backup)')
    expect(RECONCILIATION_SCRIPT).toContain(
      'approved backup is stale; create and review a new read-only backup',
    )
    expect(RECONCILIATION_SCRIPT.indexOf('verifiedApprovedBackup')).toBeLessThan(
      RECONCILIATION_SCRIPT.indexOf("supabase.rpc('reconcile_household_library_memberships'"),
    )
  })

  it('verifies snapshot work preservation and keeps database credentials out of psql argv', () => {
    expect(RECONCILIATION_SCRIPT).toContain('missingSnapshotCorpusWorkIds')
    expect(RECONCILIATION_SCRIPT).toContain('snapshotState.planningWorks')
    expect(RECONCILIATION_SCRIPT).toContain('postWorkIds.has(workId)')
    expect(RECONCILIATION_SCRIPT).toContain('corpusCountBefore: snapshot.corpusCount')
    expect(RECONCILIATION_SCRIPT).toContain('corpusCountDelta: post.corpusCount - snapshot.corpusCount')
    expect(RECONCILIATION_SCRIPT).not.toContain('post.corpusCount !== corpusCount')
    expect(RECONCILIATION_SCRIPT).not.toContain('post.corpusCount !== snapshot.corpusCount')
    expect(RECONCILIATION_SCRIPT).toContain('executePsql(')
    expect(RECONCILIATION_SCRIPT).toContain('databaseUrl,')
    expect(RECONCILIATION_SCRIPT).not.toContain("[databaseUrl, '-X'")
  })
})
