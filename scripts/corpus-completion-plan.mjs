import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fields = ['description', 'pages', 'publication', 'publisher', 'language']
const issues = [
  'description',
  'invalid_isbn',
  'isbn_conflict',
  'duplicate_identity',
  'invalid_publication',
]
const states = ['found', 'review', 'unknown', 'no_series', 'unresolved']
const rowKeys = [
  'id',
  'title',
  'author',
  'isbns',
  'series_check_state',
  'fingerprint',
  'reader_linked',
  'missing_fields',
  'saved_review_state',
  'review_current',
  'issues',
  'unresolved_isbn_report',
  'edition_count',
  'reviewed_editions_with_pages',
]
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const fingerprint = /^[a-f0-9]{32}$/
const exactKeys = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k))
const list = (v, allowed) =>
  Array.isArray(v) && new Set(v).size === v.length && v.every((x) => allowed.includes(x))
const count = (v) => Number.isSafeInteger(v) && v >= 0
const fail = () => {
  throw new Error('Invalid completion inventory or research disposition')
}

/** Scheduling only: no provider fetch, metadata proposal, catalog patch or write credential. */
export function planCorpusCompletion(inventory, dispositions = []) {
  if (!Array.isArray(inventory) || inventory.length > 100000 || !Array.isArray(dispositions)) fail()
  const seen = new Set()
  for (const row of inventory) {
    if (
      !exactKeys(row, rowKeys) ||
      !uuid.test(row.id) ||
      seen.has(row.id) ||
      !fingerprint.test(row.fingerprint) ||
      typeof row.title !== 'string' ||
      typeof row.author !== 'string' ||
      row.title.length > 2000 ||
      row.author.length > 2000 ||
      !Array.isArray(row.isbns) ||
      row.isbns.some((v) => typeof v !== 'string' || v.length > 100) ||
      !states.includes(row.series_check_state) ||
      !list(row.missing_fields, fields) ||
      !list(row.issues, issues) ||
      !['open', 'deferred', 'reviewed'].includes(row.saved_review_state) ||
      [row.reader_linked, row.review_current, row.unresolved_isbn_report].some(
        (v) => typeof v !== 'boolean',
      ) ||
      !count(row.edition_count) ||
      !count(row.reviewed_editions_with_pages) ||
      row.reviewed_editions_with_pages > row.edition_count
    )
      fail()
    seen.add(row.id)
  }
  const tasks = []
  const add = (row, kind, scope, priority, requestedFields, reason) =>
    tasks.push({
      id: `${row.id}:${kind}`,
      workId: row.id,
      title: row.title,
      author: row.author,
      fingerprint: row.fingerprint,
      kind,
      scope,
      priority,
      fields: requestedFields,
      readerLinked: row.reader_linked,
      reason,
      stage: 'review',
      automatic: false,
    })
  for (const row of inventory) {
    const identityIssues = row.issues.filter((i) =>
      ['invalid_isbn', 'isbn_conflict', 'duplicate_identity'].includes(i),
    )
    if (
      !row.title.trim() ||
      !row.author.trim() ||
      identityIssues.length ||
      row.unresolved_isbn_report
    ) {
      add(
        row,
        'identity',
        'work',
        0,
        [],
        'Resolve identity or ISBN issues before researching metadata',
      )
      continue
    }
    // A stale fingerprint never releases a deferred hold automatically.
    if (row.saved_review_state === 'deferred' || row.issues.includes('invalid_publication')) {
      add(
        row,
        'existing_hold',
        'work',
        1,
        row.missing_fields,
        'Reconcile the saved review and current record before completion',
      )
      continue
    }
    if (row.missing_fields.includes('description')) {
      add(
        row,
        'description',
        'work',
        row.reader_linked ? 2 : 4,
        ['description'],
        'Inspect existing evidence, then the author or publisher synopsis',
      )
      tasks.at(-1).stage = 'non_llm_research'
    }
    const editionFields = row.missing_fields.filter((f) => f !== 'description')
    if (editionFields.length) {
      // These are WORK scalar gaps, not proof that a particular edition lacks these fields.
      // Never pick the first ISBN or copy a reviewed edition into work-level scalars.
      add(
        row,
        'edition_selection',
        'edition',
        row.reader_linked ? 3 : 5,
        editionFields,
        'Choose an exact edition and inspect its field-level evidence; work scalar blanks are not edition gaps',
      )
    }
    if (['review', 'unknown', 'unresolved'].includes(row.series_check_state))
      add(
        row,
        'series_relationship',
        'relationship',
        row.reader_linked ? 3 : 5,
        [],
        'Verify the exact work in a series relationship; a missing label does not establish standalone status',
      )
  }
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const reviewed = new Set()
  for (const disposition of dispositions) {
    if (
      !exactKeys(disposition, ['taskId', 'fingerprint', 'nonLlmStatus']) ||
      reviewed.has(disposition.taskId) ||
      !['not_attempted', 'failed', 'candidate', 'complete_no_supported_value'].includes(
        disposition.nonLlmStatus,
      )
    )
      fail()
    const task = byId.get(disposition.taskId)
    if (!task || task.kind !== 'description' || task.fingerprint !== disposition.fingerprint) fail()
    reviewed.add(disposition.taskId)
    task.stage = {
      not_attempted: 'non_llm_research',
      failed: 'non_llm_retry_review',
      candidate: 'source_review',
      complete_no_supported_value: 'llm_evidence_research',
    }[disposition.nonLlmStatus]
    // Explicitly recorded completion of the deterministic phase is only permission to research.
    // Model output still needs independent source/identity review; it is never an import patch.
    if (task.stage === 'llm_evidence_research') task.model = 'gpt-6-luna'
  }
  tasks.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  const tally = (key) =>
    tasks.reduce((out, t) => {
      out[t[key]] = (out[t[key]] ?? 0) + 1
      return out
    }, {})
  return {
    version: 1,
    purpose: 'private_completion_planning',
    productionWrites: 0,
    modelCalls: 0,
    inventorySha256: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
    works: inventory.length,
    readerLinkedWorks: inventory.filter((r) => r.reader_linked).length,
    summary: { tasks: tasks.length, kinds: tally('kind'), stages: tally('stage') },
    tasks,
  }
}

async function main(args) {
  if (args.length < 2 || args.length > 3)
    throw new Error(
      'Usage: node scripts/corpus-completion-plan.mjs INPUT.json OUTPUT.json [DISPOSITIONS.json]',
    )
  const [input, output, dispositions] = args
  const plan = planCorpusCompletion(
    JSON.parse(await readFile(input, 'utf8')),
    dispositions ? JSON.parse(await readFile(dispositions, 'utf8')) : [],
  )
  // Private, create-only output. Never overwrite a frozen plan or print case identities.
  await writeFile(output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(
    JSON.stringify({ works: plan.works, ...plan.summary, productionWrites: 0, modelCalls: 0 }),
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(() => {
    console.error(
      'Completion planning failed; check input schema and choose an unused output path.',
    )
    process.exitCode = 1
  })
