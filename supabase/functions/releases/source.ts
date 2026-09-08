// Pure release-source normalization for the releases Edge Function. This module deliberately has
// no Deno or network dependencies so the ordinary Vitest suite can exercise provider payloads and
// the cross-source selection policy without booting the Edge runtime.

export type ReleaseSource = 'prh' | 'hardcover' | 'google'
export type ReleaseDatePrecision = 'year' | 'month' | 'day'
export type ReleaseKind = 'new_work' | 'new_edition'

export interface ReleaseInfo {
  source: ReleaseSource
  precision: ReleaseDatePrecision
  sourceUrl?: string
  publisher?: string
  formats?: string[]
  territory?: string
  kind?: ReleaseKind
  checkedAt: string
  /** Sources that independently supplied the selected date, not merely the same title. */
  confirmedBy?: ReleaseSource[]
}

export interface ReleaseHit {
  title: string
  authors: string[]
  cover: string
  isbn: string
  pub: string
  genre?: string
  genres?: string[]
  description?: string
  release: ReleaseInfo
}

interface HardcoverImage {
  url?: unknown
  width?: unknown
  height?: unknown
}

interface HardcoverEdition {
  id?: unknown
  isbn_13?: unknown
  isbn_10?: unknown
  edition_format?: unknown
  physical_format?: unknown
  release_date?: unknown
  release_year?: unknown
  cached_image?: HardcoverImage | null
  image?: HardcoverImage | null
  publisher?: { name?: unknown } | null
  reading_format?: { format?: unknown } | null
  country?: { code2?: unknown } | null
  book?: {
    id?: unknown
    title?: unknown
    slug?: unknown
    release_date?: unknown
    release_year?: unknown
    description?: unknown
    cached_image?: HardcoverImage | null
    image?: HardcoverImage | null
    contributions?: { author?: { name?: unknown } | null }[] | null
  } | null
}

interface PrhTitle {
  isbn?: unknown
  title?: unknown
  subtitle?: unknown
  author?: unknown
  onsale?: unknown
  seoFriendlyUrl?: unknown
  format?: { description?: unknown } | null
  _links?: { rel?: unknown; href?: unknown }[] | null
}

const string = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const cleanIsbn = (value: unknown): string =>
  string(value)
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase()
const norm = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

export function releaseDatePrecision(value: string): ReleaseDatePrecision | null {
  if (/^\d{4}$/.test(value)) return 'year'
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return 'month'
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value)) {
    const y = Number(value.slice(0, 4))
    const m = Number(value.slice(5, 7))
    const d = Number(value.slice(8, 10))
    const date = new Date(Date.UTC(y, m - 1, d))
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d)
      return 'day'
  }
  return null
}

function imageUrl(image: HardcoverImage | null | undefined): string {
  return string(image?.url).replace(/^http:/, 'https:')
}

function allowedUrl(value: unknown, hosts: readonly string[]): string {
  try {
    const url = new URL(string(value).replace(/^http:/, 'https:'))
    return url.protocol === 'https:' && hosts.includes(url.hostname) ? url.toString() : ''
  } catch {
    return ''
  }
}

/** Prefer portrait edition art; audiobook editions often carry a square tile while the parent
 * work has a proper jacket. */
function hardcoverCover(edition: HardcoverEdition): string {
  const image = edition.cached_image
  const width = Number(image?.width)
  const height = Number(image?.height)
  const hasMeasuredImage = width > 0 && height > 0
  const portrait = hasMeasuredImage && height / width >= 1.2
  return (
    (portrait ? imageUrl(image) : '') ||
    (!hasMeasuredImage ? imageUrl(edition.image) : '') ||
    imageUrl(edition.book?.cached_image) ||
    imageUrl(edition.book?.image)
  )
}

export function hardcoverEditionToRelease(
  rawEdition: unknown,
  checkedAt: string,
): ReleaseHit | null {
  const edition = rawEdition as HardcoverEdition
  const book = edition.book
  const title = string(book?.title)
  const pub =
    string(edition.release_date) ||
    (Number.isInteger(Number(edition.release_year)) ? String(edition.release_year) : '')
  const precision = releaseDatePrecision(pub)
  const authors = (book?.contributions ?? []).map((c) => string(c.author?.name)).filter(Boolean)
  if (!title || !authors.length || !precision) return null

  const format =
    string(edition.edition_format) ||
    string(edition.physical_format) ||
    string(edition.reading_format?.format)
  const firstPub =
    string(book?.release_date) ||
    (Number.isInteger(Number(book?.release_year)) ? String(book?.release_year) : '')
  const kind: ReleaseKind | undefined = firstPub
    ? pub.slice(0, firstPub.length) === firstPub
      ? 'new_work'
      : 'new_edition'
    : undefined
  const slug = string(book?.slug)
  return {
    title,
    authors,
    cover: hardcoverCover(edition),
    isbn: cleanIsbn(edition.isbn_13) || cleanIsbn(edition.isbn_10),
    pub,
    description: string(book?.description).slice(0, 2500),
    release: {
      source: 'hardcover',
      precision,
      sourceUrl: slug ? `https://hardcover.app/books/${encodeURIComponent(slug)}` : undefined,
      publisher: string(edition.publisher?.name) || undefined,
      formats: format ? [format] : undefined,
      territory: string(edition.country?.code2).toUpperCase() || undefined,
      kind,
      checkedAt,
      confirmedBy: ['hardcover'],
    },
  }
}

