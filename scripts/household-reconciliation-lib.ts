import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { workKeyOf } from '../packages/core/src/normalize'
import type { ImportRecord } from './corpus-import-lib'

/** Stable total ordering for every table copied into the pre-reconciliation rollback snapshot.
 * PostgREST pagination over only the owner column is nondeterministic when one owner has more than
 * one page of rows. These are the real primary-key columns, so every page boundary is repeatable. */
export const RECONCILIATION_BACKUP_PRIMARY_KEYS: Record<string, readonly string[]> = {
  discovery_sessions: ['owner_id', 'id'],
  books: ['id'],
  reads: ['id'],
  lists: ['id'],
  list_items: ['list_id', 'book_id'],
  reviews: ['id'],
  merge_verdicts: ['owner_id', 'book_id', 'incoming_key'],
  profiles: ['id'],
  book_tropes: ['book_id', 'trope_id'],
  book_moods: ['book_id', 'mood_id'],
  tropes: ['id'],
  moods: ['id'],
  author_follows: ['user_id', 'author_name'],
  authors: ['id'],
  book_authors: ['book_id', 'author_id', 'role'],
  book_embeddings: ['book_id'],
  match_feedback: ['user_id', 'book_id', 'kind'],
  series: ['id'],
  household_members: ['household_id', 'user_id'],
  household_works: ['household_id', 'work_id'],
  household_book_shares: ['book_id'],
  household_work_enrichment: ['household_id', 'work_id'],
  work_metadata_edits: ['id'],
  corpus_admins: ['user_id'],
  corpus_cover_recovery_marks: ['book_id'],
  corpus_cover_reviews: ['work_id'],
  corpus_cover_review_events: ['id'],
  corpus_sweep_runs: ['id'],
  corpus_sweep_run_items: ['run_id', 'work_id'],
  work_tropes: ['work_id', 'trope_id'],
  work_series_suggestions: ['id'],
  corpus_series: ['id'],
  corpus_series_names: ['id'],
  corpus_series_sources: ['id'],
  corpus_series_entries: ['id'],
  corpus_series_edits: ['id'],
  clubs: ['id'],
  club_members: ['club_id', 'user_id'],
  club_comments: ['id'],
  shared_refs: ['owner_id', 'code'],
  content_reports: ['id'],
  sweep_traces: ['id'],
  series_entries: ['id'],
  trope_suggestions: ['book_id', 'trope_id'],
  series_merge_decisions: ['id'],
}

/** Collective rows copied into the same pre-change rollback artifact. Keep this registry separate
 * from USER_OWNED_TABLES: `households` is intentionally collective, but it still needs the same
 * counted paging and total-order guarantee as personal data. */
export const RECONCILIATION_HOUSEHOLD_BACKUP_SPECS = [
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
] as const

export interface CountedPage<Row> {
  data: Row[] | null
  error: { message?: string } | null
  count: number | null
}

/** Read a counted, ranged result under a declared primary-key identity for read-only planning.
 * Count changes, partial pages, missing key columns, and repeated key tuples fail closed, but
 * independent HTTP pages are not a database snapshot and this helper must never back a write.
 * `pageSize` is injectable so the real helper can be exercised at page boundaries in unit tests. */
