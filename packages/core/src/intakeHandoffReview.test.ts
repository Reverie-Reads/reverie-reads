import { describe, expect, it } from 'vitest'
import { buildIntakeReview, intakeReviewDiagnostics } from './intakeReview'
import type { IntakeEvidenceRequest } from './intakeEvidence'

const packet = (): IntakeEvidenceRequest => ({
  version: 1,
  targetFingerprint: 'a'.repeat(64),
  asOf: '2026-10-18T12:00:00.000Z',
  target: { title: 'Quiet Gardens', contributors: ['Jane Smith'], isbn: '9780306406157' },
  existing: { pages: 300 },
  observations: [
    {
      id: 'one',
      targetFingerprint: 'a'.repeat(64),
      status: 'ok',
      source: {
        provider: 'penguin_random_house',
        recordId: 'one',
        url: 'https://publisher.example/book',
        retrievedAt: '2026-10-18T12:00:00.000Z',
        lineage: 'publisher.example',
        kind: 'publisher',
        usage: 'eligible',
        method: 'inspected',
      },
      identity: {
        title: 'Quiet Gardens',
        scope: 'edition',
        isbns: ['9780306406157'],
        contributors: [
          {
            name: 'Jane Smith',
            role: 'author',
            scope: 'whole',
            basis: 'edition',
            sourceRole: 'Author',
          },
        ],
      },
      claims: [
        { id: 'pages', field: 'pages', value: 240, scope: 'edition', locator: 'Edition details' },
        {
          id: 'publisher',
          field: 'publisher',
          value: 'Quiet Press',
          scope: 'edition',
          locator: 'Edition details',
        },
      ],
    },
  ],
})

describe('transient source-qualified handoff preview', () => {
  it('cannot turn a packet eligibility assertion into source-use permission', () => {
    const review = buildIntakeReview(packet())
    // The offline resolver may score an eligible synthetic/inspected packet. The actual-use
    // preview independently consults code-owned source findings and cannot become a save payload.
    expect(review.fields.find((f) => f.field === 'publisher')?.state).toBe('proposed')
    const field = review.handoff.fields.find((f) => f.field === 'publisher')!
    expect(field.disposition).toBe('review_required')
    expect(field.evidence[0]?.uses.every((u) => u.state === 'review_required')).toBe(true)
    expect(field.evidence[0]?.uses[0]?.blockers).toContain('source_review_only')
    expect(review.handoff).toMatchObject({
      mode: 'review_only',
      targetFingerprint: 'a'.repeat(64),
      targetRecheck: 'required_before_prepare',
    })
    for (const literal of [
      'Quiet Gardens',
      'Jane Smith',
      'Quiet Press',
      '9780306406157',
      'publisher.example',
    ])
      expect(JSON.stringify(review.handoff)).not.toContain(literal)
    expect(review.handoff).not.toHaveProperty('patch')
  })

  it('preserves a conflicting existing value, distinguishes missing observations and changes no input', () => {
    const input = packet(),
      before = structuredClone(input)
    const review = buildIntakeReview(input)
    expect(review.handoff.fields.find((f) => f.field === 'pages')).toMatchObject({
      disposition: 'preserve_current',
      reasons: expect.arrayContaining(['field_conflict', 'existing_value']),
    })
    expect(review.handoff.fields.find((f) => f.field === 'description')).toMatchObject({
      disposition: 'no_observation',
      evidence: [],
    })
    review.handoff.fields[0]!.reasons.length = 0
    expect(input).toEqual(before)
    expect(review.current.pages).toBe(300)
  })

  it.each([
    'identity_mismatch',
    'ambiguous_name',
    'target_changed',
    'stale_evidence',
    'model_proposal',
  ] as const)('keeps %s visible alongside source-use holds', (reason) => {
    const input = packet(),
      o = input.observations[0]!
    if (reason === 'identity_mismatch') input.target.contributors = ['Wrong Person']
    if (reason === 'ambiguous_name') input.target.contributors = ['J. Smith']
    if (reason === 'target_changed') o.targetFingerprint = 'b'.repeat(64)
    if (reason === 'stale_evidence') o.source.retrievedAt = '2026-08-01T12:00:00.000Z'
    if (reason === 'model_proposal') o.source.method = 'model_proposal'
    const evidence = buildIntakeReview(input).handoff.fields.find((f) => f.field === 'publisher')!
      .evidence[0]!
    expect(evidence.evidenceReasons).toContain(reason)
    expect(evidence.uses[0]?.blockers).toContain('source_review_only')
  })

  it('retains per-source disagreement and distinguishes unknown from reported upstream lineage', () => {
    const input = packet(),
      other = structuredClone(input.observations[0]!)
    other.id = 'two'
    other.source.provider = 'hardcover'
    other.source.lineage = null
    other.claims[1] = {
      id: 'publisher',
      field: 'publisher',
      value: 'Other Press',
      scope: 'edition',
      locator: 'Other record',
    }
    input.observations.push(other)
    const review = buildIntakeReview(input),
      field = review.handoff.fields.find((f) => f.field === 'publisher')!
    expect(field.reasons).toContain('field_conflict')
    expect(field.evidence.map((e) => e.upstreamLineage)).toEqual(['reported_only', 'unverified'])
    expect(field.evidence.map((e) => e.observationId)).toEqual(['one', 'two'])
    expect(review.sources[0]?.claims[1]?.value).toBe('Quiet Press')
    expect(review.sources[1]?.claims[1]?.value).toBe('Other Press')
    for (const literal of ['Quiet Press', 'Other Press', 'publisher.example'])
      expect(JSON.stringify(intakeReviewDiagnostics(input))).not.toContain(literal)
  })

  it.each(['empty', 'failed', 'capped'] as const)(
    'keeps a source %s outcome distinct from missing fields',
    (status) => {
      const input = packet()
      input.observations[0]!.status = status
      input.observations[0]!.claims = []
      delete input.observations[0]!.identity
      const review = buildIntakeReview(input)
      expect(review.sources[0]?.status).toBe(status)
      expect(review.handoff.fields.every((f) => !f.evidence.length)).toBe(true)
      expect(review.handoff.fields.find((f) => f.field === 'pages')?.disposition).toBe(
        'preserve_current',
      )
    },
  )

  it('requires an exact selected edition even when ISBNs match another book', () => {
    const input = packet()
    input.target.title = 'Different Book'
    const review = buildIntakeReview(input)
    expect(review.sources[0]?.identityCheck.isbn).toBe('exact')
    expect(
      review.handoff.fields.find((f) => f.field === 'publisher')?.evidence[0]?.evidenceReasons,
    ).toContain('identity_mismatch')
  })
})
