import { describe, expect, it } from 'vitest'
import { readProductPreferences } from './productPreferences'

const reader = {
  version: 1,
  enabledProducts: ['reader'],
  activeProduct: 'reader',
  initialChoiceComplete: true,
  presentation: {},
}
describe('portable product preferences', () => {
  it('distinguishes an unconfigured account from a reader without writing defaults', () => {
    expect(readProductPreferences(null)).toEqual({ kind: 'unconfigured' })
    expect(readProductPreferences(undefined)).toEqual({ kind: 'unconfigured' })
    expect(readProductPreferences(reader)).toEqual({ kind: 'supported', document: reader })
  })
  it('retains independent Collector presentation without a Reader dock parser', () => {
    const document = {
      ...reader,
      enabledProducts: ['reader', 'collector'],
      activeProduct: 'collector',
      presentation: {
        collector: {
          version: 42,
          dock: ['trips', 'locations'],
          privateExtension: { collapsed: true },
        },
      },
    }
    expect(readProductPreferences(document)).toEqual({ kind: 'supported', document })
  })
  it.each([
    { ...reader, version: 2 },
    { ...reader, enabledProducts: ['bookseller'], activeProduct: 'bookseller' },
    { ...reader, presentation: { bookseller: { version: 1 } } },
  ])('does not coerce future product documents into Reader: %j', (document) => {
    const original = JSON.stringify(document)
    expect(readProductPreferences(document)).toEqual({ kind: 'unsupported' })
    expect(JSON.stringify(document)).toBe(original)
  })
  it.each([
    [],
    {},
    { ...reader, version: 0 },
    { ...reader, enabledProducts: [] },
    { ...reader, enabledProducts: ['reader', 'reader'] },
    { ...reader, activeProduct: 'collector' },
    { ...reader, initialChoiceComplete: 'true' },
    { ...reader, paid: true },
    { ...reader, presentation: { collector: { dock: [] } } },
    { ...reader, presentation: { collector: { version: 1.5 } } },
    { ...reader, presentation: { collector: { version: 1, notes: 'x'.repeat(8192) } } },
  ])('rejects malformed or authority-bearing root fields: %j', (document) => {
    expect(readProductPreferences(document)).toEqual({ kind: 'invalid' })
  })
})