export async function pageQuery<Row extends Record<string, unknown>>(
  label: string,
  primaryKey: readonly string[],
  makeQuery: (from: number, to: number) => PromiseLike<CountedPage<Row>>,
  pageSize = 1000,
): Promise<Row[]> {
  if (!primaryKey.length) throw new Error(`${label}: no primary-key identity is declared`)
  const rows: Row[] = []
  let total: number | null = null
  for (let from = 0; ; from += pageSize) {
    const { data, error, count } = await makeQuery(from, from + pageSize - 1)
    if (error) throw new Error(`${label}: ${error.message ?? JSON.stringify(error)}`)
    if (!Number.isInteger(count) || count == null || count < 0) {
      throw new Error(`${label}: exact row count is unavailable; refusing a partial snapshot`)
    }
    if (total == null) total = count
    else if (count !== total) {
      throw new Error(`${label}: row count changed during paging; refusing a partial snapshot`)
    }
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize || rows.length >= total) break
  }
  if (rows.length !== total) {
    throw new Error(`${label}: read ${rows.length} of ${total}; refusing a partial snapshot`)
  }

  const identities = new Set<string>()
  for (const row of rows) {
    const tuple = primaryKey.map((column) => {
      if (!Object.hasOwn(row, column) || row[column] == null) {
        throw new Error(`${label}: row is missing primary-key column ${column}`)
      }
      return row[column]
    })
    const identity = JSON.stringify(tuple)
    if (identities.has(identity)) {
      throw new Error(`${label}: pagination repeated a primary key; refusing a partial snapshot`)
    }
    identities.add(identity)
  }
  return rows
}

export interface PsqlConnectionBoundary {
  databaseArgument: string
  password: string | undefined
}

/** Give psql only the executable lookup it needs plus the password extracted from the
 * reviewed URI. In particular, never inherit libpq routing, TLS, service-file, or stale credential
 * variables that can override the URI or expose unrelated process secrets to the child. */
export function psqlChildEnvironment(
  source: NodeJS.ProcessEnv,
  password: string | undefined,
): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {}
  if (source.PATH) child.PATH = source.PATH
  if (password !== undefined) child.PGPASSWORD = password
  return child
}

export interface PsqlExecutionOptions {
  executable?: string
  sourceEnvironment?: NodeJS.ProcessEnv
  maxBuffer?: number
}

/** Execute the actual psql child behind the same URI and environment boundary exercised by tests.
 * Keeping process creation here prevents callers from accidentally restoring inherited libpq
 * overrides while retaining the reviewed password-free argv. */
export function executePsql(
  connectionUrl: string,
  args: readonly string[],
  options: PsqlExecutionOptions = {},
): string {
  const connection = psqlConnectionBoundary(connectionUrl)
  return execFileSync(options.executable ?? 'psql', [connection.databaseArgument, ...args], {
    encoding: 'utf8',
    env: psqlChildEnvironment(options.sourceEnvironment ?? process.env, connection.password),
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: options.maxBuffer,
  })
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  )
}

function validateExistingPrivateDirectory(directory: string, repository: string): string {
  const info = lstatSync(directory)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('artifact directory must be a private directory, not a symbolic link')
  }
  const canonicalDirectory = realpathSync(directory)
  if (isInside(repository, canonicalDirectory)) {
    throw new Error('artifact directory resolves inside the repository')
  }
  const broadDirectories = new Set(
    [resolve('/'), homedir(), tmpdir(), '/tmp']
      .filter((candidate) => existsSync(candidate))
      .map((candidate) => realpathSync(candidate)),
  )
  if (broadDirectories.has(canonicalDirectory)) {
    throw new Error('artifact directory must not be a broad system or user directory')
  }
  if ((info.mode & 0o7777) !== 0o700) {
    throw new Error('existing artifact directory must have permissions 0700')
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error('artifact directory must be owned by the current operator')
  }
  return canonicalDirectory
}

/** Prepare an owner-private artifact directory without changing permissions on any caller-supplied
 * existing path. Existing directories must already be owned by the operator and exactly 0700. A
 * missing final component is created non-recursively below a canonical, existing parent. */
