import { describe, expect, it } from 'vitest'
import { roomMapPalette } from './roomMapPalette'

describe('roomMapPalette', () => {
  it('uses the active room tokens for the reader and bookstore markers', () => {
    const values = new Map([
      ['--primary', 'rgb(111, 40, 72)'],
      ['--accent', 'rgb(176, 121, 49)'],
      ['--gold', 'rgb(214, 172, 95)'],
    ])

    expect(roomMapPalette({ getPropertyValue: (name) => values.get(name) ?? '' })).toEqual({
      origin: 'rgb(214, 172, 95)',
      store: 'rgb(111, 40, 72)',
    })
  })

  it('uses another authored room token when a specialized token is unavailable', () => {
    const values = new Map([
      ['--primary', 'rgb(33, 72, 100)'],
      ['--accent', 'rgb(90, 156, 169)'],
    ])

    expect(roomMapPalette({ getPropertyValue: (name) => values.get(name) ?? '' })).toEqual({
      origin: 'rgb(90, 156, 169)',
      store: 'rgb(33, 72, 100)',
    })
  })
})
