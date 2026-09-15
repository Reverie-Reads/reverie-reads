begin;
select plan(28);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'b1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
    'recovery-admin@example.com', '{}', '{"display_name":"Recovery Admin"}', now(), now()
  ),
  (
    'b2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
    'recovery-reader@example.com', '{}', '{"display_name":"Recovery Reader"}', now(), now()
  );
insert into public.corpus_admins (user_id)
values ('b1111111-1111-4111-8111-111111111111');

insert into public.works (
  id, work_key, title, author_text, contributors, series, position, work_id,
  enrichment_confidence, series_check_state, series_checked_at,
  series_check_source, series_check_reason, series_check_evidence
)
select
  ('b0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'recovery-work-' || n,
  'Recovery Work ' || n,
  'Fixture Author',
  '[{"name":"Fixture Author","role":"author","position":0}]'::jsonb,
  'Fixture Series', n, 'hardcover:' || n, 'high', 'no_series',
  '2026-09-09T00:00:00Z', 'hardcover',
  'The relational series source was unavailable; the search label was not accepted by itself.',
  '[{"source":"hardcover","kind":"provider_unavailable"}]'::jsonb
from generate_series(1, 25) n;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated","iss":"http://127.0.0.1:55321/auth/v1"}',
  true
);
select throws_ok(
  $$select public.start_series_recovery('[]'::jsonb)$$,
  '42501', null, 'an ordinary reader cannot start incident recovery'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated","iss":"http://127.0.0.1:55321/auth/v1"}',
  true
);
select jsonb_agg(jsonb_build_object(
  'id', w.id, 'fingerprint', md5(to_jsonb(w)::text), 'reason', 'Private identity review'
) order by w.id) as exclusions
from public.works w
where w.id::text between 'b0000000-0000-4000-8000-000000000001'
  and 'b0000000-0000-4000-8000-000000000023' \gset

select (public.start_series_recovery(:'exclusions'::jsonb) ->> 'runId') as recovery_run \gset
select is(
  (select purpose from public.corpus_sweep_runs where id = :'recovery_run'),
  'series_recovery', 'the owner creates the incident-specific run'
);
select is(
  (select eligible_count from public.corpus_sweep_runs where id = :'recovery_run'),
  25, 'the complete incident inventory is counted'
);
select is(
  (select excluded_count from public.corpus_sweep_runs where id = :'recovery_run'),
  23, 'the reviewed private exclusions are counted'
);
select is(
  (select total_count from public.corpus_sweep_runs where id = :'recovery_run'),
  2, 'only non-excluded works enter the durable run'
);
select is(
  (public.start_series_recovery(:'exclusions'::jsonb) ->> 'runId')::uuid,
  :'recovery_run'::uuid, 'a repeated browser start reconnects to the active run'
);

reset role;
set local role service_role;
select is(
  cardinality(public.service_claim_series_recovery_batch(:'recovery_run', 25)),
  2, 'one durable reset batch claims the remaining works'
);
select is(
  (select count(*) from public.works where id::text like 'b0000000-0000-4000-8000-%'
    and series_check_state = 'unresolved' and series_checked_at is null),
  2::bigint, 'the claimed works alone have their outage clocks reset'
);
select is(
  (select count(*) from public.work_metadata_edits where editor_id = 'b1111111-1111-4111-8111-111111111111'),
  2::bigint, 'every reset is attributed in the existing metadata audit'
);
select is(
  (select count(*) from public.works where id::text between
    'b0000000-0000-4000-8000-000000000001' and 'b0000000-0000-4000-8000-000000000023'
    and series_check_state = 'no_series'),
  23::bigint, 'excluded works remain byte-for-byte outside the reset batch'
);
select ok(
  public.service_prepare_series_recovery_item(
    :'recovery_run', 'b0000000-0000-4000-8000-000000000024'
  ) ->> 'title' = 'Recovery Work 24',
  'a claimed item exposes only the frozen lookup identity to the service'
);
select is(
  public.service_defer_series_recovery_item(
    :'recovery_run', 'b0000000-0000-4000-8000-000000000024', 'ambiguous_relationship'
  ), true, 'a bounded relationship ambiguity defers without a save'
);
select ok(
  public.service_prepare_series_recovery_item(
    :'recovery_run', 'b0000000-0000-4000-8000-000000000025'
  ) ->> 'title' = 'Recovery Work 25',
  'the next claimed work receives an independent lookup checkpoint'
);
select is(
  public.service_mark_series_recovery_save(
    :'recovery_run', 'b0000000-0000-4000-8000-000000000025'
  ), true, 'an unchanged exact target advances to the write-ahead save checkpoint'
);
select is(
  public.service_complete_series_recovery_item(
    :'recovery_run', 'b0000000-0000-4000-8000-000000000025',
    jsonb_build_object(
      'outcome', 'found', 'matched', true, 'series', 'Fixture Series', 'position', 25,
      'count', null, 'identityConfidence', 'high', 'membershipConfidence', 'high',
      'source', 'hardcover', 'sourceRef', '42', 'reason', 'Exact relational fixture.',
      'evidence', jsonb_build_array(jsonb_build_object(
        'source', 'hardcover', 'kind', 'relational_membership', 'sourceRef', '42',
        'series', 'Fixture Series', 'position', 25, 'memberCount', null,
        'orderType', 'unspecified'
      ))
    ), '2026-09-14T20:00:00Z'
  ) ->> 'outcome',
  'confirmed', 'the existing discovery writer saves a confirmed relationship'
);
select is(public.service_finish_corpus_sweep(:'recovery_run', null), :'recovery_run'::uuid,
  'the shared durable finisher closes the incident run');
