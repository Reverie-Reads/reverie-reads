-- Incident-specific, owner-started recovery for the September 10 Hardcover outage. This extends
-- the existing durable corpus-sweep journal instead of introducing a second privileged runner.
-- It does not acquire metadata or covers, and it never embeds the private exclusion manifest in
-- source control or Workflow history.

alter table public.corpus_sweep_runs
  add column purpose text not null default 'corpus_sweep'
    check (purpose in ('corpus_sweep', 'series_recovery')),
  add column eligible_count integer not null default 0 check (eligible_count >= 0),
  add column excluded_count integer not null default 0 check (excluded_count >= 0),
  add column exclusion_manifest_hash text,
  add column confirmed_count integer not null default 0 check (confirmed_count >= 0),
  add column review_count integer not null default 0 check (review_count >= 0),
  add column deferred_count integer not null default 0 check (deferred_count >= 0),
  add column uncertain_count integer not null default 0 check (uncertain_count >= 0),
  add constraint corpus_sweep_runs_recovery_scope_check check (
    (purpose = 'corpus_sweep' and excluded_count = 0 and exclusion_manifest_hash is null)
    or (purpose = 'series_recovery'
      and eligible_count = total_count + excluded_count
      and excluded_count = 23
      and exclusion_manifest_hash ~ '^[a-f0-9]{32}$')
  );

alter table public.corpus_sweep_run_items
  add column source_fingerprint text,
  add column reset_fingerprint text,
  add column stage text not null default 'pending'
    check (stage in ('pending', 'reset', 'lookup_started', 'save_started', 'complete')),
  add constraint corpus_sweep_run_items_fingerprint_check check (
    (source_fingerprint is null and reset_fingerprint is null)
    or (source_fingerprint ~ '^[a-f0-9]{32}$'
      and (reset_fingerprint is null or reset_fingerprint ~ '^[a-f0-9]{32}$'))
  );

-- This incident gets one durable scope. Terminal runs can be resumed where safe, but neither a
-- second browser nor a separate checkout can manufacture a replacement run to replay work.
create unique index corpus_sweep_runs_one_series_recovery_idx
  on public.corpus_sweep_runs ((true)) where purpose = 'series_recovery';

-- A normal sweep must never reconnect to an active incident recovery after the shared one-active
-- index wins a race.
create or replace function public.start_corpus_sweep()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  claims jsonb;
  issuer text;
  run_id uuid;
  active_purpose text;
begin
  if caller is null then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = caller for key share;
  perform 1 from public.corpus_admins where user_id = caller for update;
  if not found then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;

  begin
    claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  exception when others then
    claims := '{}'::jsonb;
  end;
  issuer := claims ->> 'iss';
  if issuer is null or issuer !~* '^https?://[^/?#]+/auth/v1/?$' then
    raise exception 'verified authentication issuer required' using errcode = '42501';
  end if;

  update public.corpus_sweep_runs
     set status = 'cancelled', phase = 'complete', heartbeat_at = now(),
         completed_at = coalesce(completed_at, now()), updated_at = now()
   where status in ('queued', 'running') and cancel_requested_at is not null;
  update public.corpus_sweep_runs
     set status = 'failed', phase = 'complete',
         error_message = coalesce(error_message, 'workflow heartbeat expired before completion'),
         heartbeat_at = now(), completed_at = coalesce(completed_at, now()), updated_at = now()
   where status in ('queued', 'running') and cancel_requested_at is null
     and coalesce(heartbeat_at, launch_claimed_at, created_at) < now() - interval '30 minutes';

  begin
    insert into public.corpus_sweep_runs (requested_by, requested_issuer, purpose)
    values (caller, issuer, 'corpus_sweep') returning id into run_id;
  exception when unique_violation then
    select id, purpose into run_id, active_purpose
    from public.corpus_sweep_runs where status in ('queued', 'running')
    order by created_at desc limit 1;
    if active_purpose is distinct from 'corpus_sweep' then
      raise exception 'series recovery is active' using errcode = '55000';
    end if;
  end;
  return run_id;
end;
$$;

