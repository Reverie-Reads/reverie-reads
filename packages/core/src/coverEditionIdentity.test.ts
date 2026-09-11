import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  editionsCacheKey,
  hardcoverCoverBookId,
  matchesCoverWork,
  uniqueCoverBookId,
} from '../../../supabase/functions/covers/editionIdentity'

const audition = { title: 'Audition', author: 'Katie Kitamura' }
const hit = (id: unknown, title: string, author: string) => ({
  document: { id, title, author_names: [author] },
})

describe('alternate cover identity', () => {
  it('rejects near titles and unrelated authors even when search returns them first', () => {
    expect(
      hardcoverCoverBookId(audition, [
        hit(1, 'The Audition', 'Maddie Ziegler'),
        hit(2, 'Audition', 'Katie Kitamura'),
      ]),
    ).toBe(2)
  })

  it('requires a full known author for title-based matches, not just a name fragment', () => {
    expect(matchesCoverWork(audition, 'Audition', ['K. Kitamura'])).toBe(false)
    expect(matchesCoverWork({ title: 'Audition' }, 'Audition', ['Katie Kitamura'])).toBe(false)
    expect(matchesCoverWork(audition, 'Audition', null)).toBe(false)
    expect(matchesCoverWork(audition, '', ['Katie Kitamura'])).toBe(false)
  })

  it('normalizes case, accents and punctuation while retaining complete identity', () => {
    expect(
      matchesCoverWork({ title: 'Jane Eyre', author: 'Charlotte Brontë' }, 'JANE EYRE', [
        'Charlotte Bronte',
      ]),
    ).toBe(true)
    expect(
      matchesCoverWork({ title: 'Birds of Belize', author: 'H. Lee Jones' }, 'Birds of Belize', [
        'H Lee Jones',
        'Another Contributor',
      ]),
    ).toBe(true)
  })

  it('refuses ambiguous or malformed Hardcover work identities instead of choosing first', () => {
    expect(
      hardcoverCoverBookId(audition, [
        hit(1, 'Audition', 'Katie Kitamura'),
        hit(2, 'Audition', 'Katie Kitamura'),
      ]),
    ).toBeNull()
    expect(
      hardcoverCoverBookId(audition, [
        hit('2', 'Audition', 'Katie Kitamura'),
        hit(2, 'Audition', 'Katie Kitamura'),
      ]),
    ).toBe(2)
    expect(hardcoverCoverBookId(audition, [hit('2junk', 'Audition', 'Katie Kitamura')])).toBeNull()
    expect(
      hardcoverCoverBookId(audition, [null, {}, hit(1, 'Audition', 'Someone Else')]),
    ).toBeNull()
    for (const ids of [[], [0], [-1], [1.5], [1, 2], [1, undefined], [Infinity]])
      expect(uniqueCoverBookId(ids)).toBeNull()
  })

  it('invalidates old candidate caches and scopes new ones to every lookup input', () => {
    const key = editionsCacheKey({ ...audition, isbn: '0141441143' })
    expect(key).toBe('editions:v2:9780141441146:audition|katiekitamura')
    expect(key).toBe(editionsCacheKey({ ...audition, isbn: '9780141441146' }))
    expect(key).not.toBe(
      editionsCacheKey({ title: 'Another book', author: 'Another author', isbn: '0141441143' }),
    )
  })

  it('keeps the tested guards in the deployed edition path, ahead of cover construction and cache reuse', () => {
    const edge = readFileSync(
      join(__dirname, '../../../supabase/functions/covers/index.ts'),
      'utf8',
    )
    expect(edge).toContain('bookId = hardcoverCoverBookId(input, d?.search?.results?.hits)')
    expect(edge).toContain('bookId = uniqueCoverBookId(matches.map((edition) => edition.book_id))')
    expect(edge).toContain('if (matches.length && bookId == null) return []')
    const openLibrary = edge.indexOf('function openLibraryEdition(input: EditionsInput)')
    expect(openLibrary).toBeGreaterThan(-1)
    expect(
      edge.indexOf('if (isbn.length !== 10 && isbn.length !== 13) return []', openLibrary),
    ).toBeLessThan(edge.indexOf('https://covers.openlibrary.org/b/isbn/', openLibrary))
    expect(edge).not.toContain('bestGoogleCoverLink')
    expect(edge).toContain("from './editionIdentity.ts'")
    expect(edge).toContain('const key = `cover-editions:v2:${editionsCacheKey(input)}`')
  })
})
