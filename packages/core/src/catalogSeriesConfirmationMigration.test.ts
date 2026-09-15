import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(__dirname, '../../../supabase/migrations/20261018010000_catalog_series_confirmation.sql'),
  'utf8',
)
const rpc = migration.slice(
  migration.indexOf('create function public.admin_confirm_corpus_series_membership('),
  migration.indexOf('revoke all on function public.admin_confirm_corpus_series_membership('),
)

describe('manual shared-series confirmation migration', () => {
  it('adds a separate versioned stale boundary without changing legacy fingerprint formulas', () => {
    expect(migration).toContain("'seriesConfirmationVersion', 1")
    expect(migration).toContain(
      "'seriesFingerprint', public.catalog_series_confirmation_fingerprint(p_work)",
    )
    expect(migration).toContain("'series-confirmation-v1'")
    expect(migration).toContain("'edition-review-v1'")
    expect(migration).toContain("'invalid-publication-v1'")
  })

  it('is administrator-only, explicit, source-bound, and stale-write protected', () => {
    expect(rpc).toContain('from public.corpus_admins where user_id = caller for update')
    expect(rpc).toContain('p_identity_confirmed is distinct from true')
    expect(rpc).toContain("p_source_url !~ '^https://")
    expect(rpc).toContain("before_record->>'seriesFingerprint'")
    expect(rpc).toContain(
      'p_expected_revision is distinct from coalesce(previous_review.revision, 0)',
    )
    expect(rpc).toContain("suggestion.status = 'pending'")
    expect(rpc).toContain('Resolve the pending series suggestion')
  })

  it('confirms only the displayed tuple and routes unchanged reconciliation through existing guards', () => {
    expect(rpc).toContain('btrim(p_series) is distinct from btrim(work_row.series)')
    expect(rpc).toContain('p_position is distinct from work_row.position')
    expect(rpc).toContain('p_series_count is distinct from work_row.series_count')
    expect(rpc).toContain("set_config('reverie.series_classifier', 'on', true)")
    expect(rpc).toContain("set_config('reverie.corpus_series_target', case")
    expect(rpc).toContain("set_config('reverie.series_review_preserve_catalog', '', true)")
    expect(rpc).toMatch(
      /set series = series,[\s\S]*position = position,[\s\S]*series_count = series_count/,
    )
    expect(rpc).toContain("'kind', 'relational_membership'")
    expect(rpc).toContain("'sourceRef', btrim(p_source_url)")
    expect(rpc).toContain("'reviewedBy', caller")
  })

  it('does not add an autonomous, bulk, or direct personal-data writer', () => {
    expect(migration).not.toContain('record_corpus_series_discovery(')
    expect(rpc).not.toContain('update public.books')
    expect(rpc).not.toContain('insert into public.books')
    expect(rpc).not.toContain('update public.series_entries')
    expect(rpc).not.toContain('insert into public.series_entries')
    expect(rpc).not.toContain('net.http')
    expect(rpc).not.toContain('http_get')
  })

  it('records private review history and revokes every API role before the narrow grant', () => {
    expect(migration).toContain("'series_confirmation'")
    expect(rpc).toContain('insert into public.work_metadata_edits')
    expect(rpc).toContain('insert into public.corpus_metadata_review_events')
    expect(migration).toContain(
      'from public, anon, authenticated, service_role;\n' +
        'grant execute on function public.admin_confirm_corpus_series_membership(',
    )
    expect(migration).toContain(') to authenticated;')
  })
})
