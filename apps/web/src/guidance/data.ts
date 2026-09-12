import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { profileKey, type Profile, useProfile } from '../data/profile'
import { useReaderBooks } from '../data/readerBooks'
import {
  guidanceFromUnknown,
  libraryMilestones,
  type GuidanceMode,
  type GuideId,
  type Milestone,
} from './model'

export interface GuidancePatch {
  mode?: GuidanceMode
  complete?: boolean
  milestones?: Milestone[]
  reveal?: GuideId[]
  tour?: GuideId | null
}
async function requestGuidance(patch: GuidancePatch) {
  const { data, error } = await supabase.rpc('update_reader_guidance', {
    p_mode: patch.mode ?? null,
    p_complete: patch.complete ?? false,
    p_milestones: patch.milestones ?? [],
    p_reveal: patch.reveal ?? [],
    p_set_tour: patch.tour !== undefined,
    p_tour: patch.tour ?? null,
  })
  if (error) throw error
  const guidance = guidanceFromUnknown(data)
  if (!guidance) throw new Error('Your guide could not be read. Refresh and try again.')
  return guidance
}

export function useUpdateGuidance() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const userId = session?.user.id
  return useMutation({
    mutationKey: ['reader-guidance', userId],
    meta: { action: 'Your library guide' },
    mutationFn: async (patch: GuidancePatch) => {
      if (!userId) throw new Error('Sign in to save your guide.')
      return requestGuidance(patch)
    },
    onSuccess: (guidance) => {
      qc.setQueryData<Profile | null>(profileKey, (profile) =>
        profile && profile.id === userId ? { ...profile, guidance } : profile,
      )
      void qc.invalidateQueries({ queryKey: profileKey })
    },
  })
}

/** Mounted only for opted-in gentle readers. Reads use existing caches; observations are monotonic.
 * A failed background save is quiet and retried on a later mount, never in a request loop. */
export function GuidanceObserver() {
  const { data: profile } = useProfile()
  const books = useReaderBooks()
  const qc = useQueryClient()
  const attempted = useRef('')
  const guidance = profile?.guidance
  const missing =
    guidance?.mode === 'gentle' && books.data && !books.isError
      ? libraryMilestones(books.data).filter((id) => !guidance.milestones.includes(id))
      : []
  const key = missing.join(',')
  useEffect(() => {
    if (!key || attempted.current === key) return
    attempted.current = key
    void requestGuidance({ milestones: key.split(',') as Milestone[] })
      .then(() => qc.invalidateQueries({ queryKey: profileKey }))
      .catch(() => {
        /* Guidance observations must never interrupt a reading task. */
      })
  }, [key, qc])
  return null
}
