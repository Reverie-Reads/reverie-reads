import { createClient } from '@supabase/supabase-js'

const endpoint = 'http://127.0.0.1:55321'
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

/** Explicit setup for scenarios that previously marked this reader as already onboarded.
 * Uses the reader's own RPC, never a UI interception or an administrator grant.
 * First-use scenarios must not call this: they exercise the real unconfigured welcome. */
export async function configureReturningReader(accessToken: string): Promise<void> {
  const reader = createClient(endpoint, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  const { data, error } = await reader.rpc('update_reader_guidance', {
    p_mode: 'full',
    p_complete: true,
    p_set_tour: true,
    p_tour: null,
  })
  if (error) throw error
  if (data?.mode !== 'full' || data?.setupComplete !== true)
    throw new Error('Returning-reader fixture could not save its guidance choice')
}
