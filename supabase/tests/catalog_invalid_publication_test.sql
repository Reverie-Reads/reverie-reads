begin;
select no_plan();

-- Exercise the actual record builder, not just its date helper. Composite inputs admit the
-- disconnected/out-of-range legacy cases that current column constraints may reject on insert.
with cases(label,y,m,d,invalid) as (values
  ('unknown',null::int,null::int,null::int,false),
  ('year only',2025,null,null,false),('month only precision',2025,2,null,false),
  ('leap day',2024,2,29,false),('century leap',2000,2,29,false),
  ('non-leap day',2025,2,29,true),('century non-leap',1900,2,29,true),
  ('April 31',2025,4,31,true),('December 31',2025,12,31,false),
  ('missing year',null,2,20,true),('missing month',2025,null,20,true),
  ('day only',null,null,20,true),('year zero',0,1,1,true),
  ('year too large',10000,1,1,true),('negative year',-1,null,null,true),
  ('month zero',2025,0,null,true),('month too large',2025,13,null,true),
  ('day zero',2025,1,0,true),('day too large',2025,1,32,true),
  ('future year is not an error',2099,1,1,false)
)
select is(public.catalog_metadata_review_record(jsonb_populate_record(null::public.works,
  jsonb_build_object('id',gen_random_uuid(),'title','Date fixture '||label,'author_text','Date Fixture Writer',
    'contributors','[]'::jsonb,'isbns','[]'::jsonb,'pub_y',y,'pub_m',m,'pub_d',d))) -> 'issues' ? 'invalid_publication',
  invalid,label) from cases;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('74111111-1111-4111-8111-111111111111','authenticated','authenticated','date-admin@example.com','{}','{}',now(),now()),
('74222222-2222-4222-8222-222222222222','authenticated','authenticated','date-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('74111111-1111-4111-8111-111111111111');
-- Simulate one historical row written before the tuple guard. Keep the bypass scoped to this
-- trigger and restore it immediately so the rest of the test exercises current write behavior.
alter table public.works disable trigger works_validate_publication_tuple;
insert into public.works(id,work_key,title,author_text,description,pub_y,pub_m,pub_d) values
('74000000-0000-4000-8000-000000000001','date-detection-invalid','Date detection invalid','Date Writer','Description',2025,2,29);
alter table public.works enable trigger works_validate_publication_tuple;
insert into public.works(id,work_key,title,author_text,description,pub_y,pub_m,pub_d) values
('74000000-0000-4000-8000-000000000002','date-detection-valid','Date detection valid','Date Writer','Description',2024,2,29),
('74000000-0000-4000-8000-000000000003','date-detection-unknown','Date detection unknown','Date Writer','Description',null,null,null);
-- Emulate reviews made before this migration. Only the invalid date should reopen.
insert into public.corpus_metadata_reviews(work_id,fingerprint,revision,state)
select id,md5(jsonb_build_array(title,author_text,contributors,isbns,description,
  metadata_provenance->'description',pub_y,publisher,language,'[]'::jsonb)::text),1,'reviewed'
from public.works where id in ('74000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000003');
create temporary table date_baseline as select id,to_jsonb(w) as value from public.works w where title like 'Date detection %';
create temporary table date_snapshot as select public.catalog_metadata_review_record(w)->>'fingerprint' as fingerprint
from public.works w where id='74000000-0000-4000-8000-000000000001';
grant select on date_snapshot to authenticated;
set local role anon;
select throws_ok($$select public.admin_list_corpus_metadata_reviews('attention','invalid_publication')$$,'42501',null,'anonymous date queue denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"74222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select throws_ok($$select public.admin_list_corpus_metadata_reviews('attention','invalid_publication')$$,'42501',null,'ordinary reader date queue denied');
select set_config('request.jwt.claims','{"sub":"74111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select is((public.admin_list_corpus_metadata_reviews('attention','invalid_publication','Date detection')->>'total')::int,1,'invalid-only work appears despite old assessment and no other concern');
select is((public.admin_list_corpus_metadata_reviews('reviewed','all','Date detection')->>'total')::int,2,'valid and unknown historical assessments stay closed');
select is(public.admin_list_corpus_metadata_reviews('attention','invalid_publication','Date detection')->'items'->0->'publication',
  '{"y":2025,"m":2,"d":29}'::jsonb,'raw invalid tuple is retained for review');
select is(jsonb_array_length(public.admin_list_corpus_metadata_reviews('all','invalid_publication','Date detection',1,1)->'items'),0,'date filter pagination respects offset');
reset role;
select is((select count(*)::int from public.corpus_metadata_review_events),0,'opening queue creates no review event');
select ok(not exists(select 1 from date_baseline b join public.works w using(id) where b.value<>to_jsonb(w)),'queue changes no shared metadata');
alter table public.works disable trigger works_validate_publication_tuple;
update public.works set pub_m=4,pub_d=31 where id='74000000-0000-4000-8000-000000000001';
alter table public.works enable trigger works_validate_publication_tuple;
select isnt((select public.catalog_metadata_review_record(w)->>'fingerprint' from public.works w where id='74000000-0000-4000-8000-000000000001'),
  (select fingerprint from date_snapshot),'changed invalid month/day changes assessment fingerprint');
set local role authenticated;
select throws_ok($$select public.admin_review_corpus_metadata('74000000-0000-4000-8000-000000000001',(select fingerprint from date_snapshot),1,'defer')$$,
  'P0001',null,'stale invalid-date assessment cannot be saved');
reset role;
update public.works set pub_d=30 where id='74000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.admin_list_corpus_metadata_reviews('all','invalid_publication','Date detection')->>'total')::int,0,'valid correction leaves invalid-date filter');
reset role;
select ok(not has_function_privilege('authenticated','public.catalog_metadata_review_record(public.works)','EXECUTE'),'internal record builder stays private');
select * from finish();
rollback;
