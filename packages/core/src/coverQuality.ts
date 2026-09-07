/** Decoded resolution is a display observation, not proof of identity or original sharpness. */
export interface CoverMeasurement {
  url: string
  width: number
  height: number
}

export function coverResolutionLabel(
  image: Pick<CoverMeasurement, 'width' | 'height'> | null,
): string {
  if (!image) return 'Not measured'
  if (
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    image.width < 50 ||
    image.height < 50
  )
    return 'Image unavailable'
  if (image.width >= 800 && image.height >= 1200) return 'Sharp in detail'
  if (image.width >= 480 && image.height >= 720) return 'Sharp on cards'
  return 'May look soft'
}
