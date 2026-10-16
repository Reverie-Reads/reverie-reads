import { describe, expect, it } from 'vitest'
import { resolveIntakeEvidence } from './intakeResolver'
import type {
  IntakeClaim,
  IntakeCredit,
  IntakeEvidenceRequest,
  IntakeObservation,
  IntakeResolution,
} from './intakeEvidence'

const isbn = '9780306406157'
const otherIsbn = '9781649374042'
const author: IntakeCredit = { name: 'Jane Smith', role: 'author', scope: 'whole' }
const fingerprint = 'a'.repeat(32)
const title = 'A Quiet Library'
const at = '2026-10-16T12:00:00Z'
const claim = <F extends IntakeClaim['field']>(
  c: Extract<IntakeClaim, { field: F }>,
): Extract<IntakeClaim, { field: F }> => c
const pages = claim({
  id: 'pages',
  field: 'pages',
  value: 256,
  scope: 'edition',
  locator: 'Product details: pages',
})
const description = claim({
  id: 'description',
  field: 'description',
  value: 'A librarian solves a mystery.',
  scope: 'work',
  locator: 'Synopsis',
})
function observation(patch: Partial<IntakeObservation> = {}): IntakeObservation {
  return {
    id: 'publisher',
    targetFingerprint: fingerprint,
    status: 'ok',
    source: {
      provider: 'synthetic',
      recordId: 'book-1',
      url: 'https://publisher.example/book-1',
      retrievedAt: at,
      lineage: 'publisher:book-1',
      kind: 'publisher',
      usage: 'eligible',
      method: 'structured',
    },
    identity: { title, contributors: [author], scope: 'edition', isbns: [isbn] },
    claims: [pages, description],
    ...patch,
  }
}
function request(patch: Partial<IntakeEvidenceRequest> = {}): IntakeEvidenceRequest {
  return {
    version: 1,
    targetFingerprint: fingerprint,
    asOf: at,
    target: { title, contributors: [author.name], isbn },
    existing: {},
    observations: [observation()],
    ...patch,
  }
}
const field = (r: IntakeResolution, name: string) => r.fields.find((f) => f.field === name)!

