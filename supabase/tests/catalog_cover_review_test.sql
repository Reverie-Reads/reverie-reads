begin;
select no_plan();

-- Check installed ACLs, then prove the reset also removes legacy platform named grants.
select ok(not has_table_privilege('anon', 'public.corpus_cover_reviews', 'SELECT'),
  'installed review table is private');
grant all on public.corpus_cover_reviews, public.corpus_cover_review_events
  to public, anon, authenticated;
select ok(has_table_privilege('anon', t, 'DELETE'), t || ' has a dirty legacy grant before reset')
from unnest(array['public.corpus_cover_reviews','public.corpus_cover_review_events']) t;
revoke all on public.corpus_cover_reviews, public.corpus_cover_review_events
  from public, anon, authenticated, service_role;
grant select on public.corpus_cover_reviews, public.corpus_cover_review_events to authenticated;
grant all on public.corpus_cover_reviews, public.corpus_cover_review_events to service_role;
-- Test each capability, not only a successful SELECT under the clean local defaults.
select ok(not has_table_privilege('anon', t, op), t || ' refuses anonymous ' || op)
from unnest(array['public.corpus_cover_reviews','public.corpus_cover_review_events']) t
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) op;
select ok(not has_table_privilege('authenticated', t, op), t || ' refuses direct reader ' || op)
from unnest(array['public.corpus_cover_reviews','public.corpus_cover_review_events']) t
cross join unnest(array['INSERT','UPDATE','DELETE']) op;
select ok(has_table_privilege('service_role', t, op), t || ' permits maintenance ' || op)
from unnest(array['public.corpus_cover_reviews','public.corpus_cover_review_events']) t
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) op;
select ok(not has_function_privilege('anon', f, 'EXECUTE'), f || ' has no anonymous grant')
from unnest(array[
 'public.admin_list_corpus_cover_reviews(text,text,integer,integer,uuid)',
 'public.admin_review_corpus_cover(uuid,text,integer,text,text,text,jsonb,boolean,jsonb)',
 'public.corpus_cover_review_fingerprint(public.works)']) f;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('72111111-1111-4111-8111-111111111111','authenticated','authenticated','cover-review-admin@example.com','{}','{}',now(),now()),
 ('72222222-2222-4222-8222-222222222222','authenticated','authenticated','cover-review-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values ('72111111-1111-4111-8111-111111111111');
insert into public.works(id, work_key, title, author_text, contributors, cover_url, cover_source)
values
 ('72000000-0000-4000-8000-000000000001', public.library_work_key('Review Current','Review Writer'), 'Review Current', 'Review Writer', '[{"name":"Review Writer","role":"author"}]', 'https://books.google.com/books/content?id=review-old&img=1', 'google'),
 ('72000000-0000-4000-8000-000000000002', public.library_work_key('Review Missing','Review Writer'), 'Review Missing', 'Review Writer', '[{"name":"Review Writer","role":"author"}]', null, null);
insert into public.books(id, owner_id, corpus_work_id, title, authors_display, cover_url,
  cover_source, cover_user_chosen, ownership)
values ('72000000-0000-4000-8000-000000000003', '72222222-2222-4222-8222-222222222222',
 '72000000-0000-4000-8000-000000000001', 'Review Current', 'Review Writer',
 'https://books.google.com/books/content?id=personal-keep&img=1', 'google', true, 'owned');
create temporary table cover_review_baseline as
select id, public.corpus_cover_review_fingerprint(w) as fingerprint from public.works w
where id in ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002');
grant select on cover_review_baseline to authenticated;
create temporary table personal_cover_baseline as
select to_jsonb(b) as row_value from public.books b where id = '72000000-0000-4000-8000-000000000003';

set local role anon;
select throws_ok($$select public.admin_list_corpus_cover_reviews()$$, '42501', null, 'anonymous queue access fails at the grant layer');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"72222222-2222-4222-8222-222222222222","role":"authenticated","iss":"http://127.0.0.1:55321/auth/v1"}', true);
select throws_ok($$select public.admin_list_corpus_cover_reviews()$$, '42501', 'corpus administrator required', 'ordinary readers cannot inspect the queue');
select throws_ok($$select public.admin_review_corpus_cover('72000000-0000-4000-8000-000000000001','x',0,'keep')$$, '42501', 'corpus administrator required', 'ordinary readers cannot approve shared covers');

select set_config('request.jwt.claims','{"sub":"72111111-1111-4111-8111-111111111111","role":"authenticated","iss":"http://127.0.0.1:55321/auth/v1"}', true);
select is((public.admin_list_corpus_cover_reviews('all','Review ',0,20)->>'total')::int, 2, 'administrator sees real catalog rows without personal copies');
select is(jsonb_array_length(public.admin_list_corpus_cover_reviews('all','Review ',0,1)->'items'), 1, 'queue respects its page size');
select is(public.admin_list_corpus_cover_reviews('all','Review ',0,1)->'items'->0->>'title','Review Missing','missing images are prioritized');
select is(public.admin_list_corpus_cover_reviews('all','Review ',1,1)->'items'->0->>'title','Review Current','next page advances without repeating the first book');
select is((select count(*)::int from public.corpus_cover_reviews),0,'opening the queue is read-only');
select throws_ok($$select public.admin_list_corpus_cover_reviews('all','',0,26)$$,'22023','invalid review queue request','unbounded pages are refused');
select throws_ok($$select public.admin_review_corpus_cover('72000000-0000-4000-8000-000000000001','stale',0,'keep')$$,'P0001','This catalog record or review changed. Refresh before deciding.','stale catalog state cannot be approved');
select throws_ok($$select public.admin_review_corpus_cover('72000000-0000-4000-8000-000000000001',(select fingerprint from cover_review_baseline where id='72000000-0000-4000-8000-000000000001'),0,'keep')$$,'22023','confirm the cover identity and load its image before approval','approval requires explicit identity confirmation and a loaded image');
select throws_ok($$select public.admin_review_corpus_cover('72000000-0000-4000-8000-000000000002',(select fingerprint from cover_review_baseline where id='72000000-0000-4000-8000-000000000002'),0,'keep','',null,'{"url":"https://example.test/cover","width":800,"height":1200}',true)$$,'22023','a missing cover cannot be approved','invented measurements cannot approve a missing cover');

