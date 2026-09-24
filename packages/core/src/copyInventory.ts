import { normalizeIsbn } from './match'
import { isGoogleContentCover } from './covers'
import type { Book, Owned } from './types'

export const EDITION_FORMATS = [
  'paperback',
  'hardcover',
  'physical',
  'ebook',
  'audiobook',
  'unknown',
] as const
export type EditionFormat = (typeof EDITION_FORMATS)[number]
export const COPY_STATES = ['owned', 'borrowed', 'wishlist', 'unset'] as const
export type CopyState = (typeof COPY_STATES)[number]
export interface LibraryEdition {
  id: string
  label: string
  format: EditionFormat
  isbn: string
  publisher: string
  published: string
  pages: number | null
  cover: string
  /** Optional reader-retained release listing; never catalog verification. */
  sourceUrl?: string
}
export interface LibraryCopy {
  id: string
  editionId: string
  state: CopyState
  label: string
  location: string
}
/** Private, atomic inventory for ONE personal book. IDs identify editions/copies, not catalog works. */
export interface CopyInventory {
  version: 1
  editions: LibraryEdition[]
  copies: LibraryCopy[]
}
export const EDITION_FORMAT_LABELS: Record<EditionFormat, string> = {
  paperback: 'Paperback',
  hardcover: 'Hardback',
  physical: 'Physical · binding unknown',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  unknown: 'Format not recorded',
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const id = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
export function validEditionCover(value: string): boolean {
  if (!value) return true
  if (isGoogleContentCover(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}
export function validEditionSourceUrl(value: string): boolean {
  if (!value) return true
  try {
    const url = new URL(value)
    return (
      value.length <= 2048 &&
      /^https:\/\/(hardcover[.]app|www[.]penguinrandomhouse[.]com)\/books\/[^/?#@\s]+(?:\/[^/?#@\s]+)*\/?$/.test(
        value,
      ) &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      ['hardcover.app', 'www.penguinrandomhouse.com'].includes(url.hostname) &&
      /^\/books\/[^/?#@\s]+(?:\/[^/?#@\s]+)*\/?$/.test(url.pathname)
    )
  } catch {
    return false
  }
}
export function validEditionDate(value: string): boolean {
  if (!value) return true
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value) || Number(value.slice(0, 4)) < 1) return false
  const [y, m, d] = value.split('-').map(Number)
  if (m !== undefined && (m < 1 || m > 12)) return false
  if (d !== undefined) {
    if (y === undefined || m === undefined) return false
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!
    if (d < 1 || d > days) return false
  }
  return true
}
/** Strict at save/restore: malformed inventories must never degrade into an empty collection. */
export function parseCopyInventory(value: unknown): CopyInventory | null {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.editions) ||
    !Array.isArray(value.copies)
  )
    return null
  if (
    Object.keys(value).some((k) => !['version', 'editions', 'copies'].includes(k)) ||
    value.editions.length > 100 ||
    value.copies.length > 500
  )
    return null
  const editions = new Set<string>()
  for (const e of value.editions) {
    if (
      !record(e) ||
      !id(e.id) ||
      editions.has(e.id) ||
      !EDITION_FORMATS.includes(e.format as EditionFormat) ||
      !text(e.label, 160) ||
      !text(e.isbn, 32) ||
      (e.isbn !== '' && (!/^[0-9Xx -]+$/.test(e.isbn) || !normalizeIsbn(e.isbn))) ||
      !text(e.publisher, 160) ||
      !text(e.published, 10) ||
      !validEditionDate(e.published) ||
      !text(e.cover, 2048) ||
      !validEditionCover(e.cover) ||
      (e.sourceUrl !== undefined &&
        (!text(e.sourceUrl, 2048) || !validEditionSourceUrl(e.sourceUrl))) ||
      !(
        e.pages === null ||
        (typeof e.pages === 'number' &&
          Number.isInteger(e.pages) &&
          e.pages >= 1 &&
          e.pages <= 20000)
      ) ||
      Object.keys(e).some(
        (k) =>
          ![
            'id',
            'label',
            'format',
            'isbn',
            'publisher',
            'published',
            'pages',
            'cover',
            'sourceUrl',
          ].includes(k),
      )
    )
      return null
    editions.add(e.id)
  }
  const copies = new Set<string>()
  for (const c of value.copies) {
    if (
      !record(c) ||
      !id(c.id) ||
      copies.has(c.id) ||
      !id(c.editionId) ||
      !editions.has(c.editionId) ||
      !COPY_STATES.includes(c.state as CopyState) ||
      !text(c.label, 160) ||
      !text(c.location, 160) ||
      Object.keys(c).some((k) => !['id', 'editionId', 'state', 'label', 'location'].includes(k))
    )
      return null
    copies.add(c.id)
  }
  return value as unknown as CopyInventory
}
export function inventoryPossession(
  inventory: CopyInventory,
): Pick<Book, 'ownership' | 'borrowed' | 'wishlist' | 'owned'> {
  const inHandIds = new Set(
    inventory.copies
      .filter((c) => c.state === 'owned' || c.state === 'borrowed')
      .map((c) => c.editionId),
  )
  const formats = new Set(
    inventory.editions.filter((e) => inHandIds.has(e.id)).map((e) => e.format),
  )
  const physical = [...formats].filter(
    (f) => f === 'paperback' || f === 'hardcover' || f === 'physical',
  )
  const owned: Owned = {
    physical:
      physical.length > 1 || physical[0] === 'physical'
        ? true
        : physical[0] === 'paperback' || physical[0] === 'hardcover'
          ? physical[0]
          : false,
    ebook: formats.has('ebook'),
    audiobook: formats.has('audiobook'),
  }
  return {
    ownership: inventory.copies.some((c) => c.state === 'owned') ? 'owned' : 'unowned',
    borrowed: inventory.copies.some((c) => c.state === 'borrowed'),
    wishlist: inventory.copies.some((c) => c.state === 'wishlist'),
    owned,
  }
}
export function newEdition(format: EditionFormat = 'unknown'): LibraryEdition {
  return {
    id: crypto.randomUUID(),
    label: '',
    format,
    isbn: '',
    publisher: '',
    published: '',
    pages: null,
    cover: '',
  }
}
export function newCopy(editionId: string, state: CopyState = 'unset'): LibraryCopy {
  return { id: crypto.randomUUID(), editionId, state, label: '', location: '' }
}
/** A REVIEW draft, never an automatic migration. Broad flags cannot establish actual quantity. */
export function prepareCopyInventory(book: Book): CopyInventory {
  if (book.copyInventory) return structuredClone(book.copyInventory)
  const result: CopyInventory = { version: 1, editions: [], copies: [] }
  const inHand = book.ownership === 'owned' || book.borrowed
  const formats: EditionFormat[] = inHand
    ? [
        ...(book.owned.physical
          ? ([
              typeof book.owned.physical === 'string' ? book.owned.physical : 'physical',
            ] as EditionFormat[])
          : []),
        ...(book.owned.ebook ? (['ebook'] as const) : []),
        ...(book.owned.audiobook ? (['audiobook'] as const) : []),
      ]
    : []
  if (!formats.length && inHand) formats.push('unknown')
  for (const format of formats) {
    const edition = newEdition(format)
    // Only a single recorded format can carry the existing selected-edition details as a draft.
    if (formats.length === 1) {
      edition.isbn = normalizeIsbn(book.isbn) ? book.isbn : ''
      edition.pages = book.pages
      edition.cover = validEditionCover(book.cover) ? book.cover : ''
      const { y, m, d } = book.pub
      const date = y
        ? `${String(y).padStart(4, '0')}${m ? `-${String(m).padStart(2, '0')}${d ? `-${String(d).padStart(2, '0')}` : ''}` : ''}`
        : ''
      edition.published = validEditionDate(date) ? date : ''
    }
    result.editions.push(edition)
    result.copies.push(newCopy(edition.id, book.ownership === 'owned' ? 'owned' : 'borrowed'))
  }
  // Co-occurring flags do not say WHICH edition is borrowed or wanted. Leave those unidentified.
  for (const state of ['borrowed', 'wishlist'] as const) {
    if (!(state === 'borrowed' ? book.borrowed && book.ownership === 'owned' : book.wishlist))
      continue
    const edition = newEdition()
    result.editions.push(edition)
    result.copies.push(newCopy(edition.id, state))
  }
  return result
}

