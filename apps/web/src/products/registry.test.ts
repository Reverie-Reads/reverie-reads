import { describe, expect, it } from 'vitest'
import { registerProduct, registeredProducts } from './registry'
const collector = {
  id: 'collector',
  name: 'Midniht Collector',
  description: 'Your collection',
  homePath: '/collector',
} as const

describe('product build registry', () => {
  it('contains Reader only until a delivered private implementation registers', () => {
    expect(registeredProducts().map((p) => p.id)).toEqual(['reader'])
    const unregister = registerProduct(collector)
    try {
      expect(registeredProducts().map((p) => p.id)).toEqual(['reader', 'collector'])
      expect(() => registerProduct(collector)).toThrow()
      expect(() => registerProduct({ ...collector, id: 'reader' })).toThrow()
    } finally {
      unregister()
    }
    expect(registeredProducts().map((p) => p.id)).toEqual(['reader'])
  })
  it.each(['https://example.com', '//example.com', '/auth?token=x', '/'])(
    'refuses unsafe or ambiguous registered entry %s',
    (homePath) => {
      expect(() => registerProduct({ ...collector, homePath })).toThrow()
    },
  )
})
