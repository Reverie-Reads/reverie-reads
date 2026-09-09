import type { Book } from './types'
import { coverResolutionLabel, type CoverMeasurement } from './coverQuality'

export type PersonalCoverConcern = 'broken' | 'missing' | 'uncertain' | 'soft'

type CoverBook = Pick<Book, 'cover' | 'coverConfidence' | 'coverUserChosen'>

/**
 * One reason per book keeps the care queue stable and honest. A reader's explicit placeholder or
 * selected image is settled unless its link actually breaks; enrichment confidence must never
 * overrule that gesture. Resolution is an observation of the image that loaded, not edition proof.
 */
export function personalCoverConcern(
  book: CoverBook,
  options: {
    broken?: boolean
    measurement?: Pick<CoverMeasurement, 'width' | 'height'> | null
  } = {},
): PersonalCoverConcern | null {
  if (options.broken) return 'broken'
  if (!book.cover) return book.coverUserChosen ? null : 'missing'
  if (book.coverUserChosen) return null
  if (book.coverConfidence === 'low' || book.coverConfidence === 'none') return 'uncertain'
  if (options.measurement && coverResolutionLabel(options.measurement) === 'May look soft') {
    return 'soft'
  }
  return null
}

export const PERSONAL_COVER_CONCERN_LABELS: Record<PersonalCoverConcern, string> = {
  broken: 'Cover link is broken',
  missing: 'No cover chosen',
  uncertain: 'Edition needs checking',
  soft: 'Image may look soft',
}

/** The placeholder is an explicit reader choice, so enrichment must keep the blank cover blank. */
export function choosePlaceholderCoverPatch(): Partial<Book> {
  return {
    cover: '',
    coverThumb: undefined,
    coverSource: undefined,
    coverSourceUrl: undefined,
    coverColor: undefined,
    coverConfidence: undefined,
    coverUserChosen: true,
  }
}

/** Confirming automatic art makes it a protected reader choice and clears match uncertainty. */
export function keepCurrentCoverPatch(): Partial<Book> {
  return { coverUserChosen: true, coverConfidence: undefined }
}
