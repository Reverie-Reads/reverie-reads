import { describe, expect, it } from 'vitest'
import {
  documentPilotCases,
  replayDocumentPilotCase,
  scoreDocumentPilotPage,
  validateDocumentPilotReference,
} from '../../../scripts/document-evidence-pilot.mjs'

const at = '2026-10-19T12:00:00.000Z'
function reference() {
  const groups = [
    ['authored', ['Synthetic Atlas', 'By Jane Mira Vale'], '9780306406157'],
    [
      'translated',
      ['Synthetic Garden', 'By Amelia Rowan Reed', 'Translated by Mateo Sol Vega'],
      '9780140328721',
    ],
    ['edited', ['Synthetic Voices', 'Edited by Riley Arden Stone'], '9780679783268'],
  ]
  const pages = groups
    .flatMap(([stem, title, isbn]) => [
      [stem + '-title', title],
      [stem + '-copyright', ['ISBN ' + isbn, 'Synthetic publisher: Example House']],
    ])
    .map(([pageId, lines]) => ({
      pageId,
      fileName: pageId + '.png',
      imageSha256: 'b'.repeat(64),
      width: 1200,
      height: 800,
      lines: lines.map((text, i) => ({
        id: `reference-${i + 1}`,
        text,
        region: [50, 50 + i * 120, 700, 60],
      })),
    }))
  const explicitCredits = [
    ['authored', 2, 'Jane Mira Vale', 'author', 'By'],
    ['translated', 2, 'Amelia Rowan Reed', 'author', 'By'],
    ['translated', 3, 'Mateo Sol Vega', 'translator', 'Translated by'],
    ['edited', 2, 'Riley Arden Stone', 'editor', 'Edited by'],
  ].map(([stem, n, name, role, sourceRole]) => ({
    pageId: stem + '-title',
    lineId: 'reference-' + n,
    name,
    role,
    sourceRole,
    scope: 'whole',
    quote: sourceRole + ' ' + name,
  }))
  const controlExpectations = [
    ['authored-positive', 'authored'],
    ['same-title-wrong-author', 'authored'],
    ['translated-positive', 'translated'],
    ['translator-as-author', 'translated'],
    ['editor-only', 'edited'],
    ['wrong-isbn', 'edited'],
  ].map(([id, fixture]) => ({ id, fixture, expected: 'Explicit synthetic control' }))
  return {
    version: 1,
    preparedAt: at,
    mode: 'synthetic_independent_visual_reference',
    basis: 'Synthetic unit test, no image or OCR acquisition',
    coordinateConvention: 'Top-left pixels',
    pages,
    explicitCredits,
    controlExpectations,
    limits: ['Synthetic unit tests do not measure OCR or book accuracy.'],
  }
}
function packet(ref, fixture) {
  return {
    version: 1,
    mode: 'review_only',
    targetFingerprint: 'a'.repeat(64),
    source: {
      url: 'https://document-evidence.invalid/synthetic/' + fixture,
      retrievedAt: at,
      label: 'Synthetic unit test',
      permissions: { localReview: true, catalogStorage: false, modelInput: false, export: false },
      permissionBasis: 'Synthetic test; no rights assertion',
    },
    pages: ref.pages
      .filter((p) => p.pageId.startsWith(fixture + '-'))
      .map((p) => ({
        id: p.pageId,
        label: p.pageId,
        imageSha256: p.imageSha256,
        width: p.width,
        height: p.height,
        method: 'ocr_sidecar',
        status: 'complete',
        lines: p.lines.map((l, i) => ({
          id: 'line-' + (i + 1),
          text: l.text,
          bbox: {
            x: l.region[0] + 5,
            y: l.region[1] + 5,
            width: l.region[2] - 10,
            height: l.region[3] - 10,
          },
          confidence: 99,
        })),
      })),
    corrections: [],
  }
}

