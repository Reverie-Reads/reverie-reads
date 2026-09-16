import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export type AddSaveAction = 'save' | 'merge' | 'keep_both'

/** One mounted Add form owns one possible new row. A retry never replays a confirmed insert. */
export function useAddSave(readerId: string | undefined) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveredBookId, setRecoveredBookId] = useState<string | null>(null)
  const [failedAction, setFailedAction] = useState<AddSaveAction | null>(null)
  const lockedAction = useRef<AddSaveAction | null>(null)
  const recovered = useRef(false)
  const pending = useRef(false)
  const attempted = useRef(false)
  const newBookId = useRef<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  async function run(action: AddSaveAction, save: (newId: string, retry: boolean) => Promise<void>) {
    if (pending.current || recovered.current || (lockedAction.current && lockedAction.current !== action)) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      if (!readerId) throw new Error('No reader')
      const id = (newBookId.current ??= crypto.randomUUID())
      if (attempted.current) {
        // Read only the exact attempt identity under the current reader's RLS. A missing response
        // never authorizes an upsert or a title-based guess about which existing book is ours.
        const { data, error: lookupError } = await supabase
          .from('books')
          .select('id,removed_at')
          .eq('id', id)
          .eq('owner_id', readerId)
          .maybeSingle()
        if (lookupError) throw lookupError
        if (!mounted.current) return
        if (data) {
          if (data.removed_at) {
            setError('This book was saved and then removed. Check your library before adding it again.')
          } else {
            recovered.current = true
            setRecoveredBookId(data.id)
            setError('Your book is in your library, but not every detail was confirmed. Review the saved book before making further changes. Your draft is still here.')
          }
          return
        }
      }
      if (!mounted.current) return
      const retry = attempted.current
      attempted.current = true
      await save(id, retry)
      lockedAction.current = null
      if (mounted.current) setFailedAction(null)
    } catch {
      lockedAction.current = action
      if (mounted.current) setFailedAction(action)
      if (mounted.current)
        setError('We couldn’t confirm the save. Your draft is still here. Try again to check for a saved copy before saving.')
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return { busy, error, recoveredBookId, failedAction, run }
}
