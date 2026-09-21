import { useQuery } from '@tanstack/react-query'
import type { ReleaseHit } from './releases'
import { parseReleasePub } from './releases'
import { supabase } from '../lib/supabase'

export interface ReleaseBrowseResult {
  hits: ReleaseHit[]
  checkedAt: string
  providers: Record<'hardcover' | 'prh', 'ready' | 'unavailable' | 'not_configured'>
}

export function releaseBrowseGroups(hits: ReleaseHit[], now: Date) {
  const today = now.toISOString().slice(0, 10)
  const from = new Date(`${today}T00:00:00Z`)
  const to = new Date(from)
  from.setUTCDate(from.getUTCDate() - 90)
  to.setUTCDate(to.getUTCDate() + 183)
  const admitted = hits.filter((h) => {
    const date = parseReleasePub(h.pub)
    return (
      date?.d != null &&
      h.release &&
      h.pub >= from.toISOString().slice(0, 10) &&
      h.pub <= to.toISOString().slice(0, 10)
    )
  })
  return {
    recent: admitted.filter((h) => h.pub <= today).sort((a, b) => b.pub.localeCompare(a.pub)),
    upcoming: admitted.filter((h) => h.pub > today).sort((a, b) => a.pub.localeCompare(b.pub)),
  }
}

export function useReleaseBrowse() {
  return useQuery({
    queryKey: ['release-browse', new Date().toISOString().slice(0, 10)],
    queryFn: async ({ signal }): Promise<ReleaseBrowseResult> => {
      const { data, error } = await supabase.functions.invoke('releases', {
        body: { mode: 'browse' },
        signal,
      })
      if (error || !Array.isArray(data?.hits) || !data?.providers || !data?.checkedAt)
        throw new Error('Releases could not be loaded')
      return data as ReleaseBrowseResult
    },
    staleTime: 1000 * 60 * 30,
    retry: false,
  })
}
