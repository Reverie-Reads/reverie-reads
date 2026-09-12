import { describe, expect, it } from 'vitest'
import { pickedFromAddPrefill, validateAddSearch } from './AddRoute'

describe('Add route library scope', () => {
  it('keeps an ISBN from an unquoted direct link as text through the form pick', () => {
    const prefill = validateAddSearch({ title: 'Direct link', isbn: 9780804429573 })
    expect(prefill.isbn).toBe('9780804429573')
    expect(pickedFromAddPrefill(prefill)?.isbn).toBe('9780804429573')
    expect(validateAddSearch({ isbn: '080442957X' }).isbn).toBe('080442957X')
  })

  it.each([9780804429574, 804429573, Number.MAX_SAFE_INTEGER + 1, ['9780804429573']])(
    'clears an invalid non-text ISBN instead of passing %j to enrichment',
    (isbn) => {
      expect(validateAddSearch({ isbn }).isbn).toBe('')
    },
  )

  it('accepts only the explicit household scope while preserving catalog identity', () => {
    expect(
      validateAddSearch({
        scope: 'household',
        work: 'work-1',
        title: 'Household only',
        author: 'A Writer',
        cover: 'https://assets.hardcover.app/cover.jpg',
        source: 'hardcover',
      }),
    ).toEqual({
      scope: 'household',
      work: 'work-1',
      title: 'Household only',
      author: 'A Writer',
      cover: 'https://assets.hardcover.app/cover.jpg',
      source: 'hardcover',
    })
  })

  it('carries validated cover provenance into the household form pick', () => {
    const prefill = validateAddSearch({
      scope: 'household',
      title: 'Deep-linked cover',
      cover: 'https://assets.hardcover.app/cover.jpg',
      source: 'hardcover',
    })

    expect(pickedFromAddPrefill(prefill)).toMatchObject({
      title: 'Deep-linked cover',
      cover: 'https://assets.hardcover.app/cover.jpg',
      source: 'hardcover',
    })
  })

  it('carries only an exact Google Books result link into the selected-book form', () => {
    const valid = validateAddSearch({
      title: 'Linked result',
      source: 'google',
      cover: 'https://books.google.com/books/content?id=linked-result&img=1',
      sourceUrl: 'https://books.google.com/books?id=linked-result',
    })
    expect(pickedFromAddPrefill(valid)).toMatchObject({
      source: 'google',
      cover: '',
      sourceUrl: 'https://books.google.com/books?id=linked-result',
    })

    expect(
      validateAddSearch({
        title: 'Lookalike result',
        source: 'google',
        sourceUrl: 'https://books.google.com.example.test/books?id=lookalike',
      }).sourceUrl,
    ).toBeUndefined()
    expect(
      validateAddSearch({
        title: 'Mislabeled result',
        source: 'hardcover',
        sourceUrl: 'https://books.google.com/books?id=mislabeled',
      }).sourceUrl,
    ).toBeUndefined()
  })

  it.each(['personal', 'family', '', ['household'], 1, null])(
    'fails closed to personal for %j',
    (scope) => {
      expect(validateAddSearch({ scope }).scope).toBeUndefined()
    },
  )
})
