import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(__dirname, '../../../supabase/migrations/20261016010000_publication_tuple_write_guard.sql'),
  'utf8',
)

describe('publication tuple write guard migration', () => {
  it('guards both personal and shared writes while allowing an unknown date', () => {
    expect(migration).toContain('create function public.validate_publication_tuple_write()')
    expect(migration).toContain(
      'if new.pub_y is null and new.pub_m is null and new.pub_d is null then',
    )
    expect(migration).toContain(
      'if not public.publication_tuple_is_valid(new.pub_y, new.pub_m, new.pub_d) then',
    )
    expect(migration).toContain('before insert or update of pub_y, pub_m, pub_d on public.books')
    expect(migration).toContain('before insert or update of pub_y, pub_m, pub_d on public.works')
  })

  it('does not block an unrelated update to a historical invalid row', () => {
    expect(migration).toContain("if tg_op = 'UPDATE'")
    expect(migration).toContain('new.pub_y is not distinct from old.pub_y')
    expect(migration).toContain('new.pub_m is not distinct from old.pub_m')
    expect(migration).toContain('new.pub_d is not distinct from old.pub_d')
  })

  it('keeps the trigger helper outside the callable API surface', () => {
    expect(migration).toContain('revoke all on function public.validate_publication_tuple_write()')
    expect(migration).toContain('from public, anon, authenticated, service_role;')
  })
})
