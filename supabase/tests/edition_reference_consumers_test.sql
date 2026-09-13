begin;
select no_plan();
select ok(not has_function_privilege(r,'public.corpus_edition_fields_match(jsonb,text[],text)','EXECUTE'),
 r || ' cannot call internal edition helper') from unnest(array['anon','authenticated','service_role']) r;
select ok(public.corpus_edition_fields_match('{}',array['pubY'],null),'unscoped historical values keep legacy behavior, not new certification');
select ok(public.corpus_edition_fields_match('{"pubY":{"referenceIsbn":"9780306406157"}}',array['pubY'],'0306406152'),'equivalent ISBN-10 matches reference');
select ok(not public.corpus_edition_fields_match('{"pubY":{"referenceIsbn":"9780306406157"}}',array['pubY'],'9780140449136'),'different edition cannot inherit reviewed date');
select ok(not public.corpus_edition_fields_match('{"pubY":{"referenceIsbn":"9780306406157"}}',array['pubY'],null),'unknown edition cannot inherit reviewed date');
select ok(not public.corpus_edition_fields_match('{"pubY":{"referenceIsbn":"bad"}}',array['pubY'],'9780306406157'),'invalid reference cannot become unscoped legacy');
select ok(not public.corpus_edition_fields_match('{"pubY":{"referenceIsbn":null}}',array['pubY'],'9780306406157'),'null reference cannot become unscoped legacy');
select ok(not public.corpus_edition_fields_match('{"pubY":{"referenceIsbn":"9780306406157"}}',array['pubY','pubM'],'9780306406157'),'unscoped month cannot be spliced into scoped year');
select ok(not public.corpus_edition_fields_match('{"pubY":{"referenceIsbn":"9780306406157"},"pubM":{"referenceIsbn":"9780140449136"}}',array['pubY','pubM'],'9780306406157'),'conflicting component references block whole tuple');
select ok(not public.corpus_edition_fields_match('{}','{}',null),'empty helper field set refused');

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('75111111-1111-4111-8111-111111111111','authenticated','authenticated','reference-owner@example.com','{}','{}',now(),now()),
('75222222-2222-4222-8222-222222222222','authenticated','authenticated','reference-recipient@example.com','{}','{}',now(),now());
insert into public.households(id,name) values('75000000-0000-4000-8000-000000000001','Reference fixture');
insert into public.household_members(household_id,user_id,role) values
('75000000-0000-4000-8000-000000000001','75111111-1111-4111-8111-111111111111','owner'),
('75000000-0000-4000-8000-000000000001','75222222-2222-4222-8222-222222222222','member');
insert into public.works(id,work_key,title,author_text,contributors,isbns,pages,pub_y,pub_m,pub_d,metadata_provenance)
 values('75000000-0000-4000-8000-000000000002','reference consumers fixture','Reference Consumers Fixture','Exact Writer',
 '[{"name":"Exact Writer","role":"author"}]','{9780306406157,9780140449136}',789,2024,2,null,
 '{"pageCount":{"referenceIsbn":"9780140449136"},"pubY":{"referenceIsbn":"9780306406157"},"pubM":{"referenceIsbn":"9780306406157"}}');
insert into public.household_works(household_id,work_id,added_by,inclusion_source) values
('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000002','75111111-1111-4111-8111-111111111111','manual');
insert into public.books(id,owner_id,corpus_work_id,title,authors_display,isbn,pages,pub_y,pub_m,pub_d,ownership) values
('75000000-0000-4000-8000-000000000003','75111111-1111-4111-8111-111111111111','75000000-0000-4000-8000-000000000002','Reference Consumers Fixture','Exact Writer','9780306406157',111,1999,1,2,'owned'),
('75000000-0000-4000-8000-000000000004','75111111-1111-4111-8111-111111111111','75000000-0000-4000-8000-000000000002','Reference Consumers Fixture','Exact Writer','9780140449136',222,2000,3,4,'unowned');
create temp table reference_shared_before as select to_jsonb(w) value from public.works w where id='75000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"75111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok($$select public.adopt_corpus_work_metadata('75000000-0000-4000-8000-000000000003')$$,'matching personal edition can deliberately adopt shared date');
select lives_ok($$select public.adopt_corpus_work_metadata('75000000-0000-4000-8000-000000000004')$$,'other shared details remain adoptable without copying mismatched date');
select throws_ok($$select public.add_corpus_work_to_member_library('75000000-0000-4000-8000-000000000002','75222222-2222-4222-8222-222222222222')$$,'42501',null,'edition guard does not bypass recipient consent');
reset role;
select is((select jsonb_build_array(isbn,pages,pub_y,pub_m,pub_d,ownership) from public.books where id='75000000-0000-4000-8000-000000000003'),
 '["9780306406157",111,2024,2,null,"owned"]'::jsonb,'matching adoption replaces complete date, preserves pages/ISBN/ownership');
select is((select jsonb_build_array(isbn,pages,pub_y,pub_m,pub_d,ownership) from public.books where id='75000000-0000-4000-8000-000000000004'),
 '["9780140449136",222,2000,3,4,"unowned"]'::jsonb,'mismatched adoption preserves existing personal tuple and pages');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"75222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select throws_ok($$select public.adopt_corpus_work_metadata('75000000-0000-4000-8000-000000000003')$$,'P0002',null,'another reader still cannot adopt into the owner copy');
select public.set_household_member_library_adds(true);
select set_config('request.jwt.claims','{"sub":"75111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok($$select public.add_corpus_work_to_member_library('75000000-0000-4000-8000-000000000002','75222222-2222-4222-8222-222222222222')$$,'consented delegated addition uses field-specific references');
reset role;
select is((select jsonb_build_array(isbn,pages,pub_y,pub_m,pub_d,ownership,borrowed,wishlist,read_status) from public.books
 where owner_id='75222222-2222-4222-8222-222222222222' and corpus_work_id='75000000-0000-4000-8000-000000000002'),
 '["9780306406157",null,2024,2,null,"unowned",false,false,"unset"]'::jsonb,
 'delegated first ISBN receives matching date but not another edition page count; no possession implied');
select is((select to_jsonb(w) from public.works w where id='75000000-0000-4000-8000-000000000002'),
 (select value from reference_shared_before),'consumer actions do not rewrite shared evidence');
-- A fresh copy of the other selected edition reverses the independently eligible fields.
update public.books set removed_at=now() where owner_id='75222222-2222-4222-8222-222222222222'
 and corpus_work_id='75000000-0000-4000-8000-000000000002';
update public.works set isbns='{9780140449136,9780306406157}' where id='75000000-0000-4000-8000-000000000002';
set local role authenticated;
select lives_ok($$select public.add_corpus_work_to_member_library('75000000-0000-4000-8000-000000000002','75222222-2222-4222-8222-222222222222')$$,'fresh delegated copy can use the other edition');
reset role;
select is((select jsonb_build_array(isbn,pages,pub_y,pub_m,pub_d) from public.books
 where owner_id='75222222-2222-4222-8222-222222222222' and corpus_work_id='75000000-0000-4000-8000-000000000002' and removed_at is null),
 '["9780140449136",789,null,null,null]'::jsonb,'matching pages survive a mismatched date reference without mixing fields');
select * from finish();
rollback;
