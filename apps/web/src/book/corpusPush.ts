import { normalizeIsbn, type Book } from '@reverie/core'
import type { CorpusEditionDetails, CorpusRecord, CorpusRecordChange } from '../data/corpusEditions'
import { parseReleasePub } from '../data/releases'

const unique = (values: string[]) => [
  ...new Set(values.map((s) => s.trim().toLowerCase()).filter(Boolean)),
]

/** Only explicitly reviewed bibliography or guidance crosses this boundary. Never spread a Book. */
export function bookCorpusProposal(
  book: Book,
  record: CorpusRecord,
  kind: 'edition' | 'guidance',
  inventoryEditionId: string,
  newEditionId: string,
  targetEditionId = '',
): CorpusRecordChange {
  if (book.corpusWorkId !== record.id)
    throw new Error('This book is linked to a different corpus record.')
  if (kind === 'guidance') {
    const genres = unique([book.genre, ...book.genres])
    const subgenres = unique([book.subgenre, ...book.subgenres])
    return {
      action: 'guidance',
      value: {
        genres: genres.length ? genres : unique([record.genre || '', ...record.genres]),
        subgenres: subgenres.length
          ? subgenres
          : unique([record.subgenre || '', ...record.subgenres]),
        spice: book.intensity ?? record.spice,
        darkness: book.darkness ?? record.darkness,
      },
    }
  }
  const source = book.copyInventory?.editions.find((e) => e.id === inventoryEditionId)
  if (book.copyInventory && !source)
    throw new Error('Choose the exact edition from your saved inventory first.')
  const rawIsbn = source ? source.isbn : book.isbn
  const isbn = normalizeIsbn(rawIsbn) || null
  if (rawIsbn.trim() && (!/^[0-9Xx -]{1,32}$/.test(rawIsbn.trim()) || !isbn))
    throw new Error(
      'Correct the ISBN in your saved book or edition before pushing it to the corpus.',
    )
  const pages = source ? source.pages : book.pages
  if (pages != null && (!Number.isInteger(pages) || pages < 1 || pages > 20000))
    throw new Error('Correct the page count in your saved book or edition first.')
  const publication = source
    ? parseReleasePub(source.published)
    : book.pub.y == null
      ? null
      : book.pub
  const format =
    source && ['hardcover', 'paperback', 'ebook', 'audiobook'].includes(source.format)
      ? (source.format as CorpusEditionDetails['format'])
      : null
  const publisher = source?.publisher.trim() || null
  if (!isbn && pages == null && !publication && !format && !publisher)
    throw new Error('Save an ISBN or published-edition details before pushing an edition.')
  // Exact ISBN equivalence is the only automatic edition match. Keep the attempted new UUID
  // across an explicit reload after an uncertain response, including an ISBN-less edition.
  let existing = record.editions.find((e) =>
    isbn ? normalizeIsbn(e.isbn || '') === isbn : e.id === newEditionId && !e.isbn,
  )
  if (!isbn && targetEditionId && targetEditionId !== 'new') {
    existing = record.editions.find((e) => e.id === targetEditionId && !e.isbn)
    if (!existing)
      throw new Error(
        'The selected ISBN-less edition is no longer available. Reload the corpus for review.',
      )
  }
  if (!isbn && !targetEditionId && !existing && record.editions.some((e) => !e.isbn))
    throw new Error('Choose an existing ISBN-less edition or explicitly create a new one.')
  if (!existing && record.editions.some((e) => e.id === newEditionId))
    throw new Error(
      'The previous push was saved to a different edition. Close this review and start a new push.',
    )
  const details: CorpusEditionDetails = { ...existing?.details }
  if (pages != null) details.pages = pages
  if (publication) details.publication = publication
  if (format) details.format = format
  if (publisher) details.publisher = publisher
  return { action: 'edition', value: { id: existing?.id || newEditionId, isbn, details } }
}

export function corpusProposalRows(record: CorpusRecord, change: CorpusRecordChange) {
  const unknown = 'Not recorded'
  const date = (d?: CorpusEditionDetails['publication']) =>
    d?.y == null
      ? unknown
      : [
          String(d.y),
          ...(d.m == null ? [] : [String(d.m).padStart(2, '0')]),
          ...(d.d == null ? [] : [String(d.d).padStart(2, '0')]),
        ].join('-')
  if (change.action === 'guidance') {
    return [
      [
        'Genres',
        unique([record.genre || '', ...record.genres]).join(', ') || unknown,
        change.value.genres.join(', ') || unknown,
      ],
      [
        'Subgenres',
        unique([record.subgenre || '', ...record.subgenres]).join(', ') || unknown,
        change.value.subgenres.join(', ') || unknown,
      ],
      [
        'Spice / sexual content',
        record.spice == null ? unknown : `${record.spice}/5`,
        change.value.spice == null ? unknown : `${change.value.spice}/5`,
      ],
      [
        'Darkness / emotional intensity',
        record.darkness == null ? unknown : `${record.darkness}/5`,
        change.value.darkness == null ? unknown : `${change.value.darkness}/5`,
      ],
    ]
  }
  if (change.action !== 'edition') return []
  const before = record.editions.find((e) => e.id === change.value.id)
  const after = change.value.details
  return [
    ['ISBN', before?.isbn || unknown, change.value.isbn || unknown],
    ['Pages', String(before?.details.pages ?? unknown), String(after.pages ?? unknown)],
    ['Publication date', date(before?.details.publication), date(after.publication)],
    ['Format', before?.details.format || unknown, after.format || unknown],
    ['Publisher', before?.details.publisher || unknown, after.publisher || unknown],
    ['Language', before?.details.language || unknown, after.language || unknown],
    ['Edition statement', before?.details.statement || unknown, after.statement || unknown],
  ]
}

