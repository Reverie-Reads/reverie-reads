begin;
select no_plan();

select ok(not has_function_privilege('anon',
  'public.admin_stage_corpus_shadow_series_removal_reviews(text,text,jsonb)','EXECUTE'),
  'anonymous callers cannot stage historical removal reviews');
select ok(has_function_privilege('authenticated',
  'public.admin_stage_corpus_shadow_series_removal_reviews(text,text,jsonb)','EXECUTE'),
  'authenticated callers still require administrator authorization in the body');
select ok(not has_function_privilege('anon',
  'public.admin_stage_corpus_shadow_projection_series_removal_reviews(text,text,jsonb)','EXECUTE'),
  'anonymous callers cannot stage projection-only removal reviews');
select ok(has_function_privilege('authenticated',
  'public.admin_stage_corpus_shadow_projection_series_removal_reviews(text,text,jsonb)','EXECUTE'),
  'authenticated projection staging still requires administrator authorization in the body');

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('77111111-1111-4111-8111-111111111111','authenticated','authenticated','removal-admin@example.com','{}','{}',now(),now()),
('77222222-2222-4222-8222-222222222222','authenticated','authenticated','removal-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('77111111-1111-4111-8111-111111111111');

insert into public.works(id,work_key,title,author_text,contributors,series,position,series_check_state)
values
(
  '77000000-0000-4000-8000-000000000001','shadow removal fixture','Shadow Removal Fixture',
  'Exact Writer','[{"name":"Exact Writer","role":"author"}]','False Singleton',1,'found'
),
(
  '77000000-0000-4000-8000-000000000002','projection removal fixture','Projection Removal Fixture',
  'Exact Writer','[{"name":"Exact Writer","role":"author"}]','Projection False Positive',0,'unknown'
),
(
  '77000000-0000-4000-8000-000000000003','keep membership fixture','Keep Membership Fixture',
  'Exact Writer','[{"name":"Exact Writer","role":"author"}]','Verified Series',1,'found'
);
insert into public.books(
  id,owner_id,corpus_work_id,title,authors_display,series,position,
  series_user_chosen,series_claim,ownership
) values
(
  '77000000-0000-4000-8000-000000000011','77222222-2222-4222-8222-222222222222',
  '77000000-0000-4000-8000-000000000001','Shadow Removal Fixture','Exact Writer',
  'Reader Saga',7,true,'{"origin":"reader"}','unowned'
),
(
  '77000000-0000-4000-8000-000000000012','77111111-1111-4111-8111-111111111111',
  '77000000-0000-4000-8000-000000000001','Shadow Removal Fixture','Exact Writer',
  'False Singleton',1,false,'{"origin":"corpus"}','unowned'
),
(
  '77000000-0000-4000-8000-000000000021','77222222-2222-4222-8222-222222222222',
  '77000000-0000-4000-8000-000000000002','Projection Removal Fixture','Exact Writer',
  'Reader Projection Saga',8,true,'{"origin":"reader"}','unowned'
),
(
  '77000000-0000-4000-8000-000000000022','77111111-1111-4111-8111-111111111111',
  '77000000-0000-4000-8000-000000000002','Projection Removal Fixture','Exact Writer',
  'Projection False Positive',0,false,'{"origin":"corpus"}','unowned'
);

create temp table removal_protected_before as
select to_jsonb(book) value from public.books book
where id='77000000-0000-4000-8000-000000000011';
grant select on table removal_protected_before to authenticated;

create temp table projection_removal_protected_before as
select to_jsonb(book) value from public.books book
where id='77000000-0000-4000-8000-000000000021';
grant select on table projection_removal_protected_before to authenticated;

create function pg_temp.removal_item() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workId', work.id,
    'identityFingerprint', md5(jsonb_build_object(
      'id',work.id,'title',work.title,'contributors',work.contributors,'pubY',work.pub_y
    )::text),
    'action','review_historical_authority',
    'expectedBaseline', jsonb_build_object(
      'currentOrigin','graph',
      'currentMemberships',jsonb_build_array(jsonb_build_object(
        'series','False Singleton','position',1,'role','primary'
      )),
      'pendingSuggestionCount',0
    ),
    'expectedPendingSuggestions','[]'::jsonb,
    'proposal',jsonb_build_object(
      'action','remove','series','False Singleton','position',1,'role','primary',
      'decisionSha256',repeat('d',64)
    )
  ) from public.works work where id='77000000-0000-4000-8000-000000000001'
$$;

