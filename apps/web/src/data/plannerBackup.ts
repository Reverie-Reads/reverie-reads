import type { BackupExtensionProvider } from './importExport'
import { loadPlannerEntries, parsePlannerEntries } from './plannerEntries'
import { supabase } from '../lib/supabase'

export const plannerBackupProvider: BackupExtensionProvider = {
    id: 'reader-planner',
    build: loadPlannerEntries,
    counts: payload => ({ reader_planner_entries: parsePlannerEntries(payload).length }),
    preflightRestore: async payload => { parsePlannerEntries(payload) },
    restore: async (payload, {ownerId}) => {
      const rows = parsePlannerEntries(payload)
      for (let start=0; start<rows.length; start+=100) {
        const batch = rows.slice(start,start+100).map(row => ({ ...row, owner_id: ownerId }))
        const {error} = await supabase.from('reader_planner_entries').upsert(batch, {onConflict:'owner_id,id'})
        if (error) throw error
      }
      return { reader_planner_entries: rows.length }
    },
}
