begin;
select no_plan();

-- All receipts and internal helpers are inaccessible to API roles, including service role.
select ok(not has_table_privilege(r,'public.corpus_edition_credit_source_use_receipts',p),r||' cannot directly '||p||' source-use receipts')
from unnest(array['anon','authenticated','service_role']) r
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
select ok((select relrowsecurity from pg_class where oid='public.corpus_edition_credit_source_use_receipts'::regclass),'receipt table enables RLS without broad policies');
select ok(not has_function_privilege(r,f,'EXECUTE'),r||' cannot execute internal helper '||f)
from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
 'public.edition_credit_source_use_valid(jsonb)','public.edition_credit_source_use_hold(jsonb)',
 'public.edition_credit_review_decisions(uuid,uuid,jsonb,jsonb)',
 'public.admin_prepare_edition_credits(uuid,uuid,uuid,text,jsonb)']) f;
select ok(not has_function_privilege(r,'public.admin_prepare_reviewed_edition_credits(uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE'),r||' cannot execute reviewed prepare')
from unnest(array['anon','service_role']) r;
select ok(has_function_privilege('authenticated','public.admin_prepare_reviewed_edition_credits(uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE'),'authenticated may reach role-checked prepare');
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('c9111111-1111-4111-8111-111111111111','authenticated','authenticated','credits-admin@example.com','{}','{}',now(),now()),
('c9222222-2222-4222-8222-222222222222','authenticated','authenticated','credits-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('c9111111-1111-4111-8111-111111111111');
insert into public.works(id,work_key,title,author_text,contributors,isbns) values
('c9000000-0000-4000-8000-000000000001','credits fixture','Still Waters','Jane Smith','[{"name":"Jane Smith","role":"author"}]','{9780306406157}');
insert into public.books(id,owner_id,corpus_work_id,title,authors_display,isbn,ownership) values
('c9000000-0000-4000-8000-000000000002','c9222222-2222-4222-8222-222222222222','c9000000-0000-4000-8000-000000000001','Personal title','Personal Writer','9780306406157','owned');
insert into public.reads(book_id,owner_id,read_on,format,notes) values
('c9000000-0000-4000-8000-000000000002','c9222222-2222-4222-8222-222222222222','2025-01-01','physical','Private reading history');
insert into public.authors(id,owner_id,name,name_key) values
('c9000000-0000-4000-8000-000000000003','c9222222-2222-4222-8222-222222222222','Personal Writer','personal writer');
insert into public.book_authors(book_id,author_id,owner_id,position,role) values
('c9000000-0000-4000-8000-000000000002','c9000000-0000-4000-8000-000000000003','c9222222-2222-4222-8222-222222222222',0,'author');
create temp table credits_protected as select jsonb_build_array(
 (select to_jsonb(b) from public.books b where id='c9000000-0000-4000-8000-000000000002'),
 (select jsonb_agg(to_jsonb(r) order by id) from public.reads r where book_id='c9000000-0000-4000-8000-000000000002'),
 (select jsonb_agg(to_jsonb(a)) from public.book_authors a where book_id='c9000000-0000-4000-8000-000000000002'),
 (select to_jsonb(w) from public.works w where id='c9000000-0000-4000-8000-000000000001')) value;
create function pg_temp.evidence() returns jsonb language sql as $$
 select jsonb_build_object('version',1,'source',jsonb_build_object('url','https://publisher.example/edition','kind','publisher','checkedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'locator','Edition credits','retentionConfirmed',true),
 'identity',jsonb_build_object('title','Still Waters','authors',jsonb_build_array('Jane Smith'),'isbn','9780306406157','format',null,'language',null),
 'credits','[{"name":"Jane Smith","role":"author","scope":"whole","sourceRole":"Written by","basis":"edition"},{"name":"Ann Brown","role":"translator","scope":"whole","sourceRole":" Translator ","basis":"edition"},{"name":"Ann Brown","role":"introduction","scope":"whole","sourceRole":"Introduction by","basis":"edition"},{"name":"Chris Pine","role":"author","scope":"part","part":"A story","sourceRole":"Story by","basis":"edition"},{"name":"Unclear Person","role":"unknown","scope":"whole","sourceRole":null,"basis":"work"}]'::jsonb,
 'confirmations','{"sourceChecked":true,"identityChecked":true,"creditsChecked":true}'::jsonb);
$$;

create function pg_temp.source_use() returns jsonb language sql as $$
 select jsonb_build_object('version',1,'basis','public_terms','url','https://publisher.example/terms#credits',
   'note','Synthetic permission fixture for edition identity and literal credits only.',
   'checkedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'scope','edition_identity_and_credit_facts','confirmed',true);
$$;
create function pg_temp.prepare(p_id uuid,s jsonb default pg_temp.source_use(),v jsonb default pg_temp.evidence())
returns jsonb language sql security definer set search_path='' as $$
 select public.admin_prepare_reviewed_edition_credits(p_id,'c9000000-0000-4000-8000-000000000001',e.id,
   coalesce((select expected_fingerprint from public.corpus_edition_credit_reviews where id=p_id),public.corpus_record_fingerprint(e.work_id)),v,s)
 from public.corpus_editions e where e.isbn='9780306406157';
$$;
create function pg_temp.reviews() returns jsonb language sql as $$
 select public.admin_get_edition_credit_reviews('c9000000-0000-4000-8000-000000000001',
   (select id from public.corpus_editions where isbn='9780306406157'));
$$;
-- Test-only audit catches even an UPDATE that happens to leave identical values/timestamps.
create temp table source_use_write_log(operation text);
create function pg_temp.source_use_log_write() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into pg_temp.source_use_write_log values(tg_table_name||':'||tg_op); return null; end;
$$;
create trigger source_use_test_review_write after insert or update or delete on public.corpus_edition_credit_reviews
for each row execute function pg_temp.source_use_log_write();
create trigger source_use_test_receipt_write after insert or update or delete on public.corpus_edition_credit_source_use_receipts
for each row execute function pg_temp.source_use_log_write();
create trigger source_use_test_edition_write after insert or update or delete on public.corpus_editions
for each row execute function pg_temp.source_use_log_write();
create function pg_temp.write_count() returns integer language sql security definer set search_path='' as $$
 select count(*)::integer from pg_temp.source_use_write_log;
$$;

select ok(public.edition_credit_source_use_valid(pg_temp.source_use()),'strict public-terms receipt accepted structurally');
select ok(public.edition_credit_source_use_valid(jsonb_set(pg_temp.source_use(),'{basis}','"written_permission"')),'written-permission basis accepted structurally');
select ok(public.edition_credit_source_use_valid(jsonb_set(pg_temp.source_use(),'{checkedAt}','"2024-02-29T12:30:59.123Z"')),'valid leap day and fractional UTC accepted structurally, independent of freshness');
select ok(not public.edition_credit_source_use_valid(v),label) from (values
 (null::jsonb,'missing receipt rejected'),
 ('null'::jsonb,'JSON null rejected'),
 ('[]'::jsonb,'array rejected'),
 (pg_temp.source_use()-'note','missing field rejected'),
 (pg_temp.source_use()||'{"providerPayload":{"title":"Do not retain"}}','provider payload refused'),
 (pg_temp.source_use()||'{"modelOutput":"Do not retain"}','model payload refused'),
 (pg_temp.source_use()||'{"privateNotes":"Do not retain"}','private fields refused'),
 (pg_temp.source_use()||'{"version":"1"}','string version refused'),
 (pg_temp.source_use()||'{"basis":["public_terms"]}','coercible basis array refused'),
 (pg_temp.source_use()||'{"basis":"provider_claim"}','provider claim is not a human use basis'),
 (pg_temp.source_use()||'{"scope":"all_metadata"}','scope cannot expand to descriptions/images/export/model input'),
 (pg_temp.source_use()||'{"confirmed":false}','unconfirmed receipt refused'),
 (pg_temp.source_use()||'{"confirmed":"true"}','string confirmation refused'),
 (pg_temp.source_use()||jsonb_build_object('note',repeat('x',1001)),'overlong note refused'),
 (pg_temp.source_use()||jsonb_build_object('note',E' \t\n'),'whitespace note refused'),
 (pg_temp.source_use()||jsonb_build_object('note',jsonb_build_object('api','payload')),'structured note payload refused'),
 (pg_temp.source_use()||'{"url":"http://publisher.example/terms"}','HTTP refused'),
 (pg_temp.source_use()||'{"url":"https://name:secret@publisher.example/terms"}','credential-bearing URL refused'),
 (pg_temp.source_use()||'{"url":"https://publisher.example/terms?api_key=secret"}','query-bearing URL refused'),
 (pg_temp.source_use()||'{"url":"https://publisher.example/terms?"}','empty query refused'),
 (pg_temp.source_use()||'{"url":"https:///terms"}','empty authority refused'),
 (pg_temp.source_use()||'{"url":"https://publisher.example:65536/terms"}','invalid port refused'),
 (pg_temp.source_use()||'{"url":"https://[bad]/terms"}','malformed IPv6 refused'),
 (pg_temp.source_use()||jsonb_build_object('url','https://publisher.example/'||repeat('x',2000)),'overlong URL refused'),
 (pg_temp.source_use()||'{"checkedAt":"2025-02-29T00:00:00Z"}','invalid leap date refused'),
 (pg_temp.source_use()||'{"checkedAt":"2026-02-30T00:00:00Z"}','date rollover refused'),
 (pg_temp.source_use()||'{"checkedAt":"2026-01-01T24:00:00Z"}','hour rollover refused'),
 (pg_temp.source_use()||'{"checkedAt":"2026-01-01T23:59:60Z"}','leap-second rollover refused'),
 (pg_temp.source_use()||'{"checkedAt":"2026-01-01T00:00:00+00:00"}','noncanonical UTC offset refused'),
 (pg_temp.source_use()||'{"checkedAt":"2026-01-01T00:00:00.1234Z"}','excess fractional precision refused')
) x(v,label);
select is(public.edition_credit_source_use_hold(pg_temp.source_use()),null::text,'current valid use has no hold');
select is(public.edition_credit_source_use_hold(null),'source_use_review_required','missing use has specific hold');
select is(public.edition_credit_source_use_hold(jsonb_set(pg_temp.source_use(),'{checkedAt}',to_jsonb(to_char((now()+interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')))),
 'source_use_stale','future use has specific hold');
select is(public.edition_credit_source_use_hold(jsonb_set(pg_temp.source_use(),'{checkedAt}',to_jsonb(to_char((now()-interval '31 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')))),
 'source_use_stale','old use has specific hold');

select set_config('request.jwt.claim.sub','c9222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select throws_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010',null)$$,'42501','corpus administrator required','authority check precedes invalid receipt validation');
select throws_ok($$select * from public.corpus_edition_credit_source_use_receipts$$,'42501',null,'ordinary reader cannot read receipt table');
select throws_ok($$select pg_temp.reviews()$$,'42501',null,'ordinary reader cannot inspect receipts through review RPC');
select set_config('request.jwt.claim.sub','c9111111-1111-4111-8111-111111111111',true);
select throws_ok($$select * from public.corpus_edition_credit_source_use_receipts$$,'42501',null,'even an admin has no direct receipt read privilege');
select throws_ok($$select public.admin_prepare_edition_credits(null,null,null,null,null)$$,'42501',null,'old client prepare route is closed at privilege boundary');
select throws_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010',null)$$,'22023',null,'missing use prevents evidence storage');
select throws_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010',pg_temp.source_use()||'{"modelOutput":"no"}')$$,'22023',null,'unknown payload prevents evidence storage');
select throws_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010',jsonb_set(pg_temp.source_use(),'{checkedAt}',to_jsonb(to_char((now()-interval '31 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))))$$,'22023',null,'stale source use prevents evidence storage');
select throws_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010',jsonb_set(pg_temp.source_use(),'{checkedAt}',to_jsonb(to_char((now()+interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))))$$,'22023',null,'future source use prevents evidence storage');
select throws_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010',pg_temp.source_use(),pg_temp.evidence()||'{"privateNotes":"no"}')$$,'22023',null,'invalid bibliography prevents atomic receipt retention');
select is(pg_temp.write_count(),0,'all failed prepares leave no review, receipt or edition write');
select lives_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010')$$,'admin freezes bibliography and receipt atomically');
select is(pg_temp.write_count(),2,'prepare inserts exactly one review and one receipt, no edition write');
select lives_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010')$$,'exact review and receipt retry succeeds');
select is(pg_temp.write_count(),2,'exact retry performs no write at all');
select throws_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010',pg_temp.source_use()||'{"note":"Changed permission claim"}')$$,'PT409',null,'same ID cannot change source use');
select throws_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010',null)$$,'PT409',null,'existing review cannot remove its source use');
select throws_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010',pg_temp.source_use(),jsonb_set(pg_temp.evidence(),'{credits,0,name}','"Changed Person"'))$$,'PT409',null,'same ID cannot change bibliography');
reset role;
select is((select source_use from public.corpus_edition_credit_source_use_receipts where review_id='c9000000-0000-4000-8000-000000000010'),pg_temp.source_use(),'exact receipt retained without normalization');
select is(pg_temp.reviews()->'reviews'->0->'sourceUseReview',pg_temp.source_use(),'admin read returns sourceUseReview explicitly');
select is(pg_temp.reviews()->'reviews'->0->'decisions'->0->'eligible','true'::jsonb,'reviewed source use does not hold otherwise eligible credit');

-- Owner-only fixtures represent pre-migration pending reviews and elapsed/future receipt time.
-- They are never created by an API role and do not retrofit legacy history through the RPC.
select public.admin_prepare_edition_credits('c9000000-0000-4000-8000-000000000011',e.work_id,e.id,public.corpus_record_fingerprint(e.work_id),pg_temp.evidence())
from public.corpus_editions e where e.isbn='9780306406157';
select public.admin_prepare_edition_credits('c9000000-0000-4000-8000-000000000012',e.work_id,e.id,public.corpus_record_fingerprint(e.work_id),pg_temp.evidence())
from public.corpus_editions e where e.isbn='9780306406157';
select public.admin_prepare_edition_credits('c9000000-0000-4000-8000-000000000013',e.work_id,e.id,public.corpus_record_fingerprint(e.work_id),pg_temp.evidence())
from public.corpus_editions e where e.isbn='9780306406157';
insert into public.corpus_edition_credit_source_use_receipts(review_id,source_use) values
 ('c9000000-0000-4000-8000-000000000012',jsonb_set(pg_temp.source_use(),'{checkedAt}',to_jsonb(to_char((now()-interval '31 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')))),
 ('c9000000-0000-4000-8000-000000000013',jsonb_set(pg_temp.source_use(),'{checkedAt}',to_jsonb(to_char((now()+interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
select ok((r->'decisions'->0->'reasons') ? 'source_use_review_required','legacy pending review visibly requires source use')
from jsonb_array_elements(pg_temp.reviews()->'reviews') r where r->>'id'='c9000000-0000-4000-8000-000000000011';
select is(r->'sourceUseReview','null'::jsonb,'legacy receipt is explicitly null')
from jsonb_array_elements(pg_temp.reviews()->'reviews') r where r->>'id'='c9000000-0000-4000-8000-000000000011';
select ok((r->'decisions'->0->'reasons') ? 'source_use_stale' and r->'decisions'->0->'eligible'='false'::jsonb,'aged and future receipts visibly hold credits')
from jsonb_array_elements(pg_temp.reviews()->'reviews') r where r->>'id' in ('c9000000-0000-4000-8000-000000000012','c9000000-0000-4000-8000-000000000013');
create temp table before_source_use_holds as select pg_temp.write_count() n;
grant select on before_source_use_holds to authenticated;
set local role authenticated;
select throws_ok($$select public.admin_apply_edition_credits('c9000000-0000-4000-8000-000000000011',array[0],true)$$,'22023',null,'pending legacy review cannot newly apply');
select throws_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000011')$$,'PT409',null,'legacy review cannot be retrofitted with a receipt');
select throws_ok($$select public.admin_apply_edition_credits('c9000000-0000-4000-8000-000000000012',array[0],true)$$,'22023',null,'apply rechecks stale use before append');
select throws_ok($$select public.admin_apply_edition_credits('c9000000-0000-4000-8000-000000000013',array[0],true)$$,'22023',null,'apply rechecks future use before append');
select lives_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000012',jsonb_set(pg_temp.source_use(),'{checkedAt}',to_jsonb(to_char((now()-interval '31 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))))$$,'exact stale receipt retry remains read-only');
select is(pg_temp.write_count(),(select n from before_source_use_holds),'holds and stale exact retry perform no writes');
select lives_ok($$select public.admin_apply_edition_credits('c9000000-0000-4000-8000-000000000010',array[0,1,2,3],true)$$,'supported credits apply only after both reviews');
reset role;
select is((select credits from public.corpus_editions where isbn='9780306406157'),
 (select jsonb_agg(jsonb_build_object('reviewId','c9000000-0000-4000-8000-000000000010','position',n,'credit',pg_temp.evidence()->'credits'->n,
   'source',pg_temp.evidence()->'source','identity',pg_temp.evidence()->'identity') order by n) from generate_series(0,3) n),
 'accepted credit format, exact literal values, source order and identity remain unchanged');
create temp table after_source_use_apply as select pg_temp.write_count() n,credits from public.corpus_editions where isbn='9780306406157';
grant select on after_source_use_apply to authenticated;
set local role authenticated;
select lives_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010')$$,'exact prepare retry remains available after applied catalog fingerprint changed');
select lives_ok($$select public.admin_apply_edition_credits('c9000000-0000-4000-8000-000000000010',array[3,2,1,0],true)$$,'applied identical selection retry succeeds');
select is(pg_temp.write_count(),(select n from after_source_use_apply),'applied prepare/apply retries do not write');
reset role;
-- Simulate the retained historical state of an already-applied pre-migration review.
delete from public.corpus_edition_credit_source_use_receipts where review_id='c9000000-0000-4000-8000-000000000010';
create temp table before_legacy_retry as select pg_temp.write_count() n;
grant select on before_legacy_retry to authenticated;
set local role authenticated;
select lives_ok($$select public.admin_apply_edition_credits('c9000000-0000-4000-8000-000000000010',array[0,1,2,3],true)$$,'applied legacy identical retry needs no new receipt');
select throws_ok($$select public.admin_apply_edition_credits('c9000000-0000-4000-8000-000000000010',array[0],true)$$,'PT409',null,'applied legacy retry cannot change selection');
select throws_ok($$select pg_temp.prepare('c9000000-0000-4000-8000-000000000010')$$,'PT409',null,'applied legacy receipt cannot be fabricated through prepare');
select is(pg_temp.write_count(),(select n from before_legacy_retry),'legacy retries and conflicts perform no writes');
reset role;
select is((select credits from public.corpus_editions where isbn='9780306406157'),(select credits from after_source_use_apply),'accepted legacy credits preserved exactly');
select is(jsonb_build_array(
 (select to_jsonb(b) from public.books b where id='c9000000-0000-4000-8000-000000000002'),
 (select jsonb_agg(to_jsonb(r) order by id) from public.reads r where book_id='c9000000-0000-4000-8000-000000000002'),
 (select jsonb_agg(to_jsonb(a)) from public.book_authors a where book_id='c9000000-0000-4000-8000-000000000002'),
 (select to_jsonb(w) from public.works w where id='c9000000-0000-4000-8000-000000000001')),
 (select value from credits_protected),'personal book, reads, contributor relationships and work metadata stay byte-for-byte unchanged');
select * from finish();
rollback;
