import { describe, expect, it } from 'vitest'
import { bookTourReducer as reduce, INITIAL_BOOK_TOUR as initial } from './bookTourModel'

describe('the live book walkthrough', () => {
  it('never starts from merely observing a book screen', () => {
    expect(reduce(initial, { type: 'observe', step: 'saved', bookId: 'other' })).toBe(initial)
  })
  it('requires a saved identity and only completes when that book is opened', () => {
    const started = reduce(initial, { type: 'start' })
    expect(reduce(started, { type: 'observe', step: 'saved' })).toBe(started)
    const saved = reduce(started, { type: 'observe', step: 'saved', bookId: 'mine' })
    expect(reduce(saved, { type: 'observe', step: 'opened', bookId: 'other' })).toBe(saved)
    const library = reduce(saved, { type: 'observe', step: 'library', bookId: 'mine' })
    expect(reduce(library, { type: 'observe', step: 'opened', bookId: 'mine' }).step).toBe('opened')
  })
  it('follows completed reader actions while paused without restarting animation', () => {
    const paused = reduce(reduce(initial, { type: 'start' }), { type: 'pause' })
    const saved = reduce(paused, { type: 'observe', step: 'saved', bookId: 'mine' })
    expect(saved.status).toBe('paused')
    expect(reduce(saved, { type: 'resume' })).toEqual({ ...saved, status: 'active' })
    expect(reduce(saved, { type: 'pause' })).toBe(saved)
  })
  it('clears the session identity on a new search, restart or exit', () => {
    const saved = reduce(reduce(initial, { type: 'start' }), {
      type: 'observe',
      step: 'saved',
      bookId: 'mine',
    })
    expect(reduce(saved, { type: 'observe', step: 'search' }).bookId).toBeNull()
    expect(reduce(saved, { type: 'start' }).bookId).toBeNull()
    expect(reduce(saved, { type: 'end' })).toBe(initial)
  })
})
