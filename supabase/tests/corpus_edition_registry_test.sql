begin;
select no_plan();
select ok(not has_table_privilege(role_name,table_name,privilege),role_name||' has no direct '||privilege||' on '||table_name)
from unnest(array['anon','authenticated','service_role']) role_name
cross join unnest(array['corpus_editions','corpus_isbn_exclusions','corpus_record_edits','corpus_isbn_reports']) table_name
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege;
-- Deliberately recreate legacy auto-exposure before exercising the migration's exact ACL reset.
grant all on public.corpus_editions,public.corpus_isbn_exclusions,public.corpus_record_edits,public.corpus_isbn_reports to public,anon,authenticated,service_role;
select ok(has_table_privilege('anon','public.corpus_editions','DELETE'),'legacy dirty ACL precondition');
revoke all on public.corpus_editions,public.corpus_isbn_exclusions,public.corpus_record_edits,public.corpus_isbn_reports from public,anon,authenticated,service_role;
select ok(not has_table_privilege(role_name,table_name,privilege),'dirty ACL repair denies '||role_name||' '||privilege||' on '||table_name)
from unnest(array['anon','authenticated','service_role']) role_name
cross join unnest(array['corpus_editions','corpus_isbn_exclusions','corpus_record_edits','corpus_isbn_reports']) table_name
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege;
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),role_name||' cannot execute '||signature)
from unnest(array['anon','service_role']) role_name cross join unnest(array[
 'public.get_corpus_record(uuid)', 'public.admin_save_corpus_record(uuid,text,text,jsonb,text,text,boolean)',
 'public.report_corpus_isbn(uuid,text,text,text)','public.select_corpus_edition(uuid,uuid,integer,jsonb)']) signature;
