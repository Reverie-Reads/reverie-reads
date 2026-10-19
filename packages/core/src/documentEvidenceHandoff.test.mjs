import { describe, expect, it } from 'vitest'
import {
  buildDocumentEvidenceHandoff,
  documentEvidenceFingerprint,
} from '../../../scripts/document-evidence-handoff.mjs'

const at = '2026-10-19T12:00:00.000Z'
const fingerprint = 'a'.repeat(64)
const imageHash = 'b'.repeat(64)
const box = { x: 10, y: 20, width: 400, height: 30 }

function fixture(statements = ['Quiet Gardens', 'By Jane Smith', 'ISBN 9780306406157']) {
  const lines = statements.map((text, i) => ({
    id: `line-${i + 1}`,
    text,
    bbox: { ...box, y: 20 + 40 * i },
    confidence: 99,
  }))
  const packet = {
    version: 1,
    mode: 'review_only',
    targetFingerprint: fingerprint,
    source: {
      url: 'https://publisher.example/title-page',
      retrievedAt: '2026-10-19T11:00:00.000Z',
      label: 'Synthetic printed edition',
      permissions: { localReview: true, catalogStorage: false, modelInput: false, export: false },
      permissionBasis: 'Synthetic fixture, local review only',
    },
    pages: [
      {
        id: 'page-1',
        label: 'Title and copyright page',
        imageSha256: imageHash,
        width: 800,
        height: 1200,
        method: 'ocr_sidecar',
        status: 'complete',
        lines,
      },
    ],
    corrections: lines.map((l, i) => ({
      id: `confirm-${i + 1}`,
      pageId: 'page-1',
      lineId: l.id,
      imageSha256: imageHash,
      previousText: l.text,
      text: l.text,
      bbox: l.bbox,
      reason: 'Operator inspected the rendered line',
      reviewedAt: at,
    })),
  }
  const quote = (index) => ({
    pageId: 'page-1',
    lineIds: [`line-${index + 1}`],
    text: statements[index],
  })
  const selection = {
    version: 1,
    documentFingerprint: documentEvidenceFingerprint(packet),
    targetFingerprint: fingerprint,
    identity: {
      title: quote(0),
      contributors: [
        { name: 'Jane Smith', role: 'author', scope: 'whole', basis: 'edition', quote: quote(1) },
      ],
      isbns: [quote(2)],
    },
  }
  const context = {
    targetFingerprint: fingerprint,
    asOf: at,
    target: { title: 'Quiet Gardens', contributors: ['Jane Smith'], isbn: '9780306406157' },
    existing: { pages: 400, description: 'Existing verified description' },
  }
  return { packet, selection, context }
}
const refresh = (f) => {
  f.selection.documentFingerprint = documentEvidenceFingerprint(f.packet)
  return f
}
const handoff = (f) => buildDocumentEvidenceHandoff(f.packet, f.selection, f.context)

