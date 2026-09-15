begin;
select no_plan();

select ok(not has_function_privilege(role_name,
  'public.admin_confirm_corpus_series_membership(uuid,text,integer,text,numeric,integer,text,text,boolean)','EXECUTE'),
  role_name || ' cannot execute series confirmation')
from unnest(array['anon','service_role']) role_name;
select ok(has_function_privilege('authenticated',
  'public.admin_confirm_corpus_series_membership(uuid,text,integer,text,numeric,integer,text,text,boolean)','EXECUTE'),
  'authenticated callers still require body authorization');
select ok(not has_function_privilege('authenticated',
  'public.catalog_series_confirmation_fingerprint(public.works)','EXECUTE'),
  'series fingerprint helper remains internal');

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('75111111-1111-4111-8111-111111111111','authenticated','authenticated','series-admin@example.com','{}','{}',now(),now()),
('75222222-2222-4222-8222-222222222222','authenticated','authenticated','series-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('75111111-1111-4111-8111-111111111111');

insert into public.works(
  id,work_key,title,author_text,contributors,isbns,description,
  series,position,series_count,series_check_state,series_check_evidence
) values (
  '75000000-0000-4000-8000-000000000001','series confirmation fixture',
  'Series Confirmation Fixture','Exact Writer','[{"name":"Exact Writer","role":"author"}]',
  '{9780306406157}','Protected description','Verified Saga',2,3,'unresolved',
  '[{"source":"hardcover","kind":"candidate_label","series":"Verified Saga"}]'
);
insert into public.books(
  id,owner_id,corpus_work_id,title,authors_display,series,position,series_count,
  series_user_chosen,series_claim,ownership
) values
('75000000-0000-4000-8000-000000000011','75222222-2222-4222-8222-222222222222',
 '75000000-0000-4000-8000-000000000001','Series Confirmation Fixture','Exact Writer',
 'Old Automatic',7,8,false,'{"origin":"enrichment"}','unowned'),
('75000000-0000-4000-8000-000000000012','75222222-2222-4222-8222-222222222222',
 '75000000-0000-4000-8000-000000000001','Series Confirmation Fixture','Exact Writer',
 'Reader Choice',9,9,true,'{"origin":"reader"}','unowned'),
('75000000-0000-4000-8000-000000000013','75222222-2222-4222-8222-222222222222',
 '75000000-0000-4000-8000-000000000001','Series Confirmation Fixture','Exact Writer',
 'Import Choice',10,10,false,'{"origin":"import"}','unowned');

insert into public.corpus_metadata_reviews(
  work_id,fingerprint,revision,state,note,source_url,reviewed_by
)
select id,public.catalog_metadata_review_record(w)->>'fingerprint',2,'reviewed',
  'Existing metadata assessment','https://publisher.example/metadata',
  '75111111-1111-4111-8111-111111111111'
from public.works w where id='75000000-0000-4000-8000-000000000001';

create temp table protected_personal_before as
select id,to_jsonb(b) value from public.books b
where id in ('75000000-0000-4000-8000-000000000012','75000000-0000-4000-8000-000000000013');

create function pg_temp.series_attempt(
  submitted_series text default 'Verified Saga',
  submitted_position numeric default 2,
  submitted_count integer default 3,
  source text default 'https://author.example/books/fixture',
  note text default 'Private independently checked relationship.',
  confirmed boolean default true
) returns uuid language plpgsql as $$
declare item jsonb;
begin
  item := public.admin_list_corpus_metadata_reviews(
    'all','all','',0,1,'75000000-0000-4000-8000-000000000001'
  )->'items'->0;
  return public.admin_confirm_corpus_series_membership(
    '75000000-0000-4000-8000-000000000001',
    item->>'seriesFingerprint',(item->>'revision')::integer,
    submitted_series,submitted_position,submitted_count,source,note,confirmed
  );
end;
$$;

set local role anon;
select throws_ok(
  $$select public.admin_confirm_corpus_series_membership(null,null,null,null,null,null,null,null)$$,
  '42501',null,'anonymous caller is refused at the grant boundary'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"75222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select throws_ok(
  $$select public.admin_confirm_corpus_series_membership(null,null,null,null,null,null,null,null)$$,
  '42501','corpus administrator required','ordinary reader cannot confirm a shared series'
);
select set_config('request.jwt.claims','{"sub":"75111111-1111-4111-8111-111111111111","role":"authenticated"}',true);

select throws_ok($$select pg_temp.series_attempt('Different Saga')$$,'22023',null,
  'series name cannot change through confirmation');
select throws_ok($$select pg_temp.series_attempt('Verified Saga',3)$$,'22023',null,
  'position cannot change through confirmation');
select throws_ok($$select pg_temp.series_attempt('Verified Saga',2,4)$$,'22023',null,
  'count cannot change through confirmation');
select throws_ok($$select pg_temp.series_attempt('Verified Saga',2,3,'http://author.example')$$,'22023',null,
  'non-HTTPS evidence is refused');
select throws_ok($$select pg_temp.series_attempt('Verified Saga',2,3,'https://user:secret@author.example')$$,'22023',null,
  'credential-bearing evidence is refused');
select throws_ok($$select pg_temp.series_attempt('Verified Saga',2,3,'https://author.example','','true')$$,'22023',null,
  'explanation is required');
select throws_ok($$select pg_temp.series_attempt('Verified Saga',2,3,'https://author.example','Checked',false)$$,'22023',null,
  'identity confirmation is required');

reset role;
insert into public.work_series_suggestions(
  work_id,proposed_series,source,source_ref,confidence,checked_at
) values (
  '75000000-0000-4000-8000-000000000001','Competing Saga','publisher',
  'https://publisher.example/competing','high',now()
);
set local role authenticated;
select throws_ok($$select pg_temp.series_attempt()$$,'P0001',
  'Resolve the pending series suggestion before confirming this tuple.',
  'pending suggestion must use its own review workflow');
reset role;
update public.work_series_suggestions set status='dismissed',reviewed_at=now()
where work_id='75000000-0000-4000-8000-000000000001';
set local role authenticated;

select lives_ok($$select pg_temp.series_attempt()$$,
  'administrator can confirm the exact unchanged tuple once');
select ok(coalesce(current_setting('reverie.series_classifier',true),'')<>'on',
  'classifier transaction flag is restored');
select is(coalesce(current_setting('reverie.corpus_series_target',true),''),'',
  'graph target transaction flag is restored');
select is(coalesce(current_setting('reverie.series_review_preserve_catalog',true),''),'',
  'graph preservation transaction flag is restored');
reset role;

select ok((select series='Verified Saga' and position=2 and series_count=3
  and series_check_state='found' and series_check_source='manual'
  and metadata_provenance->'series'->>'sourceRef'='https://author.example/books/fixture'
  from public.works where id='75000000-0000-4000-8000-000000000001'),
  'work retains the exact tuple with durable manual source provenance');
select is((select count(*)::integer from public.corpus_series_entries entry
  join public.corpus_series series_row on series_row.id=entry.series_id
  where entry.work_id='75000000-0000-4000-8000-000000000001'
    and entry.removed_at is null and entry.is_primary
    and series_row.name='Verified Saga'
    and entry.position=2
    and entry.source_ref='https://author.example/books/fixture'),1,
  'normal graph trigger records one source-bound primary membership');
select ok((select series='Verified Saga' and position=2 and series_count=3
  and series_claim->>'origin'='corpus'
  and series_claim->>'sourceRef'='https://author.example/books/fixture'
  from public.books where id='75000000-0000-4000-8000-000000000011'),
  'eligible automatic personal default is reconciled');
select is((select count(*)::integer from public.series_entries
  where book_id='75000000-0000-4000-8000-000000000011'
    and removed_at is null and is_primary),1,
  'eligible personal default has one active structured membership');
select is((select to_jsonb(b) from public.books b where id='75000000-0000-4000-8000-000000000012'),
  (select value from protected_personal_before where id='75000000-0000-4000-8000-000000000012'),
  'reader-selected personal series remains byte-identical');
select is((select to_jsonb(b) from public.books b where id='75000000-0000-4000-8000-000000000013'),
  (select value from protected_personal_before where id='75000000-0000-4000-8000-000000000013'),
  'CSV-imported personal series remains byte-identical');
select ok((select state='reviewed' and note='Existing metadata assessment'
  and source_url='https://publisher.example/metadata' and revision=3
  from public.corpus_metadata_reviews
  where work_id='75000000-0000-4000-8000-000000000001'),
  'confirmation advances revision without overwriting the metadata assessment');
select is((select count(*)::integer from public.corpus_metadata_review_events
  where work_id='75000000-0000-4000-8000-000000000001'
    and action='series_confirmation'
    and next_value->'seriesConfirmation'->>'sourceUrl'='https://author.example/books/fixture'
    and next_value->'seriesConfirmation'->>'note'='Private independently checked relationship.'),1,
  'private history retains source and explanation');
select ok(not exists(select 1 from public.work_metadata_edits
  where next_value::text like '%Private independently checked relationship%'),
  'private explanation is not copied into the general metadata audit');

create temp table stale_series_confirmation as
select public.catalog_metadata_review_record(w)->>'seriesFingerprint' fingerprint,
  (select revision from public.corpus_metadata_reviews where work_id=w.id) revision
from public.works w where id='75000000-0000-4000-8000-000000000001';
grant select on stale_series_confirmation to authenticated;
update public.corpus_series_entries set position=2.5
where work_id='75000000-0000-4000-8000-000000000001' and removed_at is null and is_primary;
set local role authenticated;
select throws_ok($$select public.admin_confirm_corpus_series_membership(
  '75000000-0000-4000-8000-000000000001',
  (select fingerprint from stale_series_confirmation),(select revision from stale_series_confirmation),
  'Verified Saga',2,3,'https://author.example/books/fixture','Checked again',true
)$$,'P0001','This catalog series or review changed. Refresh before confirming.',
  'graph-only drift invalidates the opened confirmation');

select set_config('request.jwt.claims','{"sub":"75222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select is((select count(*)::integer from public.corpus_metadata_review_events),0,
  'private confirmation history remains hidden from readers');
reset role;

select * from finish();
rollback;
