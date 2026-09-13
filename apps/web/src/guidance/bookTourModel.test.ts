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
    expect(reduce(saved, { type: 'end' })).toEqual({ ...initial, run: saved.run })
  })
})

describe('the live reading walkthrough', () => {
  const choose = () => reduce(initial, { type: 'start-reading' })
  const open = (reading = false) =>
    reduce(choose(), { type: 'reading-open', bookId: 'mine', reading })
  const action = (
    state: ReturnType<typeof open>,
    next: Extract<Parameters<typeof reduce>[1], { type: 'reading' }>['action'],
    bookId = 'mine',
    run = state.run,
  ) => reduce(state, { type: 'reading', action: next, bookId, run })

  it('selects only an opened personal book and cannot advance from optimistic book observations', () => {
    const started = open()
    expect(started.step).toBe('read-start')
    expect(reduce(started, { type: 'reading-open', bookId: 'mine', reading: true })).toBe(started)
    expect(reduce(started, { type: 'reading-open', bookId: 'other', reading: true })).toBe(started)
    expect(reduce(started, { type: 'observe', step: 'opened', bookId: 'mine' })).toBe(started)
    expect(action(started, 'started', 'other')).toBe(started)
    expect(action(started, 'started').step).toBe('read-progress')
  })
  it('waits for successful saves and keeps finishing optional', () => {
    const reading = open(true)
    expect(reading.step).toBe('read-progress')
    expect(action(reading, 'finished')).toBe(reading)
    const editor = action(reading, 'progress-open')
    expect(action(editor, 'progress-close').step).toBe('read-progress')
    const saved = action(editor, 'progress-saved')
    expect(saved.step).toBe('read-saved')
    const finish = action(saved, 'offer-finish')
    const finishEditor = action(finish, 'finish-open')
    expect(action(finishEditor, 'finish-close').step).toBe('read-finish')
    const finished = action(finishEditor, 'finished')
    expect(finished.step).toBe('read-finished')
    const reflect = action(finished, 'reflect-open')
    expect(reflect.step).toBe('read-reflect')
    expect(action(reflect, 'reflect-close').step).toBe('read-finished')
    expect(reduce(saved, { type: 'end' }).status).toBe('off')
  })
  it('does not confuse a late successful save from an earlier walkthrough with this one', () => {
    const earlier = action(open(true), 'progress-open')
    const restarted = reduce(earlier, { type: 'start-reading' })
    const chosen = reduce(restarted, { type: 'reading-open', bookId: 'mine', reading: true })
    const editor = action(chosen, 'progress-open')
    expect(editor.run).toBeGreaterThan(earlier.run)
    expect(action(editor, 'progress-saved', 'mine', earlier.run)).toBe(editor)
    const paused = reduce(editor, { type: 'pause' })
    expect(action(paused, 'progress-saved')).toMatchObject({ status: 'paused', step: 'read-saved' })
  })
})
