// Owner-run, dry-run-first reconciliation for the private chism-books-library.csv.
// Title-level plans and rollback data are written only to a caller-supplied directory OUTSIDE Git.
// The write is one service-role RPC transaction after an exact dry run has no unresolved identity.
//
//   pnpm household:reconcile -- chism-books-library.csv \
//     --account-a-id=<Account A> --account-b-id=<Account B> \
//     --artifact-dir=/private/path/reverie-reconciliation
//
//   pnpm household:reconcile -- chism-books-library.csv \
//     --account-a-id=<Account A> --account-b-id=<Account B> \
//     --artifact-dir=/private/path/reverie-reconciliation \
//     --backup-only --approved-dry-run-sha256=<reviewed dry-run checksum>
//
//   pnpm household:reconcile -- chism-books-library.csv \
//     --account-a-id=<Account A> --account-b-id=<Account B> \
//     --artifact-dir=/private/path/reverie-reconciliation \
//     --write --confirm=RECONCILE_CHISM_HOUSEHOLD \
//     --approved-dry-run-sha256=<reviewed dry-run checksum> \
//     --approved-backup=/private/path/reverie-reconciliation/prechange-backup-...json \
//     --approved-backup-sha256=<reviewed backup checksum>

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { USER_OWNED_TABLES } from '../apps/web/src/data/ownedTables.ts'
import { parseCsv, toRecords, normalizeRecord } from './corpus-import-lib.ts'
import {
  ensurePrivateArtifactDirectory,
  executePsql,
  householdReconciliationCounts,
  pageQuery,
  planHouseholdReconciliation,
  reconciliationRollbackScope,
  RECONCILIATION_BACKUP_PRIMARY_KEYS,
  RECONCILIATION_HOUSEHOLD_BACKUP_SPECS,
  requireApprovedSha256,
} from './household-reconciliation-lib.ts'

const LOCAL_URL = 'http://127.0.0.1:55321'
const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
const LOCAL_SERVICE_ROLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const args = process.argv.slice(2).filter((arg) => arg !== '--')
const value = (name) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''
const csvPath = args.find((arg) => !arg.startsWith('--'))
const accountA = value('account-a-id').trim().toLowerCase()
const accountB = value('account-b-id').trim().toLowerCase()
const artifactDir = resolve(value('artifact-dir'))
const write = args.includes('--write')
const backupOnly = args.includes('--backup-only')
const confirm = value('confirm')
const approvedDryRunSha256 = value('approved-dry-run-sha256')
const approvedBackupInput = value('approved-backup')
const approvedBackupSha256 = value('approved-backup-sha256')

if (!csvPath) throw new Error('pass the private CSV path')
if (!UUID.test(accountA) || !UUID.test(accountB) || accountA === accountB) {
  throw new Error('pass two distinct valid --account-a-id and --account-b-id UUIDs')
}
if (!value('artifact-dir')) throw new Error('pass --artifact-dir outside the repository')
if (write && backupOnly) throw new Error('--write and --backup-only are mutually exclusive')
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactRelative = relative(repo, artifactDir)
if (!artifactRelative.startsWith('..') || artifactRelative === '') {
  throw new Error('artifact directory must be outside the repository')
}
if (write && confirm !== 'RECONCILE_CHISM_HOUSEHOLD') {
  throw new Error('write requires --confirm=RECONCILE_CHISM_HOUSEHOLD after dry-run approval')
}
if (write && !approvedBackupInput) {
  throw new Error('write requires --approved-backup=<reviewed private backup path>')
}

