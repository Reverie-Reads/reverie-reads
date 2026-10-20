import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { summarizeScopedInventory } from './corpus-scoped-inventory.mjs'

const edition = (patch = {}) => ({
  id: '00000000-0000-0000-0000-000000000002',
  reviewed: true,
  fields: {
    pages: 'present',
    publication: 'present',
    publisher: 'missing',
    language: 'missing',
    format: 'present',
  },
  credit_state: 'unknown',
  credit_count: 0,
  held_credit_count: 0,
  ...patch,
})
const row = (patch = {}) => ({
  id: '00000000-0000-0000-0000-000000000001',
  fingerprint: 'a'.repeat(32),
  reader_linked: true,
  work_fields: {
    description: 'missing',
    pages: 'missing',
    publication: 'missing',
    publisher: 'missing',
    language: 'missing',
    cover: 'present',
  },
  identity_state: 'unknown',
  identity_reasons: [],
  contributor_state: 'structured_unverified',
  saved_review_state: 'open',
  review_current: false,
  series_state: 'unknown',
  editions: [edition()],
  ...patch,
})

test('work scalar blanks are separate from the selected registered edition and do not certify support', () => {
  const input = [row()]
  const before = structuredClone(input)
  const summary = summarizeScopedInventory(input)
  assert.deepEqual(summary.workScalarPresence.pages, { missing: 1 })
  assert.deepEqual(summary.editions.fields.pages, { present: 1 })
  assert.equal(summary.editions.reviewedFlag, 1)
  assert.equal(summary.evidenceCoverage.editionFacts, 'unknown')
  assert.equal(summary.evidenceCoverage.coverUsage, 'unknown')
  assert.equal(summary.productionWrites, 0)
  assert.equal(summary.modelCalls, 0)
  assert.deepEqual(input, before)
  assert.equal(JSON.stringify(summary).includes(input[0].id), false)
})

test('audiobook pages, unknown format, no editions and undeployed credits retain different denominators', () => {
  const summary = summarizeScopedInventory([
    row({
      editions: [
        edition({
          fields: { ...edition().fields, pages: 'not_applicable' },
          credit_state: 'not_observed',
          credit_count: null,
          held_credit_count: null,
        }),
      ],
    }),
    row({
      id: '00000000-0000-0000-0000-000000000003',
      reader_linked: false,
      editions: [
        edition({
          id: '00000000-0000-0000-0000-000000000004',
          fields: { ...edition().fields, pages: 'unknown', format: 'unknown' },
        }),
      ],
    }),
    row({ id: '00000000-0000-0000-0000-000000000005', editions: [] }),
  ])
  assert.deepEqual(summary.editions.fields.pages, { not_applicable: 1, unknown: 1 })
  assert.equal(summary.editions.registered, 2)
  assert.equal(summary.editions.worksWithoutRegisteredEdition, 1)
  assert.equal(summary.editions.creditStorageUnobserved, 1)
  assert.equal(summary.readerLinkedWorks, 2)
  assert.deepEqual(summary.readerLinkedWorkScalarPresence.description, { missing: 2 })
})

test('identity issues, held credits and stale deferred reviews stay visible', () => {
  const summary = summarizeScopedInventory([
    row({
      identity_state: 'review_required',
      identity_reasons: ['isbn_conflict', 'unresolved_isbn_report'],
      contributor_state: 'review_required',
      saved_review_state: 'deferred',
      review_current: false,
      editions: [
        edition({ credit_state: 'review_required', credit_count: 4, held_credit_count: 2 }),
      ],
    }),
  ])
  assert.equal(summary.identityStates.review_required, 1)
  assert.equal(summary.identityReasons.isbn_conflict, 1)
  assert.equal(summary.reviews.deferredStillHeld, 1)
  assert.equal(summary.reviews.staleOrAbsent, 1)
  assert.equal(summary.editions.recordedCredits, 4)
  assert.equal(summary.editions.heldCredits, 2)
})

test('reject private fields, inflated confidence, inconsistent counts and duplicated identities', () => {
  for (const input of [
    [row({ rating: 5 })],
    [row({ reader_linked: { user_id: 'private' } })],
    [row({ identity_state: 'verified' })],
    [row({ identity_state: 'review_required' })],
    [
      row({
        editions: [edition({ credit_state: 'recorded', credit_count: 1, held_credit_count: 1 })],
      }),
    ],
    [row({ editions: [edition({ credit_state: 'not_observed' })] })],
    [row(), row()],
    [row({ editions: [edition(), edition()] })],
    [
      row({
        editions: [edition({ fields: { ...edition().fields, publisher: 'not_applicable' } })],
      }),
    ],
  ])
    assert.throws(() => summarizeScopedInventory(input), /Invalid scoped inventory/)
})

test('CLI writes only a new aggregate file and never clobbers the inventory or existing summary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scoped-inventory-'))
  try {
    const input = join(dir, 'input.json'),
      output = join(dir, 'summary.json')
    await writeFile(input, JSON.stringify([row()]))
    const script = new URL('./corpus-scoped-inventory.mjs', import.meta.url).pathname
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    assert.equal(run(input, output).status, 0)
    const original = await readFile(output, 'utf8')
    assert.equal(JSON.parse(original).works, 1)
    assert.equal(run(input, output).status, 1)
    assert.equal(await readFile(output, 'utf8'), original)
    assert.equal(run(input, input).status, 1)
    assert.deepEqual(JSON.parse(await readFile(input, 'utf8')), [row()])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
