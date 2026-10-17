import { describe, expect, it } from 'vitest'
import {
  parseEditionCreditEvidence,
  reviewEditionCredits,
  type EditionCreditEvidence,
  type StoredEditionCredit,
} from './editionCredits'
const now = '2026-10-17T00:00:00Z'
const packet = (): EditionCreditEvidence => ({
  version: 1,
  source: {
    url: 'https://publisher.example/edition',
    kind: 'publisher',
    checkedAt: now,
    locator: 'Edition credits',
    retentionConfirmed: true,
  },
  identity: {
    title: 'Still Waters',
    authors: ['Jane Smith'],
    isbn: '9780306406157',
    format: 'paperback',
    language: 'en',
  },
  credits: [
    {
      name: 'Jane Smith',
      role: 'author',
      scope: 'whole',
      sourceRole: 'Written by',
      basis: 'edition',
    },
    {
      name: 'Ann Brown',
      role: 'translator',
      scope: 'whole',
      sourceRole: ' Translator ',
      basis: 'edition',
    },
    {
      name: 'Ann Brown',
      role: 'introduction',
      scope: 'whole',
      sourceRole: 'Introduction by',
      basis: 'edition',
    },
    {
      name: 'Chris Pine',
      role: 'author',
      scope: 'part',
      part: 'A story',
      sourceRole: 'Story by',
      basis: 'edition',
    },
  ],
  confirmations: { sourceChecked: true, identityChecked: true, creditsChecked: true },
})
const target = {
  title: 'Still Waters',
  authors: ['Jane Smith'],
  isbn: '9780306406157',
  format: 'paperback',
  language: 'en',
}
describe('manually reviewed edition credits', () => {
  it('rejects empty credit documents before preparing a database review', () => {
    expect(() => parseEditionCreditEvidence({ ...packet(), credits: [] })).toThrow()
  })
  it('preserves ordered multiple roles, named parts and exact role labels without mutating input', () => {
    const p = packet(),
      before = structuredClone(p),
      r = reviewEditionCredits(p, target, [], now)
    expect(r.decisions.every((d) => d.eligible)).toBe(true)
    expect(r.completeness).toBe('unverified')
    expect(r.evidence.credits).toEqual(before.credits)
    r.evidence.credits[0]!.name = 'Changed'
    expect(p).toEqual(before)
  })
  it.each(['notes', 'owner_id', 'readingHistory', 'providerPayload', 'usage', 'verified'])(
    'rejects unrecognized %s rather than dropping it',
    (field) => {
      expect(() =>
        parseEditionCreditEvidence({ ...packet(), [field]: 'private or forged' }),
      ).toThrow()
    },
  )
  it.each(['sourceChecked', 'identityChecked', 'creditsChecked'] as const)(
    'requires the %s review decision',
    (field) => {
      const p = packet()
      p.confirmations[field] = false
      expect(
        reviewEditionCredits(p, target, [], now).decisions.every((d) =>
          d.reasons.includes('confirmation_missing'),
        ),
      ).toBe(true)
    },
  )
  it('cannot persist without explicit retention confirmation', () => {
    const p = packet()
    expect(() =>
      parseEditionCreditEvidence({ ...p, source: { ...p.source, retentionConfirmed: false } }),
    ).toThrow()
  })
  it('holds unsupported origin, work basis, blank label and ambiguous credits separately', () => {
    const p = packet()
    p.source.kind = 'unverified'
    p.credits[1]!.basis = 'work'
    p.credits[2]!.sourceRole = ''
    p.credits[3]!.name = 'C. Pine'
    const r = reviewEditionCredits(p, target, [], now)
    expect(r.decisions[0]?.reasons).toEqual(['source_unverified'])
    expect(r.decisions[1]?.reasons).toContain('credit_scope_unverified')
    expect(r.decisions[2]?.reasons).toContain('role_unverified')
    expect(r.decisions[3]?.reasons).toContain('ambiguous_name')
  })
  it.each([
    [{ ...target, isbn: '9780140449136' }, 'isbn_conflict'],
    [{ ...target, isbn: null }, 'isbn_conflict'],
    [{ ...target, authors: ['Ann Brown'] }, 'identity_conflict'],
    [{ ...target, authors: ['J. Smith'] }, 'ambiguous_name'],
    [{ ...target, title: 'Still Waters: Another Book' }, 'identity_conflict'],
    [{ ...target, format: 'audiobook' }, 'edition_conflict'],
    [{ ...target, language: 'fr' }, 'edition_conflict'],
    [{ ...target, catalogIdentityConsistent: false }, 'catalog_identity_review'],
  ])('holds identity and edition conflict %#', (t, reason) => {
    expect(
      reviewEditionCredits(packet(), t, [], now).decisions.every((d) =>
        d.reasons.includes(reason as never),
      ),
    ).toBe(true)
  })
  it('accepts equivalent ISBN-10 but never uses it to defeat different authors', () => {
    const p = packet()
    p.identity.isbn = '0-306-40615-2'
    expect(reviewEditionCredits(p, target, [], now).decisions[0]?.eligible).toBe(true)
    p.identity.authors = ['Wrong Person']
    expect(reviewEditionCredits(p, target, [], now).decisions[0]?.eligible).toBe(false)
  })
  it('preserves existing credits even when a new source supports the same credit', () => {
    const p = packet(),
      existing: StoredEditionCredit[] = [
        {
          reviewId: 'old',
          position: 0,
          credit: p.credits[0]!,
          source: p.source,
          identity: p.identity,
        },
      ]
    const before = structuredClone(existing),
      r = reviewEditionCredits(p, target, existing, now)
    expect(r.decisions[0]?.reasons).toEqual(['existing_credit'])
    expect(r.decisions[1]?.eligible).toBe(true)
    expect(existing).toEqual(before)
    existing[0]!.reviewRequired = true
    expect(reviewEditionCredits(p, target, existing, now).decisions[0]?.eligible).toBe(true)
    expect(existing[0]!.credit).toEqual(before[0]!.credit)
  })
  it.each(['2026-08-01T00:00:00Z', '2026-10-18T00:00:00Z'])(
    'holds stale or future observation %s',
    (date) => {
      const p = packet()
      p.source.checkedAt = date
      expect(reviewEditionCredits(p, target, [], now).decisions[0]?.reasons).toContain(
        'stale_evidence',
      )
    },
  )
})
