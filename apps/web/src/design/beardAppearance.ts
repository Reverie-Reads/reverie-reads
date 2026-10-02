/** Private presentation only. No identity, product, room or library authority. */
export const BEARD_STYLES = [
  { id: 'classic', label: 'Original' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'full', label: 'Full' },
  { id: 'trimmed', label: 'Trimmed' },
  { id: 'goatee', label: 'Goatee' },
  { id: 'braided', label: 'Braided' },
] as const
export const BEARD_COLORS = [
  { id: 'room', label: 'Room ink', hair: '--ink', ground: '--card-solid' },
  { id: 'espresso', label: 'Espresso', hair: '--beard-espresso', ground: '--beard-paper' },
  { id: 'chestnut', label: 'Chestnut', hair: '--beard-chestnut', ground: '--beard-paper' },
  { id: 'copper', label: 'Copper', hair: '--beard-copper', ground: '--beard-paper' },
  { id: 'golden', label: 'Golden', hair: '--beard-golden', ground: '--beard-charcoal' },
  { id: 'silver', label: 'Silver', hair: '--beard-silver', ground: '--beard-charcoal' },
  { id: 'snow', label: 'Snow', hair: '--beard-snow', ground: '--beard-charcoal' },
  { id: 'plum', label: 'Plum', hair: '--beard-plum', ground: '--beard-paper' },
  { id: 'rainbow', label: 'Rainbow', hair: '--beard-rainbow-red', ground: '--beard-charcoal' },
] as const
export const BEARD_RAINBOW_STOPS = [
  '--beard-rainbow-red',
  '--beard-rainbow-orange',
  '--beard-rainbow-yellow',
  '--beard-rainbow-green',
  '--beard-rainbow-blue',
  '--beard-rainbow-violet',
] as const
export const BEARD_RAINBOW_SWATCH = `linear-gradient(135deg, ${BEARD_RAINBOW_STOPS.map((token) => `var(${token})`).join(', ')})`
export type BeardAppearance = {
  style: (typeof BEARD_STYLES)[number]['id']
  color: (typeof BEARD_COLORS)[number]['id']
}
export const DEFAULT_BEARD: BeardAppearance = { style: 'classic', color: 'room' }
export const beardKeyFor = (accountId: string) => `midniht.beard.v1.${accountId}`
export function readBeardAppearance(accountId: string): BeardAppearance {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(beardKeyFor(accountId)) ?? 'null')
    if (
      typeof value !== 'object' ||
      !value ||
      !('version' in value) ||
      value.version !== 1 ||
      !('style' in value) ||
      !('color' in value)
    )
      return DEFAULT_BEARD
    const style = BEARD_STYLES.find((entry) => entry.id === value.style)
    const color = BEARD_COLORS.find((entry) => entry.id === value.color)
    return style && color ? { style: style.id, color: color.id } : DEFAULT_BEARD
  } catch {
    return DEFAULT_BEARD
  }
}
