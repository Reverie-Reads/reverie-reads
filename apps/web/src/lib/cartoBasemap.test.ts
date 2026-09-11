import { describe, expect, it } from 'vitest'
import { cartoBasemapUrl } from './cartoBasemap'

describe('cartoBasemapUrl', () => {
  it('fails closed when the basemap key is absent', () => {
    expect(cartoBasemapUrl('light')).toBeNull()
    expect(cartoBasemapUrl('dark', '   ')).toBeNull()
  })

  it('selects the room mode and safely encodes the configured key', () => {
    expect(cartoBasemapUrl('light', ' public/key ')).toBe(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=public%2Fkey',
    )
    expect(cartoBasemapUrl('dark', 'key-123')).toContain('/dark_all/')
  })
})