const hasUrl = !!process.env.SUPABASE_URL
const hasService = !!process.env.SUPABASE_SERVICE_ROLE_KEY
if (hasUrl !== hasService) throw new Error('set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
const url = process.env.SUPABASE_URL ?? LOCAL_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SERVICE_ROLE
const databaseUrl = process.env.SUPABASE_DB_URL ?? (!hasUrl ? LOCAL_DATABASE_URL : '')
if ((write || backupOnly) && !databaseUrl) {
  throw new Error(
    'backup/write requires SUPABASE_DB_URL for one transaction-consistent, read-only rollback snapshot',
  )
}
const supabase = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const dbError = (action, error) =>
  new Error(`${action}: ${error?.message ?? JSON.stringify(error)}`)

const identifier = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`unsafe SQL identifier: ${value}`)
  return `"${value}"`
}
const uuidLiteral = (value) => `'${value}'::uuid`
const uuidArray = (values) => `array[${values.map(uuidLiteral).join(', ')}]::uuid[]`
const parseJson = (label, value) => {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label}: invalid JSON`)
  }
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function assertPrivatePath(path, label, mustExist = false) {
  const lexicalRelative = relative(repo, path)
  if (!lexicalRelative.startsWith('..') || lexicalRelative === '') {
    throw new Error(`${label} must be outside the repository`)
  }
  if (!mustExist && !existsSync(path)) return
  const info = lstatSync(path)
  if (info.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`)
  const realRelative = relative(realpathSync(repo), realpathSync(path))
  if (!realRelative.startsWith('..') || realRelative === '') {
    throw new Error(`${label} resolves inside the repository`)
  }
}

const fetchWorks = () =>
  pageQuery('works lookup', ['id'], (from, to) =>
    supabase
      .from('works')
      .select('id, title, author_text', { count: 'exact' })
      .order('id')
      .range(from, to),
  )

const fetchBooks = () =>
  pageQuery('account books', ['id'], (from, to) =>
    supabase
      .from('books')
      .select('id, owner_id, corpus_work_id, removed_at', { count: 'exact' })
      .in('owner_id', [accountA, accountB])
      .order('owner_id')
      .order('id')
      .range(from, to),
  )

const fetchHouseholdWorks = (householdId) =>
  pageQuery('household works', ['work_id'], (from, to) =>
    supabase
      .from('household_works')
      .select('work_id, removed_at', { count: 'exact' })
      .eq('household_id', householdId)
      .order('work_id')
      .range(from, to),
  )

function writePrivateJson(name, value, { reuseIdentical = false } = {}) {
  const privateArtifactDirectory = ensurePrivateArtifactDirectory(artifactDir, repo)
  const body = `${JSON.stringify(value, null, 2)}\n`
  const path = resolve(privateArtifactDirectory, name)
  assertPrivatePath(path, 'private artifact')
  if (existsSync(path)) {
    const info = lstatSync(path)
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0) {
      throw new Error(`private artifact already exists and is not a private regular file: ${path}`)
    }
    const existing = readFileSync(path, 'utf8')
    if (!reuseIdentical || existing !== body) {
      throw new Error(`private artifact already exists with different content: ${path}`)
    }
  } else {
    writeFileSync(path, body, { mode: 0o600, flag: 'wx' })
  }
  if ((lstatSync(path).mode & 0o077) !== 0) {
    throw new Error(`private artifact permissions are broader than 0600: ${path}`)
  }
  const persisted = readFileSync(path)
  return { path, sha256: sha256(persisted) }
}

function readApprovedBackup(pathInput) {
  const path = resolve(pathInput)
  assertPrivatePath(path, 'approved backup', true)
  const info = lstatSync(path)
  if (!info.isFile() || info.nlink !== 1) {
    throw new Error('approved backup must be a private regular file with one link')
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error('approved backup must not be readable or writable by group/others')
  }
  const body = readFileSync(path)
  requireApprovedSha256('backup', approvedBackupSha256, sha256(body))
  const backup = parseJson('approved backup', body.toString('utf8'))
  if (
    !backup ||
    typeof backup !== 'object' ||
    !backup.ownerTables ||
    !backup.household ||
    !backup.reconciliationFence
  ) {
    throw new Error('approved backup is missing reconciliation rollback sections')
  }
  return { path, backup }
}

