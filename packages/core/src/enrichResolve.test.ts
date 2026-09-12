import { describe, expect, it } from 'vitest'
import {
  cleanField,
  confidenceRank,
  foldDiacritics,
  matchKey,
  normalizeQuery,
  scoreCandidate,
  selectBestMatch,
  selfIsbn13,
  type ResolveCandidate,
} from './enrichResolve'
import type { SourceRecord } from './enrich'

// Build a candidate concisely.
const cand = (source: ResolveCandidate['source'], record: SourceRecord): ResolveCandidate => ({
  source,
  record,
})

describe('normalization (diacritics + whitespace)', () => {
  it('folds diacritics so accented names match their ASCII form', () => {
    expect(foldDiacritics('Céline')).toBe('Celine')
    expect(matchKey('Céline')).toBe('celine')
    expect(matchKey('Céline')).toBe(matchKey('Celine'))
  })
  it('trims + collapses whitespace (real data has "Celia ")', () => {
    expect(cleanField('  Celia   Aaron  ')).toBe('Celia Aaron')
    expect(normalizeQuery({ title: '  King of Wrath ', author: 'Ana Huang ' })).toEqual({
      title: 'King of Wrath',
      author: 'Ana Huang',
    })
  })
})

describe('selfIsbn13', () => {
  it('returns a direct 13, promotes a 10, or pulls from isbns', () => {
    expect(selfIsbn13({ isbn13: '978-1-7350-5625-8' })).toBe('9781735056258')
    expect(selfIsbn13({ isbn10: '1735056251' })).toBe('9781735056258')
    expect(selfIsbn13({ isbns: ['1735056251'] })).toBe('9781735056258')
    expect(selfIsbn13({})).toBe('')
  })
})

describe('scoreCandidate — confidence tiers', () => {
  const q = { title: 'King of Wrath', author: 'Ana Huang' }
  it('exact title + author → high', () => {
    expect(
      scoreCandidate(q, cand('hardcover', { title: 'King of Wrath', authors: ['Ana Huang'] }))
        .confidence,
    ).toBe('high')
  })
  it('exact title, no author given → medium (nothing to confirm)', () => {
    expect(
      scoreCandidate(
        { title: 'King of Wrath' },
        cand('google', { title: 'King of Wrath', authors: ['Ana Huang'] }),
      ).confidence,
    ).toBe('medium')
  })
  it('close title (subtitle dropped) + author → medium', () => {
    const s = scoreCandidate(
      q,
      cand('google', { title: 'King of Wrath: A Novel', authors: ['Ana Huang'] }),
    )
    expect(s.confidence).toBe('medium')
    expect(s.titleExact).toBe(false)
  })
  it('exact title but DIFFERENT author → low (common-title / wrong-book risk)', () => {
    expect(
      scoreCandidate(
        q,
        cand('openlibrary', { title: 'King of Wrath', authors: ['Some Other Person'] }),
      ).confidence,
    ).toBe('low')
  })
  it('close title only (no author confirm) → low', () => {
    expect(
      scoreCandidate(
        { title: 'King of Wrath' },
        cand('google', { title: 'King of Wrath: A Novel', authors: ['Anyone'] }),
      ).confidence,
    ).toBe('low')
  })
  it('unrelated title → none', () => {
    expect(
      scoreCandidate(q, cand('google', { title: 'Wuthering Heights', authors: ['Ana Huang'] }))
        .confidence,
    ).toBe('none')
  })
  it('a series search label cannot upgrade an inexact title', () => {
    const s = scoreCandidate(
      { title: 'King of Wrath', author: 'Ana Huang', series: 'Kings of Sin' },
      cand('hardcover', {
        title: 'King of Wrath: A Novel',
        authors: ['Ana Huang'],
        series: 'Kings of Sin',
      }),
    )
    expect(s.confidence).toBe('medium')
    expect(s.seriesMatch).toBe(true)
  })
  it('requires full contributor agreement rather than matching a surname', () => {
    const s = scoreCandidate(
      { title: 'A Court of Thorns and Roses', author: 'Sarah Maas' },
      cand('openlibrary', { title: 'A Court of Thorns and Roses', authors: ['Sarah J. Maas'] }),
    )
    expect(s.authorMatch).toBe(false)
    expect(s.confidence).toBe('low')
  })
})