select is((select status from public.corpus_sweep_runs where id = :'recovery_run'),
  'completed', 'the run is complete when every frozen item is terminal');
select is((select confirmed_count from public.corpus_sweep_runs where id = :'recovery_run'),
  1, 'confirmed classifications have a dedicated aggregate');
select is((select deferred_count from public.corpus_sweep_runs where id = :'recovery_run'),
  1, 'deferred classifications have a dedicated aggregate');
select is((select scanned_count from public.corpus_sweep_runs where id = :'recovery_run'),
  1, 'only saved classifications count as checked');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated","iss":"http://127.0.0.1:55321/auth/v1"}',
  true
);
select throws_ok(
  format('select public.start_series_recovery(%L::jsonb)', :'exclusions'),
  '55000', null, 'a terminal incident run cannot be replaced to replay its scope'
);
reset role;
set local role service_role;

update public.corpus_sweep_run_items set status = 'running', stage = 'lookup_started',
  outcome = null, error_message = null, completed_at = null
where run_id = :'recovery_run' and work_id = 'b0000000-0000-4000-8000-000000000024';
update public.corpus_sweep_runs set status = 'failed', phase = 'complete', completed_at = now(),
  failed_count = 0, deferred_count = 0 where id = :'recovery_run';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated","iss":"http://127.0.0.1:55321/auth/v1"}',
  true
);
select is(public.resume_series_recovery(:'recovery_run'), :'recovery_run'::uuid,
  'the initiating owner can resume a failed durable run');
reset role;
set local role service_role;
select is((select status from public.corpus_sweep_run_items where run_id = :'recovery_run'
  and work_id = 'b0000000-0000-4000-8000-000000000024'), 'deferred',
  'resume defers an interrupted lookup instead of replaying it');
select ok((select status = 'queued' and failed_count = 1 and deferred_count = 1
  from public.corpus_sweep_runs where id = :'recovery_run'),
  'resume preserves progress and queues only untouched work');

update public.corpus_sweep_run_items set status = 'running', stage = 'save_started',
  completed_at = null where run_id = :'recovery_run'
  and work_id = 'b0000000-0000-4000-8000-000000000025';
update public.corpus_sweep_runs set status = 'failed', phase = 'complete', completed_at = now()
  where id = :'recovery_run';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated","iss":"http://127.0.0.1:55321/auth/v1"}',
  true
);
select throws_ok(
  format('select public.resume_series_recovery(%L::uuid)', :'recovery_run'),
  '55000', null, 'resume refuses to replay an uncertain save checkpoint'
);
reset role;
set local role service_role;

select ok(not has_function_privilege(
  'authenticated', 'public.service_claim_series_recovery_batch(uuid,integer)', 'EXECUTE'
), 'browser sessions cannot claim or reset a recovery batch');
select ok(has_function_privilege(
  'service_role', 'public.service_claim_series_recovery_batch(uuid,integer)', 'EXECUTE'
), 'only the workflow service can advance recovery batches');
select ok(not has_table_privilege(
  'authenticated', 'public.corpus_sweep_run_items', 'SELECT'
), 'the private per-work journal remains hidden from browser sessions');

select * from finish();
rollback;
