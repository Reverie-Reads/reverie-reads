import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SKINS, type SkinId } from '@reverie/core'
import {
  MOBILE_TAB_ITEMS,
  MORE_NAVIGATION_ITEMS,
  NAVIGATION_GROUPS,
  NAVIGATION_ITEMS,
  moreNavigationItems,
  navigationLabelForPath,
  priorityNavigationItems,
} from './navigation'

describe('navigation contract', () => {
  it('uses one complete, duplicate-free destination model', () => {
    const grouped = NAVIGATION_GROUPS.flatMap((group) => group.items)
    expect(grouped).toEqual(NAVIGATION_ITEMS)
    expect(new Set(NAVIGATION_ITEMS.map((item) => item.to)).size).toBe(NAVIGATION_ITEMS.length)
    expect(MOBILE_TAB_ITEMS.map((item) => item.label)).toEqual(['Home', 'Library', 'Next read'])
    expect(NAVIGATION_GROUPS[0].items).toEqual(MOBILE_TAB_ITEMS)
    expect(MORE_NAVIGATION_ITEMS.some((item) => item.label === 'Appearance')).toBe(true)
    expect(MORE_NAVIGATION_ITEMS.some((item) => item.label === 'Settings')).toBe(true)
    expect(MORE_NAVIGATION_ITEMS.map((item) => item.to)).toEqual([
      '/shelves',
      '/series',
      '/planner',
      '/stats',
      '/tropes',
      '/discover',
      '/clubs',
      '/indie',
      '/skins',
      '/settings',
    ])
  })

  it('gives every registered skin a desktop surface, active state, and mobile dock', () => {
    const css = readFileSync(join(__dirname, '..', 'styles', 'skin-kit.css'), 'utf8')

    for (const skin of Object.keys(SKINS) as SkinId[]) {
      expect(css, `${skin}: desktop surface`).toContain(`[data-skin='${skin}'] .rv-nav-surface`)
      expect(css, `${skin}: active destination`).toContain(
        `[data-skin='${skin}'] .rv-nav-item-active`,
      )
      expect(css, `${skin}: mobile dock`).toContain(`[data-skin='${skin}'] .rv-mobile-dock`)
    }
  })

  it('names primary and detail destinations in compact mobile chrome', () => {
    expect(navigationLabelForPath('/')).toBe('Home')
    expect(navigationLabelForPath('/library')).toBe('Library')
    expect(navigationLabelForPath('/match')).toBe('Next read')
    expect(navigationLabelForPath('/indie')).toBe('Bookshops')
    expect(navigationLabelForPath('/skins')).toBe('Appearance')
    expect(navigationLabelForPath('/settings')).toBe('Settings')
    expect(navigationLabelForPath('/series/the-court')).toBe('Series')
    expect(navigationLabelForPath('/tropes/slow-burn')).toBe('Trope')
    expect(navigationLabelForPath('/book/abc-123')).toBe('Book record')
    expect(navigationLabelForPath('/add')).toBe('Add a book')
    expect(navigationLabelForPath('/covers')).toBe('Cover Studio')
    expect(navigationLabelForPath('/something-new')).toBe('Reading room')
  })

  it('uses the saved priority order and keeps every other destination in More', () => {
    const priority = priorityNavigationItems(['library', 'home', 'stats'])
    expect(priority.map((item) => item.label)).toEqual(['Library', 'Home', 'Stats'])

    const more = moreNavigationItems(['library', 'home', 'stats'])
    expect(more.map((item) => item.label)).toEqual([
      'Next read',
      'Shelves',
      'Series',
      'Planner',
      'Tropes',
      'Discover',
      'Clubs',
      'Bookshops',
      'Appearance',
      'Settings',
    ])
  })
})