describe('intake identity and edition boundaries', () => {
  it('proposes independently scoped fields without changing input or returning a writer payload', () => {
    const input = request()
    const before = JSON.stringify(input)
    const result = resolveIntakeEvidence(input)
    expect(result.work.state).toBe('resolved')
    expect(result.edition).toMatchObject({ state: 'resolved', isbn })
    expect(field(result, 'pages')).toMatchObject({ state: 'proposed', proposed: 256 })
    expect(field(result, 'description')).toMatchObject({
      state: 'proposed',
      proposed: description.value,
    })
    expect(result.mode).toBe('review_only')
    expect(JSON.stringify(input)).toBe(before)
    input.observations[0]!.claims.length = 0
    expect(result.request.observations[0]!.claims).toHaveLength(2)
    expect(result).not.toHaveProperty('patch')
  })
  it.each([
    ['A different book', [author]],
    [title, [{ ...author, name: 'Another Writer' }]],
  ])('does not let exact ISBN override wrong identity %s', (otherTitle, credits) => {
    const result = resolveIntakeEvidence(
      request({
        observations: [
          observation({
            identity: { title: otherTitle, contributors: credits, scope: 'edition', isbns: [isbn] },
          }),
        ],
      }),
    )
    expect(result.work.state).toBe('review')
    expect(field(result, 'description').proposed).toBeUndefined()
  })
  it('keeps two different works returned for one scanned ISBN under review', () => {
    const bad = observation({
      id: 'other',
      identity: {
        title,
        contributors: [{ ...author, name: 'John Brown' }],
        scope: 'edition',
        isbns: [isbn],
      },
    })
    const result = resolveIntakeEvidence(
      request({ target: { isbn }, observations: [observation(), bad] }),
    )
    expect(result.work.reasons).toContain('competing_identities')
    expect(result.fields.every((f) => f.proposed === undefined)).toBe(true)
  })
  it('corroborates a scan across harmless title and surname-order variants', () => {
    const other = observation({
      id: 'second',
      identity: {
        title: `${title}: A Novel`,
        contributors: [{ ...author, name: 'Smith, Jane' }],
        scope: 'edition',
        isbns: [isbn],
      },
    })
    const result = resolveIntakeEvidence(
      request({ target: { isbn }, observations: [observation(), other] }),
    )
    expect(result.work.state).toBe('resolved')
    expect(result.edition.state).toBe('resolved')
    expect(field(result, 'pages').proposed).toBe(256)
  })
  it.each([
    { isbn },
    { title, contributors: [author.name], isbn },
    { title, contributors: [author.name] },
  ])('does not collapse competing creator sets through a shared coauthor: %j', (target) => {
    const other = observation({
      id: 'second',
      identity: {
        title,
        contributors: [author, { ...author, name: 'Anne Brown' }],
        scope: 'edition',
        isbns: [isbn],
      },
    })
    expect(
      resolveIntakeEvidence(request({ target, observations: [observation(), other] })).work.reasons,
    ).toContain('competing_identities')
  })
  it('does not conceal a same-ISBN contradiction even with an otherwise matching publisher', () => {
    const bad = observation({
      id: 'other',
      identity: {
        title,
        contributors: [{ ...author, name: 'John Brown' }],
        scope: 'edition',
        isbns: [isbn],
      },
    })
    const result = resolveIntakeEvidence(request({ observations: [observation(), bad] }))
    expect(result.work.reasons).toContain('isbn_conflict')
    expect(result.edition.state).toBe('review')
  })
  it.each(['invalid', '9780306406158'])(
    'does not fall back to title matching for invalid ISBN %s',
    (bad) => {
      const result = resolveIntakeEvidence(
        request({ target: { title, contributors: [author.name], isbn: bad } }),
      )
      expect(result.work.reasons).toContain('invalid_isbn')
      expect(field(result, 'pages').state).toBe('review')
    },
  )
  it('accepts equivalent ISBN-10/13 but holds a mixed-edition record', () => {
    const good = observation({
      identity: { title, contributors: [author], scope: 'edition', isbns: [isbn, '0306406152'] },
    })
    expect(resolveIntakeEvidence(request({ observations: [good] })).edition.state).toBe('resolved')
    good.identity!.isbns.push(otherIsbn)
    expect(resolveIntakeEvidence(request({ observations: [good] })).work.reasons).toContain(
      'isbn_conflict',
    )
  })
  it('retains work description without borrowing edition facts from an unselected ISBN', () => {
    const result = resolveIntakeEvidence(
      request({ target: { title, contributors: [author.name] } }),
    )
    expect(result.work.state).toBe('resolved')
    expect(result.edition.state).toBe('unknown')
    expect(field(result, 'description').state).toBe('proposed')
    expect(field(result, 'pages')).toMatchObject({
      state: 'review',
      reasons: ['edition_unresolved'],
    })
  })
  it('never uses a work search ISBN array as a selected edition', () => {
    const result = resolveIntakeEvidence(
      request({
        observations: [
          observation({
            identity: { title, contributors: [author], scope: 'work', isbns: [isbn, otherIsbn] },
          }),
        ],
      }),
    )
    expect(result.edition.state).toBe('review')
    expect(field(result, 'pages').proposed).toBeUndefined()
  })
  it.each(['paperback', 'ebook'] as const)(
    'holds edition facts conflicting with requested %s format',
    (format) => {
      const source = observation({
        claims: [
          pages,
          {
            id: 'format',
            field: 'format',
            value: 'hardcover',
            scope: 'edition',
            locator: 'Product format',
          },
        ],
      })
      const result = resolveIntakeEvidence(
        request({ target: { isbn, format }, observations: [source] }),
      )
      expect(result.edition.reasons).toContain('edition_conflict')
      expect(field(result, 'pages').proposed).toBeUndefined()
    },
  )
  it('does not transfer print pages to an audiobook', () => {
    const result = resolveIntakeEvidence(request({ target: { isbn, format: 'audiobook' } }))
    expect(field(result, 'pages').reasons).toContain('not_applicable')
    expect(field(result, 'pages').proposed).toBeUndefined()
  })
  it('keeps language conflicts under review', () => {
    const result = resolveIntakeEvidence(
      request({
        target: { isbn, language: 'fr' },
        observations: [
          observation({
            claims: [
              pages,
              {
                id: 'language',
                field: 'language',
                value: 'en',
                scope: 'edition',
                locator: 'Language',
              },
            ],
          }),
        ],
      }),
    )
    expect(result.edition.reasons).toContain('edition_conflict')
  })
})

