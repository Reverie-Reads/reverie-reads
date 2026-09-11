export type CartoBasemapMode = 'dark' | 'light'

const CARTO_STYLE: Record<CartoBasemapMode, string> = {
  dark: 'dark_all',
  light: 'light_all',
}

/**
 * CARTO requires a basemap key for third-party applications. Returning null when it is absent is
 * deliberate: it prevents the CDN's "API KEY REQUIRED" watermark from becoming product UI.
 */
export function cartoBasemapUrl(mode: CartoBasemapMode, key?: string): string | null {
  const configuredKey = key?.trim()
  if (!configuredKey) return null
  return `https://{s}.basemaps.cartocdn.com/${CARTO_STYLE[mode]}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(configuredKey)}`
}

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
