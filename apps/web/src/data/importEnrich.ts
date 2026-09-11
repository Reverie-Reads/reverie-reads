import type { Book } from '@reverie/core'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import { bulkComplete } from './enrichLibrary'
import { bulkCompleteCorpus, fetchCorpusEnrichmentCandidates } from './enrichCorpus'
import { booksKey } from './books'
import type { QueryClient } from '@tanstack/react-query'

// Cover handoff (docs/archive/task-import-quality.md §3, PR #50): a fresh import leaves missing covers as the
// skin-tokened placeholder immediately; this kicks the enrichment pass (Open Library/Hardcover →
// ingest pipeline) to backfill covers + pub data for the JUST-IMPORTED books first. Best-effort and
// fire-and-forget — enrichment failures degrade to the honest placeholder, never a wrong-cover guess.
// bulkComplete's own guards apply: it fills only blanks, never overwrites a user-chosen cover, and
// respects the per-book recheck window, so a re-import doesn't re-hammer the sources.

/** Enrich the imported books (cover + metadata backfill), then refresh the books cache. */
export async function enrichImported(qc: QueryClient, importedIds: string[]): Promise<void> {
  if (!importedIds.length) return
  const wanted = new Set(importedIds)
  const all = qc.getQueryData<Book[]>(booksKey) ?? (await fetchBooks())
  const batch = all.filter((b) => wanted.has(b.id))
  if (!batch.length) return
  await bulkComplete(batch, () => {}, () => false)

  // Corpus administrators run the shared classifier automatically for the works this import just
  // touched. Ordinary readers cannot write canonical evidence; their works remain in the same
  // resumable administrator queue instead of turning an unverified personal search label into
  // shared truth. The global enrichment/series caches make this follow-up reuse the provider work.
  const { data: isAdmin, error: adminError } = await supabase.rpc('is_corpus_admin')
  if (!adminError && isAdmin === true) {
    const workIds = new Set(
      batch.map((book) => book.corpusWorkId).filter((id): id is string => !!id),
    )
    if (workIds.size) {
      const candidates = (await fetchCorpusEnrichmentCandidates()).filter((work) =>
        workIds.has(work.id),
      )
      if (candidates.length) await bulkCompleteCorpus(candidates, () => {}, () => false)
    }
  }
  await qc.invalidateQueries({ queryKey: booksKey })
}

async function fetchBooks(): Promise<Book[]> {
  // Fallback when the cache isn't warm (rare — the import flow just read it). Import scopes the
  // batch by id anyway, so a light select is enough to hand bulkComplete the incomplete rows.
  const { toBook } = await import('./mappers')
  const data = await pageAll<Parameters<typeof toBook>[0]>('books', (from, to) =>
    supabase
      .from('books')
      .select('*, book_authors(position, role, authors(id, name))', { count: 'exact' })
      .order('id')
      .range(from, to) as unknown as PromiseLike<{
      data: Parameters<typeof toBook>[0][] | null
      error: unknown
      count: number | null
    }>,
  )
  return data.map(toBook)
}