async function resolveHousehold() {
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', [accountA, accountB])
  if (profileError) throw dbError('profile lookup', profileError)
  if ((profiles ?? []).length !== 2) throw new Error('both requested profiles must exist')
  const { data: memberships, error: membershipError } = await supabase
    .from('household_members')
    .select('household_id, user_id, role')
    .in('user_id', [accountA, accountB])
  if (membershipError) throw dbError('household membership lookup', membershipError)
  const ids = [...new Set((memberships ?? []).map((row) => row.household_id))]
  if (ids.length !== 1 || (memberships ?? []).length !== 2) {
    throw new Error('both accounts must be members of the same one household')
  }
  const { data: completeRoster, error: rosterError } = await supabase
    .from('household_members')
    .select('household_id, user_id, role')
    .eq('household_id', ids[0])
    .order('user_id')
  if (rosterError) throw dbError('complete household roster lookup', rosterError)
  const expectedRoster = [accountA, accountB].sort()
  const rosterIds = (completeRoster ?? []).map((row) => row.user_id)
  if (JSON.stringify(rosterIds) !== JSON.stringify(expectedRoster)) {
    throw new Error('the reviewed household roster must contain exactly Account A and Account B')
  }
  return { householdId: ids[0], profiles, memberships: completeRoster }
}

function snapshotAggregateSql({ table, filterColumn, filterSql, orderColumns }) {
  const order = orderColumns.map((column) => `snapshot_row.${identifier(column)}`).join(', ')
  return `(
    select coalesce(
      jsonb_agg(to_jsonb(snapshot_row) order by ${order}),
      '[]'::jsonb
    )
    from (
      select *
      from public.${identifier(table)}
      where ${identifier(filterColumn)} ${filterSql}
    ) snapshot_row
  )`
}

const snapshotPlanningWorksSql = `(
    select coalesce(
      jsonb_agg(to_jsonb(snapshot_work) order by snapshot_work.id),
      '[]'::jsonb
    )
    from (
      select id, title, author_text from public.works
    ) snapshot_work
  )`

function backupOwnerState(householdId) {
  const accounts = uuidArray([accountA, accountB])
  const ownerTablePairs = []
  for (const entry of USER_OWNED_TABLES) {
    const primaryKey = RECONCILIATION_BACKUP_PRIMARY_KEYS[entry.table]
    if (!primaryKey?.length) {
      throw new Error(`backup ${entry.table}: no stable primary-key ordering is declared`)
    }
    ownerTablePairs.push(
      `'${entry.table}'`,
      snapshotAggregateSql({
        table: entry.table,
        filterColumn: entry.owner,
        filterSql: entry.ownerRelation
          ? `in (select ${identifier(entry.ownerRelation.key)} from public.${identifier(entry.ownerRelation.table)} where ${identifier(entry.ownerRelation.owner)} = any(${accounts}))`
          : `= any(${accounts})`,
        orderColumns: [entry.owner, ...primaryKey],
      }),
    )
  }
  const householdPairs = []
  for (const entry of RECONCILIATION_HOUSEHOLD_BACKUP_SPECS) {
    householdPairs.push(
      `'${entry.key}'`,
      snapshotAggregateSql({
        table: entry.table,
        filterColumn: entry.table === 'households' ? 'id' : 'household_id',
        filterSql: `= ${uuidLiteral(householdId)}`,
        orderColumns: entry.primaryKey,
      }),
    )
  }

  let output
  try {
    output = executePsql(
      databaseUrl,
      [
        '-X',
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `
          begin isolation level repeatable read read only;
          select jsonb_build_object(
            'ownerTables', jsonb_build_object(${ownerTablePairs.join(',\n')}),
            'household', jsonb_build_object(${householdPairs.join(',\n')}),
            'planningWorks', ${snapshotPlanningWorksSql},
            'corpusCount', (select count(*) from public.works),
            'reconciliationFence', jsonb_build_object(
              'roster', (
                select coalesce(jsonb_agg(hm.user_id order by hm.user_id), '[]'::jsonb)
                from public.household_members hm
                where hm.household_id = ${uuidLiteral(householdId)}
              ),
              'booksFingerprint', (
                select md5(coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)::text)
                from public.books b where b.owner_id = any(${accounts})
              ),
              'householdWorksFingerprint', (
                select md5(coalesce(jsonb_agg(to_jsonb(hw) order by hw.work_id), '[]'::jsonb)::text)
                from public.household_works hw
                where hw.household_id = ${uuidLiteral(householdId)}
              )
            )
          )::text;
          commit;
        `,
      ],
      {
        maxBuffer: 256 * 1024 * 1024,
      },
    ).trim()
  } catch (error) {
    const stderr =
      typeof error?.stderr === 'string'
        ? error.stderr.trim()
        : Buffer.isBuffer(error?.stderr)
          ? error.stderr.toString('utf8').trim()
          : ''
    const status = Number.isInteger(error?.status) ? ` (exit ${error.status})` : ''
    throw new Error(
      `transaction-consistent rollback snapshot failed${status}${stderr ? `: ${stderr}` : ''}`,
    )
  }
  const state = parseJson('rollback snapshot', output)
  const { planningWorks, corpusCount, ownerTables, household, reconciliationFence } = state
  return {
    artifact: {
      createdAt: new Date().toISOString(),
      endpoint: url,
      accounts: [accountA, accountB],
      householdId,
      corpusCount,
      ownerTables,
      household,
      reconciliationFence,
    },
    planningWorks,
  }
}

