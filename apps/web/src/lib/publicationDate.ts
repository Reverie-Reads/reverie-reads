import { validPublicationDate, type PartialDate } from '@reverie/core'

export type PublicationDateField = 'year' | 'month' | 'day'

export type PublicationDateError = {
  field: PublicationDateField
  message: string
}

/** Blank is a supported unknown date; any stated precision must form a real calendar tuple. */
export function publicationDateError(date: PartialDate): PublicationDateError | null {
  if (date.y == null && date.m == null && date.d == null) return null
  if (date.y == null) {
    return { field: 'year', message: 'Add a publication year before a month or day.' }
  }
  if (date.m == null && date.d != null) {
    return { field: 'month', message: 'Add a publication month before a day.' }
  }
  if (!validPublicationDate(date)) {
    return { field: 'day', message: 'Use a real calendar date.' }
  }
  return null
}