-- The browser supplies the private, reviewed 23-row exclusion list once. Postgres independently
-- rebuilds the complete live incident inventory, validates every exclusion fingerprint, and
-- freezes only the remaining works. No title, author, or exclusion reason is persisted here.
create function public.start_series_recovery(p_exclusions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  claims jsonb;
  issuer text;
  run_id uuid;
  active_purpose text;
  entry jsonb;
  exclusion_id uuid;
  exclusion_ids uuid[] := '{}'::uuid[];
  live_fingerprint text;
  inventory_count integer;
  selected_count integer;
  inserted_count integer;
begin
  if caller is null then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = caller for key share;
  perform 1 from public.corpus_admins where user_id = caller for update;
  if not found then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  begin
    claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  exception when others then claims := '{}'::jsonb;
  end;
  issuer := claims ->> 'iss';
  if issuer is null or issuer !~* '^https?://[^/?#]+/auth/v1/?$' then
    raise exception 'verified authentication issuer required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_exclusions) <> 'array' or jsonb_array_length(p_exclusions) <> 23 then
    raise exception 'the reviewed 23-work exclusion manifest is required' using errcode = '22023';
  end if;

  -- Match the existing stale-run recovery boundary before allocating a new single-use run.
  update public.corpus_sweep_runs
     set status = 'cancelled', phase = 'complete', heartbeat_at = now(),
         completed_at = coalesce(completed_at, now()), updated_at = now()
   where status in ('queued', 'running') and cancel_requested_at is not null;
  update public.corpus_sweep_runs
     set status = 'failed', phase = 'complete',
         error_message = coalesce(error_message, 'workflow heartbeat expired before completion'),
         heartbeat_at = now(), completed_at = coalesce(completed_at, now()), updated_at = now()
   where status in ('queued', 'running') and cancel_requested_at is null
     and coalesce(heartbeat_at, launch_claimed_at, created_at) < now() - interval '30 minutes';

  select id, purpose into run_id, active_purpose
  from public.corpus_sweep_runs where status in ('queued', 'running')
  order by created_at desc limit 1;
  if run_id is not null then
    if active_purpose <> 'series_recovery' then
      raise exception 'corpus sweep is active' using errcode = '55000';
    end if;
    return (select jsonb_build_object(
      'runId', id, 'reused', true, 'eligible', eligible_count,
      'excluded', excluded_count, 'total', total_count
    ) from public.corpus_sweep_runs where id = run_id);
  end if;
  select id into run_id
  from public.corpus_sweep_runs where purpose = 'series_recovery'
  order by created_at desc limit 1;
  if run_id is not null then
    raise exception 'series recovery already exists; resume the durable run if permitted'
      using errcode = '55000';
  end if;

  for entry in select value from jsonb_array_elements(p_exclusions) loop
    if jsonb_typeof(entry) <> 'object'
      or coalesce(entry ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(entry ->> 'fingerprint', '') !~ '^[a-f0-9]{32}$'
      or nullif(trim(entry ->> 'reason'), '') is null
      or length(entry ->> 'reason') > 240 then
      raise exception 'invalid exclusion entry' using errcode = '22023';
    end if;
    exclusion_id := (entry ->> 'id')::uuid;
    if exclusion_id = any(exclusion_ids) then
      raise exception 'duplicate exclusion entry' using errcode = '22023';
    end if;
    select md5(to_jsonb(w)::text) into live_fingerprint
    from public.works w
    where w.id = exclusion_id
      and w.series_check_state = 'no_series'
      and w.series_checked_at < timestamptz '2026-09-10T00:00:00Z'
      and w.series_check_reason = 'The relational series source was unavailable; the search label was not accepted by itself.'
      and w.series_check_evidence @> '[{"source":"hardcover","kind":"provider_unavailable"}]'::jsonb
      and not exists (select 1 from public.corpus_series_entries e where e.work_id = w.id and e.removed_at is null)
      and not exists (select 1 from public.work_series_suggestions s where s.work_id = w.id and s.status = 'pending');
    if live_fingerprint is distinct from entry ->> 'fingerprint' then
      raise exception 'excluded work changed or left the incident inventory' using errcode = '55000';
    end if;
    exclusion_ids := array_append(exclusion_ids, exclusion_id);
  end loop;

  select count(*) into inventory_count from public.works w
  where w.series_check_state = 'no_series'
    and w.series_checked_at < timestamptz '2026-09-10T00:00:00Z'
    and w.series_check_reason = 'The relational series source was unavailable; the search label was not accepted by itself.'
    and w.series_check_evidence @> '[{"source":"hardcover","kind":"provider_unavailable"}]'::jsonb
    and not exists (select 1 from public.corpus_series_entries e where e.work_id = w.id and e.removed_at is null)
    and not exists (select 1 from public.work_series_suggestions s where s.work_id = w.id and s.status = 'pending');
  if inventory_count > 1000 then
    raise exception 'series recovery inventory exceeds 1000 works' using errcode = '54000';
  end if;
  selected_count := inventory_count - cardinality(exclusion_ids);
  if selected_count <= 0 then
    raise exception 'series recovery scope is empty' using errcode = '22023';
  end if;

  begin
    insert into public.corpus_sweep_runs (
      requested_by, requested_issuer, purpose, total_count, eligible_count, excluded_count,
      exclusion_manifest_hash
    ) values (
      caller, issuer, 'series_recovery', selected_count, inventory_count,
      cardinality(exclusion_ids), md5(p_exclusions::text)
    ) returning id into run_id;
  exception when unique_violation then
    raise exception 'series recovery already exists; reconnect to the durable run'
      using errcode = '55000';
  end;

  insert into public.corpus_sweep_run_items (
    run_id, work_id, ordinal, source_fingerprint
  )
  select run_id, w.id, row_number() over (order by w.id)::integer, md5(to_jsonb(w)::text)
  from public.works w
  where w.series_check_state = 'no_series'
    and w.series_checked_at < timestamptz '2026-09-10T00:00:00Z'
    and w.series_check_reason = 'The relational series source was unavailable; the search label was not accepted by itself.'
    and w.series_check_evidence @> '[{"source":"hardcover","kind":"provider_unavailable"}]'::jsonb
    and not (w.id = any(exclusion_ids))
    and not exists (select 1 from public.corpus_series_entries e where e.work_id = w.id and e.removed_at is null)
    and not exists (select 1 from public.work_series_suggestions s where s.work_id = w.id and s.status = 'pending')
  order by w.id;
  get diagnostics inserted_count = row_count;
  if inserted_count <> selected_count then
    raise exception 'series recovery inventory changed while freezing scope' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'runId', run_id, 'reused', false, 'eligible', inventory_count,
    'excluded', cardinality(exclusion_ids), 'total', selected_count
  );
end;
$$;

create function public.service_claim_series_recovery_batch(p_run uuid, p_limit integer default 25)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.corpus_sweep_runs%rowtype;
  work_ids uuid[];
  actor uuid;
  before_row public.works%rowtype;
begin
  if p_limit < 1 or p_limit > 25 then
    raise exception 'series recovery batch must contain 1-25 works' using errcode = '22023';
  end if;
  select * into run from public.corpus_sweep_runs where id = p_run for update;
  if not found or run.purpose <> 'series_recovery' or run.status not in ('queued', 'running') then
    return '{}'::uuid[];
  end if;
  if run.cancel_requested_at is not null then
    update public.corpus_sweep_runs set status = 'cancelled', phase = 'complete',
      completed_at = now(), heartbeat_at = now(), updated_at = now() where id = p_run;
    return '{}'::uuid[];
  end if;
  update public.corpus_sweep_runs set status = 'running', phase = 'classifying',
    started_at = coalesce(started_at, now()), heartbeat_at = now(), updated_at = now()
    where id = p_run;

  select coalesce(array_agg(item.work_id order by item.ordinal), '{}'::uuid[]) into work_ids
  from public.corpus_sweep_run_items item
  where item.run_id = p_run and item.status = 'running';
  if cardinality(work_ids) > 0 then return work_ids; end if;

  select coalesce(array_agg(chosen.work_id order by chosen.ordinal), '{}'::uuid[]) into work_ids
  from (
    select item.work_id, item.ordinal
    from public.corpus_sweep_run_items item
    where item.run_id = p_run and item.status = 'pending'
    order by item.ordinal limit p_limit for update skip locked
  ) chosen;
  if cardinality(work_ids) = 0 then return work_ids; end if;

  perform 1 from public.books b where b.corpus_work_id = any(work_ids) and b.removed_at is null
    order by b.id for update;
  perform 1 from public.works w where w.id = any(work_ids) order by w.id for update;
  if (select count(*) from public.works w
      join public.corpus_sweep_run_items item on item.run_id = p_run and item.work_id = w.id
      where w.id = any(work_ids)
        and md5(to_jsonb(w)::text) = item.source_fingerprint
        and w.series_check_state = 'no_series'
        and w.series_checked_at < timestamptz '2026-09-10T00:00:00Z'
        and w.series_check_reason = 'The relational series source was unavailable; the search label was not accepted by itself.'
        and w.series_check_evidence @> '[{"source":"hardcover","kind":"provider_unavailable"}]'::jsonb
        and not exists (select 1 from public.corpus_series_entries e where e.work_id = w.id and e.removed_at is null)
        and not exists (select 1 from public.work_series_suggestions s where s.work_id = w.id and s.status = 'pending'))
      <> cardinality(work_ids) then
    raise exception 'series recovery target changed before reset' using errcode = '55000';
  end if;

  actor := run.requested_by;
  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor::text, 'role', 'authenticated', 'iss', run.requested_issuer
  )::text, true);
  perform set_config('reverie.series_classifier', 'on', true);
  for before_row in select w.* from public.works w where w.id = any(work_ids) order by w.id loop
    update public.works set series_check_state = 'unresolved', series_checked_at = null
      where id = before_row.id;
    insert into public.work_metadata_edits (work_id, editor_id, previous_value, next_value)
      select w.id, actor, to_jsonb(before_row), to_jsonb(w)
      from public.works w where w.id = before_row.id;
  end loop;
  perform set_config('reverie.series_classifier', '', true);

  update public.corpus_sweep_run_items item
     set status = 'running', stage = 'reset', attempt_count = attempt_count + 1,
         reset_fingerprint = md5(to_jsonb(w)::text), started_at = coalesce(item.started_at, now()),
         updated_at = now()
    from public.works w
   where item.run_id = p_run and item.work_id = w.id and item.work_id = any(work_ids)
     and item.status = 'pending';
  update public.corpus_sweep_runs set recovery_batch_count = recovery_batch_count + 1,
    heartbeat_at = now(), updated_at = now() where id = p_run;
  return work_ids;