async function currentPlan(records, householdId) {
  const [works, books, householdWorks] = await Promise.all([
    fetchWorks(),
    fetchBooks(),
    fetchHouseholdWorks(householdId),
  ])
  return {
    plan: planHouseholdReconciliation({
      records,
      works,
      books,
      householdWorks,
      accountA,
      accountB,
    }),
    corpusCount: works.length,
    corpusWorkIds: works.map((work) => work.id).sort(),
  }
}

async function main() {
  const records = toRecords(parseCsv(readFileSync(csvPath, 'utf8'))).map(normalizeRecord)
  const { householdId, profiles, memberships } = await resolveHousehold()
  const { plan, corpusCount } = await currentPlan(records, householdId)
  const counts = householdReconciliationCounts(plan)
  const review = {
    version: 1,
    endpoint: url,
    householdId,
    accounts: [...profiles].sort((a, b) => a.id.localeCompare(b.id)),
    roster: memberships,
    plan,
  }
  const reviewBody = `${JSON.stringify(review, null, 2)}\n`
  const reviewSha256 = sha256(reviewBody)
  const detail = writePrivateJson(`dry-run-detail-${reviewSha256.slice(0, 12)}.json`, review, {
    reuseIdentical: true,
  })
  console.log(
    JSON.stringify(
      {
        mode: write
          ? 'WRITE — approval checks required before mutation'
          : backupOnly
            ? 'BACKUP ONLY — nothing written to the database'
            : 'DRY RUN — nothing written',
        endpoint: url,
        accounts: profiles,
        householdId,
        roster: memberships,
        corpusCount,
        counts,
        canWrite: plan.canWrite,
        privateDetailArtifact: detail,
      },
      null,
      2,
    ),
  )
  if (!plan.canWrite) {
    throw new Error(
      'write blocked: add exact missing identities through Household Add books, and resolve every ambiguous or duplicate-active row, then rerun the dry run',
    )
  }
  if (!write && !backupOnly) {
    console.log('\nDry run complete. Review the private artifact and checksum before any write.')
    return
  }
  requireApprovedSha256('dry-run', approvedDryRunSha256, detail.sha256)

  const snapshotState = backupOwnerState(householdId)
  const snapshot = snapshotState.artifact
  const snapshotPlan = planHouseholdReconciliation({
    records,
    works: snapshotState.planningWorks,
    books: snapshot.ownerTables.books,
    householdWorks: snapshot.household.works,
    accountA,
    accountB,
  })
  const expectedRoster = [accountA, accountB].sort()
  if (JSON.stringify(snapshot.reconciliationFence.roster) !== JSON.stringify(expectedRoster)) {
    throw new Error('household roster changed after preflight; review a new dry run')
  }
  if (JSON.stringify(snapshotPlan) !== JSON.stringify(plan)) {
    throw new Error('reconciliation inputs changed after preflight; review a new dry run')
  }

  if (backupOnly) {
    const backup = writePrivateJson(
      `prechange-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      snapshot,
    )
    console.log(
      JSON.stringify(
        {
          verifiedPrechangeBackup: backup,
          next: 'Review this exact private backup and checksum before authorizing write mode.',
        },
        null,
        2,
      ),
    )
    return
  }

  const approved = readApprovedBackup(approvedBackupInput)
  if (
    !isDeepStrictEqual(
      reconciliationRollbackScope(snapshot),
      reconciliationRollbackScope(approved.backup),
    )
  ) {
    throw new Error('approved backup is stale; create and review a new read-only backup')
  }
  console.log(
    JSON.stringify(
      {
        verifiedApprovedBackup: {
          path: approved.path,
          sha256: approvedBackupSha256.toLowerCase(),
        },
      },
      null,
      2,
    ),
  )

  const desiredA = [
    ...new Set(
      snapshotPlan.resolved.filter((item) => item.record.tcRead).map((item) => item.workId),
    ),
  ].sort()
  const desiredB = [
    ...new Set(
      snapshotPlan.resolved.filter((item) => item.record.gcRead).map((item) => item.workId),
    ),
  ].sort()
  const desiredHousehold = [...new Set(snapshotPlan.resolved.map((item) => item.workId))].sort()
  const { data: result, error } = await supabase.rpc('reconcile_household_library_memberships', {
    p_household: householdId,
    p_personal_assignments: [
      { accountId: accountA, workIds: desiredA },
      { accountId: accountB, workIds: desiredB },
    ],
    p_household_work_ids: desiredHousehold,
    p_expected_roster: snapshot.reconciliationFence.roster,
    p_expected_books_fingerprint: snapshot.reconciliationFence.booksFingerprint,
    p_expected_household_works_fingerprint: snapshot.reconciliationFence.householdWorksFingerprint,
  })
  if (error) throw dbError('atomic reconciliation', error)

  const post = await currentPlan(records, householdId)
  const postCounts = householdReconciliationCounts(post.plan)
  const postWorkIds = new Set(post.corpusWorkIds)
  const missingSnapshotCorpusWorkIds = snapshotState.planningWorks
    .map((work) => work.id)
    .filter((workId) => !postWorkIds.has(workId))
  if (
    !post.plan.canWrite ||
    postCounts.personalCreate ||
    postCounts.personalRestore ||
    postCounts.personalArchive ||
    postCounts.householdCreate ||
    postCounts.householdRestore ||
    postCounts.householdArchive ||
    missingSnapshotCorpusWorkIds.length
  ) {
    throw new Error('post-write verification did not converge exactly to the approved plan')
  }
  const verified = writePrivateJson('postchange-verification.json', {
    createdAt: new Date().toISOString(),
    rpcResult: result,
    corpusCountBefore: snapshot.corpusCount,
    corpusCountAfter: post.corpusCount,
    corpusCountDelta: post.corpusCount - snapshot.corpusCount,
    missingSnapshotCorpusWorkIds,
    counts: postCounts,
  })
  console.log(
    JSON.stringify({ result, postCounts, privateVerificationArtifact: verified }, null, 2),
  )
}

await main().catch((error) => {
  console.error(
    `reconcile-chism-household: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})
