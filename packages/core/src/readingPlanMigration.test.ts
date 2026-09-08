import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), '../../supabase/migrations/20260929010000_reading_plan_queue.sql'),
  'utf8',
).toLowerCase()

describe('reading plan queue migration', () => {
  it('adds bounded intention and ordered membership without turning every undated book into a plan', () => {
    expect(sql).toContain('add column if not exists plan_position numeric')
    expect(sql).toContain("add column if not exists plan_intention text not null default ''")
    expect(sql).toContain('char_length(plan_intention) <= 300')
    expect(sql).toContain('where plan_y is not null')
    expect(sql).toContain('and plan_position is null')
    expect(sql).not.toContain('where plan_position is null;')
  })

  it('keeps the five plan fields atomic at the authenticated merge boundary', () => {
    expect(sql).toContain('create or replace function public.merge_books_authoritative')
    expect(sql).toContain("- 'plan_y' - 'plan_m' - 'plan_d' - 'plan_position' - 'plan_intention'")
    expect(sql).toContain("(p_fields ->> 'plan_y') is not null or")
    expect(sql).toContain("(p_fields ->> 'plan_position') is not null")
    expect(sql).toContain('from public, anon, authenticated, service_role')
    expect(sql).toContain('to authenticated')
  })
})
