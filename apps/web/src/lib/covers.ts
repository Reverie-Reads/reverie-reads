import type { CoverSource } from '@reverie/core'
import { supabase } from './supabase'

// Client wrappers for the `covers` Edge Function — the cover sheet's editions chooser and the
// single ingest pipeline every chosen cover flows through (edition pick / camera / upload / URL).

/** One alternate edition, with context (never a bare image wall): cover + format + year + publisher. */
export interface EditionOption {
  source: 'hardcover' | 'google'
  cover: string
  isbn13?: string
  isbn10?: string
  format?: string
  year?: number
  publisher?: string
  pages?: number
  title?: string
}

export interface IngestResult {
  cover: string
  thumb: string
  color: string | null
  sourceUrl: string | null
  /** normalization fell back to storing the original bytes (no thumb/colour) */
  degraded?: boolean
  /** per-stage wall times, present only when `trace: true` was requested */
  _trace?: { spans: { s: string; ms: number }[]; totalMs: number }
}

export type IngestOutcome = { status: 'ok'; data: IngestResult } | { status: 'error'; code: string }

/** Fetch alternate editions for a book (Hardcover + Google, server-cached per book). */
export async function fetchEditions(
  input: {
    isbn?: string
    title?: string
    author?: string
  },
  options: { throwOnError?: boolean } = {},
): Promise<EditionOption[]> {
  try {
    const { data, error } = await supabase.functions.invoke('covers', {
      body: { action: 'editions', ...input },
    })
    if (error) throw error
    return ((data as { editions?: EditionOption[] })?.editions ?? []).filter((e) => e.cover)
  } catch (error) {
    if (options.throwOnError) throw error
    return []
  }
}

/**
 * Ingest a chosen cover through the durable pipeline: pass `file` (camera/upload, post-crop) OR
 * `url` (reviewed provider/edition link — fetched server-side). Arbitrary pasted hosts remain
 * display-time hotlinks and never call this boundary. Returns the stored asset URLs + the extracted
 * dominant colour; the caller persists them via the normal RLS-checked book mutation.
 */
export async function ingestCover(input: {
  bookId: string
  source: CoverSource
  file?: Blob
  url?: string
  sourceUrl?: string
  /** Ask the function to return its per-stage timings (URL ingests only). */
  trace?: boolean
}): Promise<IngestOutcome> {
  try {
    let body: FormData | Record<string, unknown>
    if (input.file) {
      const form = new FormData()
      form.set('file', input.file, 'cover')
      form.set('bookId', input.bookId)
      form.set('source', input.source)
      if (input.sourceUrl) form.set('sourceUrl', input.sourceUrl)
      body = form
    } else {
      body = {
        action: 'ingest',
        bookId: input.bookId,
        source: input.source,
        url: input.url,
        sourceUrl: input.sourceUrl,
        ...(input.trace ? { trace: true } : {}),
      }
    }
    const { data, error } = await supabase.functions.invoke('covers', { body })
    if (error) {
      // FunctionsHttpError carries the response; surface the server's error code for the sheet copy.
      const ctx = (error as { context?: Response }).context
      const code = ctx
        ? ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error
        : undefined
      return { status: 'error', code: code ?? 'failed' }
    }
    const d = data as IngestResult & { error?: string }
    if (!d?.cover) return { status: 'error', code: d?.error ?? 'failed' }
    return { status: 'ok', data: d }
  } catch {
    return { status: 'error', code: 'failed' }
  }
}

/** Owner/admin corpus ingest. The Edge Function verifies exact work-edit authority and stores the
 * asset under w/{workId}, so the shared cover has no dependency on a personal book or account. */
export async function ingestCorpusCover(input: {
  workId: string
  source: CoverSource
  url: string
  sourceUrl?: string
  trace?: boolean
}): Promise<IngestOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke('covers', {
      body: {
        action: 'ingest',
        scope: 'corpus',
        workId: input.workId,
        source: input.source,
        url: input.url,
        sourceUrl: input.sourceUrl,
        ...(input.trace ? { trace: true } : {}),
      },
    })
    if (error) {
      const ctx = (error as { context?: Response }).context
      const code = ctx
        ? ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error
        : undefined
      return { status: 'error', code: code ?? 'failed' }
    }
    const d = data as IngestResult & { error?: string }
    if (!d?.cover) return { status: 'error', code: d?.error ?? 'failed' }
    return { status: 'ok', data: d }
  } catch {
    return { status: 'error', code: 'failed' }
  }
}
