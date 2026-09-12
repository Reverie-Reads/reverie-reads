import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isActiveSkin, isMode, type ActiveSkin, type AdaptiveBundle, type AdaptivePending, type Mode } from '@reverie/core'
import { guidanceFromUnknown, type Guidance } from '../guidance/model'
import { supabase } from '../lib/supabase'
import {
  arrangementDocument,
  arrangementFromUnknown,
  type ArrangementConfig,
} from '../design/arrangements'

export interface DefaultStore {
  id: string
  name: string
  website: string
}

export interface Profile {
  id: string
  displayName: string
  goalYear: number | null
  goalTarget: number | null
  autoMergeDuplicates: boolean
  defaultStore: DefaultStore | null
  skin: ActiveSkin
  mode: Mode
  adaptiveSkin: AdaptiveBundle | null
  adaptiveLocked: boolean
  adaptivePending: AdaptivePending | null
  /** Last evolving-skin suggestion the reader dismissed ("Not now"); the cron won't re-surface the
   *  same shift until taste moves materially past it. */
  adaptiveDismissed: AdaptivePending | null
  /** Split the Owned shelf by format (physical / ebook / audiobook + unmarked). Default off. */
  shelfBreakdownFormat: boolean
  /** hide the intensity ("Spice") field entirely — a VIEW flag; books.intensity is untouched */
  hideIntensity: boolean
  /** Give DNF its own shelf instead of showing those books within Read. Default off. */
  shelfBreakdownDnf: boolean
  /** The reader's versioned navigation priorities and independently ordered Home modules. */
  arrangement: ArrangementConfig
  guidance?: Guidance | null
}

interface ProfileRow {
  id: string
  display_name: string | null
  goal_year: number | null
  goal_target: number | null
  auto_merge_duplicates: boolean | null
  default_store_id: string | null
  default_store_name: string | null
  default_store_website: string | null
  skin: string | null
  mode: string | null
  adaptive_skin: AdaptiveBundle | null
  adaptive_locked: boolean | null
  adaptive_pending: AdaptivePending | null
  adaptive_dismissed: AdaptivePending | null
  shelf_breakdown_format: boolean | null
  hide_intensity: boolean | null
  shelf_breakdown_dnf: boolean | null
  arrangement: unknown
  guidance: unknown
}

export const profileKey = ['profile'] as const

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  displayName: row.display_name ?? '',
  goalYear: row.goal_year,
  goalTarget: row.goal_target,
  autoMergeDuplicates: row.auto_merge_duplicates ?? true,
  defaultStore: row.default_store_id
    ? { id: row.default_store_id, name: row.default_store_name ?? '', website: row.default_store_website ?? '' }
    : null,
  skin: isActiveSkin(row.skin) ? row.skin : 'tryst',
  mode: isMode(row.mode) ? row.mode : 'system',
  adaptiveSkin: row.adaptive_skin ?? null,
  adaptiveLocked: row.adaptive_locked ?? false,
  adaptivePending: row.adaptive_pending ?? null,
  adaptiveDismissed: row.adaptive_dismissed ?? null,
  // `?? false` mirrors the column defaults, and covers a row cached before the B1 migration —
  // the same posture as autoMergeDuplicates' `?? true`.
  shelfBreakdownFormat: row.shelf_breakdown_format ?? false,
  hideIntensity: row.hide_intensity ?? false,
  shelfBreakdownDnf: row.shelf_breakdown_dnf ?? false,
  arrangement: arrangementFromUnknown(row.arrangement),
  guidance: guidanceFromUnknown(row.guidance),
})

/** The signed-in user's own profile (RLS returns only their row). */
export function useProfile() {
  return useQuery({
    queryKey: profileKey,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, goal_year, goal_target, auto_merge_duplicates, default_store_id, default_store_name, default_store_website, skin, mode, adaptive_skin, adaptive_locked, adaptive_pending, adaptive_dismissed, shelf_breakdown_format, shelf_breakdown_dnf, hide_intensity, arrangement, guidance')
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data ? toProfile(data as ProfileRow) : null
    },
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'Your profile' },
    mutationFn: async (patch: {
      displayName?: string
      goalYear?: number | null
      goalTarget?: number | null
      autoMergeDuplicates?: boolean
      defaultStore?: DefaultStore | null
      skin?: ActiveSkin
      mode?: Mode
      adaptiveSkin?: AdaptiveBundle | null
      adaptiveLocked?: boolean
      adaptivePending?: AdaptivePending | null
      adaptiveDismissed?: AdaptivePending | null
      shelfBreakdownFormat?: boolean
      hideIntensity?: boolean
      shelfBreakdownDnf?: boolean
      arrangement?: ArrangementConfig
    }): Promise<void> => {
      const { data: auth } = await supabase.auth.getUser()
      const id = auth.user?.id
      if (!id) throw new Error('Not signed in')
      const row: Partial<ProfileRow> = {}
      if (patch.displayName !== undefined) row.display_name = patch.displayName
      if (patch.goalYear !== undefined) row.goal_year = patch.goalYear
      if (patch.goalTarget !== undefined) row.goal_target = patch.goalTarget
      if (patch.autoMergeDuplicates !== undefined) row.auto_merge_duplicates = patch.autoMergeDuplicates
      if (patch.skin !== undefined) row.skin = patch.skin
      if (patch.mode !== undefined) row.mode = patch.mode
      if (patch.adaptiveSkin !== undefined) row.adaptive_skin = patch.adaptiveSkin
      if (patch.adaptiveLocked !== undefined) row.adaptive_locked = patch.adaptiveLocked
      if (patch.adaptivePending !== undefined) row.adaptive_pending = patch.adaptivePending
      if (patch.adaptiveDismissed !== undefined) row.adaptive_dismissed = patch.adaptiveDismissed
      if (patch.shelfBreakdownFormat !== undefined)
        row.shelf_breakdown_format = patch.shelfBreakdownFormat
      if (patch.hideIntensity !== undefined) row.hide_intensity = patch.hideIntensity
      if (patch.shelfBreakdownDnf !== undefined) row.shelf_breakdown_dnf = patch.shelfBreakdownDnf
      if (patch.arrangement !== undefined) row.arrangement = arrangementDocument(patch.arrangement)
      if (patch.defaultStore !== undefined) {
        row.default_store_id = patch.defaultStore?.id ?? null
        row.default_store_name = patch.defaultStore?.name ?? null
        row.default_store_website = patch.defaultStore?.website ?? null
      }
      const { error } = await supabase.from('profiles').update(row).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKey }),
  })
}

/**
 * Whether this reader has hidden the intensity ("Spice") field.
 *
 * A hook rather than a prop so every render site is a one-liner and none of them drills profile
 * through a grid — the same shape as `useLabels()`, which the same components already call.
 * Defaults to FALSE while the profile query is loading: spice is visible for everyone today, so
 * the loading state must not flash the field away and back.
 */
export function useHideIntensity(): boolean {
  return useProfile().data?.hideIntensity ?? false
}