export function prhTitleToRelease(
  rawTitle: unknown,
  expectedAuthor: string,
  checkedAt: string,
): ReleaseHit | null {
  const title = rawTitle as PrhTitle
  const name = string(title.title)
  const author = string(title.author)
  const pub = string(title.onsale)
  const precision = releaseDatePrecision(pub)
  if (!name || !author || norm(author) !== norm(expectedAuthor) || !precision) return null
  const isbn = cleanIsbn(title.isbn)
  const icon = (title._links ?? []).find((link) => string(link.rel) === 'icon')
  const path = string(title.seoFriendlyUrl)
  const format = string(title.format?.description)
  return {
    title: name,
    authors: [author],
    cover:
      allowedUrl(icon?.href, ['images.randomhouse.com']) ||
      (isbn ? `https://images.randomhouse.com/cover/${isbn}` : ''),
    isbn,
    pub,
    release: {
      source: 'prh',
      precision,
      sourceUrl: path.startsWith('/books/')
        ? new URL(path, 'https://www.penguinrandomhouse.com').toString()
        : undefined,
      formats: format ? [format] : undefined,
      checkedAt,
      confirmedBy: ['prh'],
    },
  }
}

function bounds(pub: string): { first: number; last: number } | null {
  const precision = releaseDatePrecision(pub)
  if (!precision) return null
  const year = Number(pub.slice(0, 4))
  const month = precision === 'year' ? 1 : Number(pub.slice(5, 7))
  const day = precision === 'day' ? Number(pub.slice(8, 10)) : 1
  const first = Date.UTC(year, month - 1, day)
  const last =
    precision === 'day'
      ? first
      : precision === 'month'
        ? Date.UTC(year, month, 0, 23, 59, 59, 999)
        : Date.UTC(year, 11, 31, 23, 59, 59, 999)
  return { first, last }
}

const sourceRank: Record<ReleaseSource, number> = { prh: 0, hardcover: 1, google: 2 }

function temporalRank(hit: ReleaseHit, now: number): [number, number, number] {
  const b = bounds(hit.pub)
  if (!b) return [3, Number.MAX_SAFE_INTEGER, sourceRank[hit.release.source]]
  if (b.first > now) return [0, b.first, sourceRank[hit.release.source]]
  if (b.last >= now) return [1, b.last, sourceRank[hit.release.source]]
  return [2, -b.last, sourceRank[hit.release.source]]
}

function compareRank(a: ReleaseHit, b: ReleaseHit, now: number): number {
  const aa = temporalRank(a, now)
  const bb = temporalRank(b, now)
  return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2]
}

/** One useful event per work: nearest future date, then an imprecise date that spans today, then
 * newest recent date. Sources confirm a date only when their normalized date strings agree. */
export function mergeAuthorReleases(hits: readonly ReleaseHit[], now: number): ReleaseHit[] {
  const groups = new Map<string, ReleaseHit[]>()
  for (const hit of hits) {
    if (!hit.title || !hit.authors[0] || !releaseDatePrecision(hit.pub)) continue
    const key = `${norm(hit.title)}|${norm(hit.authors[0])}`
    groups.set(key, [...(groups.get(key) ?? []), hit])
  }

  const merged: ReleaseHit[] = []
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => compareRank(a, b, now))
    const selected = ordered[0]
    if (!selected) continue
    const sameDate = group.filter((hit) => hit.pub === selected.pub)
    const bestForDate =
      [...sameDate].sort(
        (a, b) => sourceRank[a.release.source] - sourceRank[b.release.source],
      )[0] ?? selected
    const formats = [
      ...new Set(sameDate.flatMap((hit) => hit.release.formats ?? []).filter(Boolean)),
    ]
    const confirmedBy = [...new Set(sameDate.map((hit) => hit.release.source))].sort(
      (a, b) => sourceRank[a] - sourceRank[b],
    )
    const cover =
      sameDate.find((hit) => hit.release.source === 'hardcover' && hit.cover)?.cover ||
      bestForDate.cover ||
      group.find((hit) => hit.cover)?.cover ||
      ''
    merged.push({
      ...bestForDate,
      cover,
      description: bestForDate.description || group.find((hit) => hit.description)?.description,
      release: {
        ...bestForDate.release,
        publisher:
          bestForDate.release.publisher ||
          sameDate.find((hit) => hit.release.publisher)?.release.publisher,
        formats: formats.length ? formats : undefined,
        territory:
          bestForDate.release.territory ||
          sameDate.find((hit) => hit.release.territory)?.release.territory,
        kind: bestForDate.release.kind || sameDate.find((hit) => hit.release.kind)?.release.kind,
        confirmedBy,
      },
    })
  }
  return merged.sort((a, b) => compareRank(a, b, now)).slice(0, 25)
}
