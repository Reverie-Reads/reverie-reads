begin;
select no_plan();
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('da111111-1111-4111-8111-111111111111','authenticated','authenticated','bib-admin@example.com','{}','{}',now(),now()),
('da222222-2222-4222-8222-222222222222','authenticated','authenticated','bib-peer@example.com','{}','{}',now(),now()),
('da333333-3333-4333-8333-333333333333','authenticated','authenticated','bib-outside@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('da111111-1111-4111-8111-111111111111');
insert into public.households(id,name) values('da000000-0000-4000-8000-000000000001','Bibliography test');
insert into public.household_members(household_id,user_id,role) values
('da000000-0000-4000-8000-000000000001','da111111-1111-4111-8111-111111111111','owner'),
('da000000-0000-4000-8000-000000000001','da222222-2222-4222-8222-222222222222','member');
select set_config('request.jwt.claim.sub','da111111-1111-4111-8111-111111111111',true);
set local role authenticated;
insert into public.books(id,owner_id,title,author_first,author_last,ownership,genre,genres,series,position,series_count,status,series_claim,series_user_chosen,rating)
values('da000000-0000-4000-8000-000000000002','da111111-1111-4111-8111-111111111111','Shared Fixture','Ada','Writer','owned','fantasy','{fantasy}','Fixture Saga',2,4,'ongoing','{"origin":"reader"}',true,4);
reset role;
create function pg_temp.bib_work() returns uuid language sql security definer as $$ select corpus_work_id from public.books where id='da000000-0000-4000-8000-000000000002'; $$;
create function pg_temp.bib_push() returns uuid language sql security definer as $$
 select public.admin_push_corpus_record(pg_temp.bib_work(),public.corpus_record_fingerprint(pg_temp.bib_work()),
 '[{"action":"series","value":{"bookId":"da000000-0000-4000-8000-000000000002","name":"Fixture Saga","position":2,"count":4,"status":"ongoing"}}]', 'direct'); $$;
select is((select bibliography->>'series_name' from public.household_work_enrichment where work_id=pg_temp.bib_work()),'Fixture Saga','owned intake publishes household series');
set local role authenticated;
update public.books set genre='mystery',genres='{mystery}',pub_y=2026,pub_m=5,pub_d=2 where id='da000000-0000-4000-8000-000000000002';
select is((select row->>'primary_genre' from public.household_library_works_v2() row where row->>'work_id'=pg_temp.bib_work()::text),'mystery','personal genre edit appears in household');
select is((select row->>'pub_d' from public.household_library_works_v2() row where row->>'work_id'=pg_temp.bib_work()::text),'2','personal date appears in household');
update public.books set pub_m=null,pub_d=null where id='da000000-0000-4000-8000-000000000002';
select is((select row->'pub_d' from public.household_library_works_v2() row where row->>'work_id'=pg_temp.bib_work()::text),'null'::jsonb,'reduced date precision clears old day');
select lives_ok($$select pg_temp.bib_push()$$,'administrator publishes saved structured series without evidence checks');
reset role;
select is((select series from public.works where id=pg_temp.bib_work()),'Fixture Saga','shared corpus tuple saved');
select ok(exists(select 1 from public.corpus_series_entries e join public.corpus_series s on s.id=e.series_id where e.work_id=pg_temp.bib_work() and e.removed_at is null and s.name='Fixture Saga'),'push materializes active shared graph');
select is((select genre from public.works where id=pg_temp.bib_work()),'fantasy','household personal edits do not silently change corpus genre');
select ok(not exists(select 1 from public.household_work_enrichment where bibliography ?| array['rating','notes','copy_inventory','progress','intensity','darkness']),'private fields never enter household bibliography');
-- Re-review rejects a personal edit made after opening the push, without changing shared data.
set local role authenticated;
select public.set_book_series_membership('da000000-0000-4000-8000-000000000002',null,'Fixture Saga',3,4,true,'{"origin":"reader"}','{"origin":"reader"}');
select throws_ok($$select pg_temp.bib_push()$$,'PT409','The saved series changed or has no confirmed membership. Reload your book.','stale saved series cannot be published');
reset role;
select is((select position from public.works where id=pg_temp.bib_work()),2::numeric,'stale push preserves shared position');
select is((select bibliography->>'series_position' from public.household_work_enrichment where work_id=pg_temp.bib_work()),'3','saved series edit reaches household separately');
-- An existing household work also accepts explicit re-sharing of the saved bibliography.
set local role authenticated;
select lives_ok($$select public.add_personal_books_to_household(array['da000000-0000-4000-8000-000000000002'::uuid])$$,'explicit Add refreshes an existing household entry');
reset role;
select is((select bibliography->>'primary_genre' from public.household_work_enrichment where work_id=pg_temp.bib_work()),'mystery','re-sharing retains current personal genre');
select set_config('request.jwt.claim.sub','da222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select is((select count(*)::int from public.household_library_works_v2()),1,'peer sees the shared book');
select throws_ok($$select pg_temp.bib_push()$$,'42501','corpus administrator required','household membership cannot publish corpus');
select set_config('request.jwt.claim.sub','da333333-3333-4333-8333-333333333333',true);
select is((select count(*)::int from public.household_library_works_v2()),0,'outsider cannot read household bibliography');
reset role;
select ok(not has_function_privilege('authenticated','public.sync_personal_household_bibliography(uuid,jsonb)','execute'),'internal synchronizer cannot be called directly');
select ok(not has_function_privilege('anon','public.household_library_works_v2()','execute'),'anonymous household read denied');
select * from finish();
rollback;
