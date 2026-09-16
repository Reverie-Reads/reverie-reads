import { describe, expect, it } from 'vitest'
import {
  bookTourReducer as reduce,
  INITIAL_BOOK_TOUR as initial,
  isBookTourLocation,
  bookTourReturnHref,
} from './bookTourModel'

describe('the live book walkthrough', () => {
  it('never starts from merely observing a book screen', () => {
    expect(reduce(initial, { type: 'observe', run: 1, step: 'saved', bookId: 'other' })).toBe(
      initial,
    )
  })
  it('requires a saved identity and only completes when that book is opened', () => {
    const started = reduce(initial, { type: 'start' })
    expect(reduce(started, { type: 'observe', run: 1, step: 'saved' })).toBe(started)
    expect(reduce(started, { type: 'observe', run: 1, step: 'saved-loading' })).toBe(started)
    const loading = reduce(started, {
      type: 'observe',
      run: 1,
      step: 'saved-loading',
      bookId: 'mine',
    })
    expect(loading.step).toBe('saved-loading')
    expect(loading.bookId).toBe('mine')
    const replay = reduce(loading, { type: 'start' })
    expect(reduce(replay, { type: 'observe', run: 1, step: 'saved-loading', bookId: 'mine' })).toBe(
      replay,
    )
    const saved = reduce(started, { type: 'observe', run: 1, step: 'saved', bookId: 'mine' })
    expect(reduce(saved, { type: 'observe', run: 1, step: 'opened', bookId: 'other' })).toBe(saved)
    const library = reduce(saved, { type: 'observe', run: 1, step: 'library', bookId: 'mine' })
    expect(reduce(library, { type: 'observe', run: 1, step: 'opened', bookId: 'mine' }).step).toBe(
      'opened',
    )
  })
  it('follows completed reader actions while paused without restarting animation', () => {
    const paused = reduce(reduce(initial, { type: 'start' }), { type: 'pause' })
    const saved = reduce(paused, { type: 'observe', run: 1, step: 'saved', bookId: 'mine' })
    expect(saved.status).toBe('paused')
    expect(reduce(saved, { type: 'resume' })).toEqual({ ...saved, status: 'active' })
    expect(reduce(saved, { type: 'pause' })).toBe(saved)
  })
  it('clears the session identity on a new search, restart or exit', () => {
    const saved = reduce(reduce(initial, { type: 'start' }), {
      type: 'observe',
      run: 1,
      step: 'saved',
      bookId: 'mine',
    })
    expect(reduce(saved, { type: 'observe', run: 1, step: 'search' }).bookId).toBeNull()
    expect(reduce(saved, { type: 'start' }).bookId).toBeNull()
    expect(reduce(saved, { type: 'end' })).toEqual({ ...initial, run: saved.run })
  })
})

describe('the live reading walkthrough', () => {
  const choose = () => reduce(initial, { type: 'start-reading' })
  const open = (reading = false) =>
    reduce(choose(), { type: 'reading-open', run: 1, bookId: 'mine', reading })
  const action = (
    state: ReturnType<typeof open>,
    next: Extract<Parameters<typeof reduce>[1], { type: 'reading' }>['action'],
    bookId = 'mine',
    run = state.run,
  ) => reduce(state, { type: 'reading', action: next, bookId, run })

  it('selects only an opened personal book and cannot advance from optimistic book observations', () => {
    const started = open()
    expect(started.step).toBe('read-start')
    expect(reduce(started, { type: 'reading-open', run: 1, bookId: 'mine', reading: true })).toBe(
      started,
    )
    expect(reduce(started, { type: 'reading-open', run: 1, bookId: 'other', reading: true })).toBe(
      started,
    )
    expect(reduce(started, { type: 'observe', run: 1, step: 'opened', bookId: 'mine' })).toBe(
      started,
    )
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
    const chosen = reduce(restarted, {
      type: 'reading-open',
      run: restarted.run,
      bookId: 'mine',
      reading: true,
    })
    const editor = action(chosen, 'progress-open')
    expect(editor.run).toBeGreaterThan(earlier.run)
    expect(action(editor, 'progress-saved', 'mine', earlier.run)).toBe(editor)
    const paused = reduce(editor, { type: 'pause' })
    expect(action(paused, 'progress-saved')).toMatchObject({ status: 'paused', step: 'read-saved' })
  })
})

