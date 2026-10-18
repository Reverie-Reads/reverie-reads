import { describe, expect, it } from 'vitest'
import { adaptPenguinRandomHouseIntake } from './intakeSourceAdapters'
import { intakeIdentityDiagnostics, resolveIntakeEvidence } from './intakeResolver'
import { parseEditionCreditEvidence } from './editionCredits'
import { buildIntakeReview, intakeReviewDiagnostics } from './intakeReview'
import { parseIntakeEvidence } from './intakeEvidenceValidation'
import type { IntakeCredit, IntakeEvidenceRequest } from './intakeEvidence'

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
  it('accepts the observed one-title wrapper and qualified partial-roster count without authority', () => {
    const raw = {
      status: 'ok',
      recordCount: 1,
      error: null,
      data: { titles: [{ ...title().data, isbnStr: isbn }], _embeds: null, _links: [] },
    }
    const rows = [person(), person('T', 'Translator', 'Ann Brown', 2)]
    const authors = {
      status: 'ok',
      recordCount: 1,
      error: null,
      data: { authors: rows, _embeds: null, _links: [] },
    }
    const a = adaptPenguinRandomHouseIntake(raw, authors, context)
    expect(a.observations[0]?.status).toBe('ok')
    expect(a.issues).toEqual(
      expect.arrayContaining(['partial_contributor_roster', 'contributor_count_unqualified']),
    )
    expect(intakeIdentityDiagnostics(request(a), a.observations[0]!).reasons).toEqual([])
    expect(resolveIntakeEvidence(request(a)).fields.some((f) => f.state === 'proposed')).toBe(false)
    const noStatus = { ...raw }
    delete (noStatus as { status?: string }).status
    expect(
      adaptPenguinRandomHouseIntake(noStatus, { ...authors, status: undefined }, context)
        .observations[0]?.status,
    ).toBe('ok')
  })
  it('rejects empty/competing title wrappers, explicit errors and contradictory ISBN literals', () => {
    const raw = {
      status: 'ok',
      recordCount: 1,
      error: null,
      data: { titles: [{ ...title().data, isbnStr: isbn }] },
    }
    for (const broken of [
      {},
      { data: {} },
      { ...raw, data: { titles: [] } },
      { ...raw, data: { titles: [title().data, title().data] } },
      { ...raw, status: 'failed' },
      { ...raw, error: { message: 'Not retained' } },
      { ...raw, recordCount: 2 },
    ]) {
      const a = adaptPenguinRandomHouseIntake(broken, roster(), context)
      expect(a.observations[0]?.status).toBe('failed')
      expect(a.issues).toContain('invalid_prh_title_response')
    }
    raw.data.titles[0]!.isbnStr = '9781649374042'
    expect(adaptPenguinRandomHouseIntake(raw, roster(), context).issues).toContain(
      'prh_edition_identity_mismatch',
    )
    for (const broken of [
      { ...roster(), error: { message: 'Not retained' } },
      { ...roster(), status: 'failed' },
      { ...roster(), recordCount: -1 },
      { ...roster(), data: [{}] },
    ])
      expect(adaptPenguinRandomHouseIntake(title(), broken, context).observations[0]?.status).toBe(
        'failed',
      )
  })
  it.each([{ value: [isbn] }, { value: { literal: isbn } }, { value: true }])(
    'rejects nonliteral ISBN values without coercion',
    ({ value }) => {
      const a = adaptPenguinRandomHouseIntake(
        { status: 'ok', data: { titles: [{ ...title().data, isbn: value }] } },
        roster(),
        context,
      )
      expect(a.observations[0]?.status).toBe('failed')
      expect(a.issues).toContain('prh_edition_identity_mismatch')
    },
  )
  it('validates returned self links on nested title and authors envelopes without following them', () => {
    const root = 'https://api.penguinrandomhouse.com/resources/v2/title/domains/PRH.US'
    const t = {
      status: 'ok',
      recordCount: 1,
      data: { titles: [title().data], _links: [{ rel: 'self', href: `${root}/titles/${isbn}` }] },
    }
    const a = {
      status: 'ok',
      recordCount: 1,
      data: {
        authors: roster().data,
        _links: [{ rel: 'self', href: `${root}/titles/${isbn}/authors` }],
      },
    }
    expect(adaptPenguinRandomHouseIntake(t, a, context).observations[0]?.status).toBe('ok')
    for (const href of [
      `${root}/works/1/authors`,
      `${root}/titles/9781649374042/authors`,
      'https://example.org/authors',
    ]) {
      a.data._links[0]!.href = href
      expect(adaptPenguinRandomHouseIntake(t, a, context).issues).toContain(
        'prh_endpoint_scope_conflict',
      )
    }
    a.data._links = []
    t.data._links[0]!.href = `${root.replace('PRH.US', 'PRH.CA')}/titles/${isbn}`
    expect(adaptPenguinRandomHouseIntake(t, a, context).issues).toContain(
      'prh_endpoint_scope_conflict',
    )
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
  it('accepts only the documented author label alias with an author code', () => {
    const p = request(adapt(title(), roster([person('A', ' Written by ')])))
    expect(intakeIdentityDiagnostics(p, p.observations[0]!).reasons).toEqual([])
    expect(p.observations[0]!.identity!.contributors[0]).toMatchObject({
      role: 'author',
      sourceRole: ' Written by ',
      sourceRoleCode: 'A',
      sourceContributorId: '1',
    })
    for (const [code, label] of [
      ['T', 'Written by'],
      ['A', 'Translated by'],
      ['unknown', 'Written by'],
    ]) {
      const held = request(adapt(title(), roster([person(code, label)])))
      expect(held.observations[0]!.identity!.contributors[0]!.role).toBe('unknown')
      expect(intakeIdentityDiagnostics(held, held.observations[0]!).reasons).not.toEqual([])
    }
  })
  it.each([
    ['1', 'Preface by', 'Preface'],
    ['D', 'Afterword by', 'Afterword'],
    ['Q', 'Epilogue by', 'Epilogue'],
    ['2', 'Prologue by', 'Prologue'],
    ['A1', 'Appendix by', 'Appendix'],
  ])(
    'retains documented named-part credit %s without making its writer the whole-book author',
    (code, label, part) => {
      const p = request(adapt(title(), roster([person(), person(code, label, 'Ann Brown', 2)])))
      expect(parseIntakeEvidence(p)).toEqual(p)
      expect(p.observations[0]!.identity!.contributors[1]).toMatchObject({
        role: 'contributor',
        scope: 'part',
        part,
        sourceRole: label,
        sourceRoleCode: code,
      })
      expect(intakeIdentityDiagnostics(p, p.observations[0]!).reasons).toEqual([])
      p.target.contributors = ['Ann Brown']
      expect(intakeIdentityDiagnostics(p, p.observations[0]!).contributors).toEqual(['part_only'])
      expect(resolveIntakeEvidence(p).fields.some((f) => f.state === 'proposed')).toBe(false)
    },
  )
  it.each([
    [[person(), person()], 'repeated_credit'],
    [[person('F', 'Annotations by'), person('Z', 'Notes by')], 'role_normalization_collision'],
    [[person('4', 'Read by'), person('Y', 'Narrated by')], 'role_normalization_collision'],
    [[person(), person('I', 'Illustrator', 'Jane Smith', 2)], 'person_identifier_conflict'],
    [[person(), person('I', 'Illustrator', 'Different Person', 1)], 'person_name_conflict'],
  ] as const)(
    'explains a credit collision as %s / %s without discarding rows or supporting identity',
    (people, kind) => {
      const a = adapt(title(), roster([...people]))
      const p = request(a),
        before = structuredClone(p)
      expect(a.issues).toEqual(
        expect.arrayContaining([
          'partial_contributor_roster',
          'territory_specific_edition',
          'duplicate_credits',
          kind,
        ]),
      )
      expect(p.observations[0]).toMatchObject({ status: 'failed', claims: [] })
      expect(p.observations[0]!.identity).toBeUndefined()
      const review = buildIntakeReview(p)
      expect(review.sources[0]!.creditCollisions).toEqual([{ kind, positions: [0, 1] }])
      expect(review.sources[0]!.credits.map((c) => c.sourceContributorId)).toEqual(
        people.map((c) => String(c.authorId)),
      )
      expect(review.sources[0]!.credits.every((c) => c.withheld)).toBe(true)
      expect(review.fields.some((f) => f.state === 'proposed')).toBe(false)
      expect(p).toEqual(before)
      const diagnostic = JSON.stringify(intakeReviewDiagnostics(p))
      for (const literal of [
        'Jane Smith',
        'Different Person',
        'Annotations by',
        'sourceContributorId',
        'sourceRoleCode',
      ])
        expect(diagnostic).not.toContain(literal)
    },
  )
  it('retains prior unknown-role and count warnings when collisions force review', () => {
    const a = adapt(title(), {
      ...roster([person('F', 'Annotations by'), person('Z', 'Notes by')]),
      recordCount: 1,
    })
    expect(a.issues).toEqual(
      expect.arrayContaining([
        'unqualified_contributor_role',
        'contributor_count_unqualified',
        'duplicate_credits',
      ]),
    )
  })
  it('keeps supported multiple named parts distinct and validates transient person IDs', () => {
    const p = request(
      adapt(
        title(),
        roster([
          person(),
          person('1', 'Preface by', 'Ann Brown', 2),
          person('D', 'Afterword by', 'Ann Brown', 2),
        ]),
      ),
    )
    expect(buildIntakeReview(p).sources[0]!.creditCollisions).toEqual([])
    expect(p.observations[0]!.identity!.contributors).toHaveLength(3)
    for (const value of ['', 'x'.repeat(101), 1, { private: 'data' }]) {
      const invalid = structuredClone(p)
      Object.assign(invalid.observations[0]!.identity!.contributors[0]!, {
        sourceContributorId: value,
      })
      expect(() => parseIntakeEvidence(invalid)).toThrow()
    }
  })
  it.each([
    ['Jane Smith', 'Smith, Jane'],
    ['José García', 'Jose Garcia'],
    ['Anne O’Neill', "Anne O'Neill"],
    ['Jane-Smith', 'Jane Smith'],
  ])('holds distinct provider IDs when identity matching equates %s and %s', (first, second) => {
    const a = adapt(
      title(),
      roster([person('A', 'Author', first, 1), person('T', 'Translator', second, 2)]),
    )
    expect(a.issues).toContain('person_identifier_conflict')
    expect(a.observations[0]).toMatchObject({ status: 'failed', claims: [] })
    expect(a.observations[0]!.identity).toBeUndefined()
    expect(parseIntakeEvidence(request(a))).toEqual(request(a))
    expect(a.observations[0]!.withheldCredits?.map((c) => c.name)).toEqual([first, second])
  })
  it.each([
    ['Different Person', '1'],
    ['Jane Smith', '2'],
    ['Smith, Jane', '2'],
    ['Jane-Smith', '2'],
  ])('rejects direct and manual successful packets with conflicting person %s / %s', (name, id) => {
    const p = request()
    const credits: IntakeCredit[] = [
      ...p.observations[0]!.identity!.contributors,
      {
        name,
        role: 'translator',
        scope: 'whole',
        sourceRole: 'Translator',
        sourceRoleCode: 'T',
        sourceContributorId: id,
        basis: 'edition',
      },
    ]
    // Test the strict boundary directly: neither path goes through the provider adapter.
    const direct = structuredClone(p)
    direct.observations[0]!.identity!.contributors = credits
    expect(() => parseIntakeEvidence(direct)).toThrow()
    const claimOnly = structuredClone(p)
    const claim = claimOnly.observations[0]!.claims.find((c) => c.field === 'contributors')!
    claim.value = credits
    expect(() => parseIntakeEvidence(claimOnly)).toThrow()
    expect(() =>
      parseEditionCreditEvidence({
        version: 1,
        source: {
          url: p.observations[0]!.source.url,
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
      }),
    ).toThrow()
    // The same statements are still reviewable losslessly after identity support is withheld.
    const withheld = structuredClone(p)
    withheld.observations[0]!.status = 'failed'
    delete withheld.observations[0]!.identity
    withheld.observations[0]!.claims = []
    withheld.observations[0]!.withheldCredits = credits
    expect(parseIntakeEvidence(withheld)).toEqual(withheld)
  })
  it('preserves legitimate same-ID multi-role formatting and non-Latin identity marks', () => {
    const multi = request(
      adapt(title(), roster([person(), person('I', 'Illustrator', 'Smith, Jane', 1)])),
    )
    expect(multi.observations[0]!.status).toBe('ok')
    expect(parseIntakeEvidence(multi)).toEqual(multi)
    expect(buildIntakeReview(multi).sources[0]!.creditCollisions).toEqual([])
    // Devanagari vowel signs remain identity-bearing, unlike supported Latin accent formatting.
    const different = request(
      adapt(title(), roster([person('A', 'Author', 'कला', 1), person('T', 'Translator', 'कल', 2)])),
    )
    expect(different.observations[0]!.status).toBe('ok')
    expect(parseIntakeEvidence(different)).toEqual(different)
  })
  it('never compares person IDs across separate source observations', () => {
    const p = request()
    const other = structuredClone(p.observations[0]!)
    other.id = 'another-source:edition'
    other.source.provider = 'another-source'
    other.identity!.contributors[0]!.name = 'Different Person'
    other.claims = []
    p.observations.push(other)
    expect(parseIntakeEvidence(p)).toEqual(p)
    expect(
      buildIntakeReview(p).sources.every((source) => source.creditCollisions.length === 0),
    ).toBe(true)
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
      'contributor_count_unqualified',
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
