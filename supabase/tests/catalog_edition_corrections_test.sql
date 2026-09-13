begin;
select no_plan();
select ok(not has_function_privilege(role_name,
 'public.admin_correct_corpus_edition_details(uuid,text,integer,text,text,text,text,jsonb,text,text,boolean)','EXECUTE'),
 role_name || ' cannot execute edition correction') from unnest(array['anon','service_role']) role_name;
select ok(has_function_privilege('authenticated',
 'public.admin_correct_corpus_edition_details(uuid,text,integer,text,text,text,text,jsonb,text,text,boolean)','EXECUTE'),
 'authenticated callers still require body authorization');

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('74111111-1111-4111-8111-111111111111','authenticated','authenticated','edition-admin@example.com','{}','{}',now(),now()),
('74222222-2222-4222-8222-222222222222','authenticated','authenticated','edition-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('74111111-1111-4111-8111-111111111111');
insert into public.works(id,work_key,title,author_text,contributors,isbns,description,pages,pub_y,pub_m,pub_d,
 series,position,series_check_state,series_checked_at,metadata_provenance) values
('74000000-0000-4000-8000-000000000001','edition correction fixture','Edition Correction Fixture','Test Writer',
 '[{"name":"Test Writer","role":"author"}]','{9780306406157,9780140449136}','Protected description',321,2025,2,29,
 'Protected Series',1,'found','2020-01-01',
 '{"series":{"source":"manual","confidence":"high"},"pageCount":{"source":"openlibrary"},"pubY":{"source":"openlibrary"},"pubM":{"source":"hardcover"},"pubD":{"source":"hardcover"}}');
insert into public.books(id,owner_id,corpus_work_id,title,authors_display,isbn,pages,pub_y,pub_m,pub_d,ownership) values
('74000000-0000-4000-8000-000000000002','74111111-1111-4111-8111-111111111111','74000000-0000-4000-8000-000000000001','Edition Correction Fixture','Test Writer','9780306406157',111,1999,3,2,'unowned'),
('74000000-0000-4000-8000-000000000003','74222222-2222-4222-8222-222222222222','74000000-0000-4000-8000-000000000001','Edition Correction Fixture','Test Writer','9780140449136',222,2001,null,null,'unowned');
create temp table edition_personal_before as select jsonb_agg(to_jsonb(b) order by id) value from public.books b
 where corpus_work_id='74000000-0000-4000-8000-000000000001';
create temp table edition_shared_before as select to_jsonb(w) value from public.works w where id='74000000-0000-4000-8000-000000000001';
create temp table edition_graph_before as select jsonb_build_object(
 'series',(select jsonb_agg(to_jsonb(s) order by id) from public.corpus_series s),
 'entries',(select jsonb_agg(to_jsonb(e) order by id) from public.corpus_series_entries e),
 'sources',(select jsonb_agg(to_jsonb(s) order by id) from public.corpus_series_sources s),
 'edits',(select jsonb_agg(to_jsonb(e) order by id) from public.corpus_series_edits e)) value;
select is((select count(*)::int from public.corpus_series_entries where work_id='74000000-0000-4000-8000-000000000001' and removed_at is null),1,'populated shared graph makes no-write assertion non-vacuous');
select is((select public.catalog_metadata_review_record(w)->>'fingerprint' from public.works w
 where id='74000000-0000-4000-8000-000000000001'),
 (select md5(jsonb_build_array(title,author_text,contributors,isbns,description,metadata_provenance->'description',
 pub_y,publisher,language,'[]'::jsonb)::text) from public.works where id='74000000-0000-4000-8000-000000000001'),
 'existing assessment fingerprint is unchanged by new edition capability');

create function pg_temp.edition_attempt(field text, value jsonb, isbn text default '0306406152',
 title text default 'Edition Correction Fixture', author text default 'Test Writer', confirmed boolean default true,
 source text default 'https://publisher.example/edition', note text default 'Private checked edition explanation')
returns uuid language plpgsql as $$
declare item jsonb;
begin
 item := public.admin_list_corpus_metadata_reviews('all','all','',0,1,'74000000-0000-4000-8000-000000000001')->'items'->0;
 return public.admin_correct_corpus_edition_details('74000000-0000-4000-8000-000000000001',item->>'editionFingerprint',
   (item->>'revision')::int,isbn,title,author,field,value,source,note,confirmed);
end;
$$;
set local role anon;
select throws_ok($$select public.admin_correct_corpus_edition_details(null,null,null,null,null,null,null,null,null,null)$$,'42501',null,'anon refused at grant boundary');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"74222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select throws_ok($$select public.admin_correct_corpus_edition_details(null,null,null,null,null,null,null,null,null,null)$$,'42501','corpus administrator required','ordinary reader cannot correct');
select set_config('request.jwt.claims','{"sub":"74111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
reset role;
update public.works set contributors='[{"name":"Test Writer","role":"author"},{"name":"Second Writer","role":"co_author"}]'
 where id='74000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.edition_attempt('pages','{"pages":500}')$$,'22023',null,'matching display author cannot omit a recorded coauthor');
reset role;
update public.works set contributors='[{"name":"Test Writer","role":"author"}]'
 where id='74000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.edition_attempt('pages','{"pages":500}','bad')$$,'22023',null,'invalid ISBN refused');
select throws_ok($$select pg_temp.edition_attempt('pages','{"pages":500}','9780140328721')$$,'22023',null,'unassociated ISBN refused');
select throws_ok($$select pg_temp.edition_attempt('pages','{"pages":500}','0306406152','Other title')$$,'22023',null,'wrong title refused');
select throws_ok($$select pg_temp.edition_attempt('pages','{"pages":500}','0306406152','Edition Correction Fixture','Writer')$$,'22023',null,'surname-only evidence refused');
select throws_ok($$select pg_temp.edition_attempt('pages','{"pages":500}','0306406152','Edition Correction Fixture','Test Writer',false)$$,'22023',null,'identity gesture required');
select throws_ok($$select pg_temp.edition_attempt('pages','{"pages":500}','0306406152','Edition Correction Fixture','Test Writer',true,'https://user:secret@example.com')$$,'22023',null,'credential-bearing source refused');
select throws_ok($$select pg_temp.edition_attempt('pages','{"pages":500}','0306406152','Edition Correction Fixture','Test Writer',true,'javascript:alert(1)')$$,'22023',null,'unsafe source refused');
select throws_ok($$select pg_temp.edition_attempt('pages','{"pages":500}','0306406152','Edition Correction Fixture','Test Writer',true,'https://publisher.example','')$$,'22023',null,'explanation required');
select throws_ok(format('select pg_temp.edition_attempt(%L,%L::jsonb)','pages',v),'22023',null,'invalid page payload refused: '||v)
 from unnest(array['null','[]','{}','{"pages":null}','{"pages":0}','{"pages":20001}','{"pages":1.5}','{"pages":"12"}','{"pages":123,"pub_y":2020}']) v;
select throws_ok(format('select pg_temp.edition_attempt(%L,%L::jsonb)','publication',v),'22023',null,'invalid date payload refused: '||v)
 from unnest(array['{}','{"y":null,"m":null,"d":null}','{"y":2025,"m":2,"d":29}',
 '{"y":2024,"m":null,"d":1}','{"y":2024,"m":13,"d":null}','{"y":2024,"m":1}',
 '{"y":"2024","m":null,"d":null}','{"y":2024,"m":null,"d":null,"pages":9}']) v;
select lives_ok($$select pg_temp.edition_attempt('publication','{"y":2024,"m":2,"d":29}')$$,'date correction accepts valid leap day');
select ok(coalesce(current_setting('reverie.series_review_preserve_catalog',true),'')<>'on','graph-preservation flag restored after correction');
reset role;
select is((select jsonb_build_array(pub_y,pub_m,pub_d,pages) from public.works where id='74000000-0000-4000-8000-000000000001'),
 '[2024,2,29,321]'::jsonb,'whole date changes and pages stay exact');
select is((select metadata_provenance->'pubD'->>'referenceIsbn' from public.works where id='74000000-0000-4000-8000-000000000001'),'9780306406157','ISBN-10 becomes canonical reference ISBN');
select is((select jsonb_array_length(value) from edition_personal_before),2,'both personal copies exist in baseline');
select is((select jsonb_agg(to_jsonb(b) order by id) from public.books b where corpus_work_id='74000000-0000-4000-8000-000000000001'),
 (select value from edition_personal_before),'all personal columns unchanged, including other edition copy');
select is((select to_jsonb(w)-array['pub_y','pub_m','pub_d','metadata_provenance','updated_at'] from public.works w where id='74000000-0000-4000-8000-000000000001'),
 (select value-array['pub_y','pub_m','pub_d','metadata_provenance','updated_at'] from edition_shared_before),'no unrelated shared field changed');
select is(jsonb_build_object(
 'series',(select jsonb_agg(to_jsonb(s) order by id) from public.corpus_series s),
 'entries',(select jsonb_agg(to_jsonb(e) order by id) from public.corpus_series_entries e),
 'sources',(select jsonb_agg(to_jsonb(s) order by id) from public.corpus_series_sources s),
 'edits',(select jsonb_agg(to_jsonb(e) order by id) from public.corpus_series_edits e)),
 (select value from edition_graph_before),'edition provenance does not refresh any series graph or audit');
select is((select state from public.corpus_metadata_reviews where work_id='74000000-0000-4000-8000-000000000001'),'open','correction does not certify remaining concerns');
create temp table edition_stale as select public.catalog_metadata_review_record(w)->>'editionFingerprint' fingerprint from public.works w where id='74000000-0000-4000-8000-000000000001';
grant select on edition_stale to authenticated;
set local role authenticated;
select lives_ok($$select pg_temp.edition_attempt('pages','{"pages":456}')$$,'pages correction succeeds separately');
select throws_ok($$select public.admin_correct_corpus_edition_details('74000000-0000-4000-8000-000000000001',(select fingerprint from edition_stale),1,'0306406152','Edition Correction Fixture','Test Writer','pages','{"pages":456}','https://publisher.example/edition','Checked',true)$$,'P0001',null,'duplicate/stale submission refused');
select lives_ok($$select pg_temp.edition_attempt('publication','{"y":2024,"m":2,"d":null}')$$,'month precision replaces day with unknown');
reset role;
select ok((select pub_d is null and not metadata_provenance ? 'pubD' from public.works where id='74000000-0000-4000-8000-000000000001'),'discarded day precision also removes old day provenance');
set local role authenticated;
select lives_ok($$select pg_temp.edition_attempt('publication','{"y":2024,"m":null,"d":null}')$$,'year precision replaces entire date');
reset role;
select is((select jsonb_build_array(pub_y,pub_m,pub_d,pages) from public.works where id='74000000-0000-4000-8000-000000000001'),'[2024,null,null,456]'::jsonb,'year-only date never keeps former month/day; pages retained');
select is((select metadata_provenance->'pageCount'->>'referenceIsbn' from public.works where id='74000000-0000-4000-8000-000000000001'),'9780306406157','page reference retained after date action');
update edition_stale set fingerprint=(select public.catalog_metadata_review_record(w)->>'editionFingerprint' from public.works w where id='74000000-0000-4000-8000-000000000001');
update public.works set pub_m=5 where id='74000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.admin_correct_corpus_edition_details('74000000-0000-4000-8000-000000000001',(select fingerprint from edition_stale),4,'0306406152','Edition Correction Fixture','Test Writer','pages','{"pages":800}','https://publisher.example/edition','Checked',true)$$,'P0001',null,'concurrent month-only change invalidates page proposal');
reset role;
-- Legacy ISBN collision must fail even if a reviewer affirms identity.
alter table public.works disable trigger works_validate_isbn_assignment;
insert into public.works(id,work_key,title,author_text,isbns) values('74000000-0000-4000-8000-000000000004','edition conflict','Other Work','Other Writer','{9780306406157}');
alter table public.works enable trigger works_validate_isbn_assignment;
set local role authenticated;
select throws_ok($$select pg_temp.edition_attempt('pages','{"pages":900}')$$,'22023',null,'existing ISBN collision cannot be affirmed away');
select set_config('request.jwt.claims','{"sub":"74222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select is((select count(*)::int from public.corpus_metadata_review_events),0,'private correction explanation/history hidden from readers');
select is((select count(*)::int from public.corpus_metadata_reviews),0,'private review state hidden from readers');
reset role;
select is((select count(*)::int from public.corpus_metadata_review_events where work_id='74000000-0000-4000-8000-000000000001'),4,'only four successful decisions appended history');
select ok(not exists(select 1 from public.work_metadata_edits where next_value::text like '%Private checked edition explanation%'),'private notes not copied into public metadata audit');
delete from public.corpus_admins where user_id='74111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"74111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select throws_ok($$select public.admin_correct_corpus_edition_details(null,null,null,null,null,null,null,null,null,null)$$,'42501','corpus administrator required','revoked reviewer cannot finish');
reset role;
-- Keep same-tuple reconciliation alive after the narrow action restores the graph guard.
delete from public.corpus_series_entries where work_id='74000000-0000-4000-8000-000000000001';
update public.works set series_check_state=series_check_state where id='74000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.corpus_series_entries where work_id='74000000-0000-4000-8000-000000000001' and removed_at is null),1,'explicit same-state confirmation still reconciles shared graph');
select * from finish();
rollback;
