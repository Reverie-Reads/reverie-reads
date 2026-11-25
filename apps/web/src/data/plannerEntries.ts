import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import { parseReleasePub } from './releases'

export interface PlannerEntry {
  id: string
  kind: 'watch' | 'plan'
  title: string
  author: string
  series: string
  timing: string
}

export function parsePlannerEntries(input: unknown): PlannerEntry[] {
  if (!Array.isArray(input)) throw new Error('Unreadable planner entries.')
  const ids = new Set<string>()
  for (const row of input) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(k => !['id','kind','title','author','series','timing'].includes(k)) ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id) || ids.has(row.id.toLowerCase()) ||
      !['watch','plan'].includes(row.kind) || [row.title,row.author,row.series].some(s => typeof s !== 'string' || s.length > 500) ||
      !row.title.trim() || typeof row.timing !== 'string' || (row.timing !== '' && (!parseReleasePub(row.timing) || row.timing !== row.timing.trim())))
      throw new Error('Invalid planner entry. Check its title and date.')
    ids.add(row.id.toLowerCase())
  }
  return input
}

export async function loadPlannerEntries(owner: string) {
  const rows = await pageAll<PlannerEntry>('reader_planner_entries', (from,to) => supabase.from('reader_planner_entries')
    .select('id,kind,title,author,series,timing',{count:'exact'}).eq('owner_id',owner).order('id').range(from,to))
  return rows.map(({id,kind,title,author,series,timing}) => ({id,kind,title,author,series,timing}))
}

export function usePlannerEntries() {
  const { session } = useAuth()
  const owner = session?.user.id
  return useQuery({ queryKey: ['plannerEntries',owner], enabled: !!owner, queryFn: () => loadPlannerEntries(owner!) })
}

export function useSavePlannerEntry() {
  const { session } = useAuth()
  const owner = session?.user.id
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'The planner entry' },
    mutationFn: async (entry: PlannerEntry | { remove: string }) => {
      if (!owner) throw new Error('Sign in to save your plan.')
      if ('remove' in entry) {
        const { error } = await supabase.from('reader_planner_entries').delete().eq('owner_id',owner).eq('id',entry.remove)
        if (error) throw error
      } else {
        parsePlannerEntries([entry])
        const { error } = await supabase.from('reader_planner_entries').upsert({...entry,owner_id:owner},{onConflict:'owner_id,id'})
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey:['plannerEntries',owner] }),
  })
}