describe('formatting recovery without identity guesses', () => {
  it.each([
    ['Jane Smith', 'Janes Mith'],
    ['किरण शर्मा', 'करण शर्मा'],
  ])('preserves contributor word boundaries and non-Latin marks: %s / %s', (expected, actual) => {
    const source = observation({
      identity: {
        title,
        contributors: [{ ...author, name: actual }],
        scope: 'edition',
        isbns: [isbn],
      },
    })
    expect(
      resolveIntakeEvidence(
        request({ target: { title, isbn, contributors: [expected] }, observations: [source] }),
      ).work.state,
    ).toBe('review')
  })
  it.each(['कला घर', 'कला घर: A Novel'])(
    'preserves non-Latin vowel signs in titles: %s',
    (actual) => {
      const source = observation({
        identity: { title: actual, contributors: [author], scope: 'edition', isbns: [isbn] },
      })
      expect(
        resolveIntakeEvidence(
          request({
            target: { title: 'काला घर', isbn, contributors: [author.name] },
            observations: [source],
          }),
        ).work.state,
      ).toBe('review')
    },
  )
  it('retains safe Latin accent normalization', () => {
    const source = observation({
      identity: {
        title,
        contributors: [{ ...author, name: 'José Muñoz' }],
        scope: 'edition',
        isbns: [isbn],
      },
    })
    expect(
      resolveIntakeEvidence(
        request({ target: { title, isbn, contributors: ['Jose Munoz'] }, observations: [source] }),
      ).work.state,
    ).toBe('resolved')
  })
  it.each([
    ['surname-first', title, 'Smith, Jane'],
    ['punctuation', 'A Quiet Library!', author.name],
    ['descriptive subtitle', 'A Quiet Library: A Novel', author.name],
    ['genre subtitle', 'A Quiet Library: A Small-Town Mystery', author.name],
  ])('recovers %s with exact edition and full contributor', (_name, sourceTitle, name) => {
    const result = resolveIntakeEvidence(
      request({
        observations: [
          observation({
            identity: {
              title: sourceTitle,
              contributors: [{ ...author, name }],
              scope: 'edition',
              isbns: [isbn],
            },
          }),
        ],
      }),
    )
    expect(result.work.state).toBe('resolved')
  })
  it.each(['Jane A. Smith', 'J. Smith', 'Smith'])(
    'holds ambiguous or incomplete contributor %s',
    (name) => {
      const result = resolveIntakeEvidence(
        request({
          observations: [
            observation({
              identity: {
                title,
                contributors: [{ ...author, name }],
                scope: 'edition',
                isbns: [isbn],
              },
            }),
          ],
        }),
      )
      expect(result.work.state).toBe('review')
    },
  )
  it('also holds initials when both query and source use the same initials', () => {
    const result = resolveIntakeEvidence(
      request({
        target: { title, isbn, contributors: ['J. Smith'] },
        observations: [
          observation({
            identity: {
              title,
              contributors: [{ ...author, name: 'J. Smith' }],
              scope: 'edition',
              isbns: [isbn],
            },
          }),
        ],
      }),
    )
    expect(result.work.reasons).toContain('ambiguous_name')
  })
  it.each([
    'A Quiet Library Book One',
    'A Quiet Library: A Graphic Novel',
    'A Quiet Library: Expanded Edition',
    'A Quiet Library and Other Stories',
  ])('preserves meaningful title qualifier %s', (sourceTitle) => {
    expect(
      resolveIntakeEvidence(
        request({
          observations: [
            observation({
              identity: {
                title: sourceTitle,
                contributors: [author],
                scope: 'edition',
                isbns: [isbn],
              },
            }),
          ],
        }),
      ).work.state,
    ).toBe('review')
  })
})