create function pg_temp.projection_removal_item() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workId', work.id,
    'identityFingerprint', md5(jsonb_build_object(
      'id',work.id,'title',work.title,'contributors',work.contributors,'pubY',work.pub_y
    )::text),
    'action','review_historical_authority',
    'expectedBaseline', jsonb_build_object(
      'currentOrigin','projection',
      'currentMemberships',jsonb_build_array(jsonb_build_object(
        'series','Projection False Positive','position',0,'role','primary'
      )),
      'pendingSuggestionCount',0
    ),
    'expectedPendingSuggestions','[]'::jsonb,
    'proposal',jsonb_build_object(
      'action','remove','series','Projection False Positive','position',0,'role','primary',
      'decisionSha256',repeat('e',64)
    )
  ) from public.works work where id='77000000-0000-4000-8000-000000000002'
$$;

create function pg_temp.keep_membership_item() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workId', work.id,
    'identityFingerprint', md5(jsonb_build_object(
      'id',work.id,'title',work.title,'contributors',work.contributors,'pubY',work.pub_y
    )::text),
    'action','review_historical_authority',
    'expectedBaseline', jsonb_build_object(
      'currentOrigin','graph',
      'currentMemberships',jsonb_build_array(jsonb_build_object(
        'series','Verified Series','position',1,'role','primary'
      )),
      'pendingSuggestionCount',0
    ),
    'expectedPendingSuggestions','[]'::jsonb,
    'proposal',jsonb_build_object(
      'action','remove','series','Verified Series','position',1,'role','primary',
      'decisionSha256',repeat('9',64)
    )
  ) from public.works work where id='77000000-0000-4000-8000-000000000003'
$$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select throws_ok(
  $$select public.admin_stage_corpus_shadow_series_removal_reviews(repeat('a',64),repeat('b',64),jsonb_build_array(pg_temp.removal_item()))$$,
  '42501','corpus administrator required','ordinary readers cannot stage removal reviews'
);
select set_config('request.jwt.claims','{"sub":"77111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok(
  $$select public.admin_stage_corpus_shadow_series_removal_reviews(repeat('a',64),repeat('b',64),jsonb_build_array(pg_temp.removal_item()))$$,
  'administrator can stage one frozen historical removal review'
);
select is((select proposal_action from public.work_series_suggestions
  where work_id='77000000-0000-4000-8000-000000000001' and status='pending'),'remove',
  'the pending row is explicitly a removal review');
select is((select series from public.works where id='77000000-0000-4000-8000-000000000001'),
  'False Singleton','staging does not change shared series data');

select lives_ok(
  $$select public.admin_stage_corpus_shadow_series_removal_reviews(
    repeat('9',64),repeat('8',64),jsonb_build_array(pg_temp.keep_membership_item())
  )$$,
  'administrator can stage a separate keep-membership review'
);

reset role;
update public.corpus_series
set revision = revision + 1
where id=(select series_id from public.corpus_series_entries
  where work_id='77000000-0000-4000-8000-000000000003' and removed_at is null and is_primary);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok(
  $$select public.review_corpus_series_suggestion_revisioned(
    (select id from public.work_series_suggestions
      where work_id='77000000-0000-4000-8000-000000000003' and status='pending'),
    'dismiss'
  )$$,
  'keeping the exact membership survives an unrelated parent revision change'
);
select is((select status from public.work_series_suggestions
  where work_id='77000000-0000-4000-8000-000000000003'),'dismissed',
  'the stale removal proposal leaves the queue');
select is((select series from public.works where id='77000000-0000-4000-8000-000000000003'),
  'Verified Series','keeping the exact membership preserves the shared series');
select is((select count(*) from public.corpus_series_entries
  where work_id='77000000-0000-4000-8000-000000000003'
    and removed_at is null and is_primary),1::bigint,
  'keeping the exact membership preserves its active graph entry');

reset role;
update public.corpus_series
set revision = revision + 1
where id=(select series_id from public.corpus_series_entries
  where work_id='77000000-0000-4000-8000-000000000001' and removed_at is null and is_primary);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select throws_ok(
  $$select public.review_corpus_series_suggestion_revisioned(
    (select id from public.work_series_suggestions where work_id='77000000-0000-4000-8000-000000000001'),
    'accept'
  )$$,
  'P0001','This catalog series or review changed. Refresh before reviewing the suggestion.',
  'a changed series revision blocks removal'
);
reset role;
update public.corpus_series parent
set revision = suggestion.staging_expected_series_revision
from public.work_series_suggestions suggestion
where suggestion.work_id='77000000-0000-4000-8000-000000000001'
  and parent.id=(select series_id from public.corpus_series_entries
    where work_id=suggestion.work_id and removed_at is null and is_primary);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok(
  $$select public.review_corpus_series_suggestion_revisioned(
    (select id from public.work_series_suggestions where work_id='77000000-0000-4000-8000-000000000001'),
    'accept'
  )$$,
  'administrator can accept against the exact restored revision'
);
reset role;