describe('selectBestMatch', () => {
  it('picks a single exact match, self-resolves the ISBN, returns high', () => {
    const r = selectBestMatch({ title: 'King of Wrath', author: 'Ana Huang' }, [
      cand('hardcover', {
        title: 'King of Wrath',
        authors: ['Ana Huang'],
        isbn10: '1735056251',
        cover: 'a.jpg',
      }),
    ])
    expect(r.confidence).toBe('high')
    expect(r.best?.source).toBe('hardcover')
    expect(r.isbn13).toBe('9781735056258')
    expect(r.query).toBe('King of Wrath — Ana Huang')
  })

  it('author whitespace does not break the match', () => {
    const r = selectBestMatch({ title: 'King of Wrath', author: 'Ana Huang ' }, [
      cand('google', { title: 'King of Wrath', authors: ['Ana Huang'], isbn13: '9781735056258' }),
    ])
    expect(r.confidence).toBe('high')
  })

  it('same work from two sources is corroboration, not ambiguity (stays high)', () => {
    const r = selectBestMatch({ title: 'King of Wrath', author: 'Ana Huang' }, [
      cand('openlibrary', {
        title: 'King of Wrath',
        authors: ['Ana Huang'],
        isbn13: '9781735056258',
        cover: 'ol.jpg',
      }),
      cand('hardcover', {
        title: 'King of Wrath',
        authors: ['Ana Huang'],
        isbn13: '9781735056258',
        cover: 'hc.jpg',
      }),
    ])
    expect(r.confidence).toBe('high')
    expect(r.best?.source).toBe('hardcover') // catalog source priority breaks the tie
    expect(r.alternates).toHaveLength(0) // same edition → no extra choice
  })

  it('two DISTINCT works at the top tier → downgraded to low (wrong-book safety)', () => {
    const r = selectBestMatch(
      { title: 'Twisted' }, // no author to disambiguate
      [
        cand('google', { title: 'Twisted', authors: ['Ana Huang'], isbn13: '9780000000001' }),
        cand('openlibrary', {
          title: 'Twisted',
          authors: ['Lisa Jackson'],
          isbn13: '9780000000002',
        }),
      ],
    )
    expect(r.confidence).toBe('low')
    expect(r.reason).toMatch(/ambiguous/)
    expect(r.alternates.length).toBeGreaterThanOrEqual(1) // the loser is offered as a choice
  })

  it('an author disambiguates a shared title (the matching author wins, stays high)', () => {
    const r = selectBestMatch({ title: 'Twisted', author: 'Ana Huang' }, [
      cand('google', { title: 'Twisted', authors: ['Ana Huang'], isbn13: '9780000000001' }),
      cand('openlibrary', { title: 'Twisted', authors: ['Lisa Jackson'], isbn13: '9780000000002' }),
    ])
    expect(r.confidence).toBe('high')
    expect((r.best?.record.authors ?? [])[0]).toBe('Ana Huang')
  })

  it('keeps other editions of the same work as alternates (different ISBN, has a cover)', () => {
    const r = selectBestMatch({ title: 'King of Wrath', author: 'Ana Huang' }, [
      cand('hardcover', {
        title: 'King of Wrath',
        authors: ['Ana Huang'],
        isbn13: '9780000000001',
        cover: 'special.jpg',
      }),
      cand('google', {
        title: 'King of Wrath',
        authors: ['Ana Huang'],
        isbn13: '9780000000002',
        cover: 'paperback.jpg',
      }),
    ])
    expect(r.confidence).toBe('high') // same work, different editions → not ambiguous
    expect(r.alternates).toHaveLength(1)
    expect(r.alternates[0]?.record.cover).toBe('paperback.jpg')
  })

  it('no candidate matches → none + null best', () => {
    const r = selectBestMatch({ title: 'King of Wrath', author: 'Ana Huang' }, [
      cand('google', { title: 'Completely Different', authors: ['Nobody'] }),
    ])
    expect(r.confidence).toBe('none')
    expect(r.best).toBeNull()
    expect(confidenceRank(r.confidence)).toBe(0)
  })
})
