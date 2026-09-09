import { describe, expect, it } from 'vitest'
import {
  choosePlaceholderCoverPatch,
  keepCurrentCoverPatch,
  personalCoverConcern,
} from './personalCoverStudio'

const book = (
  patch: Partial<Parameters<typeof personalCoverConcern>[0]> = {},
): Parameters<typeof personalCoverConcern>[0] => ({
  cover: 'https://covers.example.test/book.jpg',
  coverConfidence: 'high',
  coverUserChosen: false,
  ...patch,
})

describe('personal Cover Studio queue', () => {
  it('puts broken, missing, uncertain, and observed-soft automatic covers in attention order', () => {
    expect(personalCoverConcern(book(), { broken: true })).toBe('broken')
    expect(personalCoverConcern(book({ cover: '' }))).toBe('missing')
    expect(personalCoverConcern(book({ coverConfidence: 'low' }))).toBe('uncertain')
    expect(personalCoverConcern(book(), { measurement: { width: 128, height: 192 } })).toBe('soft')
  })

  it('keeps intentional placeholders and reader-selected art settled', () => {
    expect(personalCoverConcern(book({ cover: '', coverUserChosen: true }))).toBeNull()
    expect(
      personalCoverConcern(book({ coverConfidence: 'low', coverUserChosen: true }), {
        measurement: { width: 128, height: 192 },
      }),
    ).toBeNull()
  })

  it('still surfaces a broken reader-selected link', () => {
    expect(personalCoverConcern(book({ coverUserChosen: true }), { broken: true })).toBe('broken')
  })

  it('does not confuse an unavailable measurement with a soft cover', () => {
    expect(personalCoverConcern(book(), { measurement: { width: 1, height: 1 } })).toBeNull()
    expect(personalCoverConcern(book(), { measurement: { width: 800, height: 1200 } })).toBeNull()
  })

  it('records both a kept automatic cover and an intentional placeholder as reader choices', () => {
    expect(keepCurrentCoverPatch()).toEqual({
      coverUserChosen: true,
      coverConfidence: undefined,
    })
    expect(choosePlaceholderCoverPatch()).toEqual({
      cover: '',
      coverThumb: undefined,
      coverSource: undefined,
      coverSourceUrl: undefined,
      coverColor: undefined,
      coverConfidence: undefined,
      coverUserChosen: true,
    })
  })
})
