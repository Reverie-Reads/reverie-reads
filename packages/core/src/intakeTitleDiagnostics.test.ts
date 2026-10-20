import { describe, expect, it } from 'vitest'
import type { IntakeEvidenceRequest } from './intakeEvidence'
import { intakeIdentityDiagnostics, resolveIntakeEvidence } from './intakeResolver'
import { buildIntakeReview, intakeReviewDiagnostics } from './intakeReview'

const isbn = '9780306406157'
const packet = (): IntakeEvidenceRequest => ({
  version: 1,
  targetFingerprint: 'a'.repeat(64),
  asOf: '2026-10-20T12:00:00Z',
  target: { title: 'Quiet Gardens', contributors: ['Jane Smith'], isbn },
  existing: { pages: 300 },
  observations: [
    {
      id: 'synthetic',
      targetFingerprint: 'a'.repeat(64),
      status: 'ok',
      source: {
        provider: 'synthetic',
        recordId: 'synthetic',
        url: 'https://publisher.example/book',
        retrievedAt: '2026-10-20T12:00:00Z',
        kind: 'publisher',
        usage: 'eligible',
        method: 'inspected',
        lineage: 'publisher.example',
      },
      identity: {
        title: 'Quiet Gardens',
        contributors: [{ name: 'Jane Smith', role: 'author', scope: 'whole' }],
        scope: 'edition',
        isbns: [isbn],
      },
      claims: [
        { id: 'pages', field: 'pages', value: 240, scope: 'edition', locator: 'Edition details' },
      ],
    },
  ],
})
const check = (p: IntakeEvidenceRequest) => intakeIdentityDiagnostics(p, p.observations[0]!)

