import { describe, expect, it } from 'vitest'
import {
  ARRANGEMENT_PRESETS,
  MAX_PRIORITY_DESTINATIONS,
  cloneArrangement,
  hideDestination,
  moveItem,
  restoreDestination,
} from './arrangements'

describe('modular arrangement design contract', () => {
  it('keeps Library visible and the phone dock within its measured priority limit', () => {
    for (const preset of ARRANGEMENT_PRESETS) {
      expect(preset.config.destinations).toContain('library')
      expect(preset.config.destinations).toHaveLength(MAX_PRIORITY_DESTINATIONS)
      expect(new Set(preset.config.destinations).size).toBe(preset.config.destinations.length)
      expect(new Set(preset.config.homeModules).size).toBe(preset.config.homeModules.length)
    }
  })

  it('does not hide the Library anchor', () => {
    const config = cloneArrangement(ARRANGEMENT_PRESETS[0]!.config)
    expect(hideDestination(config, 'library')).toEqual(config)
  })

  it('requires an open priority slot before restoring a destination', () => {
    const full = cloneArrangement(ARRANGEMENT_PRESETS[0]!.config)
    expect(restoreDestination(full, 'discover')).toEqual(full)

    const open = hideDestination(full, 'home')
    expect(restoreDestination(open, 'discover').destinations).toEqual([
      'library',
      'shelves',
      'discover',
    ])
  })

  it('keeps a move within the list bounds', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
  })
})
