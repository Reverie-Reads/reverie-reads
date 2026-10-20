import { describe, expect, it } from 'vitest'
import { adaptOpenLibraryIntake, adaptHardcoverIntake } from './intakeSourceAdapters'
import { intakeIdentityDiagnostics, resolveIntakeEvidence } from './intakeResolver'
import { parseIntakeEvidence } from './intakeEvidenceValidation'
import { buildIntakeReview } from './intakeReview'

const context = { targetFingerprint: 'a'.repeat(64), retrievedAt: '2026-10-16T12:00:00Z' }
const isbn = '9780306406157'
const ol = () => ({
  key: '/books/OL1M',
  title: 'A Quiet Library',
  isbn_13: [isbn],
  authors: [{ key: '/authors/OL1A' }],
  number_of_pages: 240,
  physical_format: 'Paperback',
  publish_date: 'February 2024',
  publishers: ['Example Press'],
})
const authors = { '/authors/OL1A': { key: '/authors/OL1A', name: 'Jane Smith' } }
const hc = () => ({
  data: {
    editions: [
      {
        id: 1,
        title: 'A Quiet Library',
        isbn_13: isbn,
        compilation: false,
        pages: 240,
        physical_format: 'Paperback',
        release_date: '2024-02-29',
        book: {
          id: 2,
          title: 'A Quiet Library',
          contributions: [{ contribution: 'author', author: { name: 'Jane Smith' } }],
        },
      },
    ],
  },
})
const request = (observations: ReturnType<typeof adaptOpenLibraryIntake>['observations']) => ({
  version: 1,
  targetFingerprint: context.targetFingerprint,
  asOf: context.retrievedAt,
  target: { isbn, title: 'A Quiet Library', contributors: ['Jane Smith'] },
  existing: {},
  observations,
})

