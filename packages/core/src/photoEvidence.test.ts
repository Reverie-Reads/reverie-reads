import { describe, expect, it } from 'vitest'
import {
  inspectPhotoHeader,
  orientPhotoPoint,
  orientedPhotoSize,
  photoCropToNormalized,
  validPhotoBox,
} from './photoEvidence'

function jpeg(orientation: number, lateExif = false) {
  const exif = Buffer.alloc(36)
  exif.set([255, 225, 0, 34])
  exif.write('Exif\0\0II', 4, 'binary')
  exif.writeUInt16LE(42, 12)
  exif.writeUInt32LE(8, 14)
  exif.writeUInt16LE(1, 18)
  exif.writeUInt16LE(0x112, 20)
  exif.writeUInt16LE(3, 22)
  exif.writeUInt32LE(1, 24)
  exif.writeUInt16LE(orientation, 28)
  const sof = Buffer.from([255, 192, 0, 11, 8, 0, 80, 0, 120, 1, 1, 0x11, 0])
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([255, 216]),
      ...(lateExif ? [sof, exif] : [exif, sof]),
      Buffer.from([255, 218, 0, 8]),
    ]),
  )
}
describe('photo preflight and coordinate provenance', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'retains orientation %s before allocating browser pixels',
    (o) => {
      for (const late of [false, true])
        expect(inspectPhotoHeader(jpeg(o, late))).toEqual({
          width: 120,
          height: 80,
          orientation: o,
          mime: 'image/jpeg',
        })
    },
  )
  it('maps all eight orientations using pixel edges, including mirrors', () => {
    const expected = [
      [10, 20],
      [110, 20],
      [110, 60],
      [10, 60],
      [20, 10],
      [60, 10],
      [60, 110],
      [20, 110],
    ]
    expected.forEach((point, i) =>
      expect(orientPhotoPoint(10, 20, { width: 120, height: 80 }, i + 1)).toEqual(point),
    )
    expect(orientedPhotoSize({ width: 120, height: 80 }, 6)).toEqual({ width: 80, height: 120 })
    expect(() => orientedPhotoSize({ width: 120, height: 80 }, 9)).toThrow()
  })
  it('translates OCR crop coordinates without rounding, scaling or silently clamping', () => {
    const crop = { x: 50, y: 70, width: 120, height: 80 }
    expect(photoCropToNormalized({ x: 10, y: 20, width: 30, height: 40 }, crop)).toEqual({
      x: 60,
      y: 90,
      width: 30,
      height: 40,
    })
    expect(() => photoCropToNormalized({ x: 110, y: 20, width: 30, height: 40 }, crop)).toThrow()
    expect(validPhotoBox({ ...crop, x: 0.5 }, { width: 1200, height: 800 })).toBe(false)
  })
  it('rejects corrupt EXIF, unsupported types, oversized dimensions and partial headers', () => {
    expect(() => inspectPhotoHeader(jpeg(9))).toThrow()
    const huge = jpeg(1)
    huge[43] = 0xff
    huge[44] = 0xff
    expect(() => inspectPhotoHeader(huge)).toThrow()
    expect(() => inspectPhotoHeader(new Uint8Array(30))).toThrow()
    expect(() => inspectPhotoHeader(jpeg(1).slice(0, 28))).toThrow()
  })
})