export function ensurePrivateArtifactDirectory(
  artifactDirectory: string,
  repositoryRoot: string,
): string {
  const directory = resolve(artifactDirectory)
  const repository = realpathSync(repositoryRoot)
  if (isInside(repository, directory)) {
    throw new Error('artifact directory must be outside the repository')
  }

  if (existsSync(directory)) {
    return validateExistingPrivateDirectory(directory, repository)
  }

  const parent = dirname(directory)
  if (!existsSync(parent)) {
    throw new Error('artifact directory parent must already exist')
  }
  const canonicalDirectory = join(realpathSync(parent), basename(directory))
  if (isInside(repository, canonicalDirectory)) {
    throw new Error('artifact directory would be created inside the repository')
  }

  try {
    mkdirSync(canonicalDirectory, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
  return validateExistingPrivateDirectory(canonicalDirectory, repository)
}

/** Keep database credentials out of the child process argument list while preserving libpq URI
 * semantics, including multi-host authorities and non-password query options. The extracted secret
 * is supplied only through the allowlisted child environment built by psqlChildEnvironment. */
export function psqlConnectionBoundary(connectionUrl: string): PsqlConnectionBoundary {
  const match = /^(postgres(?:ql)?):\/\/([^/?#]*)([^#]*)$/i.exec(connectionUrl)
  if (!match) throw new Error('database URL must be a postgres:// or postgresql:// URI')

  const [, scheme, authority, originalSuffix] = match
  let safeAuthority = authority!
  let password: string | undefined
  const at = authority!.lastIndexOf('@')
  if (at >= 0) {
    const userInfo = authority!.slice(0, at)
    const passwordSeparator = userInfo.indexOf(':')
    if (passwordSeparator >= 0) {
      try {
        password = decodeURIComponent(userInfo.slice(passwordSeparator + 1))
      } catch {
        throw new Error('database URL contains an invalid encoded password')
      }
      safeAuthority = `${userInfo.slice(0, passwordSeparator)}@${authority!.slice(at + 1)}`
    }
  }

  let safeSuffix = originalSuffix!
  const queryStart = originalSuffix!.indexOf('?')
  if (queryStart >= 0) {
    const path = originalSuffix!.slice(0, queryStart)
    const safeParameters: string[] = []
    const queryPasswords: string[] = []
    for (const parameter of originalSuffix!.slice(queryStart + 1).split('&')) {
      const separator = parameter.indexOf('=')
      const rawKey = separator >= 0 ? parameter.slice(0, separator) : parameter
      let key: string
      try {
        key = decodeURIComponent(rawKey)
      } catch {
        throw new Error('database URL contains an invalid encoded query key')
      }
      if (key === 'sslpassword') {
        throw new Error(
          'database URL sslpassword cannot be passed without exposing a credential in psql argv',
        )
      }
      if (key !== 'password') {
        safeParameters.push(parameter)
        continue
      }
      const rawPassword = separator >= 0 ? parameter.slice(separator + 1) : ''
      try {
        queryPasswords.push(decodeURIComponent(rawPassword))
      } catch {
        throw new Error('database URL contains an invalid encoded password')
      }
    }
    if (queryPasswords.length > 1 || (queryPasswords.length === 1 && password !== undefined)) {
      throw new Error('database URL contains ambiguous password parameters')
    }
    if (queryPasswords.length === 1) password = queryPasswords[0]!
    const safeQuery = safeParameters.join('&')
    safeSuffix = `${path}${safeQuery ? `?${safeQuery}` : ''}`
  }

  return {
    databaseArgument: `${scheme}://${safeAuthority}${safeSuffix}`,
    password,
  }
}

const SHA256 = /^[0-9a-f]{64}$/

/** Bind an owner-approved private artifact to the exact bytes produced by the operator. Checksums
 * are approval identifiers, not secrets, so a constant-time comparison is unnecessary. */
export function requireApprovedSha256(label: string, approved: string, actual: string): void {
  const normalized = approved.trim().toLowerCase()
  if (!SHA256.test(normalized)) {
    throw new Error(`${label} requires a 64-character --approved-${label}-sha256 value`)
  }
  if (normalized !== actual.toLowerCase()) {
    throw new Error(`${label} checksum does not match the reviewed artifact`)
  }
}

/** Only the rows the reconciliation can change belong to the rollback-state comparison. Corpus
 * count and planning works are separately verified, so an unrelated corpus addition does not make
 * a still-valid personal/household backup look stale. */
export function reconciliationRollbackScope(snapshot: Record<string, unknown>) {
  return {
    endpoint: snapshot.endpoint,
    accounts: snapshot.accounts,
    householdId: snapshot.householdId,
    ownerTables: snapshot.ownerTables,
    household: snapshot.household,
    reconciliationFence: snapshot.reconciliationFence,
  }
}

export interface ReconciliationWorkRow {
  id: string
  title: string
  author_text: string | null
}

export interface ReconciliationBookRow {
  id: string
  owner_id: string
  corpus_work_id: string
  removed_at: string | null
}

export interface ReconciliationHouseholdWorkRow {
  work_id: string
  removed_at: string | null
}

export interface ResolvedCsvWork {
  record: ImportRecord
  workId: string
}

export interface HouseholdReconciliationPlan {
  records: ImportRecord[]
  resolved: ResolvedCsvWork[]
  duplicateMarkedDropped: number
  exactRowsCollapsed: number
  unmatched: ImportRecord[]
  conflicts: Array<{ record: ImportRecord; workIds: string[] }>
  personal: {
    create: Array<{ accountId: string; workId: string; record: ImportRecord }>
    restore: Array<{ accountId: string; bookId: string; workId: string }>
    archive: Array<{ accountId: string; bookId: string; workId: string }>
    unchanged: number
    duplicateActiveConflicts: Array<{ accountId: string; workId: string; bookIds: string[] }>
  }
  household: {
    create: string[]
    restore: string[]
    archive: string[]
    unchanged: number
  }
  canWrite: boolean
}

/** Duplicate annotations do not erase reader markers. Exact rows collapse by OR-ing TC/GC, while
 * rows explicitly marked Duplicate are excluded exactly as the source file requests. */
export function collapseHouseholdRecords(records: readonly ImportRecord[]): {
  records: ImportRecord[]
  duplicateMarkedDropped: number
  exactRowsCollapsed: number
} {
  const byKey = new Map<string, ImportRecord>()
  let duplicateMarkedDropped = 0
  let exactRowsCollapsed = 0
  for (const record of records) {
    if (record.duplicate) {
      duplicateMarkedDropped++
      continue
    }
    const prior = byKey.get(record.workKey)
    if (!prior) {
      byKey.set(record.workKey, record)
      continue
    }
    exactRowsCollapsed++
    byKey.set(record.workKey, {
      ...prior,
      tcRead: prior.tcRead || record.tcRead,
      gcRead: prior.gcRead || record.gcRead,
    })
  }
  return { records: [...byKey.values()], duplicateMarkedDropped, exactRowsCollapsed }
}

const workComparisonKey = (work: ReconciliationWorkRow): string =>
  workKeyOf({ title: work.title, first: work.author_text ?? '' })

export function planHouseholdReconciliation({
  records: inputRecords,
  works,
  books,
  householdWorks,
  accountA,
  accountB,
}: {
  records: readonly ImportRecord[]
  works: readonly ReconciliationWorkRow[]
  books: readonly ReconciliationBookRow[]
  householdWorks: readonly ReconciliationHouseholdWorkRow[]
  accountA: string
  accountB: string
}): HouseholdReconciliationPlan {
  const { records, duplicateMarkedDropped, exactRowsCollapsed } =
    collapseHouseholdRecords(inputRecords)
  const workIdsByKey = new Map<string, string[]>()
  for (const work of works) {
    const key = workComparisonKey(work)
    workIdsByKey.set(key, [...(workIdsByKey.get(key) ?? []), work.id].sort())
  }

  const resolved: ResolvedCsvWork[] = []
  const unmatched: ImportRecord[] = []
  const conflicts: Array<{ record: ImportRecord; workIds: string[] }> = []
  for (const record of records) {
    const matches = workIdsByKey.get(record.workKey) ?? []
    if (matches.length === 1) resolved.push({ record, workId: matches[0]! })
    else if (!matches.length) unmatched.push(record)
    else conflicts.push({ record, workIds: matches })
  }

  const desiredHousehold = new Set(resolved.map((item) => item.workId))
  const desiredByAccount = new Map<string, Map<string, ImportRecord>>([
    [accountA, new Map()],
    [accountB, new Map()],
  ])
  for (const item of resolved) {
    if (item.record.tcRead) desiredByAccount.get(accountA)!.set(item.workId, item.record)
    if (item.record.gcRead) desiredByAccount.get(accountB)!.set(item.workId, item.record)
  }

  const create: HouseholdReconciliationPlan['personal']['create'] = []
  const restore: HouseholdReconciliationPlan['personal']['restore'] = []
  const archive: HouseholdReconciliationPlan['personal']['archive'] = []
  const duplicateActiveConflicts: HouseholdReconciliationPlan['personal']['duplicateActiveConflicts'] =
    []
  let personalUnchanged = 0

  for (const [accountId, desired] of desiredByAccount) {
    const accountBooks = books.filter((book) => book.owner_id === accountId)
    for (const [workId, record] of desired) {
      const active = accountBooks.filter(
        (book) => book.corpus_work_id === workId && book.removed_at === null,
      )
      if (active.length > 1) {
        duplicateActiveConflicts.push({
          accountId,
          workId,
          bookIds: active.map((book) => book.id).sort(),
        })
      } else if (active.length === 1) personalUnchanged++
      else {
        const removed = accountBooks
          .filter((book) => book.corpus_work_id === workId && book.removed_at !== null)
          .sort((a, b) => a.id.localeCompare(b.id))
        if (removed[0]) restore.push({ accountId, bookId: removed[0].id, workId })
        else create.push({ accountId, workId, record })
      }
    }
    for (const book of accountBooks) {
      if (book.removed_at === null && !desired.has(book.corpus_work_id)) {
        archive.push({ accountId, bookId: book.id, workId: book.corpus_work_id })
      }
    }
  }

  const activeHousehold = new Map(
    householdWorks.filter((work) => work.removed_at === null).map((work) => [work.work_id, work]),
  )
  const removedHousehold = new Map(
    householdWorks.filter((work) => work.removed_at !== null).map((work) => [work.work_id, work]),
  )
  const householdCreate: string[] = []
  const householdRestore: string[] = []
  let householdUnchanged = 0
  for (const workId of [...desiredHousehold].sort()) {
    if (activeHousehold.has(workId)) householdUnchanged++
    else if (removedHousehold.has(workId)) householdRestore.push(workId)
    else householdCreate.push(workId)
  }
  const householdArchive = [...activeHousehold.keys()]
    .filter((workId) => !desiredHousehold.has(workId))
    .sort()

  return {
    records,
    resolved,
    duplicateMarkedDropped,
    exactRowsCollapsed,
    unmatched,
    conflicts,
    personal: {
      create,
      restore,
      archive,
      unchanged: personalUnchanged,
      duplicateActiveConflicts,
    },
    household: {
      create: householdCreate,
      restore: householdRestore,
      archive: householdArchive,
      unchanged: householdUnchanged,
    },
    canWrite:
      unmatched.length === 0 && conflicts.length === 0 && duplicateActiveConflicts.length === 0,
  }
}

export function householdReconciliationCounts(plan: HouseholdReconciliationPlan) {
  return {
    csvRowsAfterDuplicateRules: plan.records.length,
    duplicateMarkedDropped: plan.duplicateMarkedDropped,
    exactRowsCollapsed: plan.exactRowsCollapsed,
    resolved: plan.resolved.length,
    unmatched: plan.unmatched.length,
    conflictingCorpusMatches: plan.conflicts.length,
    personalCreate: plan.personal.create.length,
    personalRestore: plan.personal.restore.length,
    personalArchive: plan.personal.archive.length,
    personalUnchanged: plan.personal.unchanged,
    personalDuplicateConflicts: plan.personal.duplicateActiveConflicts.length,
    householdCreate: plan.household.create.length,
    householdRestore: plan.household.restore.length,
    householdArchive: plan.household.archive.length,
    householdUnchanged: plan.household.unchanged,
  }
}
