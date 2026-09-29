import { describe, expect, it } from 'vitest'
import {
  appendBarcode,
  BarcodeFrameGate,
  bookBarcode,
  BARCODE_BATCH_LIMIT,
  type BarcodeCapture,
} from './barcodeBatch'
const isbn = '9780141439518'
const capture = (id: string, value = isbn): BarcodeCapture => ({
  id,
  isbn: value,
  source: 'camera',
  capturedAt: '2026-09-29T00:00:00Z',
})
describe('book barcode capture', () => {
  it('canonicalizes valid ISBN-10/13 while rejecting product codes, broken checksums and URLs', () => {
    expect(bookBarcode('ISBN-10: 0-14-143951-3')).toBe(isbn)
    expect(bookBarcode('978-0-14-143951-8')).toBe(isbn)
    for (const bad of [
      '9780141439519',
      '4006381333931',
      'https://example.org/9780141439518',
      'book 9780141439518',
      '12345',
    ])
      expect(bookBarcode(bad)).toBe('')
  })
  it('requires an explicit distinct-copy decision, including ISBN-10 equivalence', () => {
    const first = capture('one')
    expect(appendBarcode([first], capture('two', '0141439513'))).toEqual({ kind: 'repeat' })
    const accepted = appendBarcode([first], capture('two', '0141439513'), true)
    expect(accepted).toEqual({ kind: 'added', items: [first, capture('two')] })
    expect(appendBarcode([first], first, true)).toEqual({ kind: 'invalid' })
  })
  it('refuses overflow without losing the existing batch', () => {
    const items = Array.from({ length: BARCODE_BATCH_LIMIT }, (_, i) => capture(String(i)))
    expect(appendBarcode(items, capture('next'), true)).toEqual({ kind: 'full' })
    expect(items).toHaveLength(BARCODE_BATCH_LIMIT)
  })
  it('counts a held barcode once and requires a sustained empty view before rearming', () => {
    const gate = new BarcodeFrameGate()
    expect(gate.read([isbn], 0)).toEqual({ kind: 'book', isbn })
    expect(gate.read([isbn], 300)).toBeNull()
    gate.read([], 500)
    expect(gate.read([isbn], 700)).toBeNull()
    gate.read([], 1000)
    gate.read([], 2100)
    expect(gate.read([isbn], 2300)).toEqual({ kind: 'book', isbn })
  })
  it('reads a new book immediately and refuses ambiguous simultaneous ISBNs', () => {
    const gate = new BarcodeFrameGate()
    gate.read([isbn], 0)
    expect(gate.read(['9780141441146'], 300)).toEqual({ kind: 'book', isbn: '9780141441146' })
    expect(gate.read([isbn, '9780141441146'], 600)).toEqual({ kind: 'ambiguous' })
    expect(gate.read(['51299'], 900)).toEqual({ kind: 'invalid' })
    expect(gate.read(['51299', isbn], 1200)).toEqual({ kind: 'book', isbn })
  })
})