export const CORPUS_PUSH_FIELDS = [
  'series.membership',
  'edition.identity',
  'edition.pages',
  'edition.publication',
  'edition.format',
  'edition.publisher',
  'guidance.genres',
  'guidance.subgenres',
  'guidance.spice',
  'guidance.darkness',
] as const
export type CorpusPushField = (typeof CORPUS_PUSH_FIELDS)[number]
export interface CorpusPushOption {
  key: CorpusPushField
  label: string
  before: string
  after: string
}
export function bookCorpusOptions(
  book: Book,
  record: CorpusRecord,
  inventoryEditionId: string,
  newEditionId: string,
  targetEditionId = '',
) {
  const guidance = bookCorpusProposal(book, record, 'guidance', inventoryEditionId, newEditionId)
  if (guidance.action !== 'guidance') throw new Error('Guidance proposal required.')
  const rows: CorpusPushOption[] = []
  let edition: Extract<CorpusRecordChange, { action: 'edition' }> | null = null
  let editionError = ''
  try {
    const candidate = bookCorpusProposal(
      book,
      record,
      'edition',
      inventoryEditionId,
      newEditionId,
      targetEditionId,
    )
    if (candidate.action !== 'edition') throw new Error('Edition proposal required.')
    edition = candidate
    const editionRows = corpusProposalRows(record, candidate)
    for (const [index, field] of ['pages', 'publication', 'format', 'publisher'].entries()) {
      const [label, before, after] = editionRows[index + 1]!
      if (before !== after)
        rows.push({
          key: `edition.${field}` as CorpusPushField,
          label: label!,
          before: before!,
          after: after!,
        })
    }
    // An ISBN identifies the destination edition; it is never an independent book-level field.
    // ISBN-only intake still has one deliberate selectable change.
    if (!rows.length && !record.editions.some((e) => e.id === candidate.value.id)) {
      rows.push({
        key: 'edition.identity',
        label: 'Add published edition',
        before: 'Not in the shared catalog',
        after: candidate.value.isbn || 'Edition without an ISBN',
      })
    }
  } catch (e) {
    editionError = e instanceof Error ? e.message : 'Edition details are unavailable.'
  }
  const guidanceRows = corpusProposalRows(record, guidance)
  for (const [index, field] of ['genres', 'subgenres', 'spice', 'darkness'].entries()) {
    const [label, before, after] = guidanceRows[index]!
    if (before !== after)
      rows.push({
        key: `guidance.${field}` as CorpusPushField,
        label: label!,
        before: before!,
        after: after!,
      })
  }
  const series =
    book.series.trim() && record.series
      ? {
          bookId: book.id,
          name: book.series,
          position: book.position === '' ? null : book.position,
          count: book.seriesCount,
          status: book.status,
        }
      : null
  if (
    series &&
    (!record.series?.confirmed ||
      series.name !== record.series?.name ||
      series.position !== record.series?.position ||
      series.count !== record.series?.count ||
      series.status !== record.series?.status)
  ) {
    const describe = (
      name: string | null,
      position: number | null,
      count: number | null,
      status: string | null,
    ) =>
      [
        name || 'No series recorded',
        position == null ? '' : `Book ${position}`,
        count == null ? '' : `${count} in series`,
        status,
      ]
        .filter(Boolean)
        .join(' · ')
    rows.push({
      key: 'series.membership',
      label: 'Series, position, length and status',
      before: describe(
        record.series!.name,
        record.series!.position,
        record.series!.count,
        record.series!.status,
      ),
      after: describe(series.name, series.position, series.count, series.status),
    })
  }
  return { rows, edition, guidance, editionError, series }
}

/** Build only the selected differences; everything else comes from the opened shared snapshot. */
export function selectedCorpusChanges(
  record: CorpusRecord,
  options: ReturnType<typeof bookCorpusOptions>,
  selected: ReadonlySet<CorpusPushField>,
): import('../data/corpusEditions').CorpusPushChange[] {
  const keys = new Set(options.rows.filter((row) => selected.has(row.key)).map((row) => row.key))
  const changes: import('../data/corpusEditions').CorpusPushChange[] = []
  if (options.edition && [...keys].some((key) => key.startsWith('edition.'))) {
    const candidate = options.edition.value
    const existing = record.editions.find((e) => e.id === candidate.id)
    const details: CorpusEditionDetails = { ...existing?.details }
    for (const field of ['pages', 'publication', 'format', 'publisher'] as const) {
      if (keys.has(`edition.${field}`))
        Object.assign(details, { [field]: candidate.details[field] })
    }
    changes.push({ action: 'edition', value: { id: candidate.id, isbn: candidate.isbn, details } })
  }
  if ([...keys].some((key) => key.startsWith('guidance.'))) {
    const value = {
      genres: record.genres.length ? record.genres : record.genre ? [record.genre] : [],
      subgenres: record.subgenres.length
        ? record.subgenres
        : record.subgenre
          ? [record.subgenre]
          : [],
      spice: record.spice,
      darkness: record.darkness,
    }
    for (const field of ['genres', 'subgenres', 'spice', 'darkness'] as const) {
      if (keys.has(`guidance.${field}`))
        Object.assign(value, { [field]: options.guidance.value[field] })
    }
    const fields = (['genres', 'subgenres', 'spice', 'darkness'] as const).filter((field) =>
      keys.has(`guidance.${field}`),
    )
    changes.push({ action: 'guidance', value, fields })
  }
  if (options.series && keys.has('series.membership'))
    changes.push({ action: 'series', value: options.series })
  return changes
}