function unidentifiedEdition(edition: LibraryEdition): boolean {
  return (
    edition.format === 'unknown' &&
    !edition.label &&
    !edition.isbn &&
    !edition.publisher &&
    !edition.published &&
    edition.pages === null &&
    !edition.cover &&
    !edition.sourceUrl
  )
}

function fillEditionBlanks(current: LibraryEdition, incoming: LibraryEdition): LibraryEdition {
  return {
    ...current,
    label: current.label || incoming.label,
    format: current.format === 'unknown' ? incoming.format : current.format,
    isbn: current.isbn || incoming.isbn,
    publisher: current.publisher || incoming.publisher,
    published: current.published || incoming.published,
    pages: current.pages ?? incoming.pages,
    cover: current.cover || incoming.cover,
    ...(current.sourceUrl
      ? { sourceUrl: current.sourceUrl }
      : incoming.sourceUrl
        ? { sourceUrl: incoming.sourceUrl }
        : {}),
  }
}

/**
 * Build the explicit review draft used when Discover finds an edition for a book already in the
 * reader's library. Existing configured inventories are cloned. Legacy possession flags remain a
 * reviewable setup draft, and one unidentified legacy copy may be identified by the incoming
 * edition instead of fabricating a second copy. No caller should persist this without showing the
 * normal editions-and-copies editor first.
 */
