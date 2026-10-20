import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseCatalogEvidenceDraft, type CatalogEvidenceDraft } from '@reverie/core'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { CorpusRecord } from './corpusEditions'
import { catalogMetadataReviewKey } from './corpusMetadataReview'

export interface CatalogEvidenceContext {
  version: 1
  fingerprint: string
  record: CorpusRecord
  history: {
    id: string
    draft: CatalogEvidenceDraft
    applied_at: string
    previous_value: unknown
  }[]
  attempt?: { id: string; draft: CatalogEvidenceDraft } | null
}
export const catalogEvidenceKey = ['catalog-evidence'] as const
export function useCatalogEvidence(workId: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...catalogEvidenceKey, session?.user.id, workId],
    enabled: !!session,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_catalog_evidence', { p_work: workId })
      if (error?.code === 'PGRST202')
        throw new Error(
          'Evidence review needs the updated server. Existing catalog controls remain available.',
        )
      if (error) throw error
      if (data?.version !== 1 || !data?.fingerprint || !data?.record)
        throw new Error('Reload the current evidence review before deciding.')
      return data as CatalogEvidenceContext
    },
  })
}
export interface CatalogEvidenceSave {
  id: string
  workId: string
  fingerprint: string
  draft: CatalogEvidenceDraft
}
export async function readCatalogEvidenceAttempt(workId: string, id: string) {
  const { data, error } = await supabase.rpc('admin_get_catalog_evidence', {
    p_work: workId,
    p_review: id,
  })
  if (error) throw error
  return data as CatalogEvidenceContext
}
export async function applyCatalogEvidence(input: CatalogEvidenceSave) {
  // Snapshot before yielding: caller edits cannot change an in-flight reviewed selection.
  const frozen = structuredClone(input)
  const draft = parseCatalogEvidenceDraft(frozen.draft)
  const { data, error } = await supabase.rpc('admin_apply_catalog_evidence', {
    p_id: frozen.id,
    p_work: frozen.workId,
    p_expected_fingerprint: frozen.fingerprint,
    p_draft: draft,
    p_confirmed: true,
  })
  if (error) throw error
  return data as { id: string; status: 'applied'; appliedAt: string }
}
export function useApplyCatalogEvidence() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: applyCatalogEvidence,
    retry: false,
    networkMode: 'always',
    meta: { action: 'The reviewed catalog correction' },
    onSuccess: () => {
      // A read failure after a confirmed write cannot turn the write into a failed save.
      for (const queryKey of [
        catalogEvidenceKey,
        catalogMetadataReviewKey,
        ['corpus-record'],
        ['works'],
        ['discover-details'],
      ])
        void client.invalidateQueries({ queryKey }).catch(() => undefined)
    },
  })
}
