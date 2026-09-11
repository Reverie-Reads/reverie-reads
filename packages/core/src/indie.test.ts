import { describe, expect, it } from 'vitest'
import {
  formatHours12,
  geoCacheKey,
  haversineKm,
  isChain,
  parseStores,
  safeStoreWebsite,
  type OverpassEl,
} from './indie'

describe('isChain', () => {
  it('excludes known chains, keeps independents', () => {
    expect(isChain('Barnes & Noble')).toBe(true)
    expect(isChain('Books-A-Million')).toBe(true)
    expect(isChain('Half Price Books')).toBe(true)
    expect(isChain('Faulkner House Books')).toBe(false)
    expect(isChain('Octavia Books')).toBe(false)
  })
})

describe('haversineKm', () => {
  it('is ~0 for the same point and grows with distance', () => {
    expect(haversineKm(29.95, -90.07, 29.95, -90.07)).toBeCloseTo(0, 5)
    // New Orleans → Baton Rouge ≈ 100km
    const d = haversineKm(29.95, -90.07, 30.45, -91.19)
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(135)
  })
})

describe('geoCacheKey', () => {
  it('rounds to a grid cell so nearby points share a key', () => {
    expect(geoCacheKey(29.9511, -90.0715, 25000)).toBe('stores:29.95,-90.07:25000')
    // points within the same ~1km cell collapse to one key
    expect(geoCacheKey(29.9549, -90.0742, 25000)).toBe(geoCacheKey(29.9511, -90.0715, 25000))
    // a different radius is a different key
    expect(geoCacheKey(29.95, -90.07, 10000)).not.toBe(geoCacheKey(29.95, -90.07, 25000))
  })
})

describe('parseStores', () => {
  const els: OverpassEl[] = [
    {
      type: 'node',
      id: 1,
      lat: 29.96,
      lon: -90.06,
      tags: {
        name: 'Crescent City Books',
        'addr:street': 'Chartres St',
        'addr:city': 'New Orleans',
        opening_hours: '10:00-18:00',
        website: 'https://ccbooks.com',
      },
    },
    { type: 'way', id: 2, center: { lat: 29.99, lon: -90.1 }, tags: { name: 'Barnes & Noble' } }, // chain → excluded
    { type: 'node', id: 3, lat: 29.95, lon: -90.07, tags: {} }, // unnamed, kept (no name)
    { type: 'node', id: 4, tags: { name: 'No Coords' } }, // missing coords → skipped
  ]
  it('drops chains + coordless elements, maps fields, sorts by distance', () => {
    const out = parseStores(els, 29.95, -90.07)
    expect(out.map((s) => s.id)).toEqual(['node/3', 'node/1']) // node/3 is closest
    const ccb = out.find((s) => s.id === 'node/1')!
    expect(ccb.name).toBe('Crescent City Books')
    expect(ccb.address).toBe('Chartres St New Orleans')
    expect(ccb.website).toBe('https://ccbooks.com/')
    expect(ccb.distanceKm).toBeGreaterThan(0)
    expect(out.some((s) => s.name === 'Barnes & Noble')).toBe(false)
  })
  it('handles way/relation center coords + contact:* fallbacks', () => {
    const out = parseStores(
      [
        {
          type: 'way',
          id: 9,
          center: { lat: 29.95, lon: -90.07 },
          tags: { name: 'Indie', 'contact:phone': '555-1234', 'contact:website': 'https://i.co' },
        },
      ],
      29.95,
      -90.07,
    )
    expect(out[0]).toMatchObject({ name: 'Indie', phone: '555-1234', website: 'https://i.co/' })
  })

  it('drops invalid coordinates and collapses duplicate mapped shapes', () => {
    const out = parseStores(
      [
        { type: 'node', id: 1, lat: 29.95, lon: -90.07, tags: { name: 'One Shop' } },
        { type: 'way', id: 2, center: { lat: 29.9502, lon: -90.0702 }, tags: { name: 'One Shop' } },
        { type: 'node', id: 3, lat: Number.NaN, lon: -90.07, tags: { name: 'Broken' } },
      ],
      29.95,
      -90.07,
    )
    expect(out.map((store) => store.id)).toEqual(['node/1'])
  })
})

