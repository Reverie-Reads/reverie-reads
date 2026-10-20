import { describe, expect, it } from 'vitest'
import {
  documentEvidenceLines,
  parseDocumentEvidence,
  parseDocumentTsv,
  type DocumentEvidencePacket,
} from './documentEvidence'

const sha = 'a'.repeat(64)
const bbox = { x: 10, y: 20, width: 60, height: 15 }
function packet(): DocumentEvidencePacket {
  return {
    version: 1,
    mode: 'review_only',
    targetFingerprint: 'b'.repeat(64),
    source: {
      url: 'https://publisher.example/title',
      retrievedAt: '2026-10-19T10:00:00Z',
      label: 'Title page',
      permissions: { localReview: true, catalogStorage: false, modelInput: false, export: false },
      permissionBasis: 'Operator reviewed source terms for this local inspection',
    },
    pages: [
      {
        id: 'page1',
        label: 'Title page',
        imageSha256: sha,
        width: 200,
        height: 300,
        method: 'ocr_sidecar',
        status: 'complete',
        lines: [{ id: 'line1', text: 'A qviet library', bbox: { ...bbox }, confidence: 99.9 }],
      },
    ],
    corrections: [],
  }
}
function correction(p: DocumentEvidencePacket, text = 'A quiet library') {
  p.corrections.push({
    id: `correction${p.corrections.length + 1}`,
    pageId: 'page1',
    lineId: 'line1',
    imageSha256: sha,
    previousText: p.corrections.at(-1)?.text ?? p.pages[0]!.lines[0]!.text,
    text,
    bbox: { ...bbox },
    reason: 'Compared letters against the rendered page',
    reviewedAt: '2026-10-19T11:00:00Z',
  })
}
describe('private document evidence', () => {
  it('retains literal transcription and keeps high OCR confidence under review', () => {
    const p = packet(),
      parsed = parseDocumentEvidence(p)!
    expect(parsed).toEqual(p)
    expect(parsed).not.toBe(p)
    const line = documentEvidenceLines(p)[0]!
    expect(line).toMatchObject({
      rawText: 'A qviet library',
      text: 'A qviet library',
      confidence: 99.9,
      needsReview: true,
      correctionIds: [],
    })
    line.bbox.x = 0
    expect(p.pages[0]!.lines[0]!.bbox.x).toBe(10)
    expect(parsed.source.permissions).toEqual({
      localReview: true,
      catalogStorage: false,
      modelInput: false,
      export: false,
    })
  })
  it('replays explicit corrections in order without overwriting source text', () => {
    const p = packet()
    correction(p)
    correction(p, 'A Quiet Library')
    const before = structuredClone(p)
    expect(documentEvidenceLines(p)[0]).toMatchObject({
      rawText: 'A qviet library',
      text: 'A Quiet Library',
      correctionIds: ['correction1', 'correction2'],
      needsReview: false,
    })
    expect(p).toEqual(before)
  })
  it.each(['partial', 'failed'] as const)(
    'retains %s pages, errors and recovered lines under review',
    (status) => {
      const p = packet()
      p.pages[0]!.status = status
      p.pages[0]!.errors = ['OCR stopped before end of page']
      correction(p)
      expect(parseDocumentEvidence(p)).toEqual(p)
      expect(documentEvidenceLines(p)[0]).toMatchObject({ pageStatus: status, needsReview: true })
      p.pages[0]!.lines = []
      p.corrections = []
      expect(parseDocumentEvidence(p)).toEqual(p)
      expect(documentEvidenceLines(p)).toEqual([])
    },
  )
  it.each([
    [
      'stale previous text',
      (p: DocumentEvidencePacket) => {
        p.corrections[0]!.previousText = 'different text'
      },
    ],
    [
      'changed image',
      (p: DocumentEvidencePacket) => {
        p.pages[0]!.imageSha256 = 'c'.repeat(64)
      },
    ],
    [
      'unknown line',
      (p: DocumentEvidencePacket) => {
        p.corrections[0]!.lineId = 'absent'
      },
    ],
    [
      'duplicate correction',
      (p: DocumentEvidencePacket) => {
        p.corrections.push({ ...p.corrections[0]! })
      },
    ],
    [
      'backdated correction',
      (p: DocumentEvidencePacket) => {
        p.corrections[0]!.reviewedAt = '2026-10-18T11:00:00Z'
      },
    ],
    [
      'out of bounds correction',
      (p: DocumentEvidencePacket) => {
        p.corrections[0]!.bbox.width = 201
      },
    ],
  ] as const)('rejects %s without quietly returning raw OCR', (_, mutate) => {
    const p = packet()
    correction(p)
    mutate(p)
    expect(parseDocumentEvidence(p)).toBeNull()
    expect(() => documentEvidenceLines(p)).toThrow('Invalid document evidence')
  })
  it('rejects out-of-order correction history and wrong second-version text', () => {
    const p = packet()
    correction(p)
    correction(p, 'A Quiet Library')
    p.corrections[1]!.reviewedAt = '2026-10-19T10:30:00Z'
    expect(parseDocumentEvidence(p)).toBeNull()
    p.corrections[1]!.reviewedAt = '2026-10-19T11:00:00Z'
    p.corrections[1]!.previousText = 'A qviet library'
    expect(parseDocumentEvidence(p)).toBeNull()
  })
  it.each([
    { x: -1 },
    { width: 0 },
    { x: 150 },
    { y: 299 },
    { x: 1.5 },
    { height: NaN },
    { width: Infinity },
  ])('rejects invalid page geometry %j', (invalid) => {
    const p = packet()
    Object.assign(p.pages[0]!.lines[0]!.bbox, invalid)
    expect(parseDocumentEvidence(p)).toBeNull()
  })
  it.each([
    'https://user:pass@example.org/book',
    'https://example.org/book?key=secret',
    'https://example.org/book#part',
    'http://example.org/book',
    'https://example.org/book?',
    'https://example.org/book#',
  ])('rejects unsafe source locator %s', (url) => {
    const p = packet()
    p.source.url = url
    expect(parseDocumentEvidence(p)).toBeNull()
  })
  it('rejects unknown personal fields at every evidence level rather than stripping them', () => {
    for (const target of ['root', 'source', 'page', 'line', 'correction', 'box', 'permissions']) {
      const p = packet()
      correction(p)
      const holders: Record<string, object> = {
        root: p,
        source: p.source,
        page: p.pages[0]!,
        line: p.pages[0]!.lines[0]!,
        correction: p.corrections[0]!,
        box: p.pages[0]!.lines[0]!.bbox,
        permissions: p.source.permissions,
      }
      Object.assign(holders[target]!, { privateNotes: 'must not be accepted' })
      expect(parseDocumentEvidence(p)).toBeNull()
    }
  })
  it('bounds page count, dimensions, text and IDs', () => {
    const p = packet()
    p.pages = Array.from({ length: 9 }, (_, i) => ({ ...p.pages[0]!, id: `p${i}` }))
    expect(parseDocumentEvidence(p)).toBeNull()
    const dimension = packet()
    dimension.pages[0]!.width = 30001
    expect(parseDocumentEvidence(dimension)).toBeNull()
    const long = packet()
    long.pages[0]!.lines[0]!.text = 'x'.repeat(2001)
    expect(parseDocumentEvidence(long)).toBeNull()
    const duplicate = packet()
    duplicate.pages[0]!.lines.push({ ...duplicate.pages[0]!.lines[0]! })
    expect(parseDocumentEvidence(duplicate)).toBeNull()
    const time = packet()
    time.source.retrievedAt = '2026-02-30T10:00:00Z'
    expect(parseDocumentEvidence(time)).toBeNull()
  })
  it('rejects contradictory completion while preserving permission denials as attestations', () => {
    const p = packet()
    p.pages[0]!.errors = ['OCR failed']
    expect(parseDocumentEvidence(p)).toBeNull()
    p.pages[0]!.status = 'partial'
    p.source.permissions.localReview = false
    expect(parseDocumentEvidence(p)).toEqual(p)
  })
  it('bounds total lines across pages and total correction text', () => {
    const p = packet(),
      line = p.pages[0]!.lines[0]!
    p.pages[0]!.lines = Array.from({ length: 6001 }, (_, i) => ({ ...line, id: `line${i}` }))
    expect(parseDocumentEvidence(p)).toBeNull()
    const large = packet()
    large.pages[0]!.lines[0]!.text = 'x'.repeat(2000)
    for (let i = 0; i < 501; i++) correction(large, 'x'.repeat(2000))
    expect(parseDocumentEvidence(large)).toBeNull()
  })
})
const header =
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
const row = (word: number, text: string, overrides: Record<string, unknown> = {}) => {
  const r = {
    level: 5,
    page: 1,
    block: 1,
    par: 1,
    line: 1,
    word,
    left: 10 + word * 20,
    top: 20,
    width: 18,
    height: 12,
    conf: 95,
    text,
    ...overrides,
  }
  return Object.values(r).join('\t')
}
describe('Tesseract TSV evidence', () => {
  it('groups word rows by block/paragraph/line with exact union boxes and minimum OCR score', () => {
    const result = parseDocumentTsv(
      [
        header,
        row(1, 'Translated'),
        row(2, 'by', { conf: 80 }),
        row(1, 'Nell', { par: 2, left: 5, top: 50 }),
      ].join('\r\n'),
      200,
      300,
    )
    expect(result).toEqual({
      status: 'complete',
      errors: [],
      lines: [
        {
          id: 'p1_b1_p1_l1',
          text: 'Translated by',
          bbox: { x: 30, y: 20, width: 38, height: 12 },
          confidence: 80,
        },
        {
          id: 'p1_b1_p2_l1',
          text: 'Nell',
          bbox: { x: 5, y: 50, width: 18, height: 12 },
          confidence: 95,
        },
      ],
    })
  })
  it('retains valid words while malformed rows make the whole page partial', () => {
    const result = parseDocumentTsv(
      [header, row(1, 'Useful'), row(2, 'bad', { width: 300 }), 'broken'].join('\n'),
      200,
      300,
    )
    expect(result.status).toBe('partial')
    expect(result.lines[0]!.text).toBe('Useful')
    expect(result.errors).toHaveLength(2)
  })
  it.each([`${header}\n`, `${header}\n1\t1\t0\t0\t0\t0\t0\t0\t200\t300\t-1\t`])(
    'keeps header-only or layout-only OCR unresolved instead of certifying an empty page',
    (tsv) => {
      expect(parseDocumentTsv(tsv, 200, 300)).toEqual({
        status: 'failed',
        lines: [],
        errors: ['No recognized text; page requires review'],
      })
    },
  )
  it('retains failures without inventing content', () => {
    expect(parseDocumentTsv('nonsense', 200, 300).status).toBe('failed')
    expect(
      parseDocumentTsv([header, row(1, 'bad', { conf: 101 })].join('\n'), 200, 300).status,
    ).toBe('failed')
  })
  it('keeps unavailable word confidence unknown and detects duplicate positions', () => {
    const result = parseDocumentTsv(
      [header, row(1, 'One', { conf: -1 }), row(1, 'Again'), row(2, 'Two')].join('\n'),
      200,
      300,
    )
    expect(result).toMatchObject({
      status: 'partial',
      lines: [{ text: 'One Two', confidence: null }],
    })
    expect(result.errors[0]).toContain('Repeated word position')
  })
  it('rejects multiple pages, invalid dimensions and oversized files', () => {
    expect(
      parseDocumentTsv([header, row(1, 'One'), row(1, 'Two', { page: 2 })].join('\n'), 200, 300)
        .status,
    ).toBe('failed')
    expect(parseDocumentTsv(header, NaN, 300).status).toBe('failed')
    expect(parseDocumentTsv('x'.repeat(4_000_001), 200, 300).status).toBe('failed')
  })
})
