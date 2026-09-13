begin;
select no_plan();
select ok(not has_function_privilege(r,'public.corpus_edition_fields_match(jsonb,text[],text,jsonb)','EXECUTE'),
 r || ' cannot call internal edition helper') from unnest(array['anon','authenticated','service_role']) r;
select ok(public.corpus_edition_fields_match('{}',array['pubY'],null,'{"y":2024,"m":null,"d":null}'),'unscoped historical values keep legacy behavior, not new certification');
create temp table ref_date as select '{"pubY":{"referenceIsbn":"9780306406157","referenceValue":{"y":2024,"m":null,"d":null}}}'::jsonb provenance;
select ok(public.corpus_edition_fields_match(provenance,array['pubY'],'0306406152','{"y":2024,"m":null,"d":null}'),'equivalent ISBN-10 matches reference') from ref_date;
select ok(not public.corpus_edition_fields_match(provenance,array['pubY'],'9780140449136','{"y":2024,"m":null,"d":null}'),'different edition cannot inherit reviewed date') from ref_date;
select ok(not public.corpus_edition_fields_match(provenance,array['pubY'],null,'{"y":2024,"m":null,"d":null}'),'unknown edition cannot inherit reviewed date') from ref_date;
select ok(not public.corpus_edition_fields_match(provenance,array['pubY'],'9780306406157','{"y":2025,"m":null,"d":null}'),'same ISBN cannot certify a value changed after review') from ref_date;
select ok(not public.corpus_edition_fields_match(provenance #- '{pubY,referenceValue}',array['pubY'],'9780306406157','{"y":2024,"m":null,"d":null}'),'a reference with no reviewed value is not current evidence') from ref_date;
select ok(not public.corpus_edition_fields_match(jsonb_set(provenance,'{pubY,referenceIsbn}','"bad"'),array['pubY'],'9780306406157','{"y":2024,"m":null,"d":null}'),'invalid reference cannot become unscoped legacy') from ref_date;
select ok(not public.corpus_edition_fields_match(jsonb_set(provenance,'{pubY,referenceIsbn}','null'),array['pubY'],'9780306406157','{"y":2024,"m":null,"d":null}'),'null reference cannot become unscoped legacy') from ref_date;
select ok(not public.corpus_edition_fields_match(provenance,array['pubY','pubM'],'9780306406157','{"y":2024,"m":null,"d":null}'),'unscoped month cannot be spliced into scoped year') from ref_date;
select ok(not public.corpus_edition_fields_match(provenance || jsonb_build_object('pubM',jsonb_set(provenance->'pubY','{referenceIsbn}','"9780140449136"')),array['pubY','pubM'],'9780306406157','{"y":2024,"m":null,"d":null}'),'conflicting component references block whole tuple') from ref_date;
select ok(not public.corpus_edition_fields_match('{}','{}',null,'{}'),'empty helper field set refused');

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
 '{"pageCount":{"referenceIsbn":"9780140449136","referenceValue":{"pages":789}},"pubY":{"referenceIsbn":"9780306406157","referenceValue":{"y":2024,"m":2,"d":null}},"pubM":{"referenceIsbn":"9780306406157","referenceValue":{"y":2024,"m":2,"d":null}}}');
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
 '["9780140449136",789,null,null,null,"unowned",false,false,"unset"]'::jsonb,
 'delegated canonical first ISBN receives matching pages but not another edition date; no possession implied');
select is((select to_jsonb(w) from public.works w where id='75000000-0000-4000-8000-000000000002'),
 (select value from reference_shared_before),'consumer actions do not rewrite shared evidence');
-- Another writer can change a scalar without replacing its historical provenance.
update public.works set pub_y=2026 where id='75000000-0000-4000-8000-000000000002';
set local role authenticated;
select lives_ok($$select public.adopt_corpus_work_metadata('75000000-0000-4000-8000-000000000003')$$,'adoption remains usable after an uncited date edit');
reset role;
select is((select jsonb_build_array(pub_y,pub_m,pub_d) from public.books where id='75000000-0000-4000-8000-000000000003'),
 '[2024,2,null]'::jsonb,'stale same-ISBN provenance cannot authorize copying the changed date');
-- ISBNs are canonically sorted, not insertion-ordered. Limit this fixture to the other
-- edition and restore the exact reviewed date to exercise the opposite eligibility result.
update public.books set removed_at=now() where owner_id='75222222-2222-4222-8222-222222222222'
 and corpus_work_id='75000000-0000-4000-8000-000000000002';
update public.works set isbns='{9780306406157}', pub_y=2024 where id='75000000-0000-4000-8000-000000000002';
set local role authenticated;
select lives_ok($$select public.add_corpus_work_to_member_library('75000000-0000-4000-8000-000000000002','75222222-2222-4222-8222-222222222222')$$,'fresh delegated copy can use the other edition');
reset role;
select is((select jsonb_build_array(isbn,pages,pub_y,pub_m,pub_d) from public.books
 where owner_id='75222222-2222-4222-8222-222222222222' and corpus_work_id='75000000-0000-4000-8000-000000000002' and removed_at is null),
 '["9780306406157",null,2024,2,null]'::jsonb,'matching date survives a mismatched page reference without mixing fields');
select * from finish();
rollback;
