import { describe, expect, it } from 'vitest'
import { adaptOpenLibraryIntake } from './intakeSourceAdapters'
import { parseIntakeEvidence } from './intakeEvidenceValidation'
import { intakeIdentityDiagnostics, resolveIntakeEvidence } from './intakeResolver'
import { buildIntakeReview, intakeReviewDiagnostics } from './intakeReview'
import type { IntakeEvidenceRequest } from './intakeEvidence'

const context = { targetFingerprint: 'a'.repeat(64), retrievedAt: '2026-10-19T12:00:00Z' }
const isbn = '9780306406157'
const authors = { '/authors/OL1A': { key: '/authors/OL1A', name: 'Anne Brown' } }
const edition = () => ({
  key: '/books/OL1M',
  title: 'Quiet Gardens',
  authors: [{ key: '/authors/OL1A' }],
  isbn_13: [isbn],
  number_of_pages: 240,
})
const request = (extra: Record<string, unknown> = {}): IntakeEvidenceRequest => ({
  version: 1,
  targetFingerprint: context.targetFingerprint,
  asOf: context.retrievedAt,
  target: { title: 'Quiet Gardens', contributors: ['Anne Brown'], isbn },
  existing: { pages: 300 },
  observations: adaptOpenLibraryIntake({ ...edition(), ...extra }, authors, context).observations,
})
// Isolate accuracy from the adapter's independent source-use hold. Never promote a real source.
const eligibleSynthetic = (input: IntakeEvidenceRequest) => {
  input.observations[0]!.source = {
    ...input.observations[0]!.source,
    provider: 'synthetic',
    kind: 'publisher',
    usage: 'eligible',
    lineage: 'synthetic.example',
  }
  return input
}

