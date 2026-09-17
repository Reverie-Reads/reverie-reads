begin;
select no_plan();

select ok(not has_function_privilege('anon',
  'public.admin_stage_corpus_shadow_series_suggestions(text,text,jsonb)','EXECUTE'),
  'anonymous callers cannot stage corpus shadow suggestions');
select ok(has_function_privilege('authenticated',
  'public.admin_stage_corpus_shadow_series_suggestions(text,text,jsonb)','EXECUTE'),
  'authenticated callers still require administrator authorization in the body');
select ok(not has_function_privilege('authenticated',
  'public.review_corpus_series_suggestion(uuid,text)','EXECUTE'),
  'the unversioned review function is no longer an API bypass');
select ok(has_function_privilege('authenticated',
  'public.review_corpus_series_suggestion_revisioned(uuid,text)','EXECUTE'),
  'authenticated callers use the revision-checked review wrapper');

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('76111111-1111-4111-8111-111111111111','authenticated','authenticated','shadow-admin@example.com','{}','{}',now(),now()),
('76222222-2222-4222-8222-222222222222','authenticated','authenticated','shadow-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('76111111-1111-4111-8111-111111111111');

insert into public.works(id,work_key,title,author_text,contributors,series,position,series_check_state)
values(
  '76000000-0000-4000-8000-000000000001','shadow staging fixture','Shadow Staging Fixture',
  'Exact Writer','[{"name":"Exact Writer","role":"author"}]','Old Saga',1,'found'
);
insert into public.books(
  id,owner_id,corpus_work_id,title,authors_display,series,position,
  series_user_chosen,series_claim,ownership
) values(
  '76000000-0000-4000-8000-000000000011','76222222-2222-4222-8222-222222222222',
  '76000000-0000-4000-8000-000000000001','Shadow Staging Fixture','Exact Writer',
  'Reader Saga',7,true,'{"origin":"reader"}','unowned'
);

create temp table protected_before as
select to_jsonb(book) value from public.books book where id='76000000-0000-4000-8000-000000000011';
grant select on table protected_before to authenticated;

create function pg_temp.shadow_item() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workId', work.id,
    'identityFingerprint', md5(jsonb_build_object(
      'id',work.id,'title',work.title,'contributors',work.contributors,'pubY',work.pub_y
    )::text),
    'expectedBaseline', jsonb_build_object(
      'currentOrigin','graph',
      'currentMemberships',jsonb_build_array(jsonb_build_object(
        'series','Old Saga','position',1,'role','primary'
      )),
      'pendingSuggestionCount',0
    ),
    'expectedPendingSuggestions','[]'::jsonb,
    'proposal',jsonb_build_object(
      'series','New Saga','position',2,'role','primary','decisionSha256',repeat('d',64)
    )
  ) from public.works work where id='76000000-0000-4000-8000-000000000001'
$$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"76222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select throws_ok(
  $$select public.admin_stage_corpus_shadow_series_suggestions(repeat('a',64),repeat('b',64),jsonb_build_array(pg_temp.shadow_item()))$$,
  '42501','corpus administrator required','ordinary reader cannot stage suggestions'
);
select set_config('request.jwt.claims','{"sub":"76111111-1111-4111-8111-111111111111","role":"authenticated"}',true);

select lives_ok(
  $$select public.admin_stage_corpus_shadow_series_suggestions(repeat('a',64),repeat('b',64),jsonb_build_array(pg_temp.shadow_item()))$$,
  'administrator can stage one frozen proposal'
);
select is((select count(*) from public.work_series_suggestions
  where work_id='76000000-0000-4000-8000-000000000001' and status='pending'),1::bigint,
  'staging creates one pending suggestion');
select is((select series from public.works where id='76000000-0000-4000-8000-000000000001'),'Old Saga',
  'staging does not change the shared catalog');
reset role;
select is((select to_jsonb(book) from public.books book where id='76000000-0000-4000-8000-000000000011'),
  (select value from protected_before),'staging does not change the personal book');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"76111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok(
  $$select public.admin_stage_corpus_shadow_series_suggestions(repeat('a',64),repeat('b',64),jsonb_build_array(pg_temp.shadow_item()))$$,
  'replaying the same packet is idempotent'
);
select is((select count(*) from public.work_series_suggestions
  where work_id='76000000-0000-4000-8000-000000000001'),1::bigint,
  'idempotent staging does not duplicate suggestions');

