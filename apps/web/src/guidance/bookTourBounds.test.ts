import { describe, expect, it } from 'vitest'
import { constrainTourPosition, fallbackTourPosition, tourSafeRectangle } from './bookTourBounds'

describe('body-portaled walkthrough bounds', () => {
  it('keeps portrait coaching above the home indicator and below the notch', () => {
    const area = tourSafeRectangle(
      { left: 0, top: 0, width: 390, height: 844 },
      { width: 390, height: 844 },
      { left: 0, top: 59, right: 0, bottom: 34 },
    )
    expect(area).toEqual({ left: 0, top: 59, right: 390, bottom: 810 })
    expect(fallbackTourPosition(area, { width: 366, height: 240 })).toEqual({ x: 12, y: 482 })
  })

  it('clamps desktop-style landscape placement away from both sides of a notch', () => {
    const area = tourSafeRectangle(
      { left: 0, top: 0, width: 844, height: 390 },
      { width: 844, height: 390 },
      { left: 47, top: 0, right: 47, bottom: 21 },
    )
    expect(area).toEqual({ left: 47, top: 0, right: 797, bottom: 369 })
    expect(constrainTourPosition({ x: 0, y: -30 }, area, { width: 320, height: 220 })).toEqual({
      x: 59,
      y: 12,
    })
    expect(constrainTourPosition({ x: 900, y: 300 }, area, { width: 320, height: 220 })).toEqual({
      x: 465,
      y: 137,
    })
  })

  it('uses the keyboard visual viewport without subtracting the physical bottom inset twice', () => {
    const area = tourSafeRectangle(
      { left: 0, top: 160, width: 390, height: 260 },
      { width: 390, height: 844 },
      { left: 0, top: 59, right: 0, bottom: 34 },
    )
    expect(area).toEqual({ left: 0, top: 160, right: 390, bottom: 420 })
    expect(fallbackTourPosition(area, { width: 366, height: 230 })).toEqual({ x: 12, y: 178 })
  })

  it('respects a zoomed and panned viewport rather than treating safe insets as offsets from it', () => {
    const area = tourSafeRectangle(
      { left: 90, top: 100, width: 230, height: 330 },
      { width: 390, height: 844 },
      { left: 0, top: 47, right: 0, bottom: 34 },
    )
    expect(area).toEqual({ left: 90, top: 100, right: 320, bottom: 430 })
    expect(constrainTourPosition({ x: 0, y: 900 }, area, { width: 206, height: 220 })).toEqual({
      x: 102,
      y: 198,
    })
  })

  it('keeps the existing preference for a position above the active controls when there is space', () => {
    expect(
      fallbackTourPosition(
        { left: 0, top: 0, right: 390, bottom: 844 },
        { width: 366, height: 240 },
        { top: 540, bottom: 610 },
      ),
    ).toEqual({ x: 12, y: 284 })
  })
})
