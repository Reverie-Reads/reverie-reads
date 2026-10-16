import { describe, expect, it } from 'vitest'
import { buildIntakeReview, compareIntakeCredits, intakeReviewDiagnostics } from './intakeReview'
import { adaptHardcoverIntake, adaptOpenLibraryIntake } from './intakeSourceAdapters'
import { parseIntakeEvidence } from './intakeEvidenceValidation'
import type { IntakeCredit, IntakeEvidenceRequest } from './intakeEvidence'

const credit = (name: string, role: IntakeCredit['role'] = 'author'): IntakeCredit => ({
  name,
  role,
  scope: 'whole',
})
const fp = 'a'.repeat(64),
  isbn = '9780306406157',
  at = '2026-10-16T12:00:00Z'
const packet = (): IntakeEvidenceRequest => ({
  version: 1,
  targetFingerprint: fp,
  asOf: at,
  target: { title: 'Quiet Gardens', contributors: ['Jane Smith'], isbn },
  existing: { pages: 300 },
  observations: [
    {
      id: 'one',
      targetFingerprint: fp,
      status: 'ok',
      source: {
        provider: 'synthetic',
        recordId: 'one',
        url: 'https://publisher.example/book',
        retrievedAt: at,
        kind: 'publisher',
        usage: 'eligible',
        method: 'inspected',
        lineage: 'publisher.example',
      },
      identity: {
        title: 'Quiet Gardens',
        contributors: [credit('Jane Smith')],
        scope: 'edition',
        isbns: [isbn],
      },
      claims: [
        { id: 'pages', field: 'pages', value: 240, scope: 'edition', locator: 'edition details' },
      ],
    },
  ],
})

describe('intake evidence review', () => {
  it('keeps existing values, contradictory evidence, source locator and reasons side by side without changing input', () => {
    const p = packet(),
      before = structuredClone(p),
      r = buildIntakeReview(p)
    expect(r.current.pages).toBe(300)
    expect(r.sources[0]?.claims[0]).toMatchObject({
      value: 240,
      current: 300,
      locator: 'edition details',
    })
    expect(r.fields.find((f) => f.field === 'pages')).toMatchObject({
      state: 'review',
      reasons: ['field_conflict', 'existing_value'],
    })
    r.sources[0]!.identity!.title = 'Changed view'
    expect(p).toEqual(before)
  })
  it.each([
    ['Smith, Jane', 'author', 'whole', 'formatting'],
    ['Jane Smith', 'unknown', 'whole', 'unknown_role'],
    ['Jane Smith', 'narrator', 'whole', 'secondary_role_only'],
    ['Jane Smith', 'author', 'part', 'part_only'],
    ['Janet Smith', 'author', 'whole', 'mismatch'],
  ] as const)('explains %s/%s/%s without relaxing identity', (name, role, scope, status) => {
    const p = packet()
    p.observations[0]!.identity!.contributors = [
      { name, role, scope, ...(scope === 'part' ? { part: 'One story' } : {}) },
    ]
    const r = buildIntakeReview(p)
    expect(r.sources[0]?.identityCheck.contributors).toEqual([status])
    expect(r.work.state).toBe(status === 'formatting' ? 'resolved' : 'review')
  })
  it('does not expand initials or accept an exact ISBN as complete identity', () => {
    const p = packet()
    p.target.contributors = ['J. Smith']
    expect(buildIntakeReview(p).sources[0]?.identityCheck.contributors).toEqual(['ambiguous'])
    p.target.contributors = ['Wrong Author']
    expect(buildIntakeReview(p).sources[0]?.identityCheck).toMatchObject({
      isbn: 'exact',
      contributors: ['mismatch'],
    })
    expect(buildIntakeReview(p).work.state).toBe('review')
  })
  it('blocks parent-work credits from becoming edition facts even with qualified source policy', () => {
    const p = packet(),
      o = p.observations[0]!
    o.identity!.contributors = [{ ...credit('Jane Smith'), basis: 'work', sourceRole: 'author' }]
    o.claims.push({
      id: 'credits',
      field: 'contributors',
      value: o.identity!.contributors,
      scope: 'edition',
      locator: 'parent book credits',
    })
    const r = buildIntakeReview(p)
    expect(r.sources[0]?.claims[1]?.decision.reasons).toContain('credit_scope_unverified')
    expect(r.fields.find((f) => f.field === 'contributors')?.state).toBe('review')
  })
  it('retains multiple roles, named-part credits and unsupported storage roles in source order', () => {
    const p = packet()
    p.observations[0]!.identity!.contributors.push(
      credit('Ann Brown', 'translator'),
      credit('Ann Brown', 'introduction'),
      { ...credit('Chris Pine'), scope: 'part', part: 'A story' },
    )
    const r = buildIntakeReview(p)
    expect(r.sources[0]?.credits.map((c) => [c.position, c.role, c.storage])).toEqual([
      [0, 'author', 'requires_review'],
      [1, 'translator', 'requires_review'],
      [2, 'introduction', 'requires_lossless_storage'],
      [3, 'author', 'requires_lossless_storage'],
    ])
    expect(r.sources[0]?.credits.every((c) => c.completeness === 'unverified')).toBe(true)
  })
  it('rejects private fields and invalid credit provenance without silently dropping them', () => {
    expect(() => buildIntakeReview({ ...packet(), notes: 'personal' })).toThrow()
    const p = packet()
    Object.assign(p.observations[0]!.identity!.contributors[0]!, { basis: 'verified' })
    expect(() => parseIntakeEvidence(p)).toThrow()
  })
  it('projects codes and counts without retaining provider literals', () => {
    const p = packet()
    p.observations[0]!.creditStatements = ['Secret source credit wording']
    const r = intakeReviewDiagnostics(p)
    expect(r[0]?.credits.unparsedStatements).toBe(1)
    for (const literal of [
      'Jane Smith',
      'Quiet Gardens',
      'publisher.example',
      'Secret source',
      isbn,
      '240',
    ])
      expect(JSON.stringify(r)).not.toContain(literal)
  })
})

