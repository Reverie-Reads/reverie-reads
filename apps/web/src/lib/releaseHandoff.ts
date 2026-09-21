import {
  normalizeIsbn,
  validEditionDate,
  validEditionSourceUrl,
  type EditionFormat,
} from '@reverie/core'
import type { DiscoverHit } from './discover'

/** A reader-review draft, not catalog authority. Keep edition fields bound to the same selection. */
export interface ReleaseHandoff {
  title: string
  authors: string[]
  isbn: string
  pub: string
  source: 'hardcover' | 'prh'
  sourceUrl: string
  format: EditionFormat
  publisher: string
}
export function releaseSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  return value && validEditionSourceUrl(value) ? new URL(value).href : undefined
}
export function releaseFormat(values: readonly string[]): EditionFormat {
  if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) return 'unknown'
  const known: Record<string, EditionFormat> = {
    paperback: 'paperback',
    'trade paperback': 'paperback',
    'mass market paperback': 'paperback',
    hardcover: 'hardcover',
    hardback: 'hardcover',
    'hard cover': 'hardcover',
    ebook: 'ebook',
    'e-book': 'ebook',
    'electronic book': 'ebook',
    audiobook: 'audiobook',
    'audio book': 'audiobook',
    'digital audio': 'audiobook',
    'physical book': 'physical',
    physical: 'physical',
  }
  const formats = new Set(values.map((v) => known[v.trim().toLowerCase()] ?? 'unknown'))
  return formats.size === 1 ? [...formats][0]! : 'unknown'
}
export function parseReleaseHandoff(value: unknown): ReleaseHandoff | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const r = value as Record<string, unknown>
  if (
    typeof r.title !== 'string' ||
    !r.title.trim() ||
    r.title.length > 500 ||
    !Array.isArray(r.authors) ||
    !r.authors.length ||
    r.authors.length > 20 ||
    !r.authors.every((a) => typeof a === 'string' && a.trim() && a.length <= 200) ||
    typeof r.isbn !== 'string' ||
    (r.isbn !== '' && (!/^[0-9Xx -]+$/.test(r.isbn) || !normalizeIsbn(r.isbn))) ||
    r.isbn.length > 32 ||
    typeof r.pub !== 'string' ||
    !r.pub ||
    !validEditionDate(r.pub) ||
    Number(r.pub.slice(0, 4)) < 1000 ||
    typeof r.publisher !== 'string' ||
    r.publisher.length > 160 ||
    !['paperback', 'hardcover', 'ebook', 'audiobook', 'physical', 'unknown'].includes(
      String(r.format),
    ) ||
    !['hardcover', 'prh'].includes(String(r.source))
  )
    return undefined
  const url = releaseSourceUrl(r.sourceUrl)
  if (
    !url ||
    new URL(url).hostname !==
      (r.source === 'hardcover' ? 'hardcover.app' : 'www.penguinrandomhouse.com')
  )
    return undefined
  return {
    title: r.title,
    authors: r.authors as string[],
    isbn: r.isbn,
    pub: r.pub,
    source: r.source as ReleaseHandoff['source'],
    sourceUrl: url,
    format: r.format as EditionFormat,
    publisher: r.publisher,
  }
}
export function releaseHandoff(hit: DiscoverHit): ReleaseHandoff | undefined {
  if (!hit.release) return undefined
  return parseReleaseHandoff({
    title: hit.title,
    authors: hit.authors,
    isbn: hit.isbn,
    pub: hit.pub,
    source: hit.release.source,
    sourceUrl: hit.release.sourceUrl,
    format: releaseFormat(hit.release.formats ?? []),
    publisher: hit.release.publisher ?? '',
  })
}
export function discoverAddSearch(
  hit: DiscoverHit,
  discoverSession?: string,
  context?: { window?: unknown; editions?: unknown },
) {
  return {
    work: hit.corpusWorkId,
    title: hit.title,
    author: hit.authors[0] || undefined,
    authors: hit.authors,
    isbn: hit.isbn || undefined,
    cover: hit.cover || undefined,
    source: hit.release?.source === 'hardcover' ? ('hardcover' as const) : hit.source,
    sourceUrl: hit.release?.sourceUrl ?? hit.sourceUrl,
    pub: hit.pub || undefined,
    edition: releaseHandoff(hit),
    want: true,
    discoverSession,
    releaseWindow: hit.release
      ? context?.window === 'upcoming'
        ? ('upcoming' as const)
        : ('recent' as const)
      : undefined,
    releaseEditions: hit.release && context?.editions === true ? true : undefined,
  }
}
