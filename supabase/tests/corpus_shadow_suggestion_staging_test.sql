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

select * from finish();
rollback;
