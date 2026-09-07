import { expect, it } from 'vitest'
import { coverResolutionLabel } from './coverQuality'

it('separates missing observations, invalid pixels, card resolution and detail resolution', () => {
  expect(coverResolutionLabel(null)).toBe('Not measured')
  for (const [width, height] of [
    [1, 1],
    [Number.NaN, 1200],
    [800, 0],
  ] as const)
    expect(coverResolutionLabel({ width, height })).toBe('Image unavailable')
  expect(coverResolutionLabel({ width: 128, height: 192 })).toBe('May look soft')
  expect(coverResolutionLabel({ width: 800, height: 500 })).toBe('May look soft')
  expect(coverResolutionLabel({ width: 480, height: 720 })).toBe('Sharp on cards')
  expect(coverResolutionLabel({ width: 799, height: 1200 })).toBe('Sharp on cards')
  expect(coverResolutionLabel({ width: 800, height: 1200 })).toBe('Sharp in detail')
})
