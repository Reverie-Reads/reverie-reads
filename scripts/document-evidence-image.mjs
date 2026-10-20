import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
export function documentPngCrc(bytes) {
  let crc = 0xffffffff
  for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
/** Bounded static 8-bit non-interlaced PNG; reject orientation/animation instead of moving citations. */
export function documentPng(bytes) {
  const invalid = () => {
    throw new Error('Use a complete static, non-interlaced 8-bit PNG without EXIF orientation')
  }
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 57 ||
    bytes.length > 8_000_000 ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
  )
    invalid()
  let width,
    height,
    channels,
    palette = false,
    finished = false,
    idatEnded = false
  const compressed = []
  for (let offset = 8; offset < bytes.length; ) {
    if (offset + 12 > bytes.length) invalid()
    const length = bytes.readUInt32BE(offset),
      end = offset + 12 + length
    if (end > bytes.length) invalid()
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii'),
      data = bytes.subarray(offset + 8, end - 4)
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      bytes.readUInt32BE(end - 4) !== documentPngCrc(bytes.subarray(offset + 4, end - 4))
    )
      invalid()
    if ((offset === 8 && type !== 'IHDR') || ['eXIf', 'acTL', 'fcTL', 'fdAT'].includes(type))
      invalid()
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) invalid()
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[data[9]]
      if (
        !width ||
        !height ||
        width > 12000 ||
        height > 12000 ||
        width * height > 16_000_000 ||
        !channels ||
        data[8] !== 8 ||
        data[10] ||
        data[11] ||
        data[12]
      )
        invalid()
    } else if (type === 'PLTE') {
      if (palette || compressed.length || !length || length % 3 || length > 768) invalid()
      palette = true
    } else if (type === 'IDAT') {
      if (idatEnded) invalid()
      compressed.push(data)
    } else if (type === 'IEND') {
      if (length || end !== bytes.length || !compressed.length) invalid()
      finished = true
    } else if (type[0] === type[0].toUpperCase()) invalid()
    if (compressed.length && type !== 'IDAT') idatEnded = true
    offset = end
  }
  if (!finished || (bytes[25] === 3 && !palette)) invalid()
  const rowLength = width * channels + 1,
    expected = rowLength * height
  const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected })
  if (decoded.length !== expected) invalid()
  for (let y = 0; y < height; y++) if (decoded[y * rowLength] > 4) invalid()
  return {
    bytes,
    mime: 'image/png',
    width,
    height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}