describe('title diagnostics are separate from joint identity admission', () => {
  it.each([
    ['Quiet Gardens.', 'normalized'],
    ['Quiet Gardens: A Novel', 'edition_formatting'],
  ])('reports the accepted title variant %s without a false mismatch', (observed, detail) => {
    const p = packet()
    p.observations[0]!.identity!.title = observed
    const before = structuredClone(p)
    expect(resolveIntakeEvidence(p).work.state).toBe('resolved')
    expect(check(p)).toMatchObject({ title: 'formatting', titleDetail: detail, reasons: [] })
    expect(buildIntakeReview(p).current).toEqual({ pages: 300 })
    expect(p).toEqual(before)
  })

  it('reports ampersand formatting without altering the exact edition/full creator guard', () => {
    const p = packet()
    p.target.title = 'Quiet Gardens and Rivers'
    p.observations[0]!.identity!.title = 'Quiet Gardens & Rivers'
    expect(resolveIntakeEvidence(p).work.state).toBe('resolved')
    expect(check(p)).toMatchObject({ title: 'formatting', titleDetail: 'edition_formatting' })
    p.target.contributors = ['J. Smith']
    expect(check(p)).toMatchObject({
      title: 'mismatch',
      titleDetail: 'unconfirmed_edition_formatting',
      contributors: ['ambiguous'],
    })
    expect(resolveIntakeEvidence(p).work.state).toBe('review')
  })

  it('compares work punctuation and declared subtitles without requiring an edition ISBN', () => {
    const p = packet()
    delete p.target.isbn
    p.observations[0]!.identity!.scope = 'work'
    p.target.title = 'Quiet Gardens.'
    expect(resolveIntakeEvidence(p).work.state).toBe('resolved')
    expect(check(p)).toMatchObject({ title: 'formatting', titleDetail: 'normalized' })
    p.target.title = 'Quiet Gardens: Through the Seasons'
    p.observations[0]!.identity!.subtitle = 'Through the Seasons'
    expect(resolveIntakeEvidence(p).work.state).toBe('resolved')
    expect(check(p)).toMatchObject({ title: 'formatting', titleDetail: 'declared_subtitle' })
  })

  it.each(['isbn', 'contributors'] as const)(
    'does not blame a normalized title for a conflicting %s',
    (axis) => {
      const p = packet()
      p.target.title = 'Quiet Gardens.'
      if (axis === 'isbn') p.target.isbn = '9781649374042'
      else p.target.contributors = ['Wrong Author']
      expect(check(p)).toMatchObject({ title: 'formatting', titleDetail: 'normalized' })
      expect(check(p)[axis]).toEqual(axis === 'isbn' ? 'conflict' : ['mismatch'])
      expect(resolveIntakeEvidence(p).work.state).toBe('review')
      expect(resolveIntakeEvidence(p).fields.every((f) => f.proposed === undefined)).toBe(true)
    },
  )

  it.each([
    ['Quiet Gardens Volume Two', 'additional_words'],
    ['Quiet Gardens: A Revised Novel', 'additional_words'],
    ['Another Book', 'different_words'],
    ['Quiet Gardens and Other Stories', 'additional_words'],
  ])('keeps %s held and records only the structural difference', (observed, detail) => {
    const p = packet()
    p.observations[0]!.identity!.title = observed
    expect(check(p)).toMatchObject({ title: 'mismatch', titleDetail: detail })
    expect(resolveIntakeEvidence(p).work.state).toBe('review')
  })

  it('does not erase identity-bearing non-Latin marks in diagnostics', () => {
    const p = packet()
    p.target.title = 'दिन'
    p.observations[0]!.identity!.title = 'दीन'
    expect(check(p)).toMatchObject({ title: 'mismatch', titleDetail: 'significant_marks' })
    expect(resolveIntakeEvidence(p).work.state).toBe('review')
  })

  it.each(['missing_isbn', 'invalid_isbn', 'work_scope', 'mixed_isbns', 'no_creator'] as const)(
    'keeps edition-only formatting unconfirmed with %s',
    (condition) => {
      const p = packet()
      p.observations[0]!.identity!.title += ': A Novel'
      if (condition === 'missing_isbn') delete p.target.isbn
      if (condition === 'invalid_isbn') p.target.isbn = '9780306406158'
      if (condition === 'work_scope') p.observations[0]!.identity!.scope = 'work'
      if (condition === 'mixed_isbns') p.observations[0]!.identity!.isbns.push('9781649374042')
      if (condition === 'no_creator') delete p.target.contributors
      expect(check(p)).toMatchObject({
        title: 'mismatch',
        titleDetail: 'unconfirmed_edition_formatting',
      })
      expect(resolveIntakeEvidence(p).work.state).not.toBe('resolved')
    },
  )

  it('retains responsibility, source-use and edition holds even when the title formats agree', () => {
    const p = packet()
    p.observations[0]!.identity!.title += ': A Novel'
    p.observations[0]!.responsibilityStatement = 'Edited by Jane Smith'
    p.observations[0]!.source.usage = 'review_only'
    expect(check(p)).toMatchObject({ title: 'formatting', reasons: ['responsibility_unreviewed'] })
    const r = resolveIntakeEvidence(p)
    expect(r.work.state).toBe('review')
    expect(r.observations[0]?.reasons).toEqual(
      expect.arrayContaining(['review_only_source', 'responsibility_unreviewed']),
    )
    expect(r.fields.every((f) => f.proposed === undefined)).toBe(true)
  })

  it('keeps missing and unrequested titles distinct without persisting observed text', () => {
    const p = packet()
    expect(check(p)).toMatchObject({ title: 'exact', titleDetail: 'literal' })
    delete p.target.title
    expect(check(p)).toMatchObject({ title: 'not_requested', titleDetail: 'not_requested' })
    p.target.title = 'Quiet Gardens'
    delete p.observations[0]!.identity
    p.observations[0]!.claims = []
    p.observations[0]!.status = 'failed'
    expect(check(p)).toMatchObject({ title: 'missing', titleDetail: 'not_observed' })
    const diagnostic = JSON.stringify(intakeReviewDiagnostics(packet()))
    for (const literal of ['Quiet Gardens', 'Jane Smith', isbn, 'publisher.example', '240', '300'])
      expect(diagnostic).not.toContain(literal)
  })
})
