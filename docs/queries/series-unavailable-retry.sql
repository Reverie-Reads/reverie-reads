-- OWNER ONLY. Incident repair, NOT a migration. Default is rollback.
-- Read docs/tasks/series-unavailable-recovery.md first. Replace ONLY the reviewed input below.
-- Keep real UUIDs/fingerprints private. At most 25 rows, first canary at most 5.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create temporary table series_retry_input (id uuid primary key, fingerprint text not null) on commit drop;
-- Insert reviewed (id, work_fingerprint) pairs from series-unavailable-inventory.sql here.
-- Empty input deliberately refuses to run.
create temporary table series_retry_actor (id uuid primary key) on commit drop;
-- Insert the existing corpus administrator's UUID here; never create an administrator for this.

do $repair$
declare
  actor uuid;
  before_row public.works%rowtype;
begin
  if (select count(*) from series_retry_input) not between 1 and 25
     or (select count(*) from series_retry_actor) <> 1 then
    raise exception 'Expected 1-25 reviewed targets and one existing administrator';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations
                 where version = '20261002010000') then
    raise exception 'Deploy the durable series-state fix first';
  end if;
  select id into actor from series_retry_actor;
  perform 1 from public.profiles where id = actor for key share;
  perform 1 from public.corpus_admins where user_id = actor for update;
  if not found then raise exception 'Existing corpus administrator required'; end if;
  if exists (select 1 from public.corpus_sweep_runs where status in ('queued', 'running')) then
    raise exception 'Finish or cancel the active sweep before recovery';
  end if;
  -- Match ordinary writer lock order before work updates invoke their existing triggers.
  perform 1 from public.books b join series_retry_input i on i.id = b.corpus_work_id
    where b.removed_at is null order by b.id for update of b;
  perform 1 from public.works w join series_retry_input i on i.id = w.id
    order by w.id for update of w;
  if (select count(*) from public.works w join series_retry_input i on i.id = w.id
      where md5(to_jsonb(w)::text) = i.fingerprint
        and w.series_check_state = 'no_series'
        and w.series_checked_at < timestamptz '2026-09-10T00:00:00Z'
        and w.series_check_reason = 'The relational series source was unavailable; the search label was not accepted by itself.'
        and w.series_check_evidence @> '[{"source":"hardcover","kind":"provider_unavailable"}]'::jsonb
        and not exists (select 1 from public.corpus_series_entries e
                        where e.work_id = w.id and e.removed_at is null))
      <> (select count(*) from series_retry_input) then
    raise exception 'Missing, changed, already recovered, or ineligible target; regenerate and review inventory';
  end if;
  perform set_config('reverie.series_classifier', 'on', true);
  for before_row in select w.* from public.works w join series_retry_input i on i.id = w.id order by w.id loop
    -- Null schedules a fresh check; the audit retains the exact prior timestamp and evidence.
    -- No title, membership, position, possession, review decision or provider cache is changed.
    update public.works set series_check_state = 'unresolved', series_checked_at = null
      where id = before_row.id;
    insert into public.work_metadata_edits (work_id, editor_id, previous_value, next_value)
      select w.id, actor, to_jsonb(before_row), to_jsonb(w)
      from public.works w where w.id = before_row.id;
  end loop;
  perform set_config('reverie.series_classifier', '', true);
end;
$repair$;

select w.id, w.series_check_state, w.series_checked_at
from public.works w join series_retry_input i on i.id = w.id order by w.id;
-- Inspect and preserve the dry-run output. Only the owner may replace this with COMMIT on a
-- separately reviewed execution. The same fingerprint checks are rerun after locks each time.
rollback;
