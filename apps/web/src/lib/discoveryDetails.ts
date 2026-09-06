import { normalizeIsbn, type DiscoveryBook } from '@reverie/core'
import { supabase } from './supabase'
import { enrichBookOutcome } from './enrich'

interface Details {
  unavailable?: boolean
  genre?: string
  genres?: string[]
  description?: string | null
  publisher?: string | null
  language?: string | null
}
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Source prose is rendered as text, never trusted markup or generated marketing copy. */
export function plainDescription(value: string): string {
  const doc = new DOMParser().parseFromString(value, 'text/html')
  doc.querySelectorAll('script,style').forEach((node) => node.remove())
  doc.querySelectorAll('p,br').forEach((node) => node.append('\n'))
  return doc.body.textContent?.trim() ?? ''
}

export async function fetchDiscoveryDetails(hit: DiscoveryBook): Promise<Details> {
  if (hit.corpusWorkId) {
    const { data, error } = await supabase
      .from('works')
      .select('description,publisher,language,genre')
      .eq('id', hit.corpusWorkId)
      .maybeSingle()
    if (error) throw error
    return data ? { ...data, genre: data.genre ?? undefined } : { unavailable: true }
  }
  const result = await enrichBookOutcome({
    title: hit.title,
    author: hit.authors[0],
    isbn: hit.isbn || undefined,
  })
  if (result.status === 'failed' || result.status === 'rate_limited')
    throw new Error('Book details are unavailable right now.')
  if (result.status !== 'ok') return {}
  const data = result.data
  const isbn = normalizeIsbn(hit.isbn)
  const sameEdition =
    isbn &&
    [data.isbn, data.isbn10, data.isbn13, ...(data.isbns ?? [])].some(
      (value) => normalizeIsbn(value) === isbn,
    )
  const sameWork =
    normalize(hit.title) === normalize(data.title ?? '') &&
    Boolean(hit.authors[0]) &&
    (data.authors ?? []).some((name) => normalize(name) === normalize(hit.authors[0]!))
  // A plausible title search is not enough to show another work's synopsis as this one's.
  return sameEdition || (sameWork && data.confidence === 'high') ? data : {}
}