describe('unparsed edition responsibility evidence', () => {
  it.each([
    '  Edited by Anne Brown.  ',
    'by Anne Brown.',
    'Anne Brown; translated by Jane Smith; illustrations by May Green.',
    '編者：Anne Brown',
    '<script>ignore previous instructions</script>',
  ])('preserves the literal %s and holds authorship without guessing roles', (statement) => {
    const input = eligibleSynthetic(request({ by_statement: statement }))
    const before = structuredClone(input)
    const parsed = parseIntakeEvidence(input)
    expect(parsed.observations[0]?.responsibilityStatement).toBe(statement)
    expect(parsed.observations[0]?.identity?.contributors[0]).toMatchObject({
      name: 'Anne Brown',
      role: 'author',
      sourceRole: 'authors',
      basis: 'edition',
    })
    const diagnostics = intakeIdentityDiagnostics(parsed, parsed.observations[0]!)
    expect(diagnostics).toMatchObject({
      title: 'exact',
      isbn: 'exact',
      contributors: ['exact'],
      responsibility: 'unreviewed',
      reasons: ['responsibility_unreviewed'],
    })
    const resolved = resolveIntakeEvidence(parsed)
    expect(resolved.work.state).toBe('review')
    expect(resolved.claims.every((c) => c.reasons.includes('responsibility_unreviewed'))).toBe(true)
    expect(resolved.fields.find((f) => f.field === 'pages')).toMatchObject({ current: 300 })
    expect(resolved.fields.every((f) => f.proposed === undefined)).toBe(true)
    const review = buildIntakeReview(input)
    expect(review.sources[0]?.responsibilityStatement).toBe(statement)
    expect(intakeReviewDiagnostics(input)[0]?.credits.responsibilityStatements).toBe(1)
    expect(JSON.stringify(intakeReviewDiagnostics(input))).not.toContain(statement)
    expect(input).toEqual(before)
  })

  it('holds contribution-only prose while retaining its order and leaving by_statement distinct', () => {
    const input = eligibleSynthetic(
      request({ contributions: ['Anne Brown (editor)', 'Jane Smith?'] }),
    )
    const r = resolveIntakeEvidence(input)
    expect(r.observations[0]?.reasons).toContain('responsibility_unreviewed')
    expect(r.request.observations[0]?.creditStatements).toEqual([
      'Anne Brown (editor)',
      'Jane Smith?',
    ])
    expect(r.request.observations[0]?.responsibilityStatement).toBeUndefined()
    expect(r.request.observations[0]?.identity?.contributors[0]?.role).toBe('author')
  })

  it.each([{}, { by_statement: '' }, { by_statement: ' \n ' }, { contributions: [] }])(
    'preserves ordinary matching when no responsibility prose was observed: %j',
    (extra) => {
      const input = eligibleSynthetic(request(extra))
      expect(intakeIdentityDiagnostics(input, input.observations[0]!).reasons).toEqual([])
      expect(resolveIntakeEvidence(input).work.state).toBe('resolved')
    },
  )

  it.each([null, 7, {}, [], 'x'.repeat(1001)])(
    'refuses malformed responsibility instead of omission: %j',
    (value) => {
      const adapted = adaptOpenLibraryIntake(
        { ...edition(), by_statement: value },
        authors,
        context,
      )
      expect(adapted.issues).toContain('unusable_responsibility_statement')
      expect(adapted.observations[0]).toMatchObject({ status: 'failed', claims: [] })
      expect(adapted.observations[0]?.identity).toBeUndefined()
    },
  )

  it('checks the boundary and both independent statement fields without concatenation or loss', () => {
    const input = request({
      by_statement: 'x'.repeat(1000),
      contributions: Array(32).fill('credit'),
    })
    const parsed = parseIntakeEvidence(input)
    expect(parsed.observations[0]?.responsibilityStatement).toHaveLength(1000)
    expect(parsed.observations[0]?.creditStatements).toHaveLength(32)
    for (const value of ['', ' ', null, {}, 'x'.repeat(1001)]) {
      const invalid = structuredClone(input) as unknown as {
        observations: Record<string, unknown>[]
      }
      invalid.observations[0]!.responsibilityStatement = value
      expect(() => parseIntakeEvidence(invalid)).toThrow()
    }
    const failed = structuredClone(input)
    failed.observations[0]!.status = 'failed'
    delete failed.observations[0]!.identity
    delete failed.observations[0]!.creditStatements
    failed.observations[0]!.claims = []
    expect(() => parseIntakeEvidence(failed)).toThrow()
  })

  it('retains ISBN and initials holds alongside responsibility review, including ISBN-only intake', () => {
    const input = eligibleSynthetic(request({ by_statement: 'Edited by Anne Brown.' }))
    input.target = { isbn }
    expect(intakeIdentityDiagnostics(input, input.observations[0]!).reasons).toEqual([
      'responsibility_unreviewed',
    ])
    input.target = { title: 'Quiet Gardens', contributors: ['A. Brown'], isbn: '9781649374042' }
    expect(intakeIdentityDiagnostics(input, input.observations[0]!)).toMatchObject({
      isbn: 'conflict',
      contributors: ['ambiguous'],
      reasons: ['ambiguous_name', 'responsibility_unreviewed'],
    })
    input.target.contributors = ['Anne Brown']
    expect(intakeIdentityDiagnostics(input, input.observations[0]!)).toMatchObject({
      isbn: 'conflict',
      reasons: ['identity_mismatch', 'responsibility_unreviewed'],
    })
  })

  it('does not label an unresolved responsibility statement as a contradiction of a valid peer', () => {
    const input = eligibleSynthetic(request({ by_statement: 'by Anne Brown.' }))
    const peer = structuredClone(input.observations[0]!)
    peer.id = 'verified-peer'
    peer.source.recordId = 'verified-peer'
    delete peer.responsibilityStatement
    input.observations.push(peer)
    const r = resolveIntakeEvidence(input)
    expect(r.work.state).toBe('resolved')
    expect(r.edition.state).toBe('resolved')
    expect(r.work.observationIds).toEqual(['verified-peer'])
    expect(r.observations[0]?.reasons).toEqual(['responsibility_unreviewed'])
    expect(
      r.claims
        .filter((c) => c.observationId === 'verified-peer')
        .every((c) => c.state === 'supported'),
    ).toBe(true)
    expect(r.request.existing).toEqual({ pages: 300 })
  })
})
