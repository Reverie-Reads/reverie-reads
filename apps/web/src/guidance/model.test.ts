import { describe, expect, it } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import { DEFAULT_ARRANGEMENT_PRESET } from '../design/arrangements'
import { guidanceAllowsPath, guidanceFromUnknown, libraryMilestones, type Guidance } from './model'
import { guidedNavigation } from './navigation'

const gentle: Guidance = {
  version: 1,
  mode: 'gentle',
  setupComplete: true,
  milestones: [],
  revealed: [],
  tour: null,
}
describe('a library that opens at the reader’s pace', () => {
  it('starts small while keeping essential controls and direct book routes reachable', () => {
    for (const path of ['/', '/library', '/add', '/settings', '/skins', '/guide', '/book/example'])
      expect(guidanceAllowsPath(path, gentle)).toBe(true)
    for (const path of ['/planner', '/stats', '/discover', '/clubs'])
      expect(guidanceAllowsPath(path, gentle)).toBe(false)
    const nav = guidedNavigation(DEFAULT_ARRANGEMENT_PRESET.config, gentle, '/')
    expect(nav.priority.map((item) => item.to)).toEqual(['/', '/guide', '/library'])
    expect(nav.other).toEqual([])
  })
  it('counts imported history and undated Soon plans without inventing a finish from DNF', () => {
    expect(
      libraryMilestones([
        makeBook({
          id: 'example',
          title: 'Example',
          readStatus: 'DNF',
          reads: [],
          planPosition: 0,
        }),
      ]),
    ).toEqual(['books', 'reading', 'planned'])
    expect(
      libraryMilestones([
        makeBook({
          id: 'example',
          title: 'Example',
          readStatus: 'Unread',
          reads: [{ date: '', format: '', rating: 0, notes: '' }],
        }),
      ]),
    ).toEqual(['books', 'reading', 'finished'])
    expect(libraryMilestones([])).toEqual([])
  })
  it('introduces tools from meaningful milestones and allows deliberate early exploration', () => {
    expect(guidanceAllowsPath('/planner', { ...gentle, milestones: ['books'] })).toBe(true)
    expect(guidanceAllowsPath('/series', { ...gentle, milestones: ['reading'] })).toBe(true)
    expect(guidanceAllowsPath('/stats', { ...gentle, milestones: ['finished'] })).toBe(true)
    expect(guidanceAllowsPath('/discover', { ...gentle, milestones: ['planned'] })).toBe(true)
    expect(guidanceAllowsPath('/clubs', { ...gentle, revealed: ['share'] })).toBe(true)
    expect(guidanceAllowsPath('/clubs', { ...gentle, mode: 'full' })).toBe(true)
  })
  it('preserves a deliberately arranged dock and the active route', () => {
    const nav = guidedNavigation(
      { destinations: ['library', 'stats', 'planner'], homeModules: [] },
      gentle,
      '/series/example',
    )
    expect(nav.priority.map((item) => item.to)).toEqual(['/library', '/stats', '/planner'])
    expect(nav.other.map((item) => item.to)).toContain('/series')
    expect(nav.other.map((item) => item.to)).toContain('/guide')
  })
  it('keeps older readers full and reads future documents without overwriting them', () => {
    expect(guidanceAllowsPath('/clubs', undefined)).toBe(true)
    const future = { ...gentle, version: 2 }
    expect(guidanceFromUnknown(future)).toBeNull()
    expect(future.version).toBe(2)
    expect(
      guidanceFromUnknown({
        ...gentle,
        milestones: ['books', 'book-id'],
        revealed: ['share', 'billing'],
        tour: 'billing',
      }),
    ).toEqual({ ...gentle, milestones: ['books'], revealed: ['share'] })
  })
})
