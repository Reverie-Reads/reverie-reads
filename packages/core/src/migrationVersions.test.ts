import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('deployment migration identifiers', () => {
  it('keeps every version unique in the complete deployment tree', () => {
    const files = readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(
      (file) => file.endsWith('.sql'),
    )
    const byVersion = new Map<string, string[]>()
    for (const file of files) {
      expect(file).toMatch(/^\d{14}_.+\.sql$/)
      const version = file.split('_')[0]!
      byVersion.set(version, [...(byVersion.get(version) ?? []), file])
    }
    expect([...byVersion.values()].filter((group) => group.length > 1)).toEqual([])
  })
})
