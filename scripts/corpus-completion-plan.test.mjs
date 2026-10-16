import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { planCorpusCompletion } from './corpus-completion-plan.mjs'

const row = (patch = {}) => ({
  id: '00000000-0000-0000-0000-000000000001',
  title: 'Example Book',
  author: 'Example Author',
  isbns: ['9780593500132'],
  series_check_state: 'found',
  fingerprint: 'a'.repeat(32),
  reader_linked: true,
  missing_fields: ['description', 'pages', 'publication', 'publisher', 'language'],
  saved_review_state: 'open',
  review_current: false,
  issues: ['description'],
  unresolved_isbn_report: false,
  edition_count: 2,
  reviewed_editions_with_pages: 1,
  ...patch,
})
const disposition = (status) => ({
  taskId: `${row().id}:description`,
  fingerprint: row().fingerprint,
  nonLlmStatus: status,
})

test('source research comes first; work scalar gaps never become edition fill proposals', () => {
  const input = [row()]
  const before = structuredClone(input)
  const plan = planCorpusCompletion(input)
  assert.equal(plan.tasks.find((t) => t.kind === 'description').stage, 'non_llm_research')
  const edition = plan.tasks.find((t) => t.kind === 'edition_selection')
  assert.equal(edition.stage, 'review')
  assert.equal(edition.scope, 'edition')
  assert.equal('isbn' in edition, false)
  assert.equal('value' in edition, false)
  assert.equal(plan.modelCalls, 0)
  assert.equal(plan.productionWrites, 0)
  assert.deepEqual(input, before)
})
test('ISBN conflict, invalid ISBN, duplicate identity and reports block gap research', () => {
  for (const patch of [
    ...['isbn_conflict', 'invalid_isbn', 'duplicate_identity'].map((issue) => ({
      issues: [issue],
    })),
    { unresolved_isbn_report: true },
    { author: ' ' },
  ]) {
    const plan = planCorpusCompletion([row(patch)])
    assert.deepEqual(
      plan.tasks.map((t) => t.kind),
      ['identity'],
    )
    assert.equal(plan.tasks[0].priority, 0)
  }
})
test('stale deferred reviews and invalid dates cannot be silently released', () => {
  for (const patch of [
    { saved_review_state: 'deferred', review_current: false },
    { issues: ['invalid_publication'] },
  ])
    assert.deepEqual(
      planCorpusCompletion([row(patch)]).tasks.map((t) => t.kind),
      ['existing_hold'],
    )
})
test('failure is not successful absence; a model research task requires explicit completed source research', () => {
  for (const [status, stage] of Object.entries({
    not_attempted: 'non_llm_research',
    failed: 'non_llm_retry_review',
    candidate: 'source_review',
    complete_no_supported_value: 'llm_evidence_research',
  })) {
    const task = planCorpusCompletion([row()], [disposition(status)]).tasks[0]
    assert.equal(task.stage, stage)
    assert.equal(task.model, status === 'complete_no_supported_value' ? 'gpt-6-luna' : undefined)
    assert.equal(task.automatic, false)
  }
})
test('stale, duplicate, unsupported and wrong-scope dispositions fail closed', () => {
  for (const entries of [
    [{ ...disposition('complete_no_supported_value'), fingerprint: 'b'.repeat(32) }],
    [disposition('failed'), disposition('complete_no_supported_value')],
    [{ ...disposition('candidate'), taskId: `${row().id}:edition_selection` }],
    [disposition('timeout_means_empty')],
  ])
    assert.throws(() => planCorpusCompletion([row()], entries))
})
test('unknown series remain relationship tasks, never standalone assertions', () => {
  for (const state of ['unknown', 'review', 'unresolved']) {
    const task = planCorpusCompletion([row({ missing_fields: [], series_check_state: state })])
      .tasks[0]
    assert.equal(task.kind, 'series_relationship')
    assert.equal(task.stage, 'review')
  }
  assert.equal(
    planCorpusCompletion([row({ missing_fields: [], series_check_state: 'no_series' })]).tasks
      .length,
    0,
  )
})
test('reader-linked descriptions are ahead of unlinked research regardless of input order', () => {
  const other = row({ id: '00000000-0000-0000-0000-000000000002', reader_linked: false })
  assert.equal(planCorpusCompletion([other, row()]).tasks[0].workId, row().id)
})
test('unknown fields, personal payloads, duplicate rows and unsupported states are rejected', () => {
  for (const input of [
    [row({ notes: 'private' })],
    [row(), row()],
    [row({ missing_fields: ['rating'] })],
    [row({ series_check_state: null })],
  ])
    assert.throws(() => planCorpusCompletion(input))
})
test('CLI uses private create-only output and prints aggregate counts only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'completion-plan-'))
  try {
    const input = join(dir, 'input.json'),
      output = join(dir, 'output.json')
    await writeFile(input, JSON.stringify([row()]))
    const command = new URL('./corpus-completion-plan.mjs', import.meta.url)
    const run = () =>
      spawnSync(process.execPath, [command.pathname, input, output], { encoding: 'utf8' })
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.includes(row().title), false)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    const saved = await readFile(output, 'utf8')
    assert.equal(JSON.parse(saved).tasks.length, 2)
    assert.equal(run().status, 1)
    assert.equal(await readFile(output, 'utf8'), saved)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