select is((select series from public.works where id='77000000-0000-4000-8000-000000000001'),
  null::text,'acceptance clears the false shared series');
select is((select series_check_state from public.works where id='77000000-0000-4000-8000-000000000001'),
  'no_series','the explicit administrator removal records a reviewed no-series result');
select is((select count(*) from public.corpus_series_entries
  where work_id='77000000-0000-4000-8000-000000000001' and removed_at is null),0::bigint,
  'the canonical graph membership is tombstoned');
select is((select count(*) from public.corpus_series
  where name='False Singleton' and archived_at is not null),1::bigint,
  'an empty singleton series is archived');
select is((select to_jsonb(book) from public.books book
  where id='77000000-0000-4000-8000-000000000011'),
  (select value from removal_protected_before),
  'reader-chosen personal series remains byte-for-byte unchanged');
select is((select series from public.books where id='77000000-0000-4000-8000-000000000012'),
  null::text,'an eligible automatic corpus default is cleared with the false shared series');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok(
  $$select public.admin_stage_corpus_shadow_projection_series_removal_reviews(
    repeat('f',64),repeat('c',64),jsonb_build_array(pg_temp.projection_removal_item())
  )$$,
  'administrator can stage one frozen projection-only removal review'
);
select is((select staging_removal_origin from public.work_series_suggestions
  where work_id='77000000-0000-4000-8000-000000000002' and status='pending'),'projection',
  'the pending row records its projection-only removal origin');
select is((select staging_expected_series_entry from public.work_series_suggestions
  where work_id='77000000-0000-4000-8000-000000000002' and status='pending'),null::uuid,
  'projection staging does not manufacture a graph entry');
select is((select series from public.works where id='77000000-0000-4000-8000-000000000002'),
  'Projection False Positive','projection staging does not change shared series data');
select is((select proposed_position from public.work_series_suggestions
  where work_id='77000000-0000-4000-8000-000000000002' and status='pending'),0::numeric,
  'projection staging preserves a legacy zero position for the revision check');

reset role;
select throws_ok(
  $$insert into public.work_series_suggestions(
      work_id,proposed_series,proposed_position,source,confidence,checked_at,proposal_action
    ) values (
      '77000000-0000-4000-8000-000000000002','Invalid Set Proposal',0,
      'constraint-test','medium',now(),'set'
    )$$,
  '23514',null,'ordinary set suggestions still require a positive position'
);

select set_config('reverie.series_classifier','on',true);
update public.works set series='Changed Projection'
where id='77000000-0000-4000-8000-000000000002';
select set_config('reverie.series_classifier','',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select throws_ok(
  $$select public.review_corpus_series_suggestion_revisioned(
    (select id from public.work_series_suggestions
      where work_id='77000000-0000-4000-8000-000000000002' and status='pending'),
    'accept'
  )$$,
  'P0001','This catalog series or review changed. Refresh before reviewing the suggestion.',
  'a changed scalar projection blocks removal'
);

reset role;
select set_config('reverie.series_classifier','on',true);
update public.works set series='Projection False Positive'
where id='77000000-0000-4000-8000-000000000002';
select set_config('reverie.series_classifier','',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok(
  $$select public.review_corpus_series_suggestion_revisioned(
    (select id from public.work_series_suggestions
      where work_id='77000000-0000-4000-8000-000000000002' and status='pending'),
    'accept'
  )$$,
  'administrator can accept the restored projection-only removal review'
);
reset role;

select is((select series from public.works where id='77000000-0000-4000-8000-000000000002'),
  null::text,'acceptance clears the false compatibility projection');
select is((select series_check_state from public.works where id='77000000-0000-4000-8000-000000000002'),
  'no_series','projection acceptance records a reviewed no-series result');
select is((select count(*) from public.corpus_series_entries
  where work_id='77000000-0000-4000-8000-000000000002'),0::bigint,
  'projection staging and acceptance never create a graph membership');
select is((select to_jsonb(book) from public.books book
  where id='77000000-0000-4000-8000-000000000021'),
  (select value from projection_removal_protected_before),
  'projection acceptance preserves a reader-chosen personal series byte-for-byte');
select is((select series from public.books where id='77000000-0000-4000-8000-000000000022'),
  null::text,'projection acceptance clears an eligible automatic corpus default');

select * from finish();
rollback;
