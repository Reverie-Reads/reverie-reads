import {
  inspectPhotoHeader,
  orientedPhotoSize,
  PHOTO_MAX_BYTES,
  validPhotoBox,
  type PhotoBox,
} from '@reverie/core'

export interface LocalPhoto {
  original: File
  originalSha256: string
  normalizedSha256: string
  orientation: number
  encodedWidth: number
  encodedHeight: number
  canvas: HTMLCanvasElement
  url: string
  dispose: () => void
}
const digest = async (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('')
const blobOf = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not create the private image preview.'))),
      'image/png',
    )
  })
/** Header bounds precede decode. The original File is retained separately and never uploaded. */
export async function loadLocalPhoto(file: File): Promise<LocalPhoto> {
  if (!file.size || file.size > PHOTO_MAX_BYTES) throw new Error('Use a photo up to 20 MB.')
  const bytes = await file.arrayBuffer(),
    header = inspectPhotoHeader(new Uint8Array(bytes))
  const size = orientedPhotoSize(header, header.orientation)
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    if (bitmap.width !== size.width || bitmap.height !== size.height)
      throw new Error(
        'The browser could not confirm photo orientation. Normalize this photo locally first.',
      )
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Private image preview is unavailable.')
    ctx.drawImage(bitmap, 0, 0)
    const blob = await blobOf(canvas)
    if (blob.size > 8_000_000) {
      canvas.width = canvas.height = 0
      throw new Error('Normalized evidence exceeds 8 MB. Use a smaller photo.')
    }
    const originalSha256 = await digest(bytes),
      normalizedSha256 = await digest(await blob.arrayBuffer())
    const url = URL.createObjectURL(blob)
    return {
      original: file,
      originalSha256,
      normalizedSha256,
      orientation: header.orientation,
      encodedWidth: header.width,
      encodedHeight: header.height,
      canvas,
      url,
      dispose: () => {
        URL.revokeObjectURL(url)
        canvas.width = canvas.height = 0
      },
    }
  } finally {
    bitmap.close()
  }
}
export function photoCropCanvas(photo: LocalPhoto, box: PhotoBox): HTMLCanvasElement {
  if (!validPhotoBox(box, photo.canvas)) throw new Error('The crop must stay inside the photo.')
  const canvas = document.createElement('canvas')
  canvas.width = box.width
  canvas.height = box.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Crop preview is unavailable.')
  ctx.drawImage(photo.canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
  return canvas
}
