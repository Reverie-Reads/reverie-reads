import { describe, expect, it } from 'vitest'
import { makeSeriesClaim, mergeImport } from '@reverie/core'
import { incomingToBook } from './intake'

describe('series provenance through intake', () => {
  it('keeps a reader-provided darkness value without inventing one for imports', () => {
    expect(incomingToBook({ title: 'Reader choice', darkness: 3 }).darkness).toBe(3)
    expect(incomingToBook({ title: 'Unknown darkness' }).darkness).toBeNull()
  })
  it('preserves an explicit manual Add choice', () => {
    const claim = makeSeriesClaim('reader', 'add', { at: '2026-08-30T12:00:00.000Z' })
    const book = incomingToBook({
      title: 'Reader Pick',
      series: 'Chosen Saga',
      seriesUserChosen: true,
      seriesClaim: claim,
    })

    expect(book.seriesUserChosen).toBe(true)
    expect(book.seriesClaim).toEqual(claim)
  })

  it('carries the incoming claim when an import fills an empty series', () => {
    const existing = incomingToBook({ title: 'Imported Book', series: '' })
    const claim = makeSeriesClaim('import', 'series_column', { confidence: 'high' })
    const result = mergeImport(existing, {
      title: 'Imported Book',
      series: 'Imported Saga',
      seriesClaim: claim,
    })

    expect(result.patch.series).toBe('Imported Saga')
    expect(result.patch.seriesClaim).toEqual(claim)
  })

  it('does not relabel a reader’s existing series when the incoming value loses', () => {
    const readerClaim = makeSeriesClaim('reader', 'book_edit')
    const existing = incomingToBook({
      title: 'Curated Book',
      series: 'Reader Saga',
      seriesClaim: readerClaim,
    })
    const result = mergeImport(existing, {
      title: 'Curated Book',
      series: 'Import Saga',
      seriesClaim: makeSeriesClaim('import', 'series_column'),
    })

    expect(result.patch).not.toHaveProperty('series')
    expect(result.patch).not.toHaveProperty('seriesClaim')
  })
})