end;
$$;

create function public.service_prepare_series_recovery_item(p_run uuid, p_work uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  perform 1 from public.corpus_sweep_runs where id = p_run and purpose = 'series_recovery'
    and status = 'running' and cancel_requested_at is null for update;
  if not found then raise exception 'running series recovery not found' using errcode = 'P0002'; end if;
  select jsonb_build_object(
    'id', w.id, 'title', w.title, 'author_text', w.author_text, 'series', w.series,
    'position', w.position, 'work_id', w.work_id,
    'enrichment_confidence', w.enrichment_confidence, 'fingerprint', md5(to_jsonb(w)::text)
  ) into result
  from public.corpus_sweep_run_items item join public.works w on w.id = item.work_id
  where item.run_id = p_run and item.work_id = p_work and item.status = 'running'
    and item.stage = 'reset' and md5(to_jsonb(w)::text) = item.reset_fingerprint
  for update of item, w;
  if result is null then
    raise exception 'series recovery item is changed or already attempted' using errcode = '55000';
  end if;
  update public.corpus_sweep_run_items set stage = 'lookup_started', updated_at = now()
    where run_id = p_run and work_id = p_work;
  update public.corpus_sweep_runs set heartbeat_at = now(), updated_at = now() where id = p_run;
  return result;
end;
$$;

create function public.service_mark_series_recovery_save(p_run uuid, p_work uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.corpus_sweep_runs where id = p_run and purpose = 'series_recovery'
    and status = 'running' and cancel_requested_at is null for update;
  if not found then return false; end if;
  update public.corpus_sweep_run_items item set stage = 'save_started', updated_at = now()
    from public.works w
    where item.run_id = p_run and item.work_id = p_work and item.work_id = w.id
      and item.status = 'running' and item.stage = 'lookup_started'
      and md5(to_jsonb(w)::text) = item.reset_fingerprint
      and not exists (select 1 from public.corpus_series_entries e where e.work_id = w.id and e.removed_at is null)
      and not exists (select 1 from public.work_series_suggestions s where s.work_id = w.id and s.status = 'pending');
  if not found then
    raise exception 'series recovery target changed before save' using errcode = '55000';
  end if;
  return true;
end;
$$;

create function public.service_complete_series_recovery_item(
  p_run uuid, p_work uuid, p_result jsonb, p_checked_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.corpus_sweep_runs%rowtype;
  response jsonb;
  before_work_protected text;
  before_other_provenance text;
  before_reads text;
  before_books_protected text;
  before_reader_rows text;
  before_reader_memberships text;
  before_shared_memberships text;
  result_outcome text;
begin
  select * into run from public.corpus_sweep_runs where id = p_run for update;
  if not found or run.purpose <> 'series_recovery' or run.status <> 'running' then
    raise exception 'running series recovery not found' using errcode = 'P0002';
  end if;
  perform 1 from public.corpus_sweep_run_items item join public.works w on w.id = item.work_id
    where item.run_id = p_run and item.work_id = p_work and item.status = 'running'
      and item.stage = 'save_started' and md5(to_jsonb(w)::text) = item.reset_fingerprint
    for update of item, w;
  if not found then raise exception 'series recovery save checkpoint changed' using errcode = '55000'; end if;

  select
    md5((to_jsonb(w)-array['updated_at','series_check_state','series_checked_at','series_check_source','series_check_evidence','series_check_reason','series','position','metadata_provenance'])::text),
    md5((coalesce(w.metadata_provenance,'{}'::jsonb)-'series')::text)
    into before_work_protected, before_other_provenance
  from public.works w where w.id = p_work;
  select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb)::text)
    into before_reads from public.reads r join public.books b on b.id = r.book_id
    where b.corpus_work_id = p_work;
  select md5(coalesce(jsonb_agg(
      to_jsonb(b)-array['series','position','series_count','status','series_user_chosen','series_claim','updated_at'] order by b.id
    ),'[]'::jsonb)::text),
    md5(coalesce(jsonb_agg(to_jsonb(b) order by b.id) filter (
      where b.series_user_chosen or coalesce(b.series_claim ->> 'origin','unknown') in ('reader','import')
    ),'[]'::jsonb)::text)
    into before_books_protected, before_reader_rows
  from public.books b where b.corpus_work_id = p_work;
  select md5(coalesce(jsonb_agg(to_jsonb(entry) order by entry.id), '[]'::jsonb)::text)
    into before_reader_memberships
  from public.series_entries entry
  join public.books book on book.id = entry.book_id
  where book.corpus_work_id = p_work
    and (book.series_user_chosen
      or coalesce(book.series_claim ->> 'origin', 'unknown') in ('reader', 'import'));
  select md5(coalesce(jsonb_agg(to_jsonb(entry) order by entry.id), '[]'::jsonb)::text)
    into before_shared_memberships
  from public.corpus_series_entries entry where entry.work_id = p_work;

  perform set_config('request.jwt.claim.sub', run.requested_by::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', run.requested_by::text, 'role', 'authenticated', 'iss', run.requested_issuer
  )::text, true);
  response := public.record_corpus_series_discovery(p_work, p_result, p_checked_at);
  result_outcome := response ->> 'outcome';
  if result_outcome not in ('applied', 'confirmed', 'review') then
    raise exception 'series recovery produced an unexpected save outcome' using errcode = '55000';
  end if;

  if before_work_protected is distinct from (select md5((to_jsonb(w)-array['updated_at','series_check_state','series_checked_at','series_check_source','series_check_evidence','series_check_reason','series','position','metadata_provenance'])::text) from public.works w where w.id = p_work)
    or before_other_provenance is distinct from (select md5((coalesce(w.metadata_provenance,'{}'::jsonb)-'series')::text) from public.works w where w.id = p_work)
    or before_reads is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb)::text) from public.reads r join public.books b on b.id = r.book_id where b.corpus_work_id = p_work)
    or before_books_protected is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(b)-array['series','position','series_count','status','series_user_chosen','series_claim','updated_at'] order by b.id),'[]'::jsonb)::text) from public.books b where b.corpus_work_id = p_work)
    or before_reader_rows is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(b) order by b.id) filter (where b.series_user_chosen or coalesce(b.series_claim ->> 'origin','unknown') in ('reader','import')),'[]'::jsonb)::text) from public.books b where b.corpus_work_id = p_work) then
    raise exception 'series recovery protected data verification failed' using errcode = '55000';
  end if;
  if before_reader_memberships is distinct from (
    select md5(coalesce(jsonb_agg(to_jsonb(entry) order by entry.id), '[]'::jsonb)::text)
    from public.series_entries entry
    join public.books book on book.id = entry.book_id
    where book.corpus_work_id = p_work
      and (book.series_user_chosen
        or coalesce(book.series_claim ->> 'origin', 'unknown') in ('reader', 'import'))
  ) then
    raise exception 'series recovery reader membership verification failed' using errcode = '55000';
  end if;
  if result_outcome = 'review' and before_shared_memberships is distinct from (
    select md5(coalesce(jsonb_agg(to_jsonb(entry) order by entry.id), '[]'::jsonb)::text)
    from public.corpus_series_entries entry where entry.work_id = p_work
  ) then
    raise exception 'series recovery review published shared membership' using errcode = '55000';
  end if;

  update public.corpus_sweep_run_items set status = 'completed', stage = 'complete',
    outcome = jsonb_build_object('series', response), error_message = null,
    completed_at = now(), updated_at = now()
    where run_id = p_run and work_id = p_work;
  update public.corpus_sweep_runs set scanned_count = scanned_count + 1,
    filled_count = filled_count + 1,
    confirmed_count = confirmed_count + case when result_outcome in ('applied','confirmed') then 1 else 0 end,
    review_count = review_count + case when result_outcome = 'review' then 1 else 0 end,
    heartbeat_at = now(), updated_at = now() where id = p_run;
  return response;