reset role;
insert into public.corpus_metadata_reviews(work_id,fingerprint,revision,state,note,source_url)
select id,public.catalog_metadata_review_record(work)->>'fingerprint',1,'open','',''
from public.works work where id='76000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$select public.review_corpus_series_suggestion_revisioned(
    (select id from public.work_series_suggestions where work_id='76000000-0000-4000-8000-000000000001'),
    'accept'
  )$$,
  'P0001','This catalog series or review changed. Refresh before reviewing the suggestion.',
  'a later metadata revision blocks the staged decision'
);
reset role;
delete from public.corpus_metadata_reviews where work_id='76000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok(
  $$select public.review_corpus_series_suggestion_revisioned(
    (select id from public.work_series_suggestions where work_id='76000000-0000-4000-8000-000000000001'),
    'accept'
  )$$,
  'administrator can accept once the exact staged baseline is restored'
);
select is((select series from public.works where id='76000000-0000-4000-8000-000000000001'),'New Saga',
  'acceptance uses the established suggestion workflow');
reset role;
select is((select series from public.books where id='76000000-0000-4000-8000-000000000011'),'Reader Saga',
  'reader-chosen personal series remains protected');

-- Two staged works may share one source series. Accepting the first changes only the parent
-- revision for the second work; that sibling change must not invalidate the second proposal.
reset role;
insert into public.works(id,work_key,title,author_text,contributors,series,position,series_check_state)
values
('76000000-0000-4000-8000-000000000021','shadow batch fixture one','Shadow Batch Fixture One',
 'Batch Writer','[{"name":"Batch Writer","role":"author"}]','Old Batch Saga',1,'found'),
('76000000-0000-4000-8000-000000000022','shadow batch fixture two','Shadow Batch Fixture Two',
 'Batch Writer','[{"name":"Batch Writer","role":"author"}]','Old Batch Saga',2,'found');

create function pg_temp.shadow_batch_item(p_work uuid, p_position numeric, p_hash text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workId', work.id,
    'identityFingerprint', md5(jsonb_build_object(
      'id',work.id,'title',work.title,'contributors',work.contributors,'pubY',work.pub_y
    )::text),
    'expectedBaseline', jsonb_build_object(
      'currentOrigin','graph',
      'currentMemberships',jsonb_build_array(jsonb_build_object(
        'series','Old Batch Saga','position',work.position,'role','primary'
      )),
      'pendingSuggestionCount',0
    ),
    'expectedPendingSuggestions','[]'::jsonb,
    'proposal',jsonb_build_object(
      'series','New Batch Saga','position',p_position,'role','primary','decisionSha256',p_hash
    )
  ) from public.works work where id=p_work
$$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"76111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok(
  $$select public.admin_stage_corpus_shadow_series_suggestions(
    repeat('c',64),repeat('e',64),jsonb_build_array(
      pg_temp.shadow_batch_item('76000000-0000-4000-8000-000000000021',1,repeat('f',64)),
      pg_temp.shadow_batch_item('76000000-0000-4000-8000-000000000022',2,repeat('0',64))
    )
  )$$,
  'administrator can stage sibling proposals in one packet'
);
select is((select count(*) from public.work_series_suggestions
  where work_id in (
    '76000000-0000-4000-8000-000000000021',
    '76000000-0000-4000-8000-000000000022'
  ) and staging_series_fingerprint_version='work_anchor_v2'),2::bigint,
  'new positive suggestions use the work-anchor fingerprint');
select lives_ok(
  $$select public.review_corpus_series_suggestion_revisioned(
    (select id from public.work_series_suggestions
      where work_id='76000000-0000-4000-8000-000000000021' and status='pending'),
    'accept'
  )$$,
  'administrator accepts the first sibling proposal'
);
reset role;
select isnt(
  (select public.catalog_series_confirmation_fingerprint(work)
   from public.works work where id='76000000-0000-4000-8000-000000000022'),
  (select staging_expected_series_fingerprint from public.work_series_suggestions
   where work_id='76000000-0000-4000-8000-000000000022' and status='pending'),
  'the older parent-revision fingerprint changed after the sibling move'
);
select is(
  (select public.catalog_series_positive_suggestion_fingerprint(work)
   from public.works work where id='76000000-0000-4000-8000-000000000022'),
  (select staging_expected_series_fingerprint from public.work_series_suggestions
   where work_id='76000000-0000-4000-8000-000000000022' and status='pending'),
  'the work-local proposal anchor remains unchanged'
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"76111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok(
  $$select public.review_corpus_series_suggestion_revisioned(
    (select id from public.work_series_suggestions
      where work_id='76000000-0000-4000-8000-000000000022' and status='pending'),
    'accept'
  )$$,
  'administrator accepts the second sibling proposal after the first changed the parent revision'
);
reset role;
select is((select count(distinct entry.series_id)
  from public.corpus_series_entries entry
  where entry.work_id in (
    '76000000-0000-4000-8000-000000000021',
    '76000000-0000-4000-8000-000000000022'
  ) and entry.removed_at is null and entry.is_primary),1::bigint,
  'both reviewed works share one canonical destination series');

select * from finish();
rollback;