select ok(not has_function_privilege('authenticated',signature,'EXECUTE'),'reader cannot execute helper '||signature)
from unnest(array['public.corpus_record_fingerprint(uuid)','public.corpus_edition_details_valid(jsonb)','public.sync_corpus_edition_references()']) signature;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('b9111111-1111-4111-8111-111111111111','authenticated','authenticated','registry-admin@example.com','{}','{}',now(),now()),
('b9222222-2222-4222-8222-222222222222','authenticated','authenticated','registry-reader@example.com','{}','{}',now(),now()),
('b9333333-3333-4333-8333-333333333333','authenticated','authenticated','registry-outsider@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('b9111111-1111-4111-8111-111111111111');
insert into public.works(id,work_key,title,author_text,contributors,isbns,pages,pub_y,publisher,genre,description,metadata_provenance) values
('b9000000-0000-4000-8000-000000000001','edition registry fixture','Registry Fixture','Test Writer','[{"name":"Test Writer","role":"author"}]','{9780306406157,9780140449136}',321,2024,'Work Publisher','fiction','Description',
 '{"pageCount":{"source":"manual","referenceIsbn":"9780306406157","referenceValue":{"pages":321}},"pubY":{"source":"manual","referenceIsbn":"9780306406157","referenceValue":{"y":2024,"m":null,"d":null}}}'),
('b9000000-0000-4000-8000-000000000002','other registry fixture','Different Work','Other Writer','[{"name":"Other Writer","role":"author"}]','{9780143117841}',999,1980,'Other Publisher',null,'Other description','{}');
insert into public.books(id,owner_id,corpus_work_id,title,authors_display,isbn,pages,pub_y,intensity,darkness,ownership) values
('b9000000-0000-4000-8000-000000000003','b9222222-2222-4222-8222-222222222222','b9000000-0000-4000-8000-000000000001','Registry Fixture','Test Writer','9780306406157',111,1999,4,2,'unowned');
create temp table registry_personal_before as select to_jsonb(b) value from public.books b where id='b9000000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.corpus_editions where work_id='b9000000-0000-4000-8000-000000000001'),2,'each valid work ISBN gets its own saved edition');
select is((select details from public.corpus_editions where isbn='9780306406157'),'{"pages":321,"publication":{"y":2024,"m":null,"d":null}}'::jsonb,'qualified facts stay on their exact ISBN; publisher is not guessed');
select is((select details from public.corpus_editions where isbn='9780140449136'),'{}'::jsonb,'other edition never inherits work scalar facts');
select ok(not public.corpus_edition_details_valid('{"pages":0}'),'zero page count refused');
select ok(not public.corpus_edition_details_valid('{"publication":{"y":2025,"m":2,"d":29}}'),'invalid leap day refused');
select ok(not public.corpus_edition_details_valid('{"condition":"fine"}'),'private condition is not edition data');

create function pg_temp.registry_save(action text,value jsonb,confirmed boolean default true) returns uuid language sql security definer as $$
 select public.admin_save_corpus_record('b9000000-0000-4000-8000-000000000001',public.corpus_record_fingerprint('b9000000-0000-4000-8000-000000000001'),action,value,'https://publisher.example/registry','Checked the printed edition',confirmed);
$$;
create function pg_temp.registry_edition(isbn text default '9780306406157',pages integer default 456) returns jsonb language sql security definer as $$
 select jsonb_build_object('id',(select id from public.corpus_editions where isbn='9780306406157'),'isbn',isbn,
   'details',jsonb_build_object('publisher','Edition Publisher','format','paperback','language','en','statement','Second edition','pages',pages,'publication',jsonb_build_object('y',2026,'m',null,'d',null)));
$$;
select set_config('request.jwt.claim.sub','b9222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select throws_ok($$select pg_temp.registry_save('edition',pg_temp.registry_edition())$$,'42501','corpus administrator required','ordinary reader cannot change shared edition');
select lives_ok($$select public.report_corpus_isbn('b9000000-0000-4000-8000-000000000001','9780306406157','9780140449136','My copyright page describes a different edition.')$$,'reader report persists');
select lives_ok($$select public.report_corpus_isbn('b9000000-0000-4000-8000-000000000001','0-306-40615-2','9780140449136','Updated explanation.')$$,'equivalent ISBN-10 report updates the ISBN-13 concern rather than duplicating');
select is(jsonb_array_length(public.get_corpus_record('b9000000-0000-4000-8000-000000000001')->'reports'),1,'reader sees their report');
select set_config('request.jwt.claim.sub','b9333333-3333-4333-8333-333333333333',true);
select is(jsonb_array_length(public.get_corpus_record('b9000000-0000-4000-8000-000000000001')->'reports'),0,'another reader cannot see the private report');
select throws_ok($$select public.report_corpus_isbn('b9000000-0000-4000-8000-000000000001','9780306406157',null,'Not my book.')$$,'42501',null,'unrelated reader cannot submit a report for this work');
select set_config('request.jwt.claim.sub','b9111111-1111-4111-8111-111111111111',true);
select is(jsonb_array_length(public.get_corpus_record('b9000000-0000-4000-8000-000000000001')->'reports'),1,'administrator sees incoming report');
select is((public.admin_list_corpus_metadata_reviews('attention','reader_report','Registry Fixture',0,20,null)->>'total')::int,1,'report enters existing attention queue');
select throws_ok($$select pg_temp.registry_save('edition',pg_temp.registry_edition(),false)$$,'22023',null,'confirmation is required');
select throws_ok($$select pg_temp.registry_save('edition',pg_temp.registry_edition('9780143117841'))$$,'23505',null,'cannot steal ISBN from another work');
select throws_ok($$select pg_temp.registry_save('edition',pg_temp.registry_edition('9780306406158'))$$,'22023',null,'checksum-invalid correction refused');
select lives_ok($$select pg_temp.registry_save('edition',pg_temp.registry_edition())$$,'reviewed edition saves');
select lives_ok($$select pg_temp.registry_save('guidance','{"genres":["fantasy","fiction"],"subgenres":["Epic"],"spice":0,"darkness":3}')$$,'shared guidance saves without private assessments');
reset role;
select is((select shared_spice from public.works where id='b9000000-0000-4000-8000-000000000001'),0,'zero assessment is stored distinctly from unknown');
select is((select to_jsonb(b) from public.books b where id='b9000000-0000-4000-8000-000000000003'),(select value from registry_personal_before),'shared changes preserve every personal column');
select is((select count(*)::int from public.corpus_record_edits where work_id='b9000000-0000-4000-8000-000000000001'),2,'edition and guidance each retain audit history');
select is((select revision from public.corpus_editions where isbn='9780306406157'),2,'edition revision advanced');
create temp table registry_stale as select public.corpus_record_fingerprint('b9000000-0000-4000-8000-000000000001') fingerprint;
grant select on registry_stale to authenticated;
set local role authenticated;
select lives_ok($$select public.complete_corpus_work_metadata('b9000000-0000-4000-8000-000000000001','{"genre":"romance","genres":["romance"]}')$$,'automatic completion still runs');
reset role;
select is((select genres from public.works where id='b9000000-0000-4000-8000-000000000001'),array['fantasy','fiction'],'provider genres cannot replace or append to reviewed guidance');
update public.books set genre='romance',genres=array['romance'],subgenre='Cozy',subgenres=array['Cozy'] where id='b9000000-0000-4000-8000-000000000003';
select lives_ok($$select public.preserve_personal_book_objective_metadata('b9000000-0000-4000-8000-000000000003')$$,'removal preservation can still fill objective gaps');
select is((select jsonb_build_array(genre,genres,subgenre,subgenres) from public.works where id='b9000000-0000-4000-8000-000000000001'),'["fantasy",["fantasy","fiction"],"Epic",["Epic"]]'::jsonb,'personal preservation cannot append or reorder reviewed guidance');
update public.books set genre=(select value->>'genre' from registry_personal_before),genres=(select array(select jsonb_array_elements_text(value->'genres')) from registry_personal_before),subgenre=(select value->>'subgenre' from registry_personal_before),subgenres=(select array(select jsonb_array_elements_text(value->'subgenres')) from registry_personal_before) where id='b9000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select public.admin_save_corpus_record('b9000000-0000-4000-8000-000000000001',(select fingerprint from registry_stale),'edition',pg_temp.registry_edition(),'https://publisher.example/edition','Old draft',true)$$,'40001',null,'stale work/edition snapshot refused');
select lives_ok($$select pg_temp.registry_save('remove_isbn','{"isbn":"9780140449136"}')$$,'incorrect work ISBN is removed explicitly');
reset role;
update public.works set isbns=isbns||array['9780140449136'] where id='b9000000-0000-4000-8000-000000000001';
select ok(not (select '9780140449136'=any(isbns) from public.works where id='b9000000-0000-4000-8000-000000000001'),'automatic refresh cannot reintroduce rejected assignment');
select is((select count(*)::int from public.corpus_editions where work_id='b9000000-0000-4000-8000-000000000001'),2,'removal retains edition record');
select is((select count(*)::int from public.corpus_editions where work_id='b9000000-0000-4000-8000-000000000001' and isbn is null),1,'removed assignment becomes unknown on retained edition');
create function pg_temp.registry_select() returns uuid language sql security definer as $$
 select public.select_corpus_edition('b9000000-0000-4000-8000-000000000003',e.id,e.revision,
 jsonb_build_object('isbn','9780306406157','pages',111,'publication',jsonb_build_object('y',1999,'m',null,'d',null)))
 from public.corpus_editions e where e.isbn='9780306406157';
$$;
select set_config('request.jwt.claim.sub','b9333333-3333-4333-8333-333333333333',true);
set local role authenticated;
select throws_ok($$select pg_temp.registry_select()$$,'42501',null,'other account cannot choose a personal edition');
select set_config('request.jwt.claim.sub','b9222222-2222-4222-8222-222222222222',true);
select lives_ok($$select pg_temp.registry_select()$$,'owner deliberately selects reviewed edition');
select throws_ok($$select pg_temp.registry_select()$$,'40001',null,'stale personal selection is refused');
reset role;
select is((select jsonb_build_array(isbn,pages,pub_y,pub_m,pub_d) from public.books where id='b9000000-0000-4000-8000-000000000003'),'["9780306406157",456,2026,null,null]'::jsonb,'exact edition tuple persists with unknown month/day');
select is((select to_jsonb(b)-array['isbn','pages','pub_y','pub_m','pub_d','updated_at','enriched_at','edition_revision'] from public.books b where id='b9000000-0000-4000-8000-000000000003'),(select value-array['isbn','pages','pub_y','pub_m','pub_d','updated_at','enriched_at','edition_revision'] from registry_personal_before),'selection preserves unrelated personal columns');
-- A reviewed correction changes the shared edition history, never the previously selected book.
select set_config('request.jwt.claim.sub','b9111111-1111-4111-8111-111111111111',true);
set local role authenticated;
select lives_ok($$select pg_temp.registry_save('edition',pg_temp.registry_edition('9780000000019'))$$,'administrator corrects an edition ISBN');
select lives_ok($$select pg_temp.registry_save('edition','{"id":"b9000000-0000-4000-8000-000000000099","isbn":null,"details":{"statement":"Limited edition","format":"hardcover"}}')$$,'ISBN-less published version is retained');
select lives_ok($$select pg_temp.registry_save('resolve_report',jsonb_build_object('reportId',public.get_corpus_record('b9000000-0000-4000-8000-000000000001')->'reports'->0->>'id'))$$,'administrator explicitly resolves report');
reset role;
select is((select count(*)::int from public.corpus_editions where work_id='b9000000-0000-4000-8000-000000000001'),3,'three distinct version records survive correction');
select is((select isbn from public.books where id='b9000000-0000-4000-8000-000000000003'),'9780306406157','shared ISBN correction never silently replaces personal selection');
select ok((select exists(select 1 from public.corpus_isbn_exclusions where work_id='b9000000-0000-4000-8000-000000000001' and isbn='9780306406157')),'old corrected ISBN has a durable exclusion');
select is((select count(*)::int from public.corpus_isbn_reports where work_id='b9000000-0000-4000-8000-000000000001' and resolved_at is null),0,'resolved report leaves attention queue');
update public.books set copy_inventory='{"version":1,"editions":[],"copies":[]}' where id='b9000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','b9222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select throws_ok($$select public.select_corpus_edition('b9000000-0000-4000-8000-000000000003','b9000000-0000-4000-8000-000000000099',1,'{}')$$,'22023',null,'configured private inventory cannot be replaced through parent edition selection');
reset role;
delete from auth.users where id='b9222222-2222-4222-8222-222222222222';
select is((select count(*)::int from public.corpus_isbn_reports where work_id='b9000000-0000-4000-8000-000000000001'),0,'account exit removes private reports including resolved ones');
select * from finish();
rollback;