end;
$$;

create function public.service_defer_series_recovery_item(
  p_run uuid, p_work uuid, p_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.corpus_sweep_runs where id = p_run and purpose = 'series_recovery'
    and status = 'running' for update;
  if not found then return false; end if;
  if exists (select 1 from public.corpus_sweep_run_items where run_id = p_run
    and work_id = p_work and status = 'running' and stage = 'save_started') then
    update public.corpus_sweep_runs set uncertain_count = uncertain_count + 1,
      error_message = 'uncertain series recovery save requires review', heartbeat_at = now(),
      updated_at = now() where id = p_run;
    raise exception 'uncertain series recovery save requires review' using errcode = '55000';
  end if;
  update public.corpus_sweep_run_items set status = 'deferred', stage = 'complete',
    outcome = jsonb_build_object('deferred', true, 'code', left(coalesce(nullif(trim(p_code),''),'unresolved'),120)),
    error_message = left(coalesce(nullif(trim(p_code),''),'unresolved'),1000),
    completed_at = now(), updated_at = now()
    where run_id = p_run and work_id = p_work and status = 'running'
      and stage in ('reset','lookup_started');
  if not found then return false; end if;
  update public.corpus_sweep_runs set failed_count = failed_count + 1,
    deferred_count = deferred_count + 1, heartbeat_at = now(), updated_at = now()
    where id = p_run;
  return true;
end;
$$;

create function public.resume_series_recovery(p_run uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid := (select auth.uid()); skipped integer;
begin
  if caller is null or not public.is_corpus_admin() then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  perform 1 from public.corpus_sweep_runs where id = p_run and purpose = 'series_recovery'
    and requested_by = caller and status in ('failed', 'cancelled') for update;
  if not found then raise exception 'resumable series recovery not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.corpus_sweep_run_items where run_id = p_run
    and status = 'running' and stage = 'save_started') then
    raise exception 'uncertain series recovery save requires review' using errcode = '55000';
  end if;
  update public.corpus_sweep_run_items set status = 'deferred', stage = 'complete',
    outcome = jsonb_build_object('deferred', true, 'code', 'interrupted_attempt_not_retried'),
    error_message = 'interrupted_attempt_not_retried', completed_at = now(), updated_at = now()
    where run_id = p_run and status = 'running' and stage = 'lookup_started';
  get diagnostics skipped = row_count;
  update public.corpus_sweep_runs set status = 'queued', phase = 'queued', workflow_run_id = null,
    launch_claimed_at = null, failed_count = failed_count + skipped,
    deferred_count = deferred_count + skipped, error_message = null,
    completed_at = null, heartbeat_at = now(), updated_at = now() where id = p_run;
  return p_run;
end;
$$;

revoke all on function public.start_series_recovery(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.start_series_recovery(jsonb) to authenticated;
revoke all on function public.resume_series_recovery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.resume_series_recovery(uuid) to authenticated;

revoke all on function public.service_claim_series_recovery_batch(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.service_prepare_series_recovery_item(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.service_mark_series_recovery_save(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.service_complete_series_recovery_item(uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.service_defer_series_recovery_item(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_claim_series_recovery_batch(uuid, integer) to service_role;
grant execute on function public.service_prepare_series_recovery_item(uuid, uuid) to service_role;
grant execute on function public.service_mark_series_recovery_save(uuid, uuid) to service_role;
grant execute on function public.service_complete_series_recovery_item(uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.service_defer_series_recovery_item(uuid, uuid, text) to service_role;

comment on column public.corpus_sweep_runs.purpose is
  'Separates the ordinary metadata/cover sweep from the one-time September 10 series recovery.';
comment on column public.corpus_sweep_runs.exclusion_manifest_hash is
  'Non-reversible audit hash of the owner-supplied private exclusion manifest; the manifest itself is not stored.';