describe('safeStoreWebsite', () => {
  it('keeps HTTP(S), repairs bare domains, and rejects executable schemes', () => {
    expect(safeStoreWebsite('bookshop.example/path')).toBe('https://bookshop.example/path')
    expect(safeStoreWebsite('http://bookshop.example')).toBe('http://bookshop.example/')
    expect(safeStoreWebsite('javascript:alert(1)')).toBe('')
    expect(safeStoreWebsite('data:text/html,bad')).toBe('')
  })
})

describe('formatHours12 — OSM opening_hours rendered for a reader', () => {
  // Real-shaped values. Overpass returns the opening_hours mini-language, not a time, and the
  // screen was printing it raw — so these assert the WHOLE string, grammar included, not just the
  // clock. Several DIFFERENT stores on purpose: an off-by-noon bug passes a single 10:00-18:00
  // fixture happily and only fails on the shop that opens at noon or closes at midnight.
  it('converts a plain weekday range', () => {
    expect(formatHours12('Mo-Fr 10:00-19:00')).toBe('Mo-Fr 10:00 AM-7:00 PM')
  })

  it('converts every period in a multi-clause value, keeping the separators', () => {
    expect(formatHours12('Mo-Fr 09:00-17:30; Sa 11:00-16:00; Su 12:00-17:00')).toBe(
      'Mo-Fr 9:00 AM-5:30 PM; Sa 11:00 AM-4:00 PM; Su 12:00 PM-5:00 PM',
    )
  })

  it('midnight is 12:00 AM, not 0:00 AM', () => {
    expect(formatHours12('Fr-Sa 18:00-00:00')).toBe('Fr-Sa 6:00 PM-12:00 AM')
  })

  it('noon is 12:00 PM, not 12:00 AM — the off-by-noon case', () => {
    expect(formatHours12('Mo 12:00-18:00')).toBe('Mo 12:00 PM-6:00 PM')
    expect(formatHours12('Mo 12:30-13:00')).toBe('Mo 12:30 PM-1:00 PM')
  })

  it("24:00 is OSM's end-of-day midnight, not midday", () => {
    // The trap: `24 % 12 === 0` would render this 12:00 PM and shut the shop twelve hours early.
    expect(formatHours12('Mo-Su 09:00-24:00')).toBe('Mo-Su 9:00 AM-12:00 AM')
  })

  it('the hour either side of noon and midnight lands correctly', () => {
    expect(formatHours12('11:00-13:00')).toBe('11:00 AM-1:00 PM')
    expect(formatHours12('23:00-01:00')).toBe('11:00 PM-1:00 AM')
  })

  it('preserves minutes exactly as written', () => {
    expect(formatHours12('Tu 08:05-20:45')).toBe('Tu 8:05 AM-8:45 PM')
  })

  it('leaves non-time grammar untouched', () => {
    expect(formatHours12('24/7')).toBe('24/7')
    expect(formatHours12('Mo-Sa 10:00-18:00; Su off')).toBe('Mo-Sa 10:00 AM-6:00 PM; Su off')
    expect(formatHours12('PH 12:00-16:00')).toBe('PH 12:00 PM-4:00 PM')
    expect(formatHours12('"by appointment"')).toBe('"by appointment"')
  })

  it('is empty for an absent tag — the screen renders nothing rather than a stray clock', () => {
    expect(formatHours12('')).toBe('')
  })

  it('leaves values that are not wall-clock times alone rather than guessing', () => {
    expect(formatHours12('Mo 10:75-18:00')).toBe('Mo 10:75-6:00 PM')
    expect(formatHours12('Mo 25:00-26:00')).toBe('Mo 25:00-26:00')
  })
})
