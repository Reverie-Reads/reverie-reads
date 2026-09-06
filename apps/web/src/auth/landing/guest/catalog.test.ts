import { describe, expect, it } from 'vitest'
import { isGoogleContentCover, upgradeCoverUrl } from '@reverie/core'
import { GUEST_CATALOG } from './catalog'

describe('landing guest catalog covers', () => {
  it('uses distinct Google Books editions with full and grid resolution tiers', () => {
    const covers = GUEST_CATALOG.map((book) => book.cover)
    expect(new Set(covers)).toHaveLength(GUEST_CATALOG.length)
    for (const cover of covers) {
      expect(isGoogleContentCover(cover)).toBe(true)
      expect(upgradeCoverUrl(cover, 'full')).toMatch(/[?&]zoom=0(?:&|$)/)
      expect(upgradeCoverUrl(cover, 'thumb')).toMatch(/[?&]zoom=2(?:&|$)/)
    }
  })
})