export function prepareCopyInventoryWithIncoming(
  book: Book,
  incomingValue: CopyInventory,
): CopyInventory {
  const incoming = parseCopyInventory(incomingValue)
  if (!incoming) throw new Error('The selected edition details are invalid.')

  const draft = prepareCopyInventory(book)
  const legacyDraft = !book.copyInventory
  const editionIds = new Map<string, string>()
  const consumedLegacyCopies = new Set<string>()

  if (legacyDraft) {
    for (const copy of incoming.copies) {
      const candidate = draft.copies.find((existingCopy) => {
        if (consumedLegacyCopies.has(existingCopy.id) || existingCopy.state !== copy.state)
          return false
        const edition = draft.editions.find((item) => item.id === existingCopy.editionId)
        return !!edition && unidentifiedEdition(edition)
      })
      if (!candidate) continue
      const edition = incoming.editions.find((item) => item.id === copy.editionId)
      if (!edition) throw new Error('The selected edition details are invalid.')
      draft.editions = draft.editions.map((item) =>
        item.id === candidate.editionId ? { ...structuredClone(edition), id: item.id } : item,
      )
      editionIds.set(edition.id, candidate.editionId)
      consumedLegacyCopies.add(candidate.id)
    }
  }

  for (const edition of incoming.editions) {
    if (editionIds.has(edition.id)) continue
    const normalized = edition.isbn ? normalizeIsbn(edition.isbn) : null
    const isbnMatches = normalized
      ? draft.editions.filter((item) => normalizeIsbn(item.isbn) === normalized)
      : []
    if (isbnMatches.length === 1) {
      const match = isbnMatches[0]!
      draft.editions = draft.editions.map((item) =>
        item.id === match.id ? fillEditionBlanks(item, edition) : item,
      )
      editionIds.set(edition.id, match.id)
      continue
    }
    const collision = draft.editions.find((item) => item.id === edition.id)
    if (collision) {
      if (JSON.stringify(collision) !== JSON.stringify(edition))
        throw new Error('The selected edition conflicts with an existing edition.')
      editionIds.set(edition.id, collision.id)
      continue
    }
    draft.editions.push(structuredClone(edition))
    editionIds.set(edition.id, edition.id)
  }

  for (const copy of incoming.copies) {
    if (consumedLegacyCopies.size) {
      const replacement = [...consumedLegacyCopies].find((id) => {
        const current = draft.copies.find((item) => item.id === id)
        return current?.state === copy.state && current.editionId === editionIds.get(copy.editionId)
      })
      if (replacement) {
        consumedLegacyCopies.delete(replacement)
        continue
      }
    }
    const editionId = editionIds.get(copy.editionId)
    if (!editionId) throw new Error('The selected edition details are invalid.')
    const next = { ...structuredClone(copy), editionId }
    const collision = draft.copies.find((item) => item.id === next.id)
    if (collision) {
      if (JSON.stringify(collision) !== JSON.stringify(next))
        throw new Error('The selected copy conflicts with an existing copy.')
      continue
    }
    draft.copies.push(next)
  }

  if (!parseCopyInventory(draft))
    throw new Error('The selected edition cannot be added to this copy collection.')
  return draft
}
