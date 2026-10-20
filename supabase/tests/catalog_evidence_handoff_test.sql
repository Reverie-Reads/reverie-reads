begin;
select no_plan();
select ok(not has_table_privilege(r,'public.corpus_metadata_evidence_reviews',p),r||' cannot directly '||p||' evidence history')
from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(not has_function_privilege(r,f,'EXECUTE'),r||' cannot execute '||f)
from unnest(array['anon','service_role']) r cross join unnest(array['public.admin_get_catalog_evidence(uuid,uuid)','public.admin_apply_catalog_evidence(uuid,uuid,text,jsonb,boolean)']) f;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('e8111111-1111-4111-8111-111111111111','authenticated','authenticated','evidence-admin@example.com','{}','{}',now(),now()),
('e8222222-2222-4222-8222-222222222222','authenticated','authenticated','evidence-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('e8111111-1111-4111-8111-111111111111');
insert into public.works(id,work_key,title,author_text,contributors,isbns,pages,series,position,series_check_state,metadata_provenance) values
('e8000000-0000-4000-8000-000000000001','evidence fixture','Still Waters','Jane Smith','[{"name":"Jane Smith","role":"author"}]','{9780306406157}',99,'Protected evidence series',1,'found','{"series":{"source":"manual","confidence":"high"}}');
update public.corpus_editions set details='{"format":"paperback","pages":123,"publication":{"y":2024,"m":5,"d":12}}' where work_id='e8000000-0000-4000-8000-000000000001';
insert into public.corpus_editions(id,work_id,details) values('e8000000-0000-4000-8000-000000000004','e8000000-0000-4000-8000-000000000001','{"pages":567}');
insert into public.books(id,owner_id,corpus_work_id,title,authors_display,isbn,ownership,rating) values
('e8000000-0000-4000-8000-000000000002','e8222222-2222-4222-8222-222222222222','e8000000-0000-4000-8000-000000000001','My title','Personal Writer','9780306406157','owned',4);
insert into public.reads(book_id,owner_id,read_on,format,notes) values
('e8000000-0000-4000-8000-000000000002','e8222222-2222-4222-8222-222222222222','2025-01-01','physical','Private history');
create temp table protected as select jsonb_build_array(
 (select to_jsonb(b) from public.books b where id='e8000000-0000-4000-8000-000000000002'),
 (select jsonb_agg(to_jsonb(r) order by id) from public.reads r where book_id='e8000000-0000-4000-8000-000000000002'),
 (select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.corpus_series_entries s)) value;
create function pg_temp.draft(f text default 'description') returns jsonb language sql as $$
 select jsonb_build_object('version',1,'field',f,'editionId',case when f='description' then null else (select id from public.corpus_editions where isbn='9780306406157') end,
 'value',case when f='description' then to_jsonb('A checked short summary.'::text) when f='pages' then '{"pages":456}'::jsonb else '{"y":2025,"m":null,"d":null}'::jsonb end,
 'identity',jsonb_build_object('title','Still Waters','author','Jane Smith','isbn',case when f='description' then null else '9780306406157' end),
 'source',jsonb_build_object('url','https://publisher.example/book','recordId','book','locator','Published edition details','checkedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'kind','publisher'),
 'support',jsonb_build_object('explanation','I checked this fact at the original source.','scope',case when f='description' then 'work' else 'edition' end,'independentlyChecked',true),
 'sourceUse',jsonb_build_object('version',1,'basis','public_terms','url','https://publisher.example/terms','note','The inspected terms cover retaining and displaying this selected fact.','checkedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'scope',case when f='description' then 'catalog_description' else 'catalog_edition_facts' end,'confirmed',true),
 'note','Supported correction; unrelated concerns remain open.');
$$;
select ok(public.catalog_evidence_draft_valid(pg_temp.draft()),'valid description evidence');
select ok(public.catalog_evidence_draft_valid(pg_temp.draft('pages')),'valid edition page evidence');
select ok(public.catalog_evidence_draft_valid(pg_temp.draft('publication')),'valid precision-preserving date');
select ok(public.catalog_evidence_draft_valid(jsonb_set(pg_temp.draft(),p,v)) is distinct from true,'reject malformed evidence at '||p::text)
from (values ('{field}'::text[],'null'::jsonb),('{source,kind}','null'),('{source,kind}','["publisher"]'),('{support,independentlyChecked}','false'),
 ('{sourceUse,confirmed}','false'),('{sourceUse,scope}','"model_input"'),('{source,url}','"https://person:secret@publisher.example/book"'),
 ('{source,url}','"https://publisher.example/book?key=private"'),('{note}','null')) x(p,v);
select ok(public.catalog_evidence_draft_valid(jsonb_set(pg_temp.draft('publication'),'{value}','{"y":2024,"m":1,"d":367}')) is distinct from true,'reject rolled date');
select set_config('request.jwt.claims','{"sub":"e8222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.admin_get_catalog_evidence('e8000000-0000-4000-8000-000000000001')$$,'42501','corpus administrator required','ordinary reader cannot read evidence');
reset role;
select set_config('request.jwt.claims','{"sub":"e8111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
create temp table frozen as select public.catalog_evidence_fingerprint('e8000000-0000-4000-8000-000000000001') fingerprint,pg_temp.draft() draft;
create function pg_temp.apply(i uuid, d jsonb default null, fp text default null) returns jsonb language sql security definer as $$
 select public.admin_apply_catalog_evidence(i,'e8000000-0000-4000-8000-000000000001',coalesce(fp,(select fingerprint from frozen)),coalesce(d,(select draft from frozen)),true);
$$;
select lives_ok($$select pg_temp.apply('e8000000-0000-4000-8000-000000000011')$$,'apply reviewed description');
select is((select description from public.works where id='e8000000-0000-4000-8000-000000000001'),'A checked short summary.','description persisted');
create temp table retry_before as select (select count(*) from public.corpus_metadata_review_events) events,(select count(*) from public.corpus_metadata_evidence_reviews) reviews;
select lives_ok($$select pg_temp.apply('e8000000-0000-4000-8000-000000000011')$$,'identical retry succeeds after fingerprint changed');
select is((select count(*) from public.corpus_metadata_review_events),(select events from retry_before),'retry creates no metadata event');
select is((select count(*) from public.corpus_metadata_evidence_reviews),(select reviews from retry_before),'retry creates no review');
select throws_ok($$select pg_temp.apply('e8000000-0000-4000-8000-000000000011',jsonb_set(pg_temp.draft(),'{value}','"Changed payload"'))$$,'PT409','This retry identity belongs to a different reviewed change.','different payload cannot reuse UUID');
select throws_ok($$select pg_temp.apply('e8000000-0000-4000-8000-000000000012')$$,'PT409','The catalog or review changed. Reload before deciding.','new save rejects stale fingerprint');
select lives_ok($$select pg_temp.apply('e8000000-0000-4000-8000-000000000013',pg_temp.draft('pages'),public.catalog_evidence_fingerprint('e8000000-0000-4000-8000-000000000001'))$$,'save selected edition pages');
select is((select details->>'pages' from public.corpus_editions where isbn='9780306406157'),'456','selected edition pages changed');
select is((select pages from public.works where id='e8000000-0000-4000-8000-000000000001'),99,'work scalar unchanged');
select is((select details->>'pages' from public.corpus_editions where id='e8000000-0000-4000-8000-000000000004'),'567','sibling edition unchanged');
select is((select reviewed from public.corpus_editions where isbn='9780306406157'),false,'one fact does not certify entire edition');
select lives_ok($$select pg_temp.apply('e8000000-0000-4000-8000-000000000014',pg_temp.draft('publication'),public.catalog_evidence_fingerprint('e8000000-0000-4000-8000-000000000001'))$$,'save selected edition date');
select is((select details->'publication' from public.corpus_editions where isbn='9780306406157'),'{"y":2025,"m":null,"d":null}'::jsonb,'reduced date precision clears unsupported month/day');
select ok((select count(*) from public.corpus_series_entries where work_id='e8000000-0000-4000-8000-000000000001')>0,'protected graph comparison is non-vacuous');
select is((select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.corpus_series_entries s),(select value->2 from protected),'successful corrections preserve the shared graph byte-for-byte');
update public.corpus_editions set details=details||'{"format":"audiobook"}' where isbn='9780306406157';
select throws_ok($$select pg_temp.apply('e8000000-0000-4000-8000-000000000015',pg_temp.draft('pages'),public.catalog_evidence_fingerprint('e8000000-0000-4000-8000-000000000001'))$$,'22023','Verify the selected edition format before reviewing pages.','audiobook page hold');
update public.corpus_metadata_reviews set state='deferred' where work_id='e8000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.apply('e8000000-0000-4000-8000-000000000016',pg_temp.draft(),public.catalog_evidence_fingerprint('e8000000-0000-4000-8000-000000000001'))$$,'22023','Reconcile and explicitly reopen the deferred review before applying evidence.','deferred hold cannot silently reopen');
update public.corpus_metadata_reviews set state='open' where work_id='e8000000-0000-4000-8000-000000000001';
update public.works set author_text='J. Smith',contributors='[{"name":"J. Smith","role":"author"}]' where id='e8000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.apply('e8000000-0000-4000-8000-000000000017',jsonb_set(pg_temp.draft(),'{identity,author}','"J. Smith"'),public.catalog_evidence_fingerprint('e8000000-0000-4000-8000-000000000001'))$$,'22023','Resolve contributor identity before applying evidence.','ambiguous initials remain held');
set local role authenticated;
select is(public.admin_get_catalog_evidence('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000011')->'attempt'->>'id','e8000000-0000-4000-8000-000000000011','exact receipt lookup survives later changes');
reset role;
select is(jsonb_build_array(
 (select to_jsonb(b) from public.books b where id='e8000000-0000-4000-8000-000000000002'),
 (select jsonb_agg(to_jsonb(r) order by id) from public.reads r where book_id='e8000000-0000-4000-8000-000000000002'),
 (select value->2 from protected)),(select value from protected),'personal rows and reading history preserved byte-for-byte');
select * from finish();
rollback;