describe('credit scope and completeness', () => {
  function withCredits(credits: IntakeCredit[]) {
    return observation({
      identity: { title, contributors: credits, scope: 'edition', isbns: [isbn] },
      claims: [
        {
          id: 'credits',
          field: 'contributors',
          value: credits,
          scope: 'work',
          locator: 'Title page credits',
        },
      ],
    })
  }
  it('preserves both separately credited coauthors in publisher order', () => {
    const credits: IntakeCredit[] = [
      { ...author, name: 'Carla Page' },
      { ...author, name: 'Susan Vale' },
    ]
    const result = resolveIntakeEvidence(
      request({ target: { isbn }, observations: [withCredits(credits)] }),
    )
    expect(field(result, 'contributors').proposed).toEqual(credits)
  })
  it('does not split a malformed combined name into guessed authors', () => {
    const credits: IntakeCredit[] = [
      { ...author, name: 'Carla Page' },
      { ...author, name: 'Susan Vale' },
    ]
    const result = resolveIntakeEvidence(
      request({
        target: { title, isbn, contributors: ['Carla & Susan Page & Vale'] },
        observations: [withCredits(credits)],
      }),
    )
    expect(result.work.state).toBe('review')
    expect(result.request.observations[0]!.identity!.contributors).toEqual(credits)
  })
  it('finds a known coauthor anywhere in the list without discarding the other author', () => {
    const credits = [{ ...author, name: 'Jean Rose' }, author]
    const result = resolveIntakeEvidence(request({ observations: [withCredits(credits)] }))
    expect(field(result, 'contributors').proposed).toEqual(credits)
  })
  it('retains original-story and playwright credits without collapsing them into author', () => {
    const credits: IntakeCredit[] = [
      { ...author, role: 'playwright' },
      { name: 'John Stone', role: 'original_story', scope: 'whole' },
    ]
    const result = resolveIntakeEvidence(request({ observations: [withCredits(credits)] }))
    expect(field(result, 'contributors').proposed).toEqual(credits)
  })
  it('keeps an initialed secondary credit when a separate full creator confirms identity', () => {
    const credits: IntakeCredit[] = [
      { ...author, role: 'playwright' },
      { name: 'J. K. Reed', role: 'original_story', scope: 'whole' },
    ]
    const result = resolveIntakeEvidence(request({ observations: [withCredits(credits)] }))
    expect(result.work.state).toBe('resolved')
    expect(field(result, 'contributors').proposed).toEqual(credits)
  })
  it('does not identify an anthology by a single story author or foreword writer', () => {
    const credits: IntakeCredit[] = [
      { name: 'Kate Birch', role: 'editor', scope: 'whole' },
      { ...author, scope: 'part', part: 'The Lantern' },
      { name: 'Gregory Hill', role: 'foreword', scope: 'whole' },
    ]
    const source = withCredits(credits)
    expect(resolveIntakeEvidence(request({ observations: [source] })).work.state).toBe('review')
    const scan = resolveIntakeEvidence(request({ target: { isbn }, observations: [source] }))
    expect(scan.work.state).toBe('resolved')
    expect(field(scan, 'contributors').proposed).toEqual(credits)
  })
  it('rejects a claim naming a different contributor than its observed source identity', () => {
    const source = withCredits([author])
    source.claims[0] = {
      id: 'credits',
      field: 'contributors',
      value: [{ ...author, name: 'Invented Writer' }],
      scope: 'work',
      locator: 'Title page credits',
    }
    expect(
      field(resolveIntakeEvidence(request({ observations: [source] })), 'contributors').reasons,
    ).toContain('unsupported_claim')
  })
  it('does not promote edition narration to work authorship', () => {
    const source = withCredits([author, { name: 'Anne Reader', role: 'narrator', scope: 'whole' }])
    expect(
      field(resolveIntakeEvidence(request({ observations: [source] })), 'contributors').reasons,
    ).toContain('wrong_scope')
  })
})

