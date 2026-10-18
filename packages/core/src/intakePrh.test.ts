import { describe, expect, it } from 'vitest'
import { adaptPenguinRandomHouseIntake } from './intakeSourceAdapters'
import { intakeIdentityDiagnostics, resolveIntakeEvidence } from './intakeResolver'
import { parseEditionCreditEvidence } from './editionCredits'
import { buildIntakeReview } from './intakeReview'
import { parseIntakeEvidence } from './intakeEvidenceValidation'
import type { IntakeEvidenceRequest } from './intakeEvidence'

const isbn = '9780306406157'
const context = {
  isbn,
  domain: 'PRH.US' as const,
  targetFingerprint: 'a'.repeat(64),
  retrievedAt: '2026-10-18T12:00:00Z',
}
const title = () => ({
  status: 'ok',
  data: {
    isbn: Number(isbn),
    title: 'A Quiet Library',
    pages: 240,
    onsale: '2024-02-29',
    format: { code: 'TR', description: 'Trade Paperback' },
    formatFamily: 'Paperback',
    consumerFormat: 'Paperback',
    language: 'E',
    imprint: { description: 'Example Press' },
    author: 'This display string must never establish authorship',
    earliestOnSaleDate: '1999-01-01',
    description: 'Not harvested',
    cover: 'https://example.org/cover',
    seriesNumber: 2,
  },
})
const person = (
  code: string | null = 'A',
  label: string | null = 'Author',
  name = 'Jane Smith',
  authorId = 1,
) => ({ authorId, display: name, contribRoleCode: code, contribRoleDesc: label })
const roster = (people = [person()]) => ({ status: 'ok', recordCount: people.length, data: people })
const adapt = (t = title(), r = roster(), c = context) => adaptPenguinRandomHouseIntake(t, r, c)
const request = (a = adapt()): IntakeEvidenceRequest => ({
  version: 1,
  targetFingerprint: context.targetFingerprint,
  asOf: context.retrievedAt,
  target: { isbn, title: 'A Quiet Library', contributors: ['Jane Smith'] },
  existing: {},
  observations: a.observations,
})