describe('contextual walkthrough entry', () => {
  it('binds the current book before an old or unrelated screen observation can choose it', () => {
    const earlier = reduce(initial, { type: 'start-reading' })
    const current = reduce(earlier, { type: 'start-reading', bookId: 'current' })
    expect(
      reduce(current, { type: 'reading-open', run: earlier.run, bookId: 'current', reading: true }),
    ).toBe(current)
    expect(
      reduce(current, { type: 'reading-open', run: current.run, bookId: 'other', reading: true }),
    ).toBe(current)
    expect(
      reduce(current, { type: 'reading-open', run: current.run, bookId: 'current', reading: true }),
    ).toMatchObject({ bookId: 'current', step: 'read-progress' })
  })

  it('ignores a stale intake observation or return location after restarting', () => {
    const old = reduce(initial, { type: 'start' })
    const current = reduce(old, { type: 'start' })
    expect(reduce(current, { type: 'observe', run: old.run, step: 'saved', bookId: 'old' })).toBe(
      current,
    )
    expect(reduce(current, { type: 'location', run: old.run, href: '/add?title=old' })).toBe(
      current,
    )
    const located = reduce(current, {
      type: 'location',
      run: current.run,
      href: '/library?view=list',
    })
    expect(reduce(located, { type: 'pause' }).returnTo).toBe('/library?view=list')
    expect(reduce(located, { type: 'end' }).returnTo).toBeNull()
  })
})

describe('resuming in the right place', () => {
  it('retains an unselected library URL, but returns a selected reading task to its own book', () => {
    let state = reduce(initial, { type: 'start-reading' })
    state = reduce(state, { type: 'location', run: state.run, href: '/library?view=list' })
    expect(bookTourReturnHref(state)).toBe('/library?view=list')
    expect(isBookTourLocation(state, '/add')).toBe(false)
    state = reduce(state, { type: 'reading-open', run: state.run, bookId: 'mine', reading: true })
    expect(bookTourReturnHref(state)).toBe('/book/mine')
    expect(isBookTourLocation(state, '/book/mine')).toBe(true)
    expect(isBookTourLocation(state, '/book/other')).toBe(false)
    expect(isBookTourLocation(state, '/library')).toBe(false)
  })
})

describe('Next read follows deliberate choices', () => {
  const start = () => reduce(initial, { type: 'start-next-read' })
  it('keeps the selected URL and ignores old chapter observations', () => {
    const current = start()
    const located = reduce(current, {
      type: 'location',
      run: current.run,
      href: '/match?scope=wishlist&vibeQ=quiet',
    })
    expect(bookTourReturnHref(located)).toBe('/match?scope=wishlist&vibeQ=quiet')
    expect(isBookTourLocation(located, '/add')).toBe(false)
    expect(
      reduce(located, { type: 'observe', run: current.run, step: 'opened', bookId: 'unselected' }),
    ).toBe(located)
    expect(
      reduce(located, {
        type: 'reading-open',
        run: current.run,
        bookId: 'unselected',
        reading: true,
      }),
    ).toBe(located)
  })
  it('continues only into the chosen loaded book, retaining an intentional pause', () => {
    const selected = reduce(start(), {
      type: 'next-read',
      run: 1,
      action: 'select',
      bookId: 'mine',
    })
    expect(isBookTourLocation(selected, '/match')).toBe(true)
    expect(isBookTourLocation(selected, '/book/mine')).toBe(true)
    expect(isBookTourLocation(selected, '/book/other')).toBe(false)
    expect(reduce(selected, { type: 'reading-open', run: 1, bookId: 'other', reading: true })).toBe(
      selected,
    )
    expect(reduce(selected, { type: 'next-read', run: 1, action: 'saved' })).toBe(selected)
    const paused = reduce(selected, { type: 'pause' })
    expect(
      reduce(paused, { type: 'reading-open', run: 1, bookId: 'mine', reading: true }),
    ).toMatchObject({ journey: 'reading', bookId: 'mine', step: 'read-progress', status: 'paused' })
  })
  it('does not credit late TBR/start results to a replay or another guide', () => {
    const previous = start()
    const current = reduce(previous, { type: 'start-next-read' })
    expect(reduce(current, { type: 'next-read', run: previous.run, action: 'saved' })).toBe(current)
    expect(
      reduce(current, { type: 'next-read', run: previous.run, action: 'select', bookId: 'old' }),
    ).toBe(current)
    const reading = reduce(current, { type: 'start-reading' })
    expect(reduce(reading, { type: 'next-read', run: current.run, action: 'saved' })).toBe(reading)
    expect(
      reduce(reduce(current, { type: 'end' }), {
        type: 'next-read',
        run: current.run,
        action: 'saved',
      }),
    ).toMatchObject({ status: 'off' })
    expect(reduce(current, { type: 'next-read', run: current.run, action: 'saved' })).toMatchObject(
      { step: 'next-saved', bookId: null },
    )
  })
})