describe('trusted non-LLM intake adapters', () => {
  it.each(['Audiobook', 'Paperback'])(
    'uses recognized %s after an unknown format without losing the unknown diagnostic',
    (format) => {
      const raw = { ...hc().data.editions[0], physical_format: 'Deluxe', edition_format: format }
      const a = adaptHardcoverIntake({ data: { editions: [raw] } }, context)
      expect(a.issues).toContain('unknown_format')
      expect(a.observations[0]?.claims.find((c) => c.field === 'format')?.value).toBe(
        format.toLowerCase(),
      )
      expect(a.observations[0]?.claims.some((c) => c.field === 'pages')).toBe(
        format !== 'Audiobook',
      )
    },
  )
  it.each(['co-author', ' Author '])(
    'withholds duplicate normalized credits while preserving %j',
    (label) => {
      const raw = hc()
      raw.data.editions[0]!.book.contributions.push({
        contribution: label,
        author: { name: 'Jane Smith' },
      })
      const a = adaptHardcoverIntake(raw, context)
      expect(a.issues).toContain('duplicate_credits')
      expect(a.observations[0]?.status).toBe('failed')
      expect(a.observations[0]?.identity).toBeUndefined()
      expect(a.observations[0]?.claims).toEqual([])
      const review = buildIntakeReview(request(a.observations))
      expect(review.sources[0]?.credits.map((c) => c.sourceRole)).toEqual(['author', label])
      expect(review.fields.every((f) => f.proposed === undefined)).toBe(true)
    },
  )
  it('keeps withheld credits bounded and unable to become identity or claims', () => {
    const raw = hc()
    raw.data.editions[0]!.book.contributions.push({
      ...raw.data.editions[0]!.book.contributions[0]!,
    })
    const input = request(adaptHardcoverIntake(raw, context).observations)
    const observation = input.observations[0]!
    expect(() => parseIntakeEvidence(input)).not.toThrow()
    for (const status of ['ok', 'empty', 'capped'] as const) {
      expect(() =>
        parseIntakeEvidence({ ...input, observations: [{ ...observation, status }] }),
      ).toThrow()
    }
    expect(() =>
      parseIntakeEvidence({
        ...input,
        observations: [
          { ...observation, withheldCredits: Array(101).fill(observation.withheldCredits![0]) },
        ],
      }),
    ).toThrow()
    expect(() =>
      parseIntakeEvidence({
        ...input,
        observations: [
          {
            ...observation,
            withheldCredits: [{ ...observation.withheldCredits![0], privateNotes: 'private' }],
          },
        ],
      }),
    ).toThrow()
    expect(() =>
      parseIntakeEvidence({
        ...input,
        observations: [
          {
            ...observation,
            claims: [
              { id: 'pages', field: 'pages', value: 240, scope: 'edition', locator: 'pages' },
            ],
          },
        ],
      }),
    ).toThrow()
  })
  it('retains exact Open Library duplicate credits without claiming an identity', () => {
    const a = adaptOpenLibraryIntake(
      { ...ol(), authors: [{ key: '/authors/OL1A' }, { key: '/authors/OL1A' }] },
      authors,
      context,
    )
    const review = buildIntakeReview(request(a.observations))
    expect(review.sources[0]?.credits.map((c) => c.name)).toEqual(['Jane Smith', 'Jane Smith'])
    expect(review.sources[0]?.identity).toBeUndefined()
    expect(review.sources[0]?.reasons).toContain('source_failed')
    expect(
      review.sources[0]?.credits.every((c) => c.withheld && c.editionSupport === 'unverified'),
    ).toBe(true)
  })
  it('accepts agreeing known format representations but keeps unknown-only formats unknown', () => {
    const agree = adaptHardcoverIntake(
      { data: { editions: [{ ...hc().data.editions[0], edition_format: 'trade paperback' }] } },
      context,
    )
    expect(agree.observations[0]?.claims.find((c) => c.field === 'format')?.value).toBe('paperback')
    expect(agree.issues).not.toContain('conflicting_edition_formats')
    const unknown = adaptHardcoverIntake(
      {
        data: {
          editions: [
            {
              ...hc().data.editions[0],
              physical_format: 'Deluxe',
              edition_format: 'Special edition',
            },
          ],
        },
      },
      context,
    )
    expect(unknown.issues).toContain('unknown_format')
    expect(unknown.observations[0]?.claims.some((c) => c.field === 'format')).toBe(false)
  })
  it('holds an editor-as-author control through the real Hardcover adapter and resolver', () => {
    const raw = hc()
    raw.data.editions[0]!.book.contributions.unshift({
      contribution: ' Editor ',
      author: { name: 'Anne Brown' },
    })
    const adapted = adaptHardcoverIntake(raw, context)
    const input = parseIntakeEvidence(request(adapted.observations))
    input.target.contributors = ['Anne Brown']
    const diagnostic = intakeIdentityDiagnostics(input, input.observations[0]!)
    expect(diagnostic).toMatchObject({
      title: 'exact',
      isbn: 'exact',
      contributors: ['secondary_role_only'],
      reasons: ['identity_mismatch'],
    })
    expect(resolveIntakeEvidence(input).fields.every((f) => f.proposed === undefined)).toBe(true)
    input.target.contributors = ['Jane Smith']
    expect(intakeIdentityDiagnostics(input, input.observations[0]!).reasons).toEqual([])
    expect(adapted.observations[0]!.identity!.contributors[0]).toEqual({
      name: 'Anne Brown',
      role: 'editor',
      scope: 'whole',
      sourceRole: ' Editor ',
      basis: 'work',
    })
  })
  it('keeps source policy code-owned and preserves partial dates', () => {
    const raw = {
      ...ol(),
      source: { kind: 'publisher', usage: 'eligible', lineage: 'independent' },
      ownerId: 'private',
    }
    const a = adaptOpenLibraryIntake(raw, authors, context)
    expect(a.observations[0]?.source).toMatchObject({
      kind: 'bibliographic',
      usage: 'review_only',
      lineage: null,
      method: 'structured',
    })
    expect(a.observations[0]?.claims.find((c) => c.field === 'publication')?.value).toEqual({
      y: 2024,
      m: 2,
      d: null,
    })
    expect(JSON.stringify(a)).not.toContain('private')
    const r = resolveIntakeEvidence(request(a.observations))
    expect(r.fields.every((f) => f.proposed === undefined)).toBe(true)
    expect(r.work.reasons).toContain('review_only_source')
  })
  it('retains contradictory ISBNs for identity review instead of replacing them with the query', () => {
    const a = adaptOpenLibraryIntake(
      { ...ol(), isbn_13: [isbn, '9781649374042'] },
      authors,
      context,
    )
    expect(a.observations[0]?.identity?.isbns).toHaveLength(2)
    expect(resolveIntakeEvidence(request(a.observations)).observations[0]?.reasons).toContain(
      'isbn_conflict',
    )
  })
  it.each([{}, { '/authors/OL1A': { key: '/authors/OL2A', name: 'Jane Smith' } }])(
    'requires key-bound complete authors: %j',
    (a) => {
      expect(adaptOpenLibraryIntake(ol(), a, context).observations[0]?.status).toBe('failed')
    },
  )
  it('refuses author URLs and capped lists without partial identity', () => {
    expect(
      adaptOpenLibraryIntake(
        { ...ol(), authors: [{ key: 'https://evil.example/author' }] },
        authors,
        context,
      ).issues,
    ).toContain('invalid_author_reference')
    expect(
      adaptOpenLibraryIntake(
        { ...ol(), authors: Array(9).fill({ key: '/authors/OL1A' }) },
        authors,
        context,
      ).observations[0]?.status,
    ).toBe('capped')
  })
  it('never harvests description, cover or series labels in the restricted pilot', () => {
    const a = adaptOpenLibraryIntake(
      { ...ol(), description: 'sensitive text', series: ['Unverified'], covers: [42] },
      authors,
      context,
    )
    expect(a.observations[0]?.claims.map((c) => c.field)).not.toEqual(
      expect.arrayContaining(['description', 'cover', 'series']),
    )
    expect(JSON.stringify(a)).not.toContain('sensitive text')
  })
  it('does not choose one of competing Hardcover editions', () => {
    const raw = hc()
    raw.data.editions.push({ ...raw.data.editions[0]!, id: 3 })
    expect(adaptHardcoverIntake(raw, context).observations[0]?.status).toBe('capped')
  })
  it('distinguishes GraphQL errors from successful emptiness', () => {
    expect(
      adaptHardcoverIntake(
        { errors: [{ message: 'private error' }], data: { editions: [] } },
        context,
      ).observations[0]?.status,
    ).toBe('failed')
    expect(adaptHardcoverIntake({ data: { editions: [] } }, context).observations[0]?.status).toBe(
      'empty',
    )
  })
  it.each(['translator', 'editor', 'narrator', 'foreword', 'playwright', 'original story'])(
    'retains %s without making it an author',
    (label) => {
      const raw = hc()
      raw.data.editions[0]!.book.contributions.push({
        contribution: label,
        author: { name: 'Anne Brown' },
      })
      const a = adaptHardcoverIntake(raw, context)
      expect(a.observations[0]?.identity?.contributors[1]?.role).toBe(
        label === 'original story' ? 'original_story' : label,
      )
      expect(a.observations[0]?.claims[0]?.scope).toBe('edition')
      expect(() => parseIntakeEvidence(request(a.observations))).not.toThrow()
    },
  )
  it.each([null, '', 'reteller'])(
    'does not manufacture authorship for an unspecified role: %j',
    (label) => {
      const raw = hc() as unknown as { data: { editions: Record<string, unknown>[] } }
      raw.data.editions[0]!.book = {
        id: 2,
        title: 'A Quiet Library',
        contributions: [{ contribution: label, author: { name: 'Jane Smith' } }],
      }
      const a = adaptHardcoverIntake(raw, context)
      expect(a.observations[0]?.identity?.contributors[0]?.role).toBe('unknown')
      expect(a.issues).toContain('unqualified_contributor_role')
    },
  )
  it.each([true, null, undefined])('holds compilation/unknown scope %j', (compilation) => {
    expect(
      adaptHardcoverIntake(
        { data: { editions: [{ ...hc().data.editions[0], compilation }] } },
        context,
      ).observations[0]?.status,
    ).toBe('failed')
  })
  it('does not inherit identity or facts from a conflicting parent book', () => {
    const raw = hc()
    raw.data.editions[0]!.book.title = 'Another Book'
    expect(adaptHardcoverIntake(raw, context).issues).toContain('edition_parent_title_conflict')
  })
  it('does not guess unknown binding or parse impossible dates', () => {
    const a = adaptOpenLibraryIntake(
      { ...ol(), physical_format: 'Deluxe', publish_date: '2023-02-29' },
      authors,
      context,
    )
    expect(a.issues).toEqual(['unknown_format', 'unparsed_publication_date'])
    expect(a.observations[0]?.claims.some((c) => ['format', 'publication'].includes(c.field))).toBe(
      false,
    )
  })
  it('does not give audiobooks print pages or select between conflicting formats', () => {
    expect(
      adaptOpenLibraryIntake(
        { ...ol(), physical_format: 'audiobook' },
        authors,
        context,
      ).observations[0]?.claims.some((c) => c.field === 'pages'),
    ).toBe(false)
    const raw = { ...hc().data.editions[0], edition_format: 'ebook' }
    expect(adaptHardcoverIntake({ data: { editions: [raw] } }, context).issues).toContain(
      'conflicting_edition_formats',
    )
    const audioConflict = adaptHardcoverIntake(
      { data: { editions: [{ ...raw, edition_format: 'audiobook' }] } },
      context,
    )
    expect(audioConflict.issues).toContain('conflicting_edition_formats')
    expect(audioConflict.observations[0]?.status).toBe('failed')
    expect(audioConflict.observations[0]?.claims).toEqual([])
  })
})
