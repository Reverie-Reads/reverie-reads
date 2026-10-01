import { readProductPreferences, type ProductPreferences } from '@reverie/core'
import { supabase } from '../lib/supabase'

interface ProductPreferencesSnapshot {
  document: unknown
  revision: number
}
async function requireActor(actorId: string): Promise<void> {
  const { data, error } = await supabase.auth.getUser()
  if (error || data.user?.id !== actorId) throw new Error('Your account changed. Reopen this action in the current account.')
}
function snapshot(value: unknown): ProductPreferencesSnapshot {
  const row = value as Partial<ProductPreferencesSnapshot> | null
  if (!row || !('document' in row) || !Number.isSafeInteger(row.revision) || (row.revision as number) < 0)
    throw new Error('Product preferences are unavailable. Refresh and try again.')
  return { document: row.document, revision: row.revision as number }
}

/** Explicit actor throughout: an account change must neither target a new account nor return old data. */
export async function fetchProductPreferences(actorId: string): Promise<ProductPreferencesSnapshot> {
  await requireActor(actorId)
  const { data, error } = await supabase.from('profiles')
    .select('product_preferences, product_preferences_revision').eq('id', actorId).maybeSingle()
  if (error) throw error
  await requireActor(actorId)
  return snapshot(data ? { document: data.product_preferences, revision: data.product_preferences_revision } : null)
}

/** No optimistic write or automatic conflict rebase; callers retain their draft and the frozen revision. */
export async function saveProductPreferences(
  actorId: string, expectedRevision: number, document: ProductPreferences,
): Promise<ProductPreferencesSnapshot> {
  if (readProductPreferences(document).kind !== 'supported' || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 0 || expectedRevision > 2147483647)
    throw new Error('These product preferences cannot be saved by this version.')
  await requireActor(actorId)
  const { data, error } = await supabase.rpc('save_product_preferences', {
    p_owner_id: actorId, p_expected_revision: expectedRevision, p_document: document,
  })
  if (error) throw error
  await requireActor(actorId)
  return snapshot(data)
}
