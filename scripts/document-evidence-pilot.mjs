import { createHash } from 'node:crypto'
import { readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { release } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  prepareDocumentEvidence,
  privateDocumentDirectory,
  readDocumentFile,
  writeDocumentJson,
} from './document-evidence.mjs'
import { documentPng } from './document-evidence-image.mjs'
import {
  buildDocumentEvidenceHandoff,
  documentEvidenceFingerprint,
} from './document-evidence-handoff.mjs'
import { parseDocumentEvidence } from '../packages/core/src/documentEvidence.ts'
import { normalizeIsbn } from '../packages/core/src/match.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const digest = (v) => createHash('sha256').update(v).digest('hex')
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(',')}}`
  return JSON.stringify(v)
}
const exact = (v, keys) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Object.keys(v).length === keys.length &&
  keys.every((key) => Object.hasOwn(v, key))
const text = (v, max = 2000) => typeof v === 'string' && !!v.trim() && v.length <= max
const stems = ['authored', 'translated', 'edited']
const controls = [
  ['authored-positive', 'authored', 'consistent'],
  ['same-title-wrong-author', 'authored', 'wrong_creator'],
  ['translated-positive', 'translated', 'consistent'],
  ['translator-as-author', 'translated', 'secondary_role'],
  ['editor-only', 'edited', 'editor_only'],
  ['wrong-isbn', 'edited', 'isbn_conflict'],
]
const fail = (message) => {
  throw new Error(`Synthetic document pilot refused: ${message}`)
}

/** This pilot's reference is independently image-read, never generated from OCR or fixture JSON. */
export function validateDocumentPilotReference(value) {
  if (
    !exact(value, [
      'version',
      'preparedAt',
      'mode',
      'basis',
      'coordinateConvention',
      'pages',
      'explicitCredits',
      'controlExpectations',
      'limits',
      ...(Object.hasOwn(value ?? {}, 'priorReference') ? ['priorReference'] : []),
    ]) ||
    value.version !== 1 ||
    value.mode !== 'synthetic_independent_visual_reference' ||
    !text(value.preparedAt, 40) ||
    !Number.isFinite(Date.parse(value.preparedAt)) ||
    !text(value.basis, 4000) ||
    !text(value.coordinateConvention, 2000) ||
    !Array.isArray(value.pages) ||
    value.pages.length !== 6 ||
    !Array.isArray(value.explicitCredits) ||
    value.explicitCredits.length !== 4 ||
    !Array.isArray(value.controlExpectations) ||
    value.controlExpectations.length !== 6 ||
    !Array.isArray(value.limits) ||
    !value.limits.length ||
    !value.limits.every((s) => text(s, 2000))
  )
    fail('invalid independent reference')
  if (
    Object.hasOwn(value, 'priorReference') &&
    (!exact(value.priorReference, ['sha256', 'pilot', 'unchanged']) ||
      !/^[a-f0-9]{64}$/.test(value.priorReference.sha256) ||
      !/^pilot-[0-9]{2,4}$/.test(value.priorReference.pilot) ||
      value.priorReference.unchanged !== true)
  )
    fail('invalid prior reference provenance')
  const expectedIds = stems.flatMap((stem) => [`${stem}-title`, `${stem}-copyright`])
  const pageIds = new Set(),
    lineKeys = new Set()
  let count = 0
  for (const p of value.pages) {
    if (
      !exact(p, ['pageId', 'fileName', 'imageSha256', 'width', 'height', 'lines']) ||
      !expectedIds.includes(p.pageId) ||
      pageIds.has(p.pageId) ||
      p.fileName !== `${p.pageId}.png` ||
      !/^[a-f0-9]{64}$/.test(p.imageSha256) ||
      !Number.isSafeInteger(p.width) ||
      p.width < 1 ||
      p.width > 12000 ||
      !Number.isSafeInteger(p.height) ||
      p.height < 1 ||
      p.height > 12000 ||
      p.width * p.height > 16_000_000 ||
      !Array.isArray(p.lines) ||
      !p.lines.length ||
      p.lines.length > 3
    )
      fail('invalid reference page')
    pageIds.add(p.pageId)
    const literalTexts = new Set()
    for (const l of p.lines) {
      if (
        !exact(l, ['id', 'text', 'region']) ||
        !/^reference-[1-3]$/.test(l.id) ||
        lineKeys.has(`${p.pageId}/${l.id}`) ||
        !text(l.text, 1000) ||
        literalTexts.has(l.text) ||
        !Array.isArray(l.region) ||
        l.region.length !== 4 ||
        !l.region.every(Number.isSafeInteger)
      )
        fail('invalid reference line')
      const [x, y, w, h] = l.region
      if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > p.width || y + h > p.height)
        fail('invalid reference region')
      lineKeys.add(`${p.pageId}/${l.id}`)
      literalTexts.add(l.text)
      count++
    }
  }
  if (count !== 13) fail('expected thirteen independently read literal lines')
  const creditKeys = new Set()
  for (const c of value.explicitCredits) {
    const labels = { author: 'By', translator: 'Translated by', editor: 'Edited by' }
    const p = value.pages.find((p) => p.pageId === c.pageId)
    const line = p?.lines.find((l) => l.id === c.lineId)
    if (
      !exact(c, ['pageId', 'lineId', 'name', 'role', 'sourceRole', 'scope', 'quote']) ||
      !line ||
      !c.pageId.endsWith('-title') ||
      !text(c.name, 300) ||
      c.scope !== 'whole' ||
      !Object.hasOwn(labels, c.role) ||
      c.sourceRole !== labels[c.role] ||
      c.quote !== `${c.sourceRole} ${c.name}` ||
      c.quote !== line.text ||
      creditKeys.has(`${c.pageId}/${c.lineId}`)
    )
      fail('invalid explicit reference credit')
    creditKeys.add(`${c.pageId}/${c.lineId}`)
  }
  for (const [id, fixture] of controls) {
    const selected = value.controlExpectations.filter((c) => c.id === id)
    if (
      selected.length !== 1 ||
      !exact(selected[0], ['id', 'fixture', 'expected']) ||
      selected[0].fixture !== fixture ||
      !text(selected[0].expected)
    )
      fail('invalid reference control')
  }
  for (const stem of stems) {
    const title = value.pages.find((p) => p.pageId === `${stem}-title`)
    const copyright = value.pages.find((p) => p.pageId === `${stem}-copyright`)
    const credits = value.explicitCredits.filter((c) => c.pageId === title.pageId)
    const roles = credits
      .map((c) => c.role)
      .sort()
      .join(',')
    if (
      roles !== { authored: 'author', translated: 'author,translator', edited: 'editor' }[stem] ||
      !title.lines.find((l) => l.id === 'reference-1') ||
      !/^ISBN (?:\d{13})$/.test(copyright.lines[0].text) ||
      !normalizeIsbn(copyright.lines[0].text.slice(5))
    )
      fail('reference fixture contract changed')
  }
  return structuredClone(value)
}

export const DOCUMENT_PILOT_SCORING = Object.freeze({
  version: 1,
  expectedPages: 6,
  expectedLiteralLines: 13,
  cases: 6,
  positiveCases: 2,
  negativeCases: 4,
  literal:
    'Exactly one OCR line equals the reference text byte-for-byte; no trimming, normalization, merging, correction or second attempt.',
  region:
    'The unique exact-text line rectangle must lie wholly inside the independently declared rough containing rectangle. This is not glyph-level localization accuracy.',
  replay:
    'Only unique exact-text, within-region lines on complete pages receive automated synthetic-reference confirmations. Never a human approval, text repair, source qualification or OCR accuracy improvement.',
  positive:
    'title exact, ISBN exact, every requested creator exact, and no identity reasons. Overall resolver state still review.',
  negative:
    'Expected diagnostic axis and a nonempty identity hold must both be present. Missing evidence or failed handoff is unobserved, never a correct rejection.',
  masquerade:
    'A separate translated-credit-as-author selection must be refused by literal-role entailment; not part of the six identity-case denominator.',
  failures:
    'Preserve all missing, extra, ambiguous, failed and unobserved results. No retries, substitutions or tuning within this run.',
})

/** Literal recognition and rough location are scored separately, with every reference line retained. */
export function scoreDocumentPilotPage(reference, page) {
  const identityValid =
    !!page &&
    page.id === reference.pageId &&
    page.imageSha256 === reference.imageSha256 &&
    page.width === reference.width &&
    page.height === reference.height &&
    Array.isArray(page.lines)
  const lines = identityValid ? page.lines : []
  const scored = reference.lines.map((ref) => {
    const matches = lines.filter((line) => line.text === ref.text)
    const literalExact = matches.length === 1
    const b = literalExact ? matches[0].bbox : null
    const [x, y, width, height] = ref.region
    const withinRegion =
      !!b &&
      [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
      b.width > 0 &&
      b.height > 0 &&
      b.x >= x &&
      b.y >= y &&
      b.x + b.width <= x + width &&
      b.y + b.height <= y + height
    return {
      referenceLineId: ref.id,
      literalExact,
      ambiguous: matches.length > 1,
      withinRegion,
      eligibleForSyntheticReplay:
        identityValid && page.status === 'complete' && literalExact && withinRegion,
      ocrLineId: literalExact ? matches[0].id : null,
    }
  })
  return {
    pageId: reference.pageId,
    imageIdentityValid: identityValid,
    status: page?.status ?? 'unobserved',
    referenceLines: reference.lines.length,
    observedLines: lines.length,
    exactLiteralLines: scored.filter((l) => l.literalExact).length,
    exactWithinRegionLines: scored.filter((l) => l.literalExact && l.withinRegion).length,
    unmatchedObservedLines: lines.length - scored.filter((l) => l.literalExact).length,
    lines: scored,
  }
}

function targetContext(target) {
  const existing = { pages: 731, description: 'Existing synthetic description; preserve verbatim.' }
  return { targetFingerprint: digest(stable({ target, existing })), target, existing }
}
export function documentPilotCases(reference) {
  const refs = validateDocumentPilotReference(reference)
  const title = (stem) =>
    refs.pages.find((p) => p.pageId === `${stem}-title`).lines.find((l) => l.id === 'reference-1')
      .text
  const name = (stem, role) =>
    refs.explicitCredits.find((c) => c.pageId === `${stem}-title` && c.role === role).name
  const isbn = (stem) =>
    refs.pages.find((p) => p.pageId === `${stem}-copyright`).lines[0].text.slice(5)
  const names = refs.explicitCredits.map((c) => c.name)
  const wrongCreator = 'Morgan Ellis North'
  if (names.includes(wrongCreator)) fail('wrong-creator control collides with a reference name')
  return controls.map(([id, fixture, expected]) => ({
    id,
    fixture,
    expected,
    isbnControlAlsoEditorOnly: id === 'wrong-isbn',
    context: targetContext({
      title: title(fixture),
      contributors: [
        id === 'same-title-wrong-author'
          ? wrongCreator
          : id === 'translator-as-author'
            ? name('translated', 'translator')
            : name(fixture, fixture === 'edited' ? 'editor' : 'author'),
      ],
      isbn: id === 'wrong-isbn' ? isbn('authored') : isbn(fixture),
    }),
  }))
}

/** Automated synthetic replay only: preserve raw OCR; never repair text to make a case pass. */
export function replayDocumentPilotCase(reference, acquisition, frozenCase, asOf) {
  const source = parseDocumentEvidence(acquisition)
  if (!source) fail('invalid acquired packet')
  const packet = structuredClone(source)
  packet.targetFingerprint = frozenCase.context.targetFingerprint
  packet.corrections = []
  const selectedPages = reference.pages.filter((p) => p.pageId.startsWith(`${frozenCase.fixture}-`))
  const scored = selectedPages.map((p) =>
    scoreDocumentPilotPage(
      p,
      packet.pages.find((v) => v.id === p.pageId),
    ),
  )
  function quote(pageId, lineId) {
    const score = scored
      .find((p) => p.pageId === pageId)
      ?.lines.find((l) => l.referenceLineId === lineId)
    if (!score?.eligibleForSyntheticReplay) return null
    const page = packet.pages.find((p) => p.id === pageId)
    const line = page.lines.find((l) => l.id === score.ocrLineId)
    if (!packet.corrections.some((c) => c.pageId === pageId && c.lineId === line.id))
      packet.corrections.push({
        id: `synthetic-reference-${packet.corrections.length + 1}`,
        pageId,
        lineId: line.id,
        imageSha256: page.imageSha256,
        previousText: line.text,
        text: line.text,
        bbox: line.bbox,
        reason:
          'AUTOMATED SYNTHETIC REFERENCE REPLAY ONLY: exact independent visual-reference text and rough region. Not a real operator approval or OCR correction.',
        reviewedAt: asOf,
      })
    return { pageId, lineIds: [line.id], text: line.text }
  }
  const title = quote(`${frozenCase.fixture}-title`, 'reference-1')
  const isbn = quote(`${frozenCase.fixture}-copyright`, 'reference-1')
  const credits = reference.explicitCredits.filter(
    (c) => c.pageId === `${frozenCase.fixture}-title`,
  )
  const contributors = credits.map((c) => ({
    name: c.name,
    role: c.role,
    scope: c.scope,
    basis: 'edition',
    quote: quote(c.pageId, c.lineId),
  }))
  if (!title || !isbn || contributors.some((c) => !c.quote))
    return {
      status: 'unobserved',
      reason: 'required_reference_lines_not_exact_and_located',
      passed: false,
    }
  const context = { ...frozenCase.context, asOf }
  const selection = {
    version: 1,
    documentFingerprint: documentEvidenceFingerprint(packet),
    targetFingerprint: context.targetFingerprint,
    identity: { title, contributors, isbns: [isbn] },
  }
  let handoff
  try {
    handoff = buildDocumentEvidenceHandoff(packet, selection, context)
  } catch {
    return {
      status: 'unobserved',
      reason: 'synthetic_reference_handoff_refused',
      passed: false,
      packet,
      selection,
      context,
    }
  }
  const identity = handoff.review.sources[0].identityCheck
  const held = identity.reasons.length > 0
  const positive =
    identity.title === 'exact' &&
    identity.isbn === 'exact' &&
    identity.contributors.length > 0 &&
    identity.contributors.every((c) => c === 'exact') &&
    !held
  const expectationMet =
    frozenCase.expected === 'consistent'
      ? positive
      : held &&
        {
          wrong_creator: identity.contributors.includes('mismatch'),
          secondary_role: identity.contributors.includes('secondary_role_only'),
          editor_only: identity.reasons.includes('identity_incomplete'),
          isbn_conflict: identity.isbn === 'conflict',
        }[frozenCase.expected]
  const preservation = stable(handoff.request.existing) === stable(context.existing)
  const reviewOnly =
    handoff.resolution.mode === 'review_only' &&
    handoff.request.observations.every(
      (o) => o.source.kind === 'unverified' && o.source.usage === 'review_only',
    ) &&
    handoff.resolution.claims.every((c) => c.state !== 'supported') &&
    handoff.resolution.fields.every((f) => f.state !== 'proposed')
  let masquerade = null
  if (frozenCase.id === 'translator-as-author') {
    const falseSelection = structuredClone(selection)
    falseSelection.identity.contributors.find((c) => c.role === 'translator').role = 'author'
    try {
      buildDocumentEvidenceHandoff(packet, falseSelection, context)
      masquerade = 'incorrectly_accepted'
    } catch (error) {
      masquerade = error.message.includes(
        'credit role and name are not an explicit literal statement',
      )
        ? 'refused_literal_role_entailment'
        : 'other_refusal_not_scored_as_success'
    }
  }
  return {
    status: positive ? 'consistent' : held ? 'held' : 'unexpected',
    passed: !!expectationMet && preservation && reviewOnly,
    identity,
    existingPreserved: preservation,
    reviewOnly,
    masquerade,
    acquisitionTargetFingerprint: source.targetFingerprint,
    targetBinding:
      'Frozen synthetic target replay; same acquisition reused without another OCR request.',
    handoff,
  }
}

async function codeSnapshot() {
  const files = [
    'scripts/document-evidence-pilot.mjs',
    'scripts/document-evidence.mjs',
    'scripts/document-evidence-handoff.mjs',
    'scripts/document-evidence-review.mjs',
    'scripts/document-evidence-image.mjs',
    'scripts/document-evidence-vision.swift',
    'scripts/fixtures/document-evidence-pilot.swift',
    'scripts/fixtures/document-evidence-pilot.json',
    'pnpm-lock.yaml',
    'package.json',
  ]
  async function walk(dir) {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) await walk(path)
      else if (/\.(?:ts|tsx|mjs|json)$/.test(entry.name)) files.push(path)
    }
  }
  await walk('packages/core/src')
  const hashes = []
  for (const path of files.sort())
    hashes.push({ path, sha256: digest(await readDocumentFile(join(root, path))) })
  return { sha256: digest(stable(hashes)), files: hashes }
}

/** Freeze all inputs and scoring into a new private directory before starting any OCR. */
export async function runDocumentEvidencePilot(referencePath, imageDirectory, outputDirectory) {
  const referenceBytes = await readDocumentFile(resolve(referencePath))
  let reference
  try {
    reference = validateDocumentPilotReference(JSON.parse(referenceBytes.toString('utf8')))
  } catch {
    fail('invalid independent reference JSON; inputs were not logged')
  }
  const images = []
  for (const page of reference.pages) {
    const image = documentPng(await readDocumentFile(resolve(imageDirectory, page.fileName)))
    if (
      image.sha256 !== page.imageSha256 ||
      image.width !== page.width ||
      image.height !== page.height
    )
      fail('image changed since independent visual reference')
    images.push({ page, bytes: image.bytes })
  }
  const code = await codeSnapshot(),
    cases = documentPilotCases(reference),
    frozenAt = new Date().toISOString()
  const output = resolve(outputDirectory)
  await privateDocumentDirectory(output)
  await privateDocumentDirectory(join(output, 'frozen-images'))
  for (const { page, bytes } of images)
    await writeFile(join(output, 'frozen-images', page.fileName), bytes, {
      mode: 0o600,
      flag: 'wx',
    })
  await writeFile(join(output, 'independent-reference.json'), referenceBytes, {
    mode: 0o600,
    flag: 'wx',
  })
  const frame = {
    version: 1,
    mode: 'synthetic_document_pilot',
    frozenAt,
    referenceSha256: digest(referenceBytes),
    code,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
    },
    imageInputs: reference.pages.map(({ pageId, fileName, imageSha256, width, height }) => ({
      pageId,
      fileName,
      imageSha256,
      width,
      height,
    })),
    scoring: DOCUMENT_PILOT_SCORING,
    cases,
    acquisition: { engine: 'apple_vision', pairs: 3, pages: 6, retries: 0, localOnly: true },
    clockPolicy:
      'Source image retrieval time is frozenAt; each synthetic replay asOf/confirmation time is the actual replay time after acquisition.',
    sourcePermissions: {
      localReview: true,
      catalogStorage: false,
      modelInput: false,
      export: false,
    },
    limits: reference.limits,
  }
  const frameHash = digest(stable(frame))
  await writeDocumentJson(join(output, 'frozen-plan.json'), frame)
  await writeDocumentJson(join(output, 'attempt.json'), {
    version: 1,
    frameHash,
    startedAt: new Date().toISOString(),
    retryAllowed: false,
  })
  const results = [],
    pageScores = [],
    acquisitions = [],
    replayErrors = []
  let integrityFailure = false
  for (const stem of stems) {
    try {
      if ((await codeSnapshot()).sha256 !== code.sha256) fail('implementation changed after freeze')
      const pair = reference.pages.filter((p) => p.pageId.startsWith(`${stem}-`))
      for (const p of pair)
        if (
          digest(await readDocumentFile(join(output, 'frozen-images', p.fileName))) !==
          p.imageSha256
        )
          fail('frozen image changed before acquisition')
      const base = cases.find((c) => c.fixture === stem)
      const manifest = {
        version: 1,
        targetFingerprint: base.context.targetFingerprint,
        source: {
          url: `https://document-evidence.invalid/synthetic/${stem}`,
          retrievedAt: frozenAt,
          label: 'Authorized synthetic document pilot; not published-book evidence',
          permissions: frame.sourcePermissions,
          permissionBasis:
            'Owner-authorized private synthetic-image pilot. No source URL is fetched, and no external book facts or rights are asserted.',
        },
        pages: pair.map((p) => ({
          id: p.pageId,
          label: p.pageId,
          image: `frozen-images/${p.fileName}`,
          ocr: { kind: 'apple_vision' },
        })),
      }
      const manifestPath = join(output, `manifest-${stem}.json`)
      await writeDocumentJson(manifestPath, manifest)
      const { packet } = await prepareDocumentEvidence(
        manifest,
        manifestPath,
        join(output, `acquisition-${stem}`),
      )
      if ((await codeSnapshot()).sha256 !== code.sha256)
        fail('implementation changed during acquisition')
      const scores = pair.map((p) =>
        scoreDocumentPilotPage(
          p,
          packet.pages.find((v) => v.id === p.pageId),
        ),
      )
      if (scores.some((s) => !s.imageIdentityValid))
        fail('acquired image differs from frozen reference')
      pageScores.push(...scores)
      acquisitions.push({
        fixture: stem,
        status: packet.pages.every((p) => p.status === 'complete') ? 'complete' : 'incomplete',
        pages: packet.pages.map((p) => ({ id: p.id, status: p.status })),
      })
      for (const c of cases.filter((c) => c.fixture === stem)) {
        const replay = replayDocumentPilotCase(reference, packet, c, new Date().toISOString())
        await writeDocumentJson(join(output, `case-${c.id}.json`), {
          version: 1,
          mode: 'automated_synthetic_reference_replay',
          humanApproval: false,
          sourcePromotion: false,
          frameHash,
          case: c,
          ...replay,
        })
        const {
          handoff,
          packet: unusedPacket,
          selection: unusedSelection,
          context: unusedContext,
          ...aggregate
        } = replay
        void handoff
        void unusedPacket
        void unusedSelection
        void unusedContext
        results.push({ id: c.id, expected: c.expected, ...aggregate })
      }
    } catch (error) {
      const integrity =
        error.message.includes('implementation changed') ||
        error.message.includes('frozen image changed') ||
        error.message.includes('acquired image differs')
      integrityFailure ||= integrity
      const failed = {
        fixture: stem,
        status: 'failed',
        reason: integrity ? 'frozen_input_or_code_drift' : 'acquisition_or_replay_failed',
        rawErrorRetained: false,
      }
      if (acquisitions.some((a) => a.fixture === stem)) replayErrors.push(failed)
      else acquisitions.push(failed)
      for (const c of cases.filter(
        (c) => c.fixture === stem && !results.some((r) => r.id === c.id),
      ))
        results.push({
          id: c.id,
          expected: c.expected,
          status: 'unobserved',
          passed: false,
          reason: 'acquisition_or_replay_failed',
        })
      if (integrity) break
    }
  }
  for (const c of cases.filter((c) => !results.some((r) => r.id === c.id)))
    results.push({
      id: c.id,
      expected: c.expected,
      status: 'unobserved',
      passed: false,
      reason: 'stopped_after_integrity_failure',
    })
  for (const p of reference.pages.filter((p) => !pageScores.some((s) => s.pageId === p.pageId)))
    pageScores.push(scoreDocumentPilotPage(p, null))
  if ((await codeSnapshot()).sha256 !== code.sha256) integrityFailure = true
  for (const p of reference.pages)
    if (digest(await readDocumentFile(join(output, 'frozen-images', p.fileName))) !== p.imageSha256)
      integrityFailure = true
  const positives = results.filter((r) => r.expected === 'consistent'),
    negatives = results.filter((r) => r.expected !== 'consistent')
  const observed = results.filter((r) => r.status !== 'unobserved')
  const report = {
    version: 1,
    mode: 'synthetic_document_pilot',
    frameHash,
    referenceSha256: frame.referenceSha256,
    frameHashBasis: 'sha256 of recursively key-sorted compact JSON',
    codeSha256: code.sha256,
    completedAt: new Date().toISOString(),
    integrityFailure,
    ocr: {
      engine: 'apple_vision',
      expectedPages: 6,
      expectedLiteralLines: 13,
      observedPages: pageScores.filter((p) => p.imageIdentityValid).length,
      completePages: pageScores.filter((p) => p.status === 'complete').length,
      exactLiteralLines: pageScores.reduce((n, p) => n + p.exactLiteralLines, 0),
      exactWithinRoughRegionLines: pageScores.reduce((n, p) => n + p.exactWithinRegionLines, 0),
      ambiguousReferenceLines: pageScores.flatMap((p) => p.lines).filter((l) => l.ambiguous).length,
      unmatchedObservedLines: pageScores.reduce((n, p) => n + p.unmatchedObservedLines, 0),
      referenceMissingOrInexact: 13 - pageScores.reduce((n, p) => n + p.exactLiteralLines, 0),
    },
    replay: {
      kind: 'automated_synthetic_reference_replay',
      realOperatorApproval: false,
      cases: 6,
      positives: 2,
      negatives: 4,
      positivesConsistent: positives.filter((r) => r.passed).length,
      negativesHeld: negatives.filter((r) => r.passed).length,
      unobserved: results.filter((r) => r.status === 'unobserved').length,
      observedFailures: results.filter((r) => r.status !== 'unobserved' && !r.passed).length,
      translatorMasquerade:
        results.find((r) => r.id === 'translator-as-author')?.masquerade ?? 'unobserved',
      observedHandoffs: observed.length,
      allObservedExistingValuesPreserved: observed.length
        ? observed.every((r) => r.existingPreserved)
        : null,
      allObservedHandoffsReviewOnly: observed.length ? observed.every((r) => r.reviewOnly) : null,
    },
    acquisitions,
    replayErrors,
    pageScores,
    cases: results,
    externalBookAccuracy: 'unmeasured',
    sourcePromotions: 0,
    paidCalls: 0,
    databaseWrites: 0,
    limits: [
      ...reference.limits,
      'This receipt separates raw OCR scoring from synthetic-reference confirmations and resolver replay. No OCR output is a human approval.',
      'The wrong-ISBN control also has no visible author; its ISBN conflict axis is scored separately and does not isolate the cause of its overall hold.',
      'Zero or partial observations do not establish safe rejection or preserved values for unobserved cases. No population, engine comparison or real-book accuracy claim.',
    ],
  }
  await writeDocumentJson(join(output, 'report.json'), report)
  return report
}

export async function main(args) {
  args = args.filter((arg, i) => i !== 0 || arg !== '--')
  if (args.length !== 3)
    fail(
      'Usage: pnpm exec vite-node --script scripts/document-evidence-pilot.mjs -- <reference.json> <existing-image-dir> <new-output-dir>',
    )
  const report = await runDocumentEvidencePilot(...args)
  console.log(
    JSON.stringify({
      report: resolve(args[2], 'report.json'),
      ocr: report.ocr,
      replay: report.replay,
      integrityFailure: report.integrityFailure,
      paidCalls: 0,
      sourcePromotions: 0,
    }),
  )
  if (
    report.integrityFailure ||
    report.replay.unobserved ||
    report.replay.observedFailures ||
    report.ocr.exactLiteralLines !== 13 ||
    report.ocr.exactWithinRoughRegionLines !== 13 ||
    report.replay.translatorMasquerade !== 'refused_literal_role_entailment'
  )
    process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(() => {
    console.error(
      'Synthetic document pilot failed; frozen inputs and any partial private receipts are retained. No automatic retry.',
    )
    process.exitCode = 1
  })