describe('document evidence handoff', () => {
  it('keeps a literal reviewed identity unverified, review-only and unable to propose catalog fields', () => {
    const f = fixture()
    f.packet.source.permissions = {
      localReview: true,
      catalogStorage: true,
      modelInput: true,
      export: true,
    }
    refresh(f)
    const out = handoff(f)
    expect(out.request.observations[0].source).toMatchObject({
      kind: 'unverified',
      usage: 'review_only',
      method: 'inspected',
      lineage: null,
    })
    expect(out.resolution.work.state).toBe('review')
    expect(out.resolution.edition.state).toBe('review')
    expect(out.resolution.fields.some((field) => field.state === 'proposed')).toBe(false)
    expect(out.resolution.claims.every((claim) => claim.state === 'review')).toBe(true)
    expect(out.request.existing).toEqual(f.context.existing)
    expect(out.effectiveUse).toEqual({
      localReview: true,
      catalogStorage: false,
      modelInput: false,
      export: false,
    })
    expect(out.review.sources[0].qualification.usage).toBe('review_only')
  })

  it('retains image hashes, rectangles, raw transcription and correction history in a detached frozen snapshot', () => {
    const f = fixture()
    f.packet.pages[0].lines[0].text = 'Quiet Gardeus'
    f.packet.corrections[0].previousText = 'Quiet Gardeus'
    refresh(f)
    const out = handoff(f)
    expect(out.citations[0]).toMatchObject({
      id: 'title',
      imageSha256: imageHash,
      width: 800,
      height: 1200,
      lines: [
        {
          text: 'Quiet Gardens',
          rawText: 'Quiet Gardeus',
          bbox: box,
          correctionIds: ['confirm-1'],
        },
      ],
    })
    expect(out.citations[0].corrections[0].previousText).toBe('Quiet Gardeus')
    expect(out.request.observations[0].claims[0].locator).toContain(out.documentFingerprint)
    f.selection.identity.title.text = 'Changed after review'
    f.packet.corrections[0].text = 'Changed after review'
    f.context.existing.pages = 999
    expect(out.selection.identity.title.text).toBe('Quiet Gardens')
    expect(out.document.corrections[0].text).toBe('Quiet Gardens')
    expect(out.request.existing.pages).toBe(400)
    expect(Object.isFrozen(out.citations[0].lines[0].bbox)).toBe(true)
  })

  it('hashes object-key order canonically but binds every permission and correction change', () => {
    const f = fixture()
    const reordered = Object.fromEntries(Object.entries(f.packet).reverse())
    expect(documentEvidenceFingerprint(reordered)).toBe(documentEvidenceFingerprint(f.packet))
    f.packet.source.permissions.export = true
    expect(() => handoff(f)).toThrow(/stale document/)
    refresh(f)
    f.packet.corrections[0].reason = 'A different review'
    expect(() => handoff(f)).toThrow(/stale document/)
  })

  it('requires matching packet, selection and target revisions', () => {
    const f = fixture()
    f.context.targetFingerprint = 'c'.repeat(64)
    expect(() => handoff(f)).toThrow(/stale document or target/)
  })

  it.each(['ocr_sidecar', 'manual_transcription'])(
    'never treats unconfirmed %s lines as inspected evidence',
    (method) => {
      const f = fixture()
      f.packet.pages[0].method = method
      f.packet.corrections = []
      refresh(f)
      expect(() => handoff(f)).toThrow(/confirmed effective lines/)
    },
  )

  it.each(['partial', 'failed'])(
    'refuses selections from a %s page even when its lines have confirmations',
    (status) => {
      const f = fixture()
      f.packet.pages[0].status = status
      refresh(f)
      expect(() => handoff(f)).toThrow(/selected page is incomplete/)
    },
  )

  it('retains an unselected failed page and an explicit document-incomplete hold', () => {
    const f = fixture()
    f.packet.pages.push({
      ...f.packet.pages[0],
      id: 'failed-page',
      status: 'failed',
      lines: [],
      errors: ['OCR failed'],
    })
    refresh(f)
    const out = handoff(f)
    expect(out.holds).toContain('document_incomplete')
    expect(out.document.pages[1].errors).toEqual(['OCR failed'])
    expect(out.resolution.fields.some((field) => field.state === 'proposed')).toBe(false)
  })

  it('requires local review permission and rejects missing permission declarations', () => {
    const f = fixture()
    f.packet.source.permissions.localReview = false
    refresh(f)
    expect(() => handoff(f)).toThrow(/local review permission/)
    delete f.packet.source.permissions.localReview
    expect(() => handoff(f)).toThrow(/invalid document/)
  })

  it('refuses stale correction chains, changed image hashes and future review timestamps', () => {
    const f = fixture()
    f.packet.corrections[0].previousText = 'Stale value'
    expect(() => handoff(f)).toThrow(/invalid document/)
    const changedImage = fixture()
    changedImage.packet.pages[0].imageSha256 = 'd'.repeat(64)
    expect(() => handoff(changedImage)).toThrow(/invalid document/)
    const future = fixture()
    future.packet.corrections[0].reviewedAt = '2026-10-20T00:00:00.000Z'
    refresh(future)
    expect(() => handoff(future)).toThrow(/later than the handoff/)
  })

  it('retains stale source evidence as a resolver hold', () => {
    const f = fixture()
    f.packet.source.retrievedAt = '2026-08-01T00:00:00.000Z'
    refresh(f)
    expect(handoff(f).resolution.observations[0].reasons).toContain('stale_evidence')
  })

  it('rejects edited quotes and noncontiguous or reordered line citations', () => {
    const f = fixture()
    f.selection.identity.title.text = 'Quiet gardens'
    expect(() => handoff(f)).toThrow(/exactly/)
    for (const ids of [
      ['line-1', 'line-3'],
      ['line-2', 'line-1'],
      ['line-1', 'line-1'],
    ]) {
      const g = fixture()
      g.selection.identity.title.lineIds = ids
      g.selection.identity.title.text = ids
        .map((id) => g.packet.pages[0].lines.find((l) => l.id === id).text)
        .join('\n')
      expect(() => handoff(g)).toThrow()
    }
  })

  it('retains contiguous multiline title text exactly, without normalizing the source quote', () => {
    const f = fixture(['Quiet', 'Gardens', 'By Jane Smith', 'ISBN 9780306406157'])
    f.selection.identity.title = {
      pageId: 'page-1',
      lineIds: ['line-1', 'line-2'],
      text: 'Quiet\nGardens',
    }
    f.selection.identity.contributors[0].quote = {
      pageId: 'page-1',
      lineIds: ['line-3'],
      text: 'By Jane Smith',
    }
    f.selection.identity.isbns = [
      { pageId: 'page-1', lineIds: ['line-4'], text: 'ISBN 9780306406157' },
    ]
    expect(handoff(f).request.observations[0].identity.title).toBe('Quiet\nGardens')
  })

  it('does not relabel an editor as author or let an editor-only record establish creator identity', () => {
    const f = fixture(['Quiet Gardens', 'Edited by Jane Smith', 'ISBN 9780306406157'])
    expect(() => handoff(f)).toThrow(/explicit literal statement/)
    f.selection.identity.contributors[0].role = 'editor'
    const out = handoff(f)
    expect(out.request.observations[0].identity.contributors[0].role).toBe('editor')
    expect(out.review.sources[0].identityCheck.reasons).toContain('identity_incomplete')
    expect(out.resolution.fields.some((field) => field.state === 'proposed')).toBe(false)
  })

  it.each([
    'Jane Smith',
    'A story about Jane Smith',
    'Not written by Jane Smith',
    'Translated by Jane Smith',
  ])('does not infer authorship from %s', (line) => {
    const f = fixture(['Quiet Gardens', line, 'ISBN 9780306406157'])
    expect(() => handoff(f)).toThrow(/explicit literal statement/)
  })

  it('keeps an explicit unknown name-only credit unknown and unqualified', () => {
    const f = fixture(['Quiet Gardens', 'Jane Smith', 'ISBN 9780306406157'])
    f.selection.identity.contributors[0].role = 'unknown'
    const out = handoff(f)
    expect(out.request.observations[0].identity.contributors[0]).toMatchObject({
      role: 'unknown',
      sourceRole: null,
    })
    expect(out.review.sources[0].identityCheck.reasons).toContain('identity_incomplete')
  })

  it('preserves separate editor and introduction roles without turning the part into whole-work authorship', () => {
    const f = fixture([
      'Quiet Gardens',
      'By Jane Smith',
      'ISBN 9780306406157',
      'Edited by Anne Jones',
      'Introduction by Anne Jones',
    ])
    f.selection.identity.contributors.push(
      {
        name: 'Anne Jones',
        role: 'editor',
        scope: 'whole',
        basis: 'edition',
        quote: { pageId: 'page-1', lineIds: ['line-4'], text: 'Edited by Anne Jones' },
      },
      {
        name: 'Anne Jones',
        role: 'introduction',
        scope: 'part',
        part: 'Introduction',
        basis: 'edition',
        quote: { pageId: 'page-1', lineIds: ['line-5'], text: 'Introduction by Anne Jones' },
      },
    )
    expect(handoff(f).request.observations[0].identity.contributors).toHaveLength(3)
    f.selection.identity.contributors[2].scope = 'whole'
    delete f.selection.identity.contributors[2].part
    expect(() => handoff(f)).toThrow(/unsupported credit scope/)
  })

  it('uses the existing ambiguous-name and exact ISBN identity guards', () => {
    const f = fixture(['Quiet Gardens', 'By J. Smith', 'ISBN 9780306406157'])
    f.selection.identity.contributors[0].name = 'J. Smith'
    expect(handoff(f).review.sources[0].identityCheck.reasons).toContain('ambiguous_name')
    const wrong = fixture(['Quiet Gardens', 'By Jane Smith', 'ISBN 9780141439518'])
    const out = handoff(wrong)
    expect(out.review.sources[0].identityCheck.isbn).toBe('conflict')
    expect(out.resolution.fields.some((field) => field.state === 'proposed')).toBe(false)
  })

  it.each([
    'ISBN 978O306406157',
    'ISBN 9780306406158',
    'Order 9780306406157',
    'ISBN-10 9780306406157',
  ])('rejects nonliteral or invalid ISBN statement %s', (line) => {
    expect(() => handoff(fixture(['Quiet Gardens', 'By Jane Smith', line]))).toThrow(/ISBN/)
  })

  it('permits only checksum-valid equivalent ISBN-10/13 citations for one selected edition', () => {
    const f = fixture([
      'Quiet Gardens',
      'By Jane Smith',
      'ISBN-13: 978-0-306-40615-7',
      'ISBN-10: 0-306-40615-2',
    ])
    f.selection.identity.isbns.push({
      pageId: 'page-1',
      lineIds: ['line-4'],
      text: 'ISBN-10: 0-306-40615-2',
    })
    expect(handoff(f).request.observations[0].identity.isbns).toEqual([
      '9780306406157',
      '0306406152',
    ])
    const different = fixture([
      'Quiet Gardens',
      'By Jane Smith',
      'ISBN 9780306406157',
      'ISBN 9780141439518',
    ])
    different.selection.identity.isbns.push({
      pageId: 'page-1',
      lineIds: ['line-4'],
      text: 'ISBN 9780141439518',
    })
    expect(() => handoff(different)).toThrow(/different editions/)
  })

  it('rejects added personal fields, supplied authority, external observations and unsupported claims', () => {
    for (const mutate of [
      (f) => {
        f.context.rating = 5
      },
      (f) => {
        f.context.existing.readHistory = []
      },
      (f) => {
        f.context.observations = []
      },
      (f) => {
        f.selection.claims = []
      },
      (f) => {
        f.selection.identity.contributors[0].sourceRole = 'By'
      },
      (f) => {
        f.packet.source.kind = 'publisher'
      },
      (f) => {
        f.selection.method = 'model_proposal'
      },
    ]) {
      const f = fixture()
      mutate(f)
      expect(() => handoff(f)).toThrow()
    }
  })
})