describe('evidence, provenance and preservation', () => {
  it('keeps conflicting descriptions and page counts in review rather than choosing length or provider rank', () => {
    const other = observation({
      id: 'second',
      claims: [
        {
          ...description,
          value: 'A much longer description that says something materially different.',
        },
        { ...pages, value: 300 },
      ],
    })
    const result = resolveIntakeEvidence(request({ observations: [observation(), other] }))
    for (const name of ['description', 'pages'])
      expect(field(result, name)).toMatchObject({ state: 'review', reasons: ['field_conflict'] })
    expect(result.request.observations).toHaveLength(2)
  })
  it('preserves existing values and exposes proposed corrections separately', () => {
    const result = resolveIntakeEvidence(
      request({ existing: { pages: 240, description: description.value as string } }),
    )
    expect(field(result, 'pages')).toMatchObject({ state: 'review', current: 240 })
    expect(field(result, 'description')).toMatchObject({
      state: 'preserved',
      current: description.value,
    })
    expect(result.fields.every((f) => f.proposed === undefined)).toBe(true)
  })
  it('cannot fill gaps in an existing mixed identity just because a new ISBN lookup is clean', () => {
    const input = request({
      target: { isbn },
      existing: { title, contributors: [{ ...author, name: 'Another Writer' }] },
    })
    const before = JSON.stringify(input)
    const result = resolveIntakeEvidence(input)
    expect(result.work.reasons).toContain('existing_identity_conflict')
    expect(field(result, 'description').proposed).toBeUndefined()
    expect(JSON.stringify(input)).toBe(before)
  })
  it('requires support for each fact, not just corroboration of book identity', () => {
    const a = observation()
    a.source.kind = 'bibliographic'
    const b = observation({ id: 'second', claims: [] })
    b.source.kind = 'bibliographic'
    b.source.lineage = 'independent:book'
    const result = resolveIntakeEvidence(request({ observations: [a, b] }))
    expect(result.work.state).toBe('resolved')
    expect(field(result, 'description').reasons).toContain('insufficient_support')
    expect(field(result, 'description').proposed).toBeUndefined()
  })
  it('never assembles a publication date from incompatible partial tuples', () => {
    const date = claim({
      id: 'date',
      field: 'publication',
      value: { y: 2020, m: null, d: null },
      scope: 'edition',
      locator: 'Publication',
    })
    const result = resolveIntakeEvidence(
      request({
        observations: [
          observation({ claims: [date] }),
          observation({ id: 'second', claims: [{ ...date, value: { y: 2021, m: 6, d: 1 } }] }),
        ],
      }),
    )
    expect(field(result, 'publication').state).toBe('review')
    const partial = resolveIntakeEvidence(
      request({ observations: [observation({ claims: [date] })] }),
    )
    expect(field(partial, 'publication').proposed).toEqual({ y: 2020, m: null, d: null })
  })
  it('does not count mirrored upstream records as independent corroboration', () => {
    const a = observation()
    a.source.kind = 'bibliographic'
    const b = observation({ id: 'mirror' })
    b.source.kind = 'bibliographic'
    b.source.provider = 'mirror'
    const held = resolveIntakeEvidence(request({ observations: [a, b] }))
    expect(held.work.reasons).toContain('insufficient_support')
    b.source.lineage = 'independent:record'
    expect(resolveIntakeEvidence(request({ observations: [a, b] })).work.state).toBe('resolved')
  })
  it('does not turn unknown origins into independent votes', () => {
    const a = observation()
    a.source.kind = 'bibliographic'
    a.source.lineage = null
    const b = observation({ id: 'mirror' })
    b.source.kind = 'bibliographic'
    b.source.lineage = null
    expect(resolveIntakeEvidence(request({ observations: [a, b] })).work.state).toBe('review')
  })
  it.each([
    ['model_proposal', { method: 'model_proposal' as const }],
    ['review_only_source', { usage: 'review_only' as const }],
    ['unverified_source', { kind: 'unverified' as const }],
    ['stale_evidence', { retrievedAt: '2026-08-01T12:00:00Z' }],
    ['stale_evidence', { retrievedAt: '2026-10-17T12:00:00Z' }],
  ])('retains %s without promoting its facts', (reason, patch) => {
    const source = observation()
    Object.assign(source.source, patch)
    const result = resolveIntakeEvidence(request({ observations: [source] }))
    expect(result.observations[0]!.reasons).toContain(reason)
    expect(result.fields.every((f) => f.proposed === undefined)).toBe(true)
  })
  it('requires the exact frozen target for reused evidence', () => {
    const result = resolveIntakeEvidence(
      request({ observations: [observation({ targetFingerprint: 'b'.repeat(32) })] }),
    )
    expect(result.work.reasons).toContain('target_changed')
  })
  it('keeps failures and response caps distinct from successful emptiness', () => {
    const source = observation({ status: 'empty', identity: undefined, claims: [] })
    delete source.identity
    const empty = resolveIntakeEvidence(request({ observations: [source] }))
    expect(empty.acquisition).toEqual({ complete: true, empty: 1, failed: 0, capped: 0 })
    expect(empty.work.state).toBe('unresolved')
    source.status = 'failed'
    expect(resolveIntakeEvidence(request({ observations: [source] })).acquisition.failed).toBe(1)
    source.status = 'capped'
    expect(resolveIntakeEvidence(request({ observations: [source] })).acquisition.capped).toBe(1)
  })
  it('does not report acquisition completed when no sources were attempted', () => {
    const result = resolveIntakeEvidence(request({ observations: [] }))
    expect(result.acquisition).toEqual({ complete: false, empty: 0, failed: 0, capped: 0 })
    expect(result.work.state).toBe('unresolved')
  })
  it('keeps a failed peer visible beside independently supported facts', () => {
    const failed = observation({ id: 'failed', status: 'failed', claims: [] })
    delete failed.identity
    const result = resolveIntakeEvidence(request({ observations: [observation(), failed] }))
    expect(result.acquisition.complete).toBe(false)
    expect(field(result, 'description').state).toBe('proposed')
  })
  it('requires explicit membership evidence for the exact work', () => {
    const series = claim({
      id: 'series',
      field: 'series',
      value: {
        name: 'Library Mysteries',
        position: 1,
        memberTitle: title,
        memberContributors: [author.name],
        relationship: 'explicit_membership',
      },
      scope: 'work',
      locator: 'Books in series',
    })
    expect(
      field(
        resolveIntakeEvidence(request({ observations: [observation({ claims: [series] })] })),
        'series',
      ).state,
    ).toBe('proposed')
    series.value.relationship = 'search_label'
    expect(
      field(
        resolveIntakeEvidence(request({ observations: [observation({ claims: [series] })] })),
        'series',
      ).reasons,
    ).toContain('relationship_unverified')
  })
  it('applies the same contributor boundary to series membership evidence', () => {
    const series = claim({
      id: 'series',
      field: 'series',
      value: {
        name: 'Library Mysteries',
        position: 1,
        memberTitle: title,
        memberContributors: ['Janes Mith'],
        relationship: 'explicit_membership',
      },
      scope: 'work',
      locator: 'Books in series',
    })
    const result = resolveIntakeEvidence(
      request({ observations: [observation({ claims: [series] })] }),
    )
    expect(result.work.state).toBe('resolved')
    expect(field(result, 'series').reasons).toContain('relationship_unverified')
    expect(field(result, 'series').proposed).toBeUndefined()
  })
})