describe('PRH exact title and edition credits', () => {
  it('retains source order, literal code/label, partial roster and edition basis without promoting facts', () => {
    const a = adapt(title(), roster([person('T', 'Translator', 'Ann Brown', 2), person()]))
    const p = request(a),
      before = structuredClone(p)
    expect(parseIntakeEvidence(p)).toEqual(p)
    expect(intakeIdentityDiagnostics(p, p.observations[0]!)).toMatchObject({
      title: 'exact',
      isbn: 'exact',
      contributors: ['exact'],
      reasons: [],
    })
    expect(
      buildIntakeReview(p).sources[0]!.credits.map((c) => [
        c.name,
        c.role,
        c.sourceRoleCode,
        c.sourceRole,
        c.basis,
        c.completeness,
      ]),
    ).toEqual([
      ['Ann Brown', 'translator', 'T', 'Translator', 'edition', 'unverified'],
      ['Jane Smith', 'author', 'A', 'Author', 'edition', 'unverified'],
    ])
    expect(a.issues).toContain('partial_contributor_roster')
    expect(p.observations[0]!.source).toMatchObject({
      kind: 'publisher',
      usage: 'review_only',
      lineage: null,
    })
    expect(p.observations[0]!.claims.map((c) => c.field)).not.toEqual(
      expect.arrayContaining(['description', 'cover', 'series']),
    )
    expect(resolveIntakeEvidence(p).fields.some((f) => f.state === 'proposed')).toBe(false)
    expect(p).toEqual(before)
  })
  it('keeps named foreword/introduction parts and codes through explicit manual review serialization', () => {
    const a = adapt(
      title(),
      roster([
        person(),
        person('U', 'Foreword by', 'Ann Brown', 2),
        person('V', 'Introduction by', 'Ann Brown', 2),
      ]),
    )
    const credits = a.observations[0]!.identity!.contributors
    expect(credits.slice(1).map((c) => [c.scope, c.part])).toEqual([
      ['part', 'Foreword'],
      ['part', 'Introduction'],
    ])
    const manual = {
      version: 1,
      source: {
        url: a.observations[0]!.source.url,
        kind: 'publisher',
        checkedAt: context.retrievedAt,
        locator: 'Manually inspected exact edition credits',
        retentionConfirmed: true,
      },
      identity: {
        title: 'A Quiet Library',
        authors: ['Jane Smith'],
        isbn,
        format: 'paperback',
        language: null,
      },
      credits,
      confirmations: { sourceChecked: true, identityChecked: true, creditsChecked: true },
    }
    expect(parseEditionCreditEvidence(JSON.parse(JSON.stringify(manual))).credits).toEqual(credits)
    // This only proves lossless review parsing. Provider acquisition never supplies these confirmations.
  })
  it('supports the legacy named envelopes without accepting work records', () => {
    const t = title(),
      r = roster()
    expect(
      adaptPenguinRandomHouseIntake(
        { status: 'ok', data: { title: t.data } },
        { status: 'ok', recordCount: 1, data: { authors: r.data } },
        context,
      ).observations[0]?.status,
    ).toBe('ok')
    const work = { status: 'ok', data: { workId: 1, title: 'A Quiet Library' } }
    expect(adaptPenguinRandomHouseIntake(work, r, context).observations[0]?.status).toBe('failed')
  })
  it('rejects wrong ISBN and creator/title mismatches through common identity admission', () => {
    const t = title()
    t.data.isbn = 9781649374042
    expect(adapt(t).issues).toContain('prh_edition_identity_mismatch')
    for (const target of [{ contributors: ['Other Writer'] }, { title: 'An Unrelated Book' }]) {
      const p = request()
      Object.assign(p.target, target)
      expect(intakeIdentityDiagnostics(p, p.observations[0]!).reasons.length).toBeGreaterThan(0)
    }
  })
  it.each([
    ['E', 'Editor'],
    ['T', 'Translator'],
    [null, 'Author'],
    ['Q', 'Author'],
    ['A', 'Editor'],
    ['constructor', 'Author'],
    ['__proto__', 'Author'],
  ])('does not treat code %s label %s as creator authorship', (code, label) => {
    const p = request(adapt(title(), roster([person(code, label)])))
    expect(intakeIdentityDiagnostics(p, p.observations[0]!).reasons.length).toBeGreaterThan(0)
    expect(p.observations[0]!.identity!.contributors[0]!.sourceRoleCode).toBe(code)
  })
  it('permits documented dual roles but withholds normalized duplicates losslessly', () => {
    expect(
      adapt(title(), roster([person(), person('I', 'Illustrator')])).observations[0]?.status,
    ).toBe('ok')
    const p = request(adapt(title(), roster([person(), person('A', ' Author ')])))
    expect(parseIntakeEvidence(p)).toEqual(p)
    expect(p.observations[0]!.identity).toBeUndefined()
    expect(p.observations[0]!.claims).toEqual([])
    expect(buildIntakeReview(p).sources[0]!.credits.map((c) => c.sourceRole)).toEqual([
      'Author',
      ' Author ',
    ])
  })
  it('cannot promote work credits or returned work endpoint links to edition evidence', () => {
    const a = adaptPenguinRandomHouseIntake(title(), roster(), {
      ...context,
      contributorsBasis: 'work',
    })
    expect(a.observations[0]!.withheldCredits?.[0]?.basis).toBe('work')
    expect(a.observations[0]!.claims).toEqual([])
    const r = {
      ...roster(),
      _links: [
        {
          rel: 'self',
          href: 'https://api.penguinrandomhouse.com/resources/v2/title/domains/PRH.US/works/1/authors',
        },
      ],
    }
    expect(adaptPenguinRandomHouseIntake(title(), r, context).issues).toContain(
      'prh_endpoint_scope_conflict',
    )
  })
  it('holds territory and format conflicts, invalid dates and ignores oldest work date', () => {
    expect(
      adaptPenguinRandomHouseIntake(
        { ...title(), data: { ...title().data, domain: 'PRH.CA' } },
        roster(),
        context,
      ).issues,
    ).toContain('territory_conflict')
    const t = title()
    t.data.consumerFormat = 'Hardcover'
    expect(adapt(t).issues).toContain('conflicting_edition_formats')
    t.data.consumerFormat = 'Paperback'
    t.data.format.description = 'Hardcover'
    expect(adapt(t).issues).toContain('conflicting_edition_formats')
    t.data.format.description = 'Paperback'
    t.data.onsale = '2024-02-30'
    expect(adapt(t).observations[0]!.claims.some((c) => c.field === 'publication')).toBe(false)
    const p = request()
    p.existing.publication = { y: 2023, m: 1, d: 1 }
    const resolved = resolveIntakeEvidence(p)
    expect(resolved.fields.find((f) => f.field === 'publication')?.state).toBe('preserved')
    expect(p.observations[0]!.claims.find((c) => c.field === 'publication')?.value).toEqual({
      y: 2024,
      m: 2,
      d: 29,
    })
  })
  it('retains observed absence/unknown roles and caps malformed or incomplete rosters', () => {
    const a = adapt(title(), roster([person('A', null), person('Z', 'Notes by', 'Ann Brown', 2)]))
    expect(a.observations[0]?.identity?.contributors.map((c) => c.role)).toEqual([
      'author',
      'unknown',
    ])
    expect(adapt(title(), { ...roster(), recordCount: 2 }).issues).toContain(
      'incomplete_contributors',
    )
    expect(
      adapt(
        title(),
        roster(Array.from({ length: 6 }, (_, i) => person('A', 'Author', `Writer ${i}`, i + 1))),
      ).observations[0]?.status,
    ).toBe('capped')
    expect(
      adaptPenguinRandomHouseIntake({ status: 'error' }, roster(), context).observations[0]?.status,
    ).toBe('failed')
  })
  it('suppresses print pages when a later recognized audio label follows an unknown format', () => {
    const t = title()
    // Synthetic label combination exercises the generic recognized-format vocabulary;
    // it does not assert these are the complete set of PRH consumer-format labels.
    t.data.format = { code: 'UNMAPPED_AUDIO', description: 'Special listening edition' }
    t.data.formatFamily = 'Audio'
    t.data.consumerFormat = 'Audiobook'
    const a = adapt(t)
    expect(a.observations[0]?.status).toBe('ok')
    expect(a.observations[0]!.claims.find((c) => c.field === 'format')?.value).toBe('audiobook')
    expect(a.observations[0]!.claims.some((c) => c.field === 'pages')).toBe(false)
    expect(a.issues).toEqual(
      expect.arrayContaining(['unknown_format', 'unmapped_format_code', 'unusable_page_count']),
    )
    expect(parseIntakeEvidence(request(a))).toEqual(request(a))
    t.data.consumerFormat = 'Paperback'
    const conflicting = adapt(t)
    expect(conflicting.observations[0]?.status).toBe('failed')
    expect(conflicting.observations[0]?.claims).toEqual([])
    expect(conflicting.issues).toContain('conflicting_edition_formats')
  })
  it('validates bounded literal source codes and keeps private fields outside the evidence schema', () => {
    const p = request()
    p.observations[0]!.identity!.contributors[0]!.sourceRoleCode = 'x'.repeat(41)
    expect(() => parseIntakeEvidence(p)).toThrow()
    expect(() => parseIntakeEvidence({ ...request(), readingHistory: [] })).toThrow()
  })
})
