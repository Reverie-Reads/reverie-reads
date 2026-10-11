import type { Book } from './types'

type GuidanceBook = Pick<Book, 'intensity' | 'darkness' | 'sharedGuidance'>
const level = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5 ? value : null

/** Read-time defaults only. Never use this view for persistence, merges, CSV or backups. */
export function bookGuidance(book: GuidanceBook): {
  intensity: number | null
  darkness: number | null
} {
  return {
    intensity: level(book.intensity) ?? level(book.sharedGuidance?.spice),
    darkness: level(book.darkness) ?? level(book.sharedGuidance?.darkness),
  }
}