describe('Planner follows the mounted context and confirmed editor', () => {
  const start = () => reduce(initial, { type: 'start-planner' })
  const editor = (state = start(), editorId = 'editor-one', bookId = 'mine') =>
    reduce(state, {
      type: 'planner-context',
      run: state.run,
      context: { kind: 'editor', bookId, editorId, view: 'calendar' },
    })
  it('starts only explicitly and remembers the actual Planner view', () => {
    expect(
      reduce(initial, {
        type: 'planner-context',
        run: 0,
        context: { kind: 'view', view: 'calendar' },
      }),
    ).toBe(initial)
    const state = reduce(start(), {
      type: 'planner-context',
      run: 1,
      context: { kind: 'view', view: 'releases' },
    })
    expect(state.step).toBe('plan-releases')
    expect(isBookTourLocation(state, '/planner')).toBe(true)
    expect(isBookTourLocation(state, '/match')).toBe(false)
    expect(bookTourReturnHref({ ...state, returnTo: '/planner?tab=releases' })).toBe(
      '/planner?tab=releases',
    )
  })
  it('does not turn an editor observation or an ordinary book event into a saved plan', () => {
    const state = editor()
    expect(state.step).toBe('plan-timing')
    expect(
      reduce(state, { type: 'observe', run: state.run, step: 'plan-saved', bookId: 'mine' }),
    ).toBe(state)
    expect(
      reduce(state, { type: 'reading', run: state.run, action: 'started', bookId: 'mine' }),
    ).toBe(state)
    expect(
      reduce(initial, { type: 'planner-saved', run: 0, editorId: 'editor-one', bookId: 'mine' }),
    ).toBe(initial)
  })
  it('rejects successes from another book, closed editor or restarted run', () => {
    const state = editor()
    const success = {
      type: 'planner-saved' as const,
      run: state.run,
      bookId: 'mine',
      editorId: 'editor-one',
    }
    expect(reduce(state, { ...success, bookId: 'other' })).toBe(state)
    expect(reduce(state, { ...success, editorId: 'old-editor' })).toBe(state)
    const closed = reduce(state, {
      type: 'planner-context',
      run: state.run,
      context: { kind: 'view', view: 'calendar' },
    })
    expect(reduce(closed, success)).toBe(closed)
    const reopened = editor(closed, 'editor-two')
    expect(reduce(reopened, success)).toBe(reopened)
    const replay = editor(reduce(state, { type: 'start-planner' }))
    expect(reduce(replay, success)).toBe(replay)
  })
  it('retains a confirmed save after closing the editor, but follows a deliberate tab change', () => {
    const state = editor()
    const saved = reduce(state, {
      type: 'planner-saved',
      run: state.run,
      bookId: 'mine',
      editorId: 'editor-one',
    })
    expect(saved.step).toBe('plan-saved')
    const closed = reduce(saved, {
      type: 'planner-context',
      run: state.run,
      context: { kind: 'view', view: 'calendar' },
    })
    expect(closed.step).toBe('plan-saved')
    expect(
      reduce(closed, {
        type: 'planner-context',
        run: state.run,
        context: { kind: 'view', view: 'queue' },
      }).step,
    ).toBe('plan-queue')
  })
  it('replays in the current editor and does not reset a note step on ordinary observation', () => {
    const state = editor()
    const note = reduce(state, { type: 'planner-step', run: state.run, step: 'plan-note' })
    expect(editor(note)).toBe(note)
    expect(editor(reduce(note, { type: 'start-planner' })).step).toBe('plan-timing')
    const paused = reduce(note, { type: 'pause' })
    const saved = reduce(paused, {
      type: 'planner-saved',
      run: paused.run,
      bookId: 'mine',
      editorId: 'editor-one',
    })
    expect(saved.step).toBe('plan-saved')
    expect(saved.status).toBe('paused')
  })
})
