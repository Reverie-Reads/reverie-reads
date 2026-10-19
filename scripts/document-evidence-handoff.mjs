import { createHash } from 'node:crypto'
import {
  parseDocumentEvidence,
  documentEvidenceLines,
} from '../packages/core/src/documentEvidence.ts'
import { parseIntakeEvidence } from '../packages/core/src/intakeEvidenceValidation.ts'
import { resolveIntakeEvidence } from '../packages/core/src/intakeResolver.ts'
import { buildIntakeReview } from '../packages/core/src/intakeReview.ts'
import { normalizeIsbn } from '../packages/core/src/match.ts'

const object = (v) =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const keys = (v, required, optional = []) =>
  object(v) &&
  required.every((k) => Object.hasOwn(v, k)) &&
  Object.keys(v).every((k) => [...required, ...optional].includes(k))
const text = (v, max) => typeof v === 'string' && !!v.trim() && v.length <= max
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (object(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(',')}}`
  return JSON.stringify(v)
}
const freeze = (v) => {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze)
    Object.freeze(v)
  }
  return v
}
const fail = (reason) => {
  throw new Error(`Document evidence handoff refused: ${reason}`)
}

/** Canonical packet revision, including permissions, raw lines and the full correction chain. */
export function documentEvidenceFingerprint(input) {
  const packet = parseDocumentEvidence(input)
  if (!packet) return fail('invalid document packet')
  return createHash('sha256').update(stable(packet)).digest('hex')
}

// Deliberately small literal statement grammar. A name appearing on a page does not imply a role.
// Unsupported statements remain in the document; callers must not rewrite them to fit this grammar.
const statements = {
  author: ['By', 'Written by', 'Author:'],
  editor: ['Edited by', 'Editor:'],
  translator: ['Translated by', 'Translator:'],
  illustrator: ['Illustrated by', 'Illustrator:'],
  narrator: ['Narrated by', 'Read by', 'Narrator:'],
  foreword: ['Foreword by'],
  introduction: ['Introduction by'],
}
function selectedCredit(c, quote) {
  if (
    !keys(c, ['name', 'role', 'scope', 'basis', 'quote'], ['part']) ||
    !text(c.name, 300) ||
    c.name.trim() !== c.name ||
    Array.from(c.name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    c.basis !== 'edition'
  )
    return fail('invalid selected credit')
  const part =
    c.role === 'foreword' ? 'Foreword' : c.role === 'introduction' ? 'Introduction' : null
  if (part ? c.scope !== 'part' || c.part !== part : c.scope !== 'whole' || c.part !== undefined)
    return fail('unsupported credit scope')
  // An explicitly unknown name-only statement cannot establish creator identity.
  let sourceRole = null
  if (c.role === 'unknown') {
    if (quote !== c.name) return fail('unknown role must retain the literal name-only statement')
  } else {
    sourceRole = statements[c.role]?.find((prefix) => {
      if (!quote.startsWith(prefix)) return false
      const rest = quote.slice(prefix.length)
      return /^[ \t\n]+/.test(rest) && rest.replace(/^[ \t\n]+/, '') === c.name
    })
    if (!sourceRole) return fail('credit role and name are not an explicit literal statement')
  }
  return {
    name: c.name,
    role: c.role,
    scope: c.scope,
    ...(part ? { part } : {}),
    basis: 'edition',
    sourceRole,
  }
}

function selectedIsbn(quote) {
  // No arbitrary character stripping: OCR O/I substitutions, prose and multiple identifiers fail.
  const match = /^(?:ISBN(?:-10|-13)?[ :\t]+)?([0-9Xx][0-9Xx -]{8,24}[0-9Xx])$/.exec(quote)
  if (!match) return fail('ISBN is not a literal identifier statement')
  const literal = match[1].replace(/[ -]/g, '').toUpperCase()
  const isbn = normalizeIsbn(literal)
  if (!isbn) return fail('invalid literal ISBN checksum')
  if (quote.startsWith('ISBN-10') && literal.length !== 10) return fail('ISBN label disagrees')
  if (quote.startsWith('ISBN-13') && literal.length !== 13) return fail('ISBN label disagrees')
  return { literal, canonical: isbn }
}

/** Explicit operator-reviewed selection only. No model-input path, qualification or writer.
 * context: {targetFingerprint, asOf, target, existing}; no incoming observations are accepted.
 * selection: {version:1, documentFingerprint, targetFingerprint, identity:{title,contributors,isbns}}.
 * Each quote is {pageId,lineIds,text}; text equals contiguous effective lines joined with '\n'.
 * Every selected line must first have an explicit image-bound transcription confirmation/correction.
 * Output contains private source text; it is a detached frozen local review, never an export grant.
 */
export function buildDocumentEvidenceHandoff(input, selection, context) {
  const packet = parseDocumentEvidence(input)
  if (!packet) return fail('invalid document packet')
  if (!packet.source.permissions.localReview) return fail('local review permission is missing')
  if (!keys(context, ['targetFingerprint', 'asOf', 'target', 'existing']))
    return fail('invalid target context')
  const base = parseIntakeEvidence({ version: 1, ...context, observations: [] })
  const fingerprint = documentEvidenceFingerprint(packet)
  if (
    !keys(selection, ['version', 'documentFingerprint', 'targetFingerprint', 'identity']) ||
    selection.version !== 1 ||
    !hash(selection.documentFingerprint) ||
    selection.documentFingerprint !== fingerprint ||
    selection.targetFingerprint !== packet.targetFingerprint ||
    selection.targetFingerprint !== base.targetFingerprint
  )
    return fail('stale document or target selection')
  const identity = selection.identity
  if (
    !keys(identity, ['title', 'contributors', 'isbns']) ||
    !Array.isArray(identity.contributors) ||
    !identity.contributors.length ||
    identity.contributors.length > 20 ||
    !Array.isArray(identity.isbns) ||
    !identity.isbns.length ||
    identity.isbns.length > 2
  )
    return fail('invalid selected identity')

  const lines = documentEvidenceLines(packet)
  const citations = []
  function cite(q, id) {
    if (
      !keys(q, ['pageId', 'lineIds', 'text']) ||
      !text(q.pageId, 80) ||
      !text(q.text, 1000) ||
      !Array.isArray(q.lineIds) ||
      !q.lineIds.length ||
      q.lineIds.length > 8 ||
      !q.lineIds.every((v) => text(v, 80)) ||
      new Set(q.lineIds).size !== q.lineIds.length
    )
      return fail('invalid citation')
    const page = packet.pages.find((p) => p.id === q.pageId)
    if (!page || page.status !== 'complete') return fail('selected page is incomplete')
    const pageLines = lines.filter((l) => l.pageId === q.pageId)
    const start = pageLines.findIndex((l) => l.lineId === q.lineIds[0])
    const selected = pageLines.slice(start, start + q.lineIds.length)
    if (
      start < 0 ||
      selected.length !== q.lineIds.length ||
      selected.some((l, i) => l.lineId !== q.lineIds[i] || l.needsReview) ||
      selected.map((l) => l.text).join('\n') !== q.text
    )
      return fail('citation must match contiguous confirmed effective lines exactly')
    const correctionIds = new Set(selected.flatMap((l) => l.correctionIds))
    const corrections = packet.corrections.filter((c) => correctionIds.has(c.id))
    if (corrections.some((c) => Date.parse(c.reviewedAt) > Date.parse(base.asOf)))
      return fail('transcription review is later than the handoff time')
    citations.push({
      id,
      pageId: page.id,
      pageLabel: page.label,
      imageSha256: page.imageSha256,
      width: page.width,
      height: page.height,
      quote: q.text,
      lines: selected,
      corrections,
    })
    return q.text
  }

  const title = cite(identity.title, 'title')
  const contributors = identity.contributors.map((c, i) =>
    selectedCredit(c, cite(c?.quote, `contributor-${i + 1}`)),
  )
  const identifiers = identity.isbns.map((q, i) => selectedIsbn(cite(q, `isbn-${i + 1}`)))
  if (new Set(identifiers.map((v) => v.canonical)).size !== 1)
    return fail('selected identifiers belong to different editions')
  const locator = (field) => `document-evidence:${fingerprint}#${field}`
  const request = parseIntakeEvidence({
    ...base,
    observations: [
      {
        id: 'document-selection',
        targetFingerprint: base.targetFingerprint,
        source: {
          provider: 'document_evidence',
          recordId: fingerprint,
          url: packet.source.url,
          retrievedAt: packet.source.retrievedAt,
          lineage: null,
          kind: 'unverified',
          usage: 'review_only',
          method: 'inspected',
        },
        status: 'ok',
        identity: {
          title,
          contributors,
          scope: 'edition',
          isbns: identifiers.map((v) => v.literal),
        },
        claims: [
          {
            id: 'title',
            field: 'title',
            value: title,
            scope: 'edition',
            locator: locator('title'),
          },
          {
            id: 'contributors',
            field: 'contributors',
            value: contributors,
            scope: 'edition',
            locator: locator('contributors'),
          },
        ],
      },
    ],
  })
  return freeze(
    structuredClone({
      version: 1,
      mode: 'review_only',
      documentFingerprint: fingerprint,
      document: packet,
      selection,
      // These are operator attestations. No source permission changes this stage's effective use.
      effectiveUse: { localReview: true, catalogStorage: false, modelInput: false, export: false },
      holds: [
        'review_only_source',
        'unverified_source',
        ...(packet.pages.some((p) => p.status !== 'complete') ? ['document_incomplete'] : []),
      ],
      request,
      resolution: resolveIntakeEvidence(request),
      review: buildIntakeReview(request),
      citations,
    }),
  )
}
