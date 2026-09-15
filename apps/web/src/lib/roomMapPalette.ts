/**
 * Map markers are part of the reader's room, not a separate product palette. Leaflet receives
 * resolved colors rather than CSS variables, so read the active room tokens at the map boundary.
 */
export interface RoomMapPalette {
  origin: string
  store: string
}

interface RoomStyle {
  getPropertyValue(name: string): string
}

export function roomMapPalette(style: RoomStyle): RoomMapPalette {
  const primary = style.getPropertyValue('--primary').trim()
  const accent = style.getPropertyValue('--accent').trim()
  const gold = style.getPropertyValue('--gold').trim()

  return {
    origin: gold || accent || primary,
    store: primary || accent || gold,
  }
}
