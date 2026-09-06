import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mayIngestCover, normalizeIsbn, upgradeCoverUrl, type Book, type CoverSource } from '@reverie/core'
import { fetchEditions, ingestCover, type EditionOption } from '../lib/covers'
import { clearCoverBroken } from './brokenCovers'
import { useUpdateBook } from './books'

// Data layer for the cover sheet: the editions query (lazy — only while the sheet is open) and the
// set-cover mutation that runs the ingest pipeline then persists the stored asset + provenance via
// the normal RLS-checked book mutation. User picks always set cover_user_chosen (the non-overwrite
// flag) and CLEAR cover_confidence (null = trusted, never flagged in import review).

export function useEditionOptions(book: Book, enabled: boolean) {
  const author = [book.first, book.last].filter(Boolean).join(' ')
  return useQuery<EditionOption[]>({
    queryKey: ['editions', book.id],
    queryFn: () => fetchEditions({ isbn: book.isbn || undefined, title: book.title, author }),
    enabled: enabled && !!(book.isbn || book.title),
    staleTime: 5 * 60 * 1000,
    select: (list) => sortCoverEditions(list, book.isbn),
  })
}

/** Exact edition before storage convenience; unknown ISBNs never imply an edition match. */
export function matchesCoverEdition(option: EditionOption, isbn: string): boolean {
  const exact = normalizeIsbn(isbn)
  return !!exact && [option.isbn13, option.isbn10].some((value) => normalizeIsbn(value ?? '') === exact)
}
export function sortCoverEditions(options: readonly EditionOption[], isbn: string): EditionOption[] {
  return [...options].sort((a, b) =>
    Number(matchesCoverEdition(b, isbn)) - Number(matchesCoverEdition(a, isbn)) ||
    Number(mayIngestCover(b.source, b.cover)) - Number(mayIngestCover(a.source, a.cover)),
  )
}

export interface SetCoverInput {
  /** only the id is needed — ingest scopes storage by the signed-in user, RLS checks the patch */
  book: { id: string }
  source: CoverSource
  file?: Blob
  url?: string
  sourceUrl?: string
  /** false for the lazy backfill (provenance move, not a reader choice) */
  userChosen?: boolean
}

export type SetCoverError =
  | 'not_an_image'
  | 'too_large'
  | 'fetch_failed'
  | 'no_cover_available'
  | 'display_only_source'
  | 'failed'

/**
 * Set a book's cover. Two outcomes by design (docs/reference/reverie-metadata-sourcing.md §Covers):
 *
 *  · INGEST — Open Library, upload, camera, and Hardcover: the bytes go through the pipeline and
 *    are stored in the reader's own Storage path, with provenance.
 *  · HOTLINK — Google Books and unreviewed pasted hosts are rendered at display size, but never
 *    fetched by the server. The reader's pick still works and still counts as their choice; only
 *    the bytes stay where they are.
 *
 * The hotlink branch is what keeps a Google edition from becoming a dead end in the sheet — the
 * alternative was offering a candidate that errors when picked.
 */
export function useSetCover() {
  const qc = useQueryClient()
  const update = useUpdateBook()
  return useMutation({
    meta: { action: 'The cover' },
    mutationFn: async ({ book, source, file, url, sourceUrl, userChosen = true }: SetCoverInput) => {
      const chosen = { coverUserChosen: true, coverConfidence: undefined } as const

      // Display-only: record the reference, fetch nothing. Judged by exact host as well as by label,
      // since the lazy backfill's 'url' label can carry Google or another unreviewed remote image.
      if (!file && !mayIngestCover(source, url)) {
        const display = upgradeCoverUrl(url ?? '', 'full')
        if (!display) throw new Error('failed')
        await update.mutateAsync({
          id: book.id,
          patch: {
            cover: display,
            coverThumb: upgradeCoverUrl(url ?? '', 'thumb'),
            coverSource: source,
            coverSourceUrl: sourceUrl ?? url,
            ...(userChosen ? chosen : {}),
          },
        })
        clearCoverBroken(book.id)
        return { cover: display, thumb: '', sourceUrl: sourceUrl ?? url ?? null, color: null, hotlinked: true }
      }

      const outcome = await ingestCover({ bookId: book.id, source, file, url, sourceUrl })
      if (outcome.status === 'error') throw new Error(outcome.code)
      const d = outcome.data
      await update.mutateAsync({
        id: book.id,
        patch: {
          cover: d.cover,
          coverThumb: d.thumb,
          coverSource: source,
          coverSourceUrl: d.sourceUrl ?? undefined,
          coverColor: d.color ?? undefined,
          ...(userChosen ? chosen : {}),
        },
      })
      clearCoverBroken(book.id)
      return { ...d, hotlinked: false }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
    },
  })
}

/** The optional one-tap "also update edition details" sync — offered, never forced. */
export function editionSyncPatch(book: Book, e: EditionOption): Partial<Book> {
  const patch: Partial<Book> = {}
  const isbn = e.isbn13 || e.isbn10
  if (isbn && isbn !== book.isbn) patch.isbn = isbn
  const format = mapEditionFormat(e.format)
  if (format && format !== book.format) patch.format = format
  if (e.year && e.year !== book.pub.y) patch.pub = { ...book.pub, y: e.year }
  // The edition already carries a page count and the chooser already shows it ("352 pp") — it was
  // simply discarded on pick because the model had nowhere to put it. Offered, never forced: this
  // rides the same "also update edition details" confirmation as ISBN, format and year.
  if (e.pages && e.pages !== book.pages) patch.pages = e.pages
  return patch
}

/** Map a source's edition/reading format label onto the app's FORMATS vocabulary (best-effort). */
export function mapEditionFormat(raw?: string): string | null {
  if (!raw) return null
  const f = raw.toLowerCase()
  if (f.includes('audio')) return 'Audiobook'
  if (f.includes('hardcover') || f.includes('hardback')) return 'Hardcover'
  if (f.includes('paperback') || f.includes('mass market') || f.includes('softcover')) return 'Paperback'
  if (f.includes('ebook') || f.includes('e-book') || f.includes('kindle') || f.includes('digital')) return 'eBook'
  return null
}
