/** Coordinates are integer, top-left, half-open pixel rectangles. No identity inference. */
export interface PhotoBox {
  x: number
  y: number
  width: number
  height: number
}
export interface PhotoSize {
  width: number
  height: number
}
export const PHOTO_MAX_BYTES = 20_000_000
export function validPhotoSize({ width, height }: PhotoSize): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= 12000 &&
    height <= 12000 &&
    width * height <= 16_000_000
  )
}
export function validPhotoBox(box: PhotoBox, size: PhotoSize): boolean {
  return (
    validPhotoSize(size) &&
    [box.x, box.y, box.width, box.height].every(Number.isSafeInteger) &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= size.width &&
    box.y + box.height <= size.height
  )
}
export function orientedPhotoSize(size: PhotoSize, orientation: number): PhotoSize {
  if (!validPhotoSize(size) || !Number.isInteger(orientation) || orientation < 1 || orientation > 8)
    throw new Error('Invalid photo dimensions or orientation')
  return orientation >= 5 ? { width: size.height, height: size.width } : { ...size }
}
/** Encoded pixel edge -> orientation-normalized pixel edge, including mirrored EXIF cases. */
export function orientPhotoPoint(
  x: number,
  y: number,
  size: PhotoSize,
  orientation: number,
): [number, number] {
  orientedPhotoSize(size, orientation)
  switch (orientation) {
    case 2:
      return [size.width - x, y]
    case 3:
      return [size.width - x, size.height - y]
    case 4:
      return [x, size.height - y]
    case 5:
      return [y, x]
    case 6:
      return [size.height - y, x]
    case 7:
      return [size.height - y, size.width - x]
    case 8:
      return [y, size.width - x]
    default:
      return [x, y]
  }
}
export function photoCropToNormalized(box: PhotoBox, crop: PhotoBox): PhotoBox {
  if (!validPhotoBox(box, crop)) throw new Error('Region leaves its crop')
  return { ...box, x: crop.x + box.x, y: crop.y + box.y }
}

/** Header preflight before browser allocation. HEIC uses the bounded local ImageIO command. */
export function inspectPhotoHeader(
  bytes: Uint8Array,
): PhotoSize & { orientation: number; mime: string } {
  const fail = (): never => {
    throw new Error(
      'Use a static PNG or JPEG up to 20 MB and 16 million pixels. Convert HEIC locally first.',
    )
  }
  if (bytes.length < 24 || bytes.length > PHOTO_MAX_BYTES) return fail()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    let dimensions: PhotoSize | null = null,
      ended = false
    for (let offset = 8; offset + 12 <= bytes.length; ) {
      const length = view.getUint32(offset),
        end = offset + length + 12
      if (end > bytes.length) return fail()
      const kind = ascii(offset + 4, offset + 8)
      if (offset === 8) {
        if (
          kind !== 'IHDR' ||
          length !== 13 ||
          bytes[offset + 16] !== 8 ||
          bytes[offset + 20] !== 0
        )
          return fail()
        dimensions = { width: view.getUint32(offset + 8), height: view.getUint32(offset + 12) }
      } else if (kind === 'IHDR') return fail()
      if (['acTL', 'fcTL', 'fdAT', 'eXIf'].includes(kind)) return fail()
      if (kind === 'IEND') {
        if (length || end !== bytes.length) return fail()
        ended = true
      }
      offset = end
    }
    if (!ended || !dimensions || !validPhotoSize(dimensions)) return fail()
    return { ...dimensions, orientation: 1, mime: 'image/png' }
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail()
  let orientation = 1,
    sawExif = false
  let size: PhotoSize | null = null
  for (let offset = 2; offset + 4 <= bytes.length; ) {
    if (bytes[offset++] !== 0xff) return fail()
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xda && size) return { ...size, orientation, mime: 'image/jpeg' }
    if (marker === undefined || marker === 0xda || marker === 0xd9) return fail()
    const length = view.getUint16(offset),
      end = offset + length
    if (length < 2 || end > bytes.length) return fail()
    if (marker === 0xe1 && ascii(offset + 2, offset + 8) === 'Exif\0\0') {
      if (sawExif) return fail()
      sawExif = true
      const start = offset + 8
      if (start + 8 > end) return fail()
      const order = ascii(start, start + 2),
        little = order === 'II'
      if (!['II', 'MM'].includes(order) || view.getUint16(start + 2, little) !== 42) return fail()
      const ifd = start + view.getUint32(start + 4, little)
      if (ifd < start + 8 || ifd + 2 > end) return fail()
      const count = view.getUint16(ifd, little)
      if (count > 1024 || ifd + 2 + count * 12 > end) return fail()
      let found = false
      for (let n = 0; n < count; n++) {
        const entry = ifd + 2 + n * 12
        if (view.getUint16(entry, little) !== 0x112) continue
        if (
          found ||
          view.getUint16(entry + 2, little) !== 3 ||
          view.getUint32(entry + 4, little) !== 1
        )
          return fail()
        orientation = view.getUint16(entry + 8, little)
        found = true
        if (orientation < 1 || orientation > 8) return fail()
      }
    }
    // Baseline and progressive single-frame JPEG. Unsupported SOFs fail before decoding.
    if ([0xc0, 0xc2].includes(marker)) {
      if (length < 8 || bytes[offset + 2] !== 8) return fail()
      if (size) return fail()
      size = { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) }
      if (!validPhotoSize(size)) return fail()
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc0, 0xc2, 0xc4, 0xc8, 0xcc].includes(marker))
      return fail()
    offset = end
  }
  return fail()
}
