import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { PubDate } from '@reverie/core'

export interface CorpusEditionDetails {
  title?: string | null
  statement?: string | null
  format?: 'hardcover' | 'paperback' | 'ebook' | 'audiobook' | 'other' | null
  publisher?: string | null
  language?: string | null
  pages?: number | null
  publication?: PubDate | null
}
export interface CorpusEdition {
  id: string
  work_id: string
  isbn: string | null
  details: CorpusEditionDetails
  reviewed: boolean
  revision: number
  source_url: string | null
}
export interface CorpusIsbnReport {
  id: string
  isbn: string
  proposed_isbn: string | null
  note: string
  created_at: string
}
export interface CorpusRecord {
  id: string
  title: string
  author: string
  description: string | null
  genre: string | null
  genres: string[]
  subgenre: string | null
  subgenres: string[]
  spice: number | null
  darkness: number | null
  guidanceSource: { sourceRef?: string; observedAt?: string } | null
  isbns: string[]
  fingerprint: string
  editions: CorpusEdition[]
  reports: CorpusIsbnReport[]
  history: { id: string; action: string; source_url: string; note: string; created_at: string }[]
}
export const corpusRecordKey = ['corpus-record'] as const
export function useCorpusRecord(workId: string, enabled = true) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...corpusRecordKey, session?.user.id, workId],
    enabled: enabled && !!session && !!workId,
    queryFn: async (): Promise<CorpusRecord> => {
      const { data, error } = await supabase.rpc('get_corpus_record', { p_work: workId })
      if (error) throw error
      return data as CorpusRecord
    },
  })
}
export type CorpusRecordChange =
  | { action: 'edition'; value: { id: string; isbn: string | null; details: CorpusEditionDetails } }
  | { action: 'guidance'; value: { genres: string[]; subgenres: string[]; spice: number | null; darkness: number | null } }
  | { action: 'remove_isbn'; value: { isbn: string } }
  | { action: 'resolve_report'; value: { reportId: string } }
export function useSaveCorpusRecord() {
  const client = useQueryClient()
  return useMutation({
    retry: false,
    meta: { action: 'Shared catalog changes' },
    mutationFn: async (input: {
      record: CorpusRecord
      change: CorpusRecordChange
      sourceUrl: string
      note: string
    }) => {
      const { data, error } = await supabase.rpc('admin_save_corpus_record', {
        p_work: input.record.id,
        p_expected_fingerprint: input.record.fingerprint,
        p_action: input.change.action,
        p_value: input.change.value,
        p_source_url: input.sourceUrl.trim(),
        p_note: input.note.trim(),
        p_confirmed: true,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: async () => {
      await Promise.all([
        corpusRecordKey, ['catalog-metadata-review'], ['works'], ['works-browse'],
        ['works-lookup'], ['works-lookup-isbns'], ['discover-details'], ['household'], ['books'],
      ].map((queryKey) => client.invalidateQueries({ queryKey })))
    },
  })
}
export function useReportCorpusIsbn() {
  const client = useQueryClient()
  return useMutation({
    retry: false,
    meta: { action: 'ISBN report' },
    mutationFn: async (input: { workId: string; isbn: string; proposedIsbn: string; note: string }) => {
      const { data, error } = await supabase.rpc('report_corpus_isbn', {
        p_work: input.workId, p_isbn: input.isbn.trim(),
        p_proposed_isbn: input.proposedIsbn.trim() || null, p_note: input.note.trim(),
      })
      if (error) throw error
      return data as string
    },
    onSuccess: async () => {
      await Promise.all([corpusRecordKey, ['catalog-metadata-review']].map((queryKey) => client.invalidateQueries({ queryKey })))
    },
  })
}
export function catalogError(error: unknown): string {
  return (error as { message?: string } | null)?.message || 'The catalog change could not be saved. Your draft is still here.'
}
export function useSelectCorpusEdition() {
  const client = useQueryClient()
  return useMutation({
    retry: false,
    meta: { action: 'Edition selection' },
    mutationFn: async ({ book, edition }: { book: import('@reverie/core').Book; edition: CorpusEdition }) => {
      const { error } = await supabase.rpc('select_corpus_edition', {
        p_book: book.id, p_edition: edition.id, p_revision: edition.revision,
        p_expected: { isbn: book.isbn || '', pages: book.pages, publication: book.pub },
      })
      if (error) throw error
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['books'] }) },
  })
}
