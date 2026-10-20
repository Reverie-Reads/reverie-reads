import { open, mkdir, readFile, readdir, rename, rmdir, lstat, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { planCorpusCompletion } from './corpus-completion-plan.mjs'
import {
  RESEARCH_PROMPT,
  researchInput,
  researchSourceUrl,
  researchTextFormat,
  validResearchBody,
  assessResearchResponse,
} from './intake-research-contract.mjs'

export const MODEL = 'gpt-6-luna'
export const CEILING = 50_000_000_000n
export const KNOWN_OPENING = 20_739_314_750n
const hash = (v) =>
  createHash('sha256')
    .update(typeof v === 'string' ? v : JSON.stringify(v))
    .digest('hex')
const exact = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k))
const requireThat = (v, message) => {
  if (!v) throw new Error(message)
}
const digest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const integer = (v) => Number.isSafeInteger(v) && v >= 0
export function nanos(v) {
  requireThat(
    typeof v === 'string' && /^(0|[1-9]\d*)(\.\d{1,9})?$/.test(v),
    'Invalid exact USD amount',
  )
  const [whole, part = ''] = v.split('.')
  return BigInt(whole) * 1_000_000_000n + BigInt(part.padEnd(9, '0'))
}
export const usd = (v) => `${v / 1_000_000_000n}.${String(v % 1_000_000_000n).padStart(9, '0')}`
const timestamp = (v, now, days = 7) =>
  typeof v === 'string' &&
  Number.isFinite(Date.parse(v)) &&
  Date.parse(v) <= now &&
  now - Date.parse(v) <= days * 86400000
