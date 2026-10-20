import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  initialize,
  configure,
  status,
  prepare,
  reserve,
  run,
  settle,
  nanos,
  ledgerRoot,
  review,
} from './intake-budget.mjs'

const moduleUrl = new URL('./intake-budget.mjs', import.meta.url).href
const hash = (s) => createHash('sha256').update(s).digest('hex')
const now = Date.parse('2026-10-18T12:00:00Z')
const receipt = JSON.stringify({ model: 'gpt-6-luna', conservativeSpentTotalUsd: 20.73931475 })
const reconciliation = () => ({
  version: 1,
  receiptSha256: hash(receipt),
  openingBurdenUsd: '20.73931475',
  checkedAt: new Date(now).toISOString(),
  laterActivityReconciled: true,
})
const pricing = () => ({
  version: 1,
  model: 'gpt-6-luna',
  serviceTier: 'default',
  currency: 'USD',
  pricingVersion: 'synthetic-tests-only',
  pricingSource: 'https://openai.com/api/pricing/',
  contextLimitSource: 'https://developers.openai.com/api/docs/models',
  checkedAt: new Date(now).toISOString(),
  verified: true,
  inputUsdPerMillion: '1',
  outputUsdPerMillion: '2',
  maxInputTokens: 100000,
  maxOutputTokens: 5000,
})
const row = (n = 1) => ({
  id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  title: 'Synthetic private title',
  author: 'Synthetic Author',
  isbns: [],
  series_check_state: 'found',
  fingerprint: 'a'.repeat(32),
  reader_linked: true,
  missing_fields: ['description'],
  saved_review_state: 'open',
  review_current: false,
  issues: ['description'],
  unresolved_isbn_report: false,
  edition_count: 0,
  reviewed_editions_with_pages: 0,
})
function input(n = 1, at = now) {
  const r = row(n),
    taskId = `${r.id}:description`
  const dispositions = [
    { taskId, fingerprint: r.fingerprint, nonLlmStatus: 'complete_no_supported_value' },
  ]
  return {
    inventory: [r],
    dispositions,
    taskId,
    evidence: {
      version: 1,
      checkedAt: new Date(at).toISOString(),
      inventoryHash: hash(JSON.stringify([r])),
      dispositionHash: hash(JSON.stringify(dispositions)),
      currentInventoryConfirmed: true,
      fingerprint: r.fingerprint,
      snippets: [
        {
          url: 'https://publisher.example/book',
          locator: 'Description',
          text: 'Synthetic reference text.',
          sourceChecked: true,
          modelInputAllowed: true,
        },
      ],
    },
  }
}
const prepared = (n = 1, at = now) => {
  const i = input(n, at)
  return prepare(i.inventory, i.dispositions, i.taskId, i.evidence, 1000, at)
}
const response = (patch = {}) => ({
  id: 'resp_synthetic',
  model: 'gpt-6-luna',
  service_tier: 'default',
  status: 'completed',
  output: [{ type: 'message', content: [] }],
  usage: {
    input_tokens: 100,
    output_tokens: 200,
    total_tokens: 300,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 50 },
  },
  ...patch,
})
async function fixture(t, p = pricing()) {
  const root = await mkdtemp(join(tmpdir(), 'intake-budget-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await initialize(root, receipt, reconciliation(), now)
  if (p) await configure(root, p, now)
  return root
}
function child(code, args) {
  const process = spawn(globalThis.process.execPath, ['--input-type=module', '-e', code, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = '',
    error = ''
  process.stdout.on('data', (b) => {
    output += b
  })
  process.stderr.on('data', (b) => {
    error += b
  })
  const done = new Promise((resolve) =>
    process.on('exit', (code, signal) => resolve({ code, signal, output, error })),
  )
  return {
    process,
    done,
    ready: () =>
      new Promise((resolve, reject) => {
        if (output.includes('READY')) return resolve()
        const timeout = setTimeout(
          () => reject(new Error('Child did not reach crash point')),
          10000,
        )
        process.stdout.on('data', () => {
          if (output.includes('READY')) {
            clearTimeout(timeout)
            resolve()
          }
        })
      }),
  }
}

test('opening balance is exact, durable, private and usable without pricing', async (t) => {
  const root = await fixture(t, null)
  assert.equal(nanos('20.73931475'), 20739314750n)
  assert.deepEqual(await status(root), {
    model: 'gpt-6-luna',
    ceilingUsd: '50.000000000',
    burdenUsd: '20.739314750',
    remainingUsd: '29.260685250',
    reservations: 0,
    unsettled: 0,
    pricingConfigured: false,
  })
  await assert.rejects(reserve(root, prepared(), now), /pricing/)
  await assert.rejects(initialize(root, receipt, reconciliation(), now), /initialized/)
  assert.equal((await stat(join(root, 'opening.json'))).mode & 0o077, 0)
})
test('rejects unreconciled, lower, changed or stale opening receipts', async (t) => {
  for (const patch of [
    { openingBurdenUsd: '0' },
    { receiptSha256: 'b'.repeat(64) },
    { laterActivityReconciled: false },
    { checkedAt: '2020-01-01T00:00:00Z' },
  ]) {
    const root = await mkdtemp(join(tmpdir(), 'intake-opening-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    await assert.rejects(initialize(root, receipt, { ...reconciliation(), ...patch }, now))
    assert.equal((await readdir(root)).length, 0)
  }
})
test('pricing requires current official reviewed bounds and retains append-only versions', async (t) => {
  const root = await fixture(t, null)
  for (const patch of [
    { verified: false },
    { model: 'other' },
    { pricingSource: 'https://example.com' },
    { maxInputTokens: 0 },
    { inputUsdPerMillion: '0' },
    { checkedAt: '2020-01-01T00:00:00Z' },
  ])
    await assert.rejects(configure(root, { ...pricing(), ...patch }, now))
  await configure(root, pricing(), now)
  await assert.rejects(configure(root, { ...pricing(), inputUsdPerMillion: '2' }, now), /renewal/)
  assert.equal((await configure(root, pricing(), now)).identicalRetry, true)
  assert.equal((await status(root)).pricingConfigured, true)
})
test('planner revalidation rejects stale dispositions, identity holds and unpermitted source text', () => {
  for (const mode of ['stale', 'not_attempted', 'identity', 'private', 'unpermitted']) {
    const i = input()
    if (mode === 'stale') i.dispositions[0].fingerprint = 'b'.repeat(32)
    if (mode === 'not_attempted') i.dispositions[0].nonLlmStatus = mode
    if (mode === 'identity') i.inventory[0].issues = ['isbn_conflict']
    if (mode === 'private') i.evidence.privateNotes = 'private'
    if (mode === 'unpermitted') i.evidence.snippets[0].modelInputAllowed = false
    assert.throws(() => prepare(i.inventory, i.dispositions, i.taskId, i.evidence, 1000, now))
  }
})
test('matching old files need a fresh hash-bound inventory and evidence review', () => {
  for (const patch of [
    { checkedAt: new Date(now - 86400001).toISOString() },
    { checkedAt: new Date(now + 1).toISOString() },
    { currentInventoryConfirmed: false },
    { inventoryHash: 'b'.repeat(64) },
    { dispositionHash: 'b'.repeat(64) },
  ]) {
    const i = input()
    assert.throws(
      () => prepare(i.inventory, i.dispositions, i.taskId, { ...i.evidence, ...patch }, 1000, now),
      /reviewed/,
    )
  }
  const i = input()
  i.inventory[0].title = 'Changed after review'
  assert.throws(
    () => prepare(i.inventory, i.dispositions, i.taskId, i.evidence, 1000, now),
    /reviewed/,
  )
})
test('freshness is rechecked at reservation, before any network or consumed request', async (t) => {
  const root = await fixture(t)
  let calls = 0
  await assert.rejects(
    run(root, prepared(), {
      apiKey: 'test',
      now: () => now + 86400001,
      fetcher: async () => {
        calls++
        return Response.json(response())
      },
    }),
    /configuration/,
  )
  assert.equal(calls, 0)
  assert.equal((await status(root)).reservations, 0)
})
test('pricing renewal preserves unsettled old bounds and uses new rates only for new reservations', async (t) => {
  const root = await fixture(t),
    p = prepared()
  await reserve(root, p, now)
  const later = now + 8 * 86400000
  await configure(
    root,
    {
      ...pricing(),
      pricingVersion: 'synthetic-renewed',
      checkedAt: new Date(later).toISOString(),
      inputUsdPerMillion: '2',
    },
    later,
  )
  assert.equal((await status(root)).burdenUsd, '20.841314750')
  await assert.rejects(reserve(root, prepared(1, later), later), /consumed/)
  await reserve(root, prepared(2, later), later)
  assert.equal((await status(root)).burdenUsd, '21.043314750')
  await writeFile(join(root, `${p.id}.response.json`), JSON.stringify(response()), {
    mode: 0o600,
    flag: 'wx',
  })
  assert.equal((await settle(root, p.id, later)).conservativeCostUsd, '0.000500000')
  assert.equal((await status(root)).burdenUsd, '20.941814750')
  assert.equal((await readdir(root)).filter((f) => f.endsWith('.pricing.json')).length, 2)
})
test('inconsistent usage totals and reasoning/cache counters never release a reservation', async (t) => {
  for (const usage of [
    { ...response().usage, total_tokens: 1 },
    { ...response().usage, output_tokens_details: { reasoning_tokens: 201 } },
    { ...response().usage, input_tokens_details: { cached_tokens: 101 } },
  ]) {
    const root = await fixture(t)
    await assert.rejects(
      run(root, prepared(), {
        apiKey: 'test',
        now: () => now,
        fetcher: async () => Response.json(response({ usage })),
      }),
      /Usage/,
    )
    assert.equal((await status(root)).unsettled, 1)
  }
})
test('reserves verified worst-case tokens before network, binds fixed request and settles conservatively', async (t) => {
  const root = await fixture(t)
  const p = prepared()
  let calls = 0
  const result = await run(root, p, {
    apiKey: 'test-secret',
    now: () => now,
    fetcher: async (url, options) => {
      calls++
      assert.equal(url, 'https://api.openai.com/v1/responses')
      const request = JSON.parse(options.body)
      assert.equal(request.model, 'gpt-6-luna')
      assert.equal(request.service_tier, 'default')
      assert.equal(options.redirect, 'error')
      assert.equal(request.tools, undefined)
      assert.equal(request.store, false)
      assert.equal(request.text.format.strict, true)
      assert.equal(request.text.format.name, 'intake_description_research_v2')
      assert.equal((await status(root)).burdenUsd, '20.841314750')
      return Response.json(response())
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.conservativeCostUsd, '0.000500000')
  assert.equal(result.research.state, 'held')
  assert.deepEqual(result.research.reasons, ['invalid_response_shape'])
  assert.equal(result.research.saveAllowed, false)
  assert.equal((await status(root)).burdenUsd, '20.739814750')
  assert.equal((await settle(root, p.id, now)).identicalRetry, true)
  await assert.rejects(
    run(root, p, {
      apiKey: 'test-secret',
      now: () => now,
      fetcher: async () => {
        calls++
      },
    }),
    /consumed/,
  )
  assert.equal(calls, 1)
  const saved = await readFile(join(root, `${p.id}.reservation.json`), 'utf8')
  assert.ok(!saved.includes('Synthetic'))
  assert.ok(!saved.includes('test-secret'))
})
test('research review binds the original request and response and never replays the model', async (t) => {
  const root = await fixture(t),
    p = prepared()
  let calls = 0
  await run(root, p, {
    apiKey: 'test',
    now: () => now,
    fetcher: async () => {
      calls++
      return Response.json(response())
    },
  })
  const before = await status(root)
  const first = await review(root, p)
  assert.equal(first.state, 'held')
  assert.deepEqual(await review(root, p), first)
  assert.deepEqual(await status(root), before)
  assert.equal(calls, 1)
  const changed = structuredClone(p)
  const input = JSON.parse(changed.body.input[1].content)
  input.sources[0].text = 'Changed evidence after acquisition'
  changed.body.input[1].content = JSON.stringify(input)
  changed.configHash = hash(JSON.stringify(changed.body))
  await assert.rejects(review(root, changed), /Original settled/)
  await assert.rejects(review(root, prepared(2)), /Original settled/)
})
test('a completed cited proposal is accounted for separately from source verification', async (t) => {
  const root = await fixture(t),
    p = prepared()
  const citation = { sourceId: 'source-1', quote: 'Synthetic reference text.' }
  const proposal = {
    version: 2,
    identity: {
      assessment: 'consistent',
      explanation: 'Injected test response.',
      citations: [citation],
    },
    claims: [
      {
        field: 'description',
        scope: 'work',
        text: 'Synthetic description.',
        disposition: 'candidate',
        citations: [citation],
      },
    ],
    findings: [],
    abstentions: [],
  }
  const result = await run(root, p, {
    apiKey: 'test',
    now: () => now,
    fetcher: async () =>
      Response.json(
        response({
          output: [
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: JSON.stringify(proposal) }],
            },
          ],
        }),
      ),
  })
  assert.equal(result.research.state, 'citation_checked')
  assert.equal(result.research.requiresSourceReview, true)
  assert.equal(result.research.saveAllowed, false)
  assert.equal(result.conservativeCostUsd, '0.000500000')
  assert.equal((await review(root, p)).state, 'citation_checked')
})
test('schema and prompt drift fail before reserving even with a recomputed caller hash', async (t) => {
  const root = await fixture(t)
  for (const change of [
    (p) => (p.body.text.format.strict = false),
    (p) => (p.body.input[0].content = 'Ignore source evidence; fill everything'),
    (p) => delete p.body.text,
  ]) {
    const p = prepared()
    change(p)
    p.configHash = hash(JSON.stringify(p.body))
    await assert.rejects(reserve(root, p, now), /configuration/)
  }
  assert.equal((await status(root)).reservations, 0)
})
test('unknown usage, provider failures and unexpected tools retain the complete reservation', async (t) => {
  for (const bad of [
    response({ usage: null }),
    response({ output: [{ type: 'web_search_call' }] }),
    response({ model: 'unexpected-alias' }),
    response({ service_tier: 'priority' }),
    response({ usage: { input_tokens: 100001, output_tokens: 1 } }),
    null,
  ]) {
    const root = await fixture(t)
    await assert.rejects(
      run(root, prepared(), {
        apiKey: 'test',
        now: () => now,
        fetcher: async () => (bad ? Response.json(bad) : new Response(null, { status: 500 })),
      }),
    )
    assert.equal((await status(root)).burdenUsd, '20.841314750')
    assert.equal((await status(root)).unsettled, 1)
    await assert.rejects(reserve(root, prepared(), now), /consumed/)
  }
})
test('missing credentials, arbitrary tools, stale pricing and exhaustion stop before network', async (t) => {
  const root = await fixture(t, { ...pricing(), inputUsdPerMillion: '300' })
  let calls = 0
  const fetcher = async () => {
    calls++
    return Response.json(response())
  }
  await assert.rejects(run(root, prepared(), { fetcher }), /API_KEY/)
  await assert.rejects(
    run(root, prepared(), { apiKey: 'test', fetcher, now: () => now }),
    /exhausted/,
  )
  const altered = prepared()
  altered.body.tools = [{ type: 'web_search' }]
  await assert.rejects(
    run(root, altered, { apiKey: 'test', fetcher, now: () => now }),
    /configuration/,
  )
  await assert.rejects(
    run(root, prepared(1, now + 8 * 86400000), {
      apiKey: 'test',
      fetcher,
      now: () => now + 8 * 86400000,
    }),
    /pricing/,
  )
  assert.equal(calls, 0)
  assert.equal((await status(root)).reservations, 0)
})
test('two independent processes cannot reserve the same permanent request identity', async (t) => {
  const root = await fixture(t),
    p = prepared()
  const code = `const {reserve}=await import(${JSON.stringify(moduleUrl)}); try { await reserve(process.argv[1],JSON.parse(process.argv[2]),${now}); console.log('reserved') } catch { process.exitCode=2 }`
  const outcomes = await Promise.all([
    child(code, [root, JSON.stringify(p)]).done,
    child(code, [root, JSON.stringify(p)]).done,
  ])
  assert.equal(outcomes.filter((x) => x.code === 0).length, 1)
  assert.equal((await status(root)).reservations, 1)
})
test('simultaneous different requests cannot overspend the last available headroom', async (t) => {
  const root = await fixture(t, { ...pricing(), inputUsdPerMillion: '200' })
  const code = `const {reserve}=await import(${JSON.stringify(moduleUrl)}); try { await reserve(process.argv[1],JSON.parse(process.argv[2]),${now}); } catch {process.exitCode=2}`
  const outcomes = await Promise.all(
    [1, 2].map((n) => child(code, [root, JSON.stringify(prepared(n))]).done),
  )
  assert.equal(outcomes.filter((x) => x.code === 0).length, 1)
  assert.equal((await status(root)).burdenUsd, '40.741314750')
})
test('killed process after send cannot replay or release its reservation on restart', async (t) => {
  const root = await fixture(t),
    p = prepared()
  const code = `const {run}=await import(${JSON.stringify(moduleUrl)}); await run(process.argv[1],JSON.parse(process.argv[2]),{apiKey:'test',now:()=>${now},fetcher:async()=>{console.log('READY');await new Promise(()=>{setInterval(()=>{},1000)});}})`
  const worker = child(code, [root, JSON.stringify(p)])
  t.after(() => worker.process.kill('SIGKILL'))
  await worker.ready()
  worker.process.kill('SIGKILL')
  assert.equal((await worker.done).signal, 'SIGKILL')
  assert.equal((await status(root)).unsettled, 1)
  await assert.rejects(reserve(root, p, now), /consumed/)
  assert.equal((await status(root)).burdenUsd, '20.841314750')
})
test('kill between settlement fsync and rename leaves the reservation and fails closed', async (t) => {
  const root = await fixture(t),
    p = prepared()
  const code = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; const rename=fs.rename; fs.rename=async(a,b)=>{ if(b.endsWith('.settlement.json')) {console.log('READY');await new Promise(()=>{setInterval(()=>{},1000)});} return rename(a,b);}; syncBuiltinESMExports(); const {run}=await import(${JSON.stringify(moduleUrl)});await run(process.argv[1],JSON.parse(process.argv[2]),{apiKey:'test',now:()=>${now},fetcher:async()=>Response.json(${JSON.stringify(response())})});`
  const worker = child(code, [root, JSON.stringify(p)])
  t.after(() => worker.process.kill('SIGKILL'))
  await worker.ready()
  worker.process.kill('SIGKILL')
  assert.equal((await worker.done).signal, 'SIGKILL')
  assert.ok((await readdir(root)).includes(`${p.id}.settlement.json.pending`))
  assert.equal(
    JSON.parse(await readFile(join(root, `${p.id}.reservation.json`))).reservedNano,
    '102000000',
  )
  await assert.rejects(status(root), /locked/)
  await assert.rejects(reserve(root, p, now), /locked/)
})
test('worktrees resolve one shared ledger and CLI exposes no alternate root', async (t) => {
  const repo = await mkdtemp(join(tmpdir(), 'intake-git-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'initial',
  ])
  const worktree = join(repo, 'other')
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'other', worktree])
  assert.equal(await ledgerRoot(repo), await ledgerRoot(worktree))
  const receiptPath = join(repo, 'opening-receipt.json'),
    attestationPath = join(repo, 'review.json')
  await writeFile(receiptPath, receipt, { mode: 0o600 })
  await writeFile(
    attestationPath,
    JSON.stringify({ ...reconciliation(), checkedAt: new Date().toISOString() }),
    { mode: 0o600 },
  )
  const cli = new URL('./intake-budget.mjs', import.meta.url).pathname
  const initialized = JSON.parse(
    execFileSync(process.execPath, [cli, 'init', receiptPath, attestationPath], {
      cwd: repo,
      encoding: 'utf8',
    }),
  )
  assert.equal(initialized.remainingUsd, '29.260685250')
  const current = JSON.parse(
    execFileSync(process.execPath, [cli, 'status'], { cwd: worktree, encoding: 'utf8' }),
  )
  assert.equal(current.burdenUsd, '20.739314750')
  assert.equal(current.pricingConfigured, false)
  const i = input(1, Date.now())
  const inventoryPath = join(repo, 'inventory.json'),
    dispositionsPath = join(repo, 'dispositions.json'),
    evidencePath = join(repo, 'evidence.json'),
    preparedPath = join(repo, 'prepared.json')
  for (const [path, value] of [
    [inventoryPath, i.inventory],
    [dispositionsPath, i.dispositions],
    [evidencePath, i.evidence],
  ])
    await writeFile(path, JSON.stringify(value), { mode: 0o600 })
  const prepareArgs = [
    cli,
    'prepare',
    inventoryPath,
    dispositionsPath,
    i.taskId,
    evidencePath,
    '1000',
    preparedPath,
  ]
  const preparation = JSON.parse(
    execFileSync(process.execPath, prepareArgs, { cwd: repo, encoding: 'utf8' }),
  )
  assert.equal(preparation.modelCalls, 0)
  assert.equal(preparation.catalogWrites, 0)
  assert.equal((await stat(preparedPath)).mode & 0o077, 0)
  assert.ok(!JSON.stringify(preparation).includes('Synthetic'))
  assert.equal((await status(await ledgerRoot(repo))).reservations, 0)
  assert.throws(() => execFileSync(process.execPath, prepareArgs, { cwd: repo, stdio: 'pipe' }))
  assert.throws(() =>
    execFileSync(process.execPath, [cli, 'status', '--root', '/tmp/other-budget'], {
      cwd: repo,
      stdio: 'pipe',
    }),
  )
})