describe('source credit fidelity', () => {
  it.each([null, '', ' Reteller ', ' Translator '])(
    'keeps the literal %j while never guessing an unknown role',
    (label) => {
      const r = adaptHardcoverIntake(
        {
          data: {
            editions: [
              {
                id: 1,
                title: 'Quiet Gardens',
                compilation: false,
                isbn_13: isbn,
                book: {
                  id: 2,
                  title: 'Quiet Gardens',
                  contributions: [{ author: { name: 'Jane Smith' }, contribution: label }],
                },
              },
            ],
          },
        },
        { targetFingerprint: fp, retrievedAt: at },
      )
      expect(r.observations[0]?.identity?.contributors[0]).toMatchObject({
        sourceRole: label,
        basis: 'work',
        role: label === ' Translator ' ? 'translator' : 'unknown',
      })
      expect(() => parseIntakeEvidence({ ...packet(), observations: r.observations })).not.toThrow()
    },
  )
  it('keeps Open Library free-text contributions unparsed rather than inventing roles', () => {
    const r = adaptOpenLibraryIntake(
      {
        key: '/books/OL1M',
        title: 'Quiet Gardens',
        isbn_13: [isbn],
        authors: [{ key: '/authors/OL1A' }],
        contributions: ['Brown, Ann, translator?'],
      },
      { '/authors/OL1A': { key: '/authors/OL1A', name: 'Jane Smith' } },
      { targetFingerprint: fp, retrievedAt: at },
    )
    expect(r.observations[0]?.creditStatements).toEqual(['Brown, Ann, translator?'])
    expect(r.observations[0]?.identity?.contributors).toHaveLength(1)
    expect(r.issues).toContain('unparsed_credit_statements')
  })
  it('scores names, roles, part scope and edition basis separately', () => {
    const wanted = [credit('Jane Smith'), credit('Ann Brown', 'translator')]
    expect(
      compareIntakeCredits(wanted, [
        { ...credit('Smith, Jane'), basis: 'edition' },
        { ...credit('Ann Brown', 'translator'), basis: 'work' },
      ]),
    ).toEqual(['edition_observed', 'scope_unverified'])
    expect(
      compareIntakeCredits(wanted, [
        credit('Jane Smith', 'editor'),
        credit('Ann Brown', 'unknown'),
      ]),
    ).toEqual(['role_or_part_conflict', 'unknown_role'])
    expect(compareIntakeCredits(wanted, [credit('J. Smith')])).toEqual(['missing', 'missing'])
  })
})