const official = (v) => {
  try {
    const u = new URL(v)
    return (
      u.protocol === 'https:' &&
      ['openai.com', 'developers.openai.com', 'platform.openai.com'].includes(u.hostname) &&
      !u.username &&
      !u.password
    )
  } catch {
    return false
  }
}
async function syncDir(root) {
  const handle = await open(root, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
async function privateFile(path) {
  const s = await lstat(path)
  requireThat(
    s.isFile() && !s.isSymbolicLink() && !(s.mode & 0o077),
    'Ledger file must be private and regular',
  )
  return JSON.parse(await readFile(path, 'utf8'))
}
async function atomic(root, name, value) {
  try {
    await lstat(join(root, name))
    throw new Error('Permanent receipt already exists')
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  const pending = join(root, `${name}.pending`)
  const handle = await open(pending, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(pending, join(root, name))
  await syncDir(root)
}
async function locked(root, action) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const s = await lstat(root)
  requireThat(
    s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o077),
    'Ledger directory must be private and regular',
  )
  const lock = join(root, 'writer.lock')
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch (e) {
    if (e.code === 'EEXIST')
      throw new Error('Budget locked; never automatically remove an interrupted writer lock')
    throw e
  }
  await syncDir(root)
  try {
    requireThat(
      !(await readdir(root)).some((f) => f.endsWith('.pending')),
      'Interrupted ledger write requires review',
    )
    return await action()
  } finally {
    await rmdir(lock)
    await syncDir(root)
  }
}
export async function initialize(root, receiptBytes, reconciliation, now = Date.now()) {
  const receipt = JSON.parse(receiptBytes)
  requireThat(
    exact(reconciliation, [
      'version',
      'receiptSha256',
      'openingBurdenUsd',
      'checkedAt',
      'laterActivityReconciled',
    ]) &&
      reconciliation.version === 1 &&
      reconciliation.receiptSha256 === hash(receiptBytes) &&
      reconciliation.laterActivityReconciled === true &&
      timestamp(reconciliation.checkedAt, now, 1),
    'Opening reconciliation required',
  )
  const opening = nanos(reconciliation.openingBurdenUsd)
  requireThat(
    opening >= KNOWN_OPENING &&
      opening <= CEILING &&
      receipt.model === MODEL &&
      nanos(String(receipt.conservativeSpentTotalUsd)) === opening,
    'Opening burden disagrees with conservative receipt',
  )
  return locked(root, async () => {
    requireThat(
      (await readdir(root)).every((f) => f === 'writer.lock'),
      'Budget already initialized or incomplete',
    )
    await atomic(root, 'opening.json', {
      version: 1,
      model: MODEL,
      ceilingNano: String(CEILING),
      openingNano: String(opening),
      receiptHash: hash(receiptBytes),
      reconciliationHash: hash(reconciliation),
      createdAt: new Date(now).toISOString(),
    })
    return {
      ceilingUsd: usd(CEILING),
      burdenUsd: usd(opening),
      remainingUsd: usd(CEILING - opening),
    }
  })
}
export function validatePricing(p, now = Date.now()) {
  requireThat(
    exact(p, [
      'version',
      'model',
      'serviceTier',
      'currency',
      'pricingVersion',
      'pricingSource',
      'contextLimitSource',
      'checkedAt',
      'verified',
      'inputUsdPerMillion',
      'outputUsdPerMillion',
      'maxInputTokens',
      'maxOutputTokens',
    ]) &&
      p.version === 1 &&
      p.model === MODEL &&
      p.serviceTier === 'default' &&
      p.currency === 'USD' &&
      p.verified === true &&
      typeof p.pricingVersion === 'string' &&
      p.pricingVersion.length > 0 &&
      p.pricingVersion.length <= 100 &&
      official(p.pricingSource) &&
      official(p.contextLimitSource) &&
      timestamp(p.checkedAt, now) &&
      integer(p.maxInputTokens) &&
      p.maxInputTokens > 0 &&
      p.maxInputTokens <= 10_000_000 &&
      integer(p.maxOutputTokens) &&
      p.maxOutputTokens > 0 &&
      p.maxOutputTokens <= 1_000_000,
    'Current verified model pricing and context bounds required',
  )
  requireThat(
    nanos(p.inputUsdPerMillion) > 0n && nanos(p.outputUsdPerMillion) > 0n,
    'Positive verified pricing required',
  )
  return p
}
const tokenCost = (rate, tokens) => (nanos(rate) * BigInt(tokens) + 999_999n) / 1_000_000n
const cost = (pricing, input, output) =>
  tokenCost(pricing.inputUsdPerMillion, input) + tokenCost(pricing.outputUsdPerMillion, output)
async function load(root) {
  const opening = await privateFile(join(root, 'opening.json'))
  requireThat(
    exact(opening, [
      'version',
      'model',
      'ceilingNano',
      'openingNano',
      'receiptHash',
      'reconciliationHash',
      'createdAt',
    ]) &&
      opening.version === 1 &&
      opening.model === MODEL &&
      opening.ceilingNano === String(CEILING) &&
      /^\d+$/.test(opening.openingNano) &&
      BigInt(opening.openingNano) >= KNOWN_OPENING &&
      BigInt(opening.openingNano) <= CEILING &&
      digest(opening.receiptHash) &&
      digest(opening.reconciliationHash),
    'Invalid opening ledger',
  )
  const files = await readdir(root)
  requireThat(
    files.every(
      (f) =>
        ['writer.lock', 'opening.json'].includes(f) ||
        /^[a-f0-9]{64}\.(pricing|reservation|settlement|response)\.json$/.test(f),
    ),
    'Unexpected ledger artifact; review required',
  )
  const pricingByHash = new Map()
  for (const name of files.filter((f) => f.endsWith('.pricing.json'))) {
    const p = await privateFile(join(root, name))
    validatePricing(p, Date.parse(p.checkedAt))
    requireThat(name === `${hash(p)}.pricing.json`, 'Pricing receipt hash mismatch')
    pricingByHash.set(hash(p), p)
  }
  const pricing =
    [...pricingByHash.values()].sort(
      (a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt),
    )[0] ?? null
  requireThat(
    new Set([...pricingByHash.values()].map((p) => p.checkedAt)).size === pricingByHash.size,
    'Ambiguous active pricing',
  )
  let burden = BigInt(opening.openingNano)
  const reservations = new Map()
  for (const name of files.filter((f) => f.endsWith('.reservation.json'))) {
    const r = await privateFile(join(root, name))
    const boundPricing = pricingByHash.get(r.pricingHash)
    requireThat(
      exact(r, [
        'version',
        'id',
        'model',
        'configHash',
        'pricingHash',
        'inventoryHash',
        'dispositionHash',
        'reviewHash',
        'reservedNano',
        'maxOutputTokens',
        'createdAt',
      ]) &&
        r.version === 1 &&
        r.model === MODEL &&
        name === `${r.id}.reservation.json` &&
        [r.id, r.configHash, r.pricingHash, r.inventoryHash, r.dispositionHash, r.reviewHash].every(
          digest,
        ) &&
        /^\d+$/.test(r.reservedNano) &&
        BigInt(r.reservedNano) > 0n &&
        integer(r.maxOutputTokens) &&
        boundPricing &&
        r.maxOutputTokens > 0 &&
        r.maxOutputTokens <= boundPricing.maxOutputTokens &&
        BigInt(r.reservedNano) ===
          cost(boundPricing, boundPricing.maxInputTokens, r.maxOutputTokens),
      'Invalid reservation ledger',
    )
    reservations.set(r.id, r)
    if (files.includes(`${r.id}.settlement.json`)) {
      const s = await privateFile(join(root, `${r.id}.settlement.json`))
      requireThat(
        exact(s, [
          'version',
          'id',
          'reservationHash',
          'responseHash',
          'chargedNano',
          'createdAt',
        ]) &&
          s.version === 1 &&
          s.id === r.id &&
          s.reservationHash === hash(r) &&
          digest(s.responseHash) &&
          /^\d+$/.test(s.chargedNano) &&
          BigInt(s.chargedNano) <= BigInt(r.reservedNano),
        'Invalid settlement ledger',
      )
      const response = await privateFile(join(root, `${r.id}.response.json`))
      requireThat(
        s.responseHash === hash(response) &&
          settlementCost(response, r, boundPricing) === BigInt(s.chargedNano),
        'Settlement proof mismatch',
      )
      burden += BigInt(s.chargedNano)
    } else burden += BigInt(r.reservedNano)
  }
  requireThat(
    files
      .filter((f) => /\.(settlement|response)\.json$/.test(f))
      .every((f) => reservations.has(f.split('.')[0])),
    'Orphan receipt requires review',
  )
  requireThat(burden <= CEILING, 'Budget ceiling exceeded; stop for review')
  return { pricing, pricingByHash, burden, reservations, files }
}
export async function configure(root, pricing, now = Date.now()) {
  validatePricing(pricing, now)
  return locked(root, async () => {
    const s = await load(root),
      key = hash(pricing)
    if (s.pricingByHash.has(key)) return { model: MODEL, pricingHash: key, identicalRetry: true }
    requireThat(
      !s.pricing || Date.parse(pricing.checkedAt) > Date.parse(s.pricing.checkedAt),
      'Pricing renewal must be newly reviewed and later than existing versions',
    )
    await atomic(root, `${key}.pricing.json`, pricing)
    return { model: MODEL, pricingHash: key }
  })
}
export async function status(root) {
  return locked(root, async () => {
    const s = await load(root)
    return {
      model: MODEL,
      ceilingUsd: usd(CEILING),
      burdenUsd: usd(s.burden),
      remainingUsd: usd(CEILING - s.burden),
      reservations: s.reservations.size,
      unsettled: [...s.reservations.keys()].filter(
        (id) => !s.files.includes(`${id}.settlement.json`),
      ).length,
      pricingConfigured: !!s.pricing,
    }
  })
}
export function prepare(
  inventory,
  dispositions,
  taskId,
  evidence,
  maxOutputTokens,
  now = Date.now(),
) {
  const plan = planCorpusCompletion(inventory, dispositions)
  const task = plan.tasks.find((t) => t.id === taskId)
  requireThat(
    task?.stage === 'llm_evidence_research' && task.model === MODEL && task.kind === 'description',
    'Current planner disposition does not permit Luna research',
  )
  requireThat(
    exact(evidence, [
      'version',
      'fingerprint',
      'snippets',
      'checkedAt',
      'inventoryHash',
      'dispositionHash',
      'currentInventoryConfirmed',
    ]) &&
      evidence.version === 1 &&
      evidence.fingerprint === task.fingerprint &&
      timestamp(evidence.checkedAt, now, 1) &&
      evidence.inventoryHash === hash(inventory) &&
      evidence.dispositionHash === hash(dispositions) &&
      evidence.currentInventoryConfirmed === true &&
      Array.isArray(evidence.snippets) &&
      evidence.snippets.length > 0 &&
      evidence.snippets.length <= 4 &&
      evidence.snippets.every(
        (s) =>
          exact(s, ['url', 'locator', 'text', 'sourceChecked', 'modelInputAllowed']) &&
          s.sourceChecked === true &&
          s.modelInputAllowed === true &&
          typeof s.text === 'string' &&
          s.text.length > 0 &&
          s.text.length <= 6000 &&
          typeof s.locator === 'string' &&
          s.locator.length > 0 &&
          s.locator.length <= 500 &&
          typeof s.url === 'string' &&
          s.url.length <= 2000 &&
          researchSourceUrl(s.url),
      ),
    'Bounded reviewed and permitted source snippets required',
  )
  requireThat(integer(maxOutputTokens) && maxOutputTokens > 0, 'Bounded output required')
  const body = {
    model: MODEL,
    service_tier: 'default',
    store: false,
    truncation: 'disabled',
    max_output_tokens: maxOutputTokens,
    text: researchTextFormat(),
    input: [
      {
        role: 'system',
        content: RESEARCH_PROMPT,
      },
      {
        role: 'user',
        content: JSON.stringify(researchInput(task.title, task.author, evidence.snippets)),
      },
    ],
  }
  requireThat(validResearchBody(body), 'Invalid bounded research input')
  return {
    id: hash([task.id, task.fingerprint]),
    body,
    configHash: hash(body),
    inventoryHash: hash(inventory),
    dispositionHash: hash(dispositions),
    reviewHash: hash(evidence),
    reviewCheckedAt: evidence.checkedAt,
    maxOutputTokens,
  }
}
export async function reserve(root, prepared, now = Date.now()) {
  requireThat(
    exact(prepared, [
      'id',
      'body',
      'configHash',
      'inventoryHash',
      'dispositionHash',
      'reviewHash',
      'reviewCheckedAt',
      'maxOutputTokens',
    ]) &&
      timestamp(prepared.reviewCheckedAt, now, 1) &&
      [
        prepared.id,
        prepared.configHash,
        prepared.inventoryHash,
        prepared.dispositionHash,
        prepared.reviewHash,
      ].every(digest) &&
      exact(prepared.body, [
        'model',
        'service_tier',
        'store',
        'truncation',
        'max_output_tokens',
        'text',
        'input',
      ]) &&
      prepared.body.model === MODEL &&
      prepared.body.service_tier === 'default' &&
      prepared.body.store === false &&
      prepared.body.truncation === 'disabled' &&
      prepared.body.max_output_tokens === prepared.maxOutputTokens &&
      validResearchBody(prepared.body) &&
      integer(prepared.maxOutputTokens) &&
      prepared.maxOutputTokens > 0 &&
      Array.isArray(prepared.body.input) &&
      prepared.body.input.length === 2 &&
      prepared.body.input.every(
        (m, i) =>
          exact(m, ['role', 'content']) &&
          m.role === (i === 0 ? 'system' : 'user') &&
          typeof m.content === 'string' &&
          m.content.length <= 40000,
      ),
    'Invalid fixed-model research configuration',
  )
  return locked(root, async () => {
    const s = await load(root),
      p = validatePricing(s.pricing, now)
    requireThat(
      !s.reservations.has(prepared.id),
      'Request identity permanently consumed; no replay',
    )
    requireThat(
      prepared.maxOutputTokens <= p.maxOutputTokens &&
        prepared.body.model === MODEL &&
        prepared.configHash === hash(prepared.body),
      'Configuration drift or output limit',
    )
    const bound = cost(p, p.maxInputTokens, prepared.maxOutputTokens)
    requireThat(s.burden + bound <= CEILING, 'Budget exhausted before network')
    const r = {
      version: 1,
      id: prepared.id,
      model: MODEL,
      configHash: prepared.configHash,
      pricingHash: hash(p),
      inventoryHash: prepared.inventoryHash,
      dispositionHash: prepared.dispositionHash,
      reviewHash: prepared.reviewHash,
      reservedNano: String(bound),
      maxOutputTokens: prepared.maxOutputTokens,
      createdAt: new Date(now).toISOString(),
    }
    await atomic(root, `${r.id}.reservation.json`, r)
    return r
  })
}
function settlementCost(response, r, p) {
  requireThat(
    response &&
      response.model === MODEL &&
      response.service_tier === 'default' &&
      ['completed', 'incomplete'].includes(response.status) &&
      Array.isArray(response.output) &&
      response.output.every((o) => ['message', 'reasoning'].includes(o.type)) &&
      response.usage &&
      integer(response.usage.input_tokens) &&
      integer(response.usage.output_tokens) &&
      integer(response.usage.total_tokens) &&
      response.usage.total_tokens === response.usage.input_tokens + response.usage.output_tokens &&
      integer(response.usage.input_tokens_details?.cached_tokens) &&
      response.usage.input_tokens_details.cached_tokens <= response.usage.input_tokens &&
      integer(response.usage.output_tokens_details?.reasoning_tokens) &&
      response.usage.output_tokens_details.reasoning_tokens <= response.usage.output_tokens &&
      response.usage.input_tokens <= p.maxInputTokens &&
      response.usage.output_tokens <= r.maxOutputTokens,
    'Usage is unknown, unexpected or exceeds reservation; retain full burden',
  )
  return cost(p, response.usage.input_tokens, response.usage.output_tokens)
}
export async function settle(root, id, now = Date.now()) {
  requireThat(digest(id), 'Invalid request identity')
  return locked(root, async () => {
    const s = await load(root),
      r = s.reservations.get(id)
    requireThat(r, 'Unknown reservation')
    if (s.files.includes(`${id}.settlement.json`))
      return { id, settled: true, identicalRetry: true }
    const response = await privateFile(join(root, `${id}.response.json`))
    const charged = settlementCost(response, r, s.pricingByHash.get(r.pricingHash))
    await atomic(root, `${id}.settlement.json`, {
      version: 1,
      id,
      reservationHash: hash(r),
      responseHash: hash(response),
      chargedNano: String(charged),
      createdAt: new Date(now).toISOString(),
    })
    return { id, settled: true, conservativeCostUsd: usd(charged) }
  })
}
export async function run(root, prepared, { apiKey, fetcher = fetch, now = Date.now } = {}) {
  requireThat(
    typeof apiKey === 'string' && apiKey.length > 0,
    'OPENAI_API_KEY required before reservation',
  )
  const submission = structuredClone(prepared)
  const r = await reserve(root, submission, now())
  // Reservation and its directory are fsynced before the only network call. No retries or tools.
  const response = await fetcher('https://api.openai.com/v1/responses', {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(submission.body),
    signal: AbortSignal.timeout(120000),
  })
  requireThat(response.ok, 'Provider response failed; reservation remains uncertain')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      requireThat(size <= 2 * 1024 * 1024, 'Response exceeds bound; reservation remains uncertain')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  await locked(root, async () => {
    const s = await load(root)
    requireThat(hash(s.reservations.get(r.id)) === hash(r), 'Reservation changed')
    await atomic(root, `${r.id}.response.json`, result)
  })
  const receipt = await settle(root, r.id, now())
  return {
    ...receipt,
    resultPath: join(root, `${r.id}.response.json`),
    reviewRequired: true,
    research: assessResearchResponse(result, submission.body),
  }
}

/** Inspect a durable response without another model call or a new reservation. Configuration
 * and response hashes bind review to the original paid attempt; accounting remains separate. */
export async function review(root, prepared) {
  const submission = structuredClone(prepared)
  requireThat(
    digest(submission?.id) &&
      validResearchBody(submission.body) &&
      submission.configHash === hash(submission.body),
    'Invalid research review request',
  )
  return locked(root, async () => {
    const s = await load(root)
    const reservation = s.reservations.get(submission.id)
    requireThat(
      reservation?.configHash === submission.configHash &&
        s.files.includes(`${submission.id}.settlement.json`),
      'Original settled research attempt required',
    )
    const response = await privateFile(join(root, `${submission.id}.response.json`))
    return { id: submission.id, ...assessResearchResponse(response, submission.body) }
  })
}
export async function ledgerRoot(cwd = process.cwd()) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim()
  return join(await realpath(common), 'intake-luna-budget-v1')
}
async function json(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'))
}
export async function main(args) {
  const [command, ...paths] = args,
    root = await ledgerRoot()
  if (command === 'init' && paths.length === 2)
    return initialize(root, await readFile(resolve(paths[0]), 'utf8'), await json(paths[1]))
  if (command === 'configure' && paths.length === 1) return configure(root, await json(paths[0]))
  if (command === 'status' && paths.length === 0) return status(root)
  if (command === 'settle' && paths.length === 1) return settle(root, paths[0])
  if (command === 'review' && paths.length === 1) return review(root, await json(paths[0]))
  if (command === 'prepare' && paths.length === 6) {
    const [inventory, dispositions, taskId, evidence, outputTokens, output] = paths
    const prepared = prepare(
      await json(inventory),
      await json(dispositions),
      taskId,
      await json(evidence),
      Number(outputTokens),
    )
    const handle = await open(resolve(output), 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(prepared, null, 2)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    return { id: prepared.id, prepared: true, modelCalls: 0, catalogWrites: 0 }
  }
  if (command === 'run' && paths.length === 5) {
    const [inventory, dispositions, taskId, evidence, outputTokens] = paths
    return run(
      root,
      prepare(
        await json(inventory),
        await json(dispositions),
        taskId,
        await json(evidence),
        Number(outputTokens),
      ),
      { apiKey: process.env.OPENAI_API_KEY },
    )
  }
  throw new Error(
    'Usage: intake-budget init receipt.json reconciliation.json | configure pricing.json | status | prepare inventory.json dispositions.json taskId evidence.json maxOutputTokens privateOutput.json | run inventory.json dispositions.json taskId evidence.json maxOutputTokens | settle requestId | review privatePrepared.json',
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => {
      process.stderr.write(
        'Intake budget operation refused; inspect private ledger and inputs. Uncertain reservations are never automatically released.\n',
      )
      process.exitCode = 1
    })
}
