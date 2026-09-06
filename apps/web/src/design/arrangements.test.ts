import { describe, expect, it } from 'vitest'
import {
  ARRANGEMENT_PRESETS,
  MAX_PRIORITY_DESTINATIONS,
  arrangementDocument,
  arrangementFromUnknown,
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

  it('reads a versioned account document and removes duplicate module ids', () => {
    expect(
      arrangementFromUnknown({
        version: 1,
        priorityDestinations: ['library', 'home', 'stats'],
        homeModules: ['reading', 'reading', 'year', 'unknown'],
      }),
    ).toEqual({ destinations: ['library', 'home', 'stats'], homeModules: ['reading', 'year'] })
  })

  it('falls back without trying to understand corrupt or future documents', () => {
    const expected = ARRANGEMENT_PRESETS[1]!.config
    expect(arrangementFromUnknown({ version: 2, priorityDestinations: [] })).toEqual(expected)
    expect(
      arrangementFromUnknown({
        version: 1,
        priorityDestinations: ['home', 'match'],
        homeModules: ['reading'],
      }),
    ).toEqual(expected)
  })

  it('serializes only a complete, valid priority trio', () => {
    expect(
      arrangementDocument({
        destinations: ['home', 'home', 'library'],
        homeModules: ['year', 'year'],
      }),
    ).toEqual({
      version: 1,
      priorityDestinations: ['home', 'match', 'library'],
      homeModules: ['next-read', 'reading', 'priority'],
    })
  })
})