select lives_ok($$select public.admin_review_corpus_cover('72000000-0000-4000-8000-000000000001',(select fingerprint from cover_review_baseline where id='72000000-0000-4000-8000-000000000001'),0,'flag','Printed author disagrees','identity')$$,'administrator records an identity concern');
select is(public.admin_list_corpus_cover_reviews('attention','Review ',0,1)->'items'->0->>'title','Review Current','recorded identity concerns precede missing covers');
select is((select revision from public.corpus_cover_reviews where work_id='72000000-0000-4000-8000-000000000001'),1,'review revision is durable');
select throws_ok($$select public.admin_review_corpus_cover('72000000-0000-4000-8000-000000000001',(select fingerprint from cover_review_baseline where id='72000000-0000-4000-8000-000000000001'),0,'defer')$$,'P0001','This catalog record or review changed. Refresh before deciding.','two reviews of the same unchanged image cannot silently overwrite each other');
select lives_ok($$select public.admin_review_corpus_cover('72000000-0000-4000-8000-000000000001',(select fingerprint from cover_review_baseline where id='72000000-0000-4000-8000-000000000001'),1,'defer','Awaiting edition evidence','identity')$$,'deferral persists without replacing the cover');
select is((public.admin_list_corpus_cover_reviews('deferred','Review ')->>'total')::int,1,'deferred work remains findable');

select throws_ok($$select public.admin_review_corpus_cover('72000000-0000-4000-8000-000000000001',(select fingerprint from cover_review_baseline where id='72000000-0000-4000-8000-000000000001'),2,'replace','',null,'{"url":"https://evil.test/cover","width":800,"height":1200}',true,'{"url":"https://evil.test/cover","source":"hardcover"}')$$,'22023','shared covers must use the corpus cover ingestion pipeline','replacement cannot introduce arbitrary remote art');
select lives_ok($$select public.admin_review_corpus_cover('72000000-0000-4000-8000-000000000001',(select fingerprint from cover_review_baseline where id='72000000-0000-4000-8000-000000000001'),2,'replace','Visually checked this edition',null,'{"url":"https://books.google.com/books/content?id=review-new&img=1","width":800,"height":1200}',true,'{"url":"https://books.google.com/books/content?id=review-new&img=1","source":"google"}')$$,'reviewed linked Google cover is selected through the existing boundary');
select is((public.admin_list_corpus_cover_reviews('approved','Review ')->>'total')::int,1,'approved record leaves attention and enters reviewed');
select is((select count(*)::int from public.corpus_cover_review_events where work_id='72000000-0000-4000-8000-000000000001'),3,'every successful decision has history and refused decisions do not');
select is((select measurement->>'basis' from public.corpus_cover_reviews where work_id='72000000-0000-4000-8000-000000000001'),'browser_decode','measurement is explicitly a browser observation');

reset role;
select is((select to_jsonb(b) from public.books b where id='72000000-0000-4000-8000-000000000003'),(select row_value from personal_cover_baseline),'every personal field remains byte-for-byte unchanged');
select is((select cover_url from public.works where id='72000000-0000-4000-8000-000000000001'),'https://books.google.com/books/content?id=review-new&img=1','shared default changed to the selected image');
select ok(exists(select 1 from public.work_metadata_edits where work_id='72000000-0000-4000-8000-000000000001' and next_value->>'coverUrl'='https://books.google.com/books/content?id=review-new&img=1'),'existing shared-cover edit audit is retained');
update public.works set author_text='Corrected Author' where id='72000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.admin_list_corpus_cover_reviews('attention','Review Current')->'items'->0->>'state','unreviewed','a changed identity makes the prior approval stale');
select is((select count(*)::int from public.corpus_cover_review_events),3,'stale reviews retain history');
select set_config('request.jwt.claims','{"sub":"72222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select is((select count(*)::int from public.corpus_cover_reviews),0,'RLS hides administrator notes from ordinary readers');
select is((select count(*)::int from public.corpus_cover_review_events),0,'RLS hides review history from ordinary readers');
reset role;
delete from public.corpus_admins where user_id='72111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"72111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select throws_ok($$select public.admin_list_corpus_cover_reviews()$$,'42501','corpus administrator required','revoked administrators lose queue access');
select throws_ok($$select public.admin_review_corpus_cover('72000000-0000-4000-8000-000000000001','anything',3,'reopen')$$,'42501','corpus administrator required','revoked administrators cannot complete a previously opened review');

reset role;
select is((select next_value->'identity'->>'title' from public.corpus_cover_review_events
 where work_id='72000000-0000-4000-8000-000000000001' and action='replace'),
 'Review Current', 'history retains the identity that was reviewed even after catalog edits');
select * from finish();
rollback;
