import { supabase } from '../lib/supabase'
import type { EditionCreditEvidence, EditionCreditHold } from '@reverie/core'

export interface EditionCreditReview {
  id: string
  status: 'prepared' | 'applied'
  evidence: EditionCreditEvidence
  selected?: number[]
  stale?: boolean
  decisions: { position: number; eligible: boolean; reasons: EditionCreditHold[] }[]
}
export async function prepareEditionCredits(input: {
  id: string; workId: string; editionId: string; fingerprint: string; evidence: EditionCreditEvidence
}): Promise<EditionCreditReview> {
  const { data, error } = await supabase.rpc('admin_prepare_edition_credits', {
    p_id: input.id, p_work: input.workId, p_edition: input.editionId,
    p_expected_fingerprint: input.fingerprint, p_evidence: input.evidence,
  })
  if (error) throw error
  return data as EditionCreditReview
}
export async function applyEditionCredits(id: string, selected: number[]) {
  const { data, error } = await supabase.rpc('admin_apply_edition_credits', {
    p_id: id, p_selected: selected, p_confirmed: true,
  })
  if (error) throw error
  return data as { id: string; status: 'applied'; selected: number[] }
}
export async function getEditionCreditReviews(workId: string, editionId: string) {
  const { data, error } = await supabase.rpc('admin_get_edition_credit_reviews', { p_work: workId, p_edition: editionId })
  if (error) throw error
  return (data as { version: 1; reviews: EditionCreditReview[] }).reviews
}