describe('frozen document pilot scoring without OCR execution', () => {
  it('retains the independent reference provenance for a preflight-only fixture replacement', () => {
    const ref = reference()
    ref.priorReference = { sha256: 'a'.repeat(64), pilot: 'pilot-01', unchanged: true }
    expect(validateDocumentPilotReference(ref).priorReference).toEqual(ref.priorReference)
    ref.priorReference.unchanged = false
    expect(() => validateDocumentPilotReference(ref)).toThrow('invalid prior reference provenance')
  })
  it('rejects duplicate reference literals that could count one OCR line twice', () => {
    const ref = reference()
    ref.pages[0].lines[1].text = ref.pages[0].lines[0].text
    expect(() => validateDocumentPilotReference(ref)).toThrow('invalid reference line')
  })
  it('does not correct literal differences or conflate recognition with location', () => {
    const ref = reference(),
      p = packet(ref, 'authored').pages[0]
    p.lines[0].bbox.x = 0
    p.lines[1].text += ' '
    const score = scoreDocumentPilotPage(ref.pages[0], p)
    expect(score.exactLiteralLines).toBe(1)
    expect(score.exactWithinRegionLines).toBe(0)
    expect(score.unmatchedObservedLines).toBe(1)
  })
  it('counts duplicate OCR literals as ambiguous, not a successful match', () => {
    const ref = reference(),
      p = packet(ref, 'authored').pages[0]
    p.lines.push({ ...p.lines[0], id: 'duplicate' })
    const score = scoreDocumentPilotPage(ref.pages[0], p)
    expect(score.lines[0]).toMatchObject({
      ambiguous: true,
      literalExact: false,
      eligibleForSyntheticReplay: false,
    })
    expect(score.unmatchedObservedLines).toBe(2)
  })
  it('keeps missing or image-mismatched pages unobserved', () => {
    const ref = reference(),
      p = packet(ref, 'authored').pages[0]
    p.imageSha256 = 'c'.repeat(64)
    expect(scoreDocumentPilotPage(ref.pages[0], p).exactLiteralLines).toBe(0)
    expect(scoreDocumentPilotPage(ref.pages[0], null)).toMatchObject({
      status: 'unobserved',
      exactLiteralLines: 0,
    })
  })
  it.each([
    'authored-positive',
    'same-title-wrong-author',
    'translated-positive',
    'translator-as-author',
    'editor-only',
    'wrong-isbn',
  ])('retains the intended diagnostic and review-only boundary for %s', (id) => {
    const ref = reference(),
      c = documentPilotCases(ref).find((c) => c.id === id),
      p = packet(ref, c.fixture)
    const before = structuredClone(p)
    const result = replayDocumentPilotCase(ref, p, c, at)
    expect(result.passed).toBe(true)
    expect(result.existingPreserved).toBe(true)
    expect(result.reviewOnly).toBe(true)
    expect(result.status).toBe(c.expected === 'consistent' ? 'consistent' : 'held')
    expect(p).toEqual(before)
    expect(
      result.handoff.document.corrections.every(
        (c) => c.previousText === c.text && c.reason.includes('Not a real operator approval'),
      ),
    ).toBe(true)
    if (id === 'translator-as-author')
      expect(result.masquerade).toBe('refused_literal_role_entailment')
    if (id === 'wrong-isbn') expect(result.identity.isbn).toBe('conflict')
  })
  it.each(['partial', 'failed'])(
    'does not turn %s page evidence into a successful negative control',
    (status) => {
      const ref = reference(),
        c = documentPilotCases(ref).find((c) => c.id === 'same-title-wrong-author'),
        p = packet(ref, c.fixture)
      p.pages[0].status = status
      p.pages[0].errors = ['Synthetic page failure']
      expect(replayDocumentPilotCase(ref, p, c, at)).toMatchObject({
        status: 'unobserved',
        passed: false,
      })
    },
  )
  it('does not use an exact text outside the independent region for replay', () => {
    const ref = reference(),
      c = documentPilotCases(ref)[0],
      p = packet(ref, c.fixture)
    p.pages[0].lines[0].bbox.x = 0
    expect(replayDocumentPilotCase(ref, p, c, at)).toMatchObject({
      status: 'unobserved',
      passed: false,
    })
  })
})
