begin;
select no_plan();
select ok(not has_table_privilege(r,'public.corpus_edition_credit_reviews',p),r||' cannot directly '||p||' reviews')
from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(not has_function_privilege(r,f,'EXECUTE'),r||' cannot execute '||f)
from unnest(array['anon','service_role']) r cross join unnest(array[
 'public.admin_get_edition_credit_reviews(uuid,uuid)', 'public.admin_prepare_edition_credits(uuid,uuid,uuid,text,jsonb)',
 'public.admin_prepare_reviewed_edition_credits(uuid,uuid,uuid,text,jsonb,jsonb)',
 'public.admin_apply_edition_credits(uuid,integer[],boolean)']) f;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('c8111111-1111-4111-8111-111111111111','authenticated','authenticated','credits-admin@example.com','{}','{}',now(),now()),
('c8222222-2222-4222-8222-222222222222','authenticated','authenticated','credits-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('c8111111-1111-4111-8111-111111111111');
insert into public.works(id,work_key,title,author_text,contributors,isbns) values
('c8000000-0000-4000-8000-000000000001','credits fixture','Still Waters','Jane Smith','[{"name":"Jane Smith","role":"author"}]','{9780306406157}');
insert into public.books(id,owner_id,corpus_work_id,title,authors_display,isbn,ownership) values
('c8000000-0000-4000-8000-000000000002','c8222222-2222-4222-8222-222222222222','c8000000-0000-4000-8000-000000000001','Personal title','Personal Writer','9780306406157','owned');
insert into public.reads(book_id,owner_id,read_on,format,notes) values
('c8000000-0000-4000-8000-000000000002','c8222222-2222-4222-8222-222222222222','2025-01-01','physical','Private reading history');
insert into public.authors(id,owner_id,name,name_key) values
('c8000000-0000-4000-8000-000000000003','c8222222-2222-4222-8222-222222222222','Personal Writer','personal writer');
insert into public.book_authors(book_id,author_id,owner_id,position,role) values
('c8000000-0000-4000-8000-000000000002','c8000000-0000-4000-8000-000000000003','c8222222-2222-4222-8222-222222222222',0,'author');
create temp table credits_protected as select jsonb_build_array(
 (select to_jsonb(b) from public.books b where id='c8000000-0000-4000-8000-000000000002'),
 (select jsonb_agg(to_jsonb(r) order by id) from public.reads r where book_id='c8000000-0000-4000-8000-000000000002'),
 (select jsonb_agg(to_jsonb(a)) from public.book_authors a where book_id='c8000000-0000-4000-8000-000000000002'),
 (select to_jsonb(w) from public.works w where id='c8000000-0000-4000-8000-000000000001')) value;
create function pg_temp.evidence() returns jsonb language sql as $$
 select jsonb_build_object('version',1,'source',jsonb_build_object('url','https://publisher.example/edition','kind','publisher','checkedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'locator','Edition credits','retentionConfirmed',true),
 'identity',jsonb_build_object('title','Still Waters','authors',jsonb_build_array('Jane Smith'),'isbn','9780306406157','format',null,'language',null),
 'credits','[{"name":"Jane Smith","role":"author","scope":"whole","sourceRole":"Written by","basis":"edition"},{"name":"Ann Brown","role":"translator","scope":"whole","sourceRole":" Translator ","basis":"edition"},{"name":"Ann Brown","role":"introduction","scope":"whole","sourceRole":"Introduction by","basis":"edition"},{"name":"Chris Pine","role":"author","scope":"part","part":"A story","sourceRole":"Story by","basis":"edition"},{"name":"Unclear Person","role":"unknown","scope":"whole","sourceRole":null,"basis":"work"}]'::jsonb,
 'confirmations','{"sourceChecked":true,"identityChecked":true,"creditsChecked":true}'::jsonb);
$$;
create function pg_temp.prepare(p_review_id uuid,v jsonb default pg_temp.evidence()) returns jsonb language sql security definer as $$
 select public.admin_prepare_reviewed_edition_credits(p_review_id,'c8000000-0000-4000-8000-000000000001',e.id,
 public.corpus_record_fingerprint(e.work_id),v,jsonb_build_object('version',1,'basis','public_terms',
 'url','https://publisher.example/terms','note','Synthetic terms fixture permits retaining these identity and credit facts.',
 'checkedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'scope','edition_identity_and_credit_facts','confirmed',true)) from public.corpus_editions e where e.isbn='9780306406157';
$$;
select ok(public.edition_credit_evidence_valid(pg_temp.evidence()),'valid manual evidence including held credit');
select ok(not public.edition_credit_evidence_valid(pg_temp.evidence()||'{"privateNotes":"no"}'),'private fields refused');
select ok(not public.edition_credit_evidence_valid(jsonb_set(pg_temp.evidence(),'{source,retentionConfirmed}','false')),'retention required before storage');
select ok(not public.edition_credit_evidence_valid(jsonb_set(pg_temp.evidence(),'{source,url}','"javascript:alert(1)"')),'unsafe URL refused');
select ok(public.edition_credit_ambiguous('J. Smith'),'initial-only identity held');
select ok(not public.edition_credit_ambiguous('Jane Smith'),'full name not initial-only');
select set_config('request.jwt.claim.sub','c8222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select throws_ok($$select pg_temp.prepare('c8000000-0000-4000-8000-000000000010')$$,'42501','corpus administrator required','ordinary reader cannot stage');
select throws_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000010',array[0],true)$$,'42501','corpus administrator required','ordinary reader cannot publish');
select throws_ok($$select public.admin_get_edition_credit_reviews('c8000000-0000-4000-8000-000000000001',null)$$,'42501','corpus administrator required','ordinary reader cannot inspect pending evidence');
select set_config('request.jwt.claim.sub','c8111111-1111-4111-8111-111111111111',true);
select lives_ok($$select pg_temp.prepare('c8000000-0000-4000-8000-000000000010')$$,'administrator freezes review');
select lives_ok($$select pg_temp.prepare('c8000000-0000-4000-8000-000000000010')$$,'identical stage retry reads existing review');
select throws_ok($$select pg_temp.prepare('c8000000-0000-4000-8000-000000000010',jsonb_set(pg_temp.evidence(),'{credits,0,name}','"Different Person"'))$$,'PT409',null,'same ID cannot change reviewed payload');
select throws_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000010',array[0],false)$$,'22023',null,'explicit confirmation required');
select throws_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000010',array[4],true)$$,'22023',null,'unknown work-scoped credit stays held');
select throws_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000010',array[0,0],true)$$,'22023',null,'duplicate selection refused');
select throws_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000010',array[99],true)$$,'22023',null,'out-of-range selection refused');
select lives_ok($$select pg_temp.prepare('c8000000-0000-4000-8000-000000000011')$$,'second draft freezes same catalog revision');
select lives_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000010',array[0,1,2,3],true)$$,'supported selected credits save atomically');
select lives_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000010',array[3,2,1,0],true)$$,'lost response retry is read-only and order independent');
select throws_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000010',array[0],true)$$,'PT409',null,'saved review cannot change selection');
select throws_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000011',array[0],true)$$,'PT409',null,'stale concurrent review cannot overwrite');
reset role;
select is((select count(*)::int from public.corpus_edition_credit_reviews),2,'retries create no duplicate reviews');
select is((select jsonb_array_length(credits) from public.corpus_editions where isbn='9780306406157'),4,'one copy of each selected credit');
select is((select credits->1->'credit'->>'sourceRole' from public.corpus_editions where isbn='9780306406157'),' Translator ','literal source role retained');
select is((select credits->2->'credit'->>'role' from public.corpus_editions where isbn='9780306406157'),'introduction','unsupported personal role retained losslessly');
select is((select credits->3->'credit'->>'part' from public.corpus_editions where isbn='9780306406157'),'A story','named part retained');
select is((select evidence->'credits'->4->>'role' from public.corpus_edition_credit_reviews where id='c8000000-0000-4000-8000-000000000010'),'unknown','unselected unsupported evidence remains under review');
select is(jsonb_build_array(
 (select to_jsonb(b) from public.books b where id='c8000000-0000-4000-8000-000000000002'),
 (select jsonb_agg(to_jsonb(r) order by id) from public.reads r where book_id='c8000000-0000-4000-8000-000000000002'),
 (select jsonb_agg(to_jsonb(a)) from public.book_authors a where book_id='c8000000-0000-4000-8000-000000000002'),
 (select to_jsonb(w) from public.works w where id='c8000000-0000-4000-8000-000000000001')),
 (select value from credits_protected),'every personal column, contributor, read and work value preserved');
select ok((public.edition_credit_decisions('c8000000-0000-4000-8000-000000000001',(select id from public.corpus_editions where isbn='9780306406157'),pg_temp.evidence())->0->'reasons') ? 'existing_credit','existing credit cannot be re-added from a new review');
select ok((public.edition_credit_decisions('c8000000-0000-4000-8000-000000000001',(select id from public.corpus_editions where isbn='9780306406157'),jsonb_set(pg_temp.evidence(),'{identity,authors}','["Other Author"]'))->0->'reasons') ? 'identity_conflict','exact ISBN never defeats wrong author');
select ok((public.edition_credit_decisions('c8000000-0000-4000-8000-000000000001',(select id from public.corpus_editions where isbn='9780306406157'),jsonb_set(pg_temp.evidence(),'{identity,isbn}','"9780140449136"'))->0->'reasons') ? 'isbn_conflict','different edition held');
select ok((public.edition_credit_decisions('c8000000-0000-4000-8000-000000000001',(select id from public.corpus_editions where isbn='9780306406157'),jsonb_set(pg_temp.evidence(),'{source,kind}','"unverified"'))->0->'reasons') ? 'source_unverified','unverified source held');
select ok((public.edition_credit_decisions('c8000000-0000-4000-8000-000000000001',(select id from public.corpus_editions where isbn='9780306406157'),jsonb_set(pg_temp.evidence(),'{source,checkedAt}','"2000-01-01T00:00:00Z"'))->0->'reasons') ? 'stale_evidence','old inspection held');
select ok((public.edition_credit_decisions('c8000000-0000-4000-8000-000000000001',(select id from public.corpus_editions where isbn='9780306406157'),jsonb_set(pg_temp.evidence(),'{confirmations,creditsChecked}','false'))->0->'reasons') ? 'confirmation_missing','source inspection is required');
update public.corpus_editions set details='{"pages":100}' where isbn='9780306406157';
select ok((select bool_and(c->'reviewRequired' is distinct from 'true'::jsonb) from public.corpus_editions e cross join lateral jsonb_array_elements(e.credits) c where e.isbn='9780306406157'),'page-count correction does not invalidate unrelated contributor evidence');
update public.corpus_editions set details='{"format":"paperback","language":"English"}' where isbn='9780306406157';
select ok((select bool_and(c->'reviewRequired'='true'::jsonb) from public.corpus_editions e cross join lateral jsonb_array_elements(e.credits) c where e.isbn='9780306406157'),'later edition identity changes hold all historical credits');
select is((select credits->1->'credit'->>'sourceRole' from public.corpus_editions where isbn='9780306406157'),' Translator ','withdrawal preserves original evidence');
select ok((public.edition_credit_decisions('c8000000-0000-4000-8000-000000000001',(select id from public.corpus_editions where isbn='9780306406157'),jsonb_set(pg_temp.evidence(),'{identity,format}','"hardcover"'))->0->'reasons') ? 'edition_conflict','format conflict held');
select ok((public.edition_credit_decisions('c8000000-0000-4000-8000-000000000001',(select id from public.corpus_editions where isbn='9780306406157'),jsonb_set(pg_temp.evidence(),'{identity,language}','"French"'))->0->'reasons') ? 'edition_conflict','language conflict held');
set local role authenticated;
select lives_ok($$select pg_temp.prepare('c8000000-0000-4000-8000-000000000012')$$,'fresh review may re-establish a historical credit');
select lives_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000012',array[0],true)$$,'fresh supported confirmation appends without deleting held history');
reset role;
select is((select jsonb_array_length(credits) from public.corpus_editions where isbn='9780306406157'),5,'revalidation preserves historical copies plus one current credit');
update public.works set title='Corrected work title' where id='c8000000-0000-4000-8000-000000000001';
select ok((select bool_and(c->'reviewRequired'='true'::jsonb) from public.corpus_editions e cross join lateral jsonb_array_elements(e.credits) c where e.isbn='9780306406157'),'work identity correction also withdraws current credit qualification');
update public.works set title='Still Waters' where id='c8000000-0000-4000-8000-000000000001';
select ok((select bool_and(c->'reviewRequired'='true'::jsonb) from public.corpus_editions e cross join lateral jsonb_array_elements(e.credits) c where e.isbn='9780306406157'),'returning an old title never silently revives credit qualification');
set local role authenticated;
select lives_ok($$select pg_temp.prepare('c8000000-0000-4000-8000-000000000013'); select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000013',array[0],true)$$,'another deliberately confirmed current review succeeds');
reset role;
update public.corpus_editions set isbn=null where isbn='9780306406157';
select ok((select bool_and(c->'reviewRequired'='true'::jsonb) from public.corpus_editions e cross join lateral jsonb_array_elements(e.credits) c where e.work_id='c8000000-0000-4000-8000-000000000001'),'ISBN removal holds accepted credits without losing them');
select is((select to_jsonb(b) from public.books b where id='c8000000-0000-4000-8000-000000000002'),(select value->0 from credits_protected),'later shared identity edits preserve the whole personal book');
insert into public.corpus_admins(user_id) values('c8222222-2222-4222-8222-222222222222');
select set_config('request.jwt.claim.sub','c8222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select throws_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000010',array[0,1,2,3],true)$$,'P0002',null,'another administrator cannot reuse the reviewed confirmation');
reset role;
select set_config('request.jwt.claim.sub','c8111111-1111-4111-8111-111111111111',true);
delete from public.corpus_admins where user_id='c8111111-1111-4111-8111-111111111111';
set local role authenticated;
select throws_ok($$select public.admin_apply_edition_credits('c8000000-0000-4000-8000-000000000010',array[0,1,2,3],true)$$,'42501',null,'revocation blocks even an identical retry');
reset role;
select * from finish();
rollback;