describe('packet validation and personal-data boundary', () => {
  it.each(['reads', 'rating', 'notes', 'copyInventory', 'ownerId', 'ownership', 'serviceKey'])(
    'rejects %s instead of treating private data as evidence',
    (name) => {
      expect(() => resolveIntakeEvidence({ ...request(), [name]: 'private' })).toThrow(
        'Invalid intake evidence packet',
      )
      expect(() =>
        resolveIntakeEvidence({ ...request(), existing: { [name]: 'private' } }),
      ).toThrow()
    },
  )
  it('rejects malformed, duplicate, oversized and future-version packets', () => {
    expect(() => resolveIntakeEvidence(null)).toThrow()
    expect(() => resolveIntakeEvidence({ ...request(), version: 2 })).toThrow()
    expect(() =>
      resolveIntakeEvidence(request({ observations: [observation(), observation()] })),
    ).toThrow()
    expect(() =>
      resolveIntakeEvidence(
        request({
          observations: Array.from({ length: 51 }, (_, i) => observation({ id: String(i) })),
        }),
      ),
    ).toThrow()
  })
  it('rejects impossible dates rather than silently correcting them', () => {
    const input = request({
      observations: [
        observation({
          claims: [
            {
              id: 'date',
              field: 'publication',
              value: { y: 2025, m: 2, d: 29 },
              scope: 'edition',
              locator: 'Date',
            },
          ],
        }),
      ],
    })
    expect(() => resolveIntakeEvidence(input)).toThrow()
  })
  it('rejects source credentials and unsupported claim fields at nested boundaries', () => {
    const input = request()
    expect(() =>
      resolveIntakeEvidence({
        ...input,
        observations: [{ ...observation(), source: { ...observation().source, apiKey: 'secret' } }],
      }),
    ).toThrow()
    expect(() =>
      resolveIntakeEvidence({
        ...input,
        observations: [{ ...observation(), claims: [{ ...pages, field: 'rating', value: 5 }] }],
      }),
    ).toThrow()
  })
})
