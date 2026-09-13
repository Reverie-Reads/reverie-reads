import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

export const METADATA_ISSUES = {
  isbn_conflict: 'ISBN shared by several records',
  duplicate_identity: 'Same title and author',
  invalid_isbn: 'ISBN needs checking',
  invalid_publication: 'Invalid publication date',
  description: 'Missing description',
} as const
export type MetadataIssue = keyof typeof METADATA_ISSUES
export type MetadataState = 'attention' | 'deferred' | 'reviewed' | 'all'
export interface RelatedMetadataWork {
  id: string
  title: string
  author: string
  isbns: string[]
  description: string | null
  pub_y: number | null
  publisher: string | null
  language: string | null
  isbn_match: boolean
  identity_match: boolean
}
export interface CatalogMetadataWork {
  id: string
  title: string
  author: string
  contributors?: { name: string; role?: string }[]
  isbns: string[]
  description: string
  descriptionSource: string | null
  cover: string | null
  year: number | null
  publisher: string | null
  language: string | null
  issues: MetadataIssue[]
  related: RelatedMetadataWork[]
  relatedTotal: number
  fingerprint: string
  revision: number
  state: 'open' | 'deferred' | 'reviewed'
  note: string
  sourceUrl: string
  /** Missing on an older server: keep correction controls unavailable until migration lands. */
  editionCorrectionVersion?: number
  editionFingerprint?: string
  pages?: number | null
  publication?: { y: number | null; m: number | null; d: number | null }
  editionProvenance?: Record<string, { referenceIsbn?: string; sourceRef?: string } | null>
}
export interface MetadataQueueInput {
  state: MetadataState
  issue: MetadataIssue | 'all'
  query: string
  offset: number
  workId?: string
}
export function editionPublicationLabel(pub: CatalogMetadataWork['publication']) {
  if (!pub || pub.y == null) return 'Unknown'
  return [
    String(pub.y),
    ...(pub.m == null ? [] : [String(pub.m).padStart(2, '0')]),
    ...(pub.d == null ? [] : [String(pub.d).padStart(2, '0')]),
  ].join('-')
}
export const METADATA_PAGE_SIZE = 20
export const catalogMetadataReviewKey = ['catalog-metadata-review'] as const
export function useCatalogMetadataQueue(input: MetadataQueueInput, enabled: boolean) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...catalogMetadataReviewKey, session?.user.id, 'queue', input],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_corpus_metadata_reviews', {
        p_state: input.state,
        p_issue: input.issue,
        p_query: input.query,
        p_offset: input.offset,
        p_limit: METADATA_PAGE_SIZE,
        p_work: input.workId ?? null,
      })
      if (error) throw error
      return data as { items: CatalogMetadataWork[]; total: number }
    },
    enabled: enabled && !!session,
    staleTime: 0,
  })
}
export type MetadataAction = 'description' | 'reviewed' | 'defer' | 'reopen' | 'edition_details'
export const METADATA_ACTIONS: Record<MetadataAction, string> = {
  description: 'Description corrected',
  reviewed: 'Assessment recorded',
  defer: 'Set aside for later',
  reopen: 'Review reopened',
  edition_details: 'Edition details corrected',
}
export interface MetadataReviewInput {
  work: CatalogMetadataWork
  action: Exclude<MetadataAction, 'edition_details'>
  note: string
  sourceUrl: string
  description?: string
  identityConfirmed: boolean
}
export async function saveCatalogMetadataReview(input: MetadataReviewInput): Promise<string> {
  const { data, error } = await supabase.rpc('admin_review_corpus_metadata', {
    p_work: input.work.id,
    p_expected_fingerprint: input.work.fingerprint,
    p_expected_revision: input.work.revision,
    p_action: input.action,
    p_note: input.note.trim(),
    p_source_url: input.sourceUrl.trim(),
    p_description: input.action === 'description' ? (input.description?.trim() ?? null) : null,
    p_identity_confirmed: input.identityConfirmed,
  })
  if (error) throw error
  return data as string
}
export interface EditionCorrectionInput {
  work: CatalogMetadataWork
  isbn: string
  evidenceTitle: string
  evidenceAuthor: string
  correction:
    | { field: 'pages'; value: { pages: number } }
    | {
        field: 'publication'
        value: { y: number; m: number | null; d: number | null }
      }
  sourceUrl: string
  note: string
  identityConfirmed: boolean
}
export async function saveCatalogEditionCorrection(input: EditionCorrectionInput): Promise<string> {
  if (input.work.editionCorrectionVersion !== 1 || !input.work.editionFingerprint)
    throw new Error(
      'Edition corrections are not available from this server. Reload after deployment.',
    )
  const { data, error } = await supabase.rpc('admin_correct_corpus_edition_details', {
    p_work: input.work.id,
    p_expected_fingerprint: input.work.editionFingerprint,
    p_expected_revision: input.work.revision,
    p_isbn: input.isbn,
    p_evidence_title: input.evidenceTitle.trim(),
    p_evidence_author: input.evidenceAuthor.trim(),
    p_field: input.correction.field,
    p_value: input.correction.value,
    p_source_url: input.sourceUrl.trim(),
    p_note: input.note.trim(),
    p_identity_confirmed: input.identityConfirmed,
  })
  if (error) throw error
  return data as string
}
function useMetadataMutation<T>(mutationFn: (input: T) => Promise<string>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn,
    networkMode: 'always',
    retry: false,
    meta: { action: 'The catalog metadata review' },
    onSuccess: async () => {
      await Promise.all(
        [
          catalogMetadataReviewKey,
          ['works'],
          ['discover-details'],
          ['works-browse'],
          ['works-lookup'],
          ['works-lookup-isbns'],
          ['household'],
        ].map((queryKey) => client.invalidateQueries({ queryKey })),
      )
    },
  })
}
export function useSaveCatalogMetadataReview() {
  return useMetadataMutation(saveCatalogMetadataReview)
}
export function useSaveCatalogEditionCorrection() {
  return useMetadataMutation(saveCatalogEditionCorrection)
}
export interface MetadataEvent {
  id: string
  action: MetadataAction
  created_at: string
  next_value: {
    review: { note: string; source_url: string }
    record: {
      description: string
      pages?: number | null
      publication?: CatalogMetadataWork['publication']
    }
    field?: 'pages' | 'publication'
    referenceIsbn?: string
  }
}
export function useCatalogMetadataHistory(workId: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...catalogMetadataReviewKey, session?.user.id, 'history', workId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corpus_metadata_review_events')
        .select('id, action, created_at, next_value')
        .eq('work_id', workId)
        .order('created_at', { ascending: false })
        .order('id')
        .limit(10)
      if (error) throw error
      return data as MetadataEvent[]
    },
    enabled: !!session,
    staleTime: 0,
  })
}
