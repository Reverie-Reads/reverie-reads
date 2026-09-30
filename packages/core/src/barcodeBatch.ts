import { normalizeIsbn } from './match'

export const BARCODE_BATCH_LIMIT = 200
export type BarcodeCapture = {
  id: string
  isbn: string
  source: 'camera' | 'manual'
  capturedAt: string
}

/** Reject other product codes and arbitrary text containing an ISBN. Canonicalize valid 10/13s. */
export function bookBarcode(raw: string): string {
  const value = raw.trim().replace(/^ISBN(?:-1[03])?:?\s*/i, '')
  if (!/^[\dXx\s-]+$/.test(value)) return ''
  return normalizeIsbn(value)
}

export function appendBarcode(
  items: readonly BarcodeCapture[],
  capture: BarcodeCapture,
  anotherCopy = false,
): { kind: 'added'; items: BarcodeCapture[] } | { kind: 'invalid' | 'repeat' | 'full' } {
  const isbn = bookBarcode(capture.isbn)
  if (!isbn || !capture.id || items.some((item) => item.id === capture.id))
    return { kind: 'invalid' }
  if (items.length >= BARCODE_BATCH_LIMIT) return { kind: 'full' }
  if (!anotherCopy && items.some((item) => item.isbn === isbn)) return { kind: 'repeat' }
  return { kind: 'added', items: [...items, { ...capture, isbn }] }
}

/** A held barcode is one observation. Brief blur cannot rearm it; explicit copy review still follows. */
export class BarcodeFrameGate {
  private last = ''
  private emptySince: number | null = null
  read(
    values: readonly string[],
    now: number,
  ): { kind: 'book'; isbn: string } | { kind: 'invalid' | 'ambiguous' } | null {
    if (!values.length) {
      this.emptySince ??= now
      if (now - this.emptySince >= 1000) this.last = ''
      return null
    }
    this.emptySince = null
    const isbns = [...new Set(values.map(bookBarcode).filter(Boolean))]
    const key = isbns.length === 1 ? isbns[0]! : isbns.length ? 'ambiguous' : 'invalid'
    if (key === this.last) return null
    this.last = key
    if (key === 'invalid' || key === 'ambiguous') return { kind: key }
    return { kind: 'book', isbn: key }
  }
}
