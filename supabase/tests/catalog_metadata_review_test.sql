begin;
select no_plan();

select ok(not has_table_privilege('anon',t,op), t || ' installed anon ' || op || ' denied')
from unnest(array['public.corpus_metadata_reviews','public.corpus_metadata_review_events']) t
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) op;
select ok(not has_table_privilege('authenticated',t,op), t || ' installed direct ' || op || ' denied')
from unnest(array['public.corpus_metadata_reviews','public.corpus_metadata_review_events']) t
cross join unnest(array['INSERT','UPDATE','DELETE']) op;
-- Dirty the legacy default grants, then exercise the migration's exact reset and intended grants.
grant all on public.corpus_metadata_reviews, public.corpus_metadata_review_events to public, anon, authenticated;
select ok(has_table_privilege('anon', 'public.corpus_metadata_reviews','DELETE'),'dirty grant is present');
revoke all on public.corpus_metadata_reviews, public.corpus_metadata_review_events from public, anon, authenticated, service_role;
grant select on public.corpus_metadata_reviews, public.corpus_metadata_review_events to authenticated;
grant all on public.corpus_metadata_reviews, public.corpus_metadata_review_events to service_role;
select ok(has_table_privilege(r,t,op) = (r='service_role' or (r='authenticated' and op='SELECT')),t || ' reset ' || r || ' ' || op)
from unnest(array['public.corpus_metadata_reviews','public.corpus_metadata_review_events']) t
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) op
cross join unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege('authenticated','public.catalog_review_isbns(text[])','EXECUTE'),'normalization helper is not a reader endpoint');
select ok(not has_function_privilege('anon', f, 'EXECUTE'),f || ' anonymous execute denied')
from unnest(array['public.admin_list_corpus_metadata_reviews(text,text,text,integer,integer,uuid)',
'public.admin_review_corpus_metadata(uuid,text,integer,text,text,text,text,boolean)',
'public.catalog_metadata_review_record(public.works)','public.catalog_review_isbns(text[])']) f;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('73111111-1111-4111-8111-111111111111','authenticated','authenticated','metadata-admin@example.com','{}','{}',now(),now()),
('73222222-2222-4222-8222-222222222222','authenticated','authenticated','metadata-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('73111111-1111-4111-8111-111111111111');
insert into public.works(id,work_key,title,author_text,contributors,isbns,description) values
('73000000-0000-4000-8000-000000000001',public.library_work_key('Metadata Review One','Test Writer'),'Metadata Review One','Test Writer','[{"name":"Test Writer","role":"author"}]','{}',null);
insert into public.books(id,owner_id,corpus_work_id,title,authors_display,ownership) values
('73000000-0000-4000-8000-000000000005','73222222-2222-4222-8222-222222222222','73000000-0000-4000-8000-000000000001','Metadata Review One','Test Writer','unowned');
insert into public.works(id,work_key,title,author_text,contributors,isbns,description) values

('73000000-0000-4000-8000-000000000002','metadata-test-b','Metadata Review ONE!','Test Writer','[{"name":"Test Writer","role":"author"}]','{}','Existing description'),
('73000000-0000-4000-8000-000000000003','metadata-test-c','Metadata Review Different','Other Writer','[{"name":"Other Writer","role":"author"}]','{}','Description'),
('73000000-0000-4000-8000-000000000004','metadata-test-d','Metadata Review Healthy','Test Writer','[{"name":"Test Writer","role":"author"}]','{}','Description');
-- Simulate historical corrupt ISBN data predating the write guard. Disable only that guard within
-- this rolled-back fixture, not the triggers under test for description corrections.
alter table public.works disable trigger works_validate_isbn_assignment;
update public.works set isbns=array['9780306406157','bad-isbn'] where id='73000000-0000-4000-8000-000000000001';
update public.works set isbns=array['0306406152'] where id='73000000-0000-4000-8000-000000000003';
insert into public.works(id,work_key,title,author_text,isbns,description) values
('73000000-0000-4000-8000-000000000006','metadata-unnamed-a','Unnamed identity','','{9780140449136}','Description'),
('73000000-0000-4000-8000-000000000007','metadata-unnamed-b','Unnamed identity','','{9780140449136}','Description');
alter table public.works enable trigger works_validate_isbn_assignment;
create temporary table metadata_baseline as select to_jsonb(b) as value from public.books b where id='73000000-0000-4000-8000-000000000005';
create temporary table metadata_snapshot as select id,to_jsonb(w) as original,public.catalog_metadata_review_record(w)->>'fingerprint' as fingerprint from public.works w where id='73000000-0000-4000-8000-000000000001';
grant select on metadata_snapshot to authenticated;
set local role anon;
select throws_ok($$select public.admin_list_corpus_metadata_reviews()$$,'42501',null,'anonymous request refused at execute boundary');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"73222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select throws_ok($$select public.admin_list_corpus_metadata_reviews()$$,'42501','corpus administrator required','reader cannot inspect queue');
select throws_ok($$select public.admin_review_corpus_metadata('73000000-0000-4000-8000-000000000001','x',0,'defer')$$,'42501','corpus administrator required','reader cannot write reviews');
select set_config('request.jwt.claims','{"sub":"73111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select is((public.admin_list_corpus_metadata_reviews('attention','isbn_conflict','Metadata Review')->>'total')::int,2,'ISBN-10/13-equivalent historical conflict found');
select is((public.admin_list_corpus_metadata_reviews('attention','duplicate_identity','Metadata Review')->>'total')::int,2,'exact title/full-author candidates found');
select is((public.admin_list_corpus_metadata_reviews('attention','duplicate_identity','Unnamed identity')->>'total')::int,0,'missing author cannot establish duplicate identity even when ISBNs conflict');
select is((public.admin_list_corpus_metadata_reviews('attention','invalid_isbn','Metadata Review')->>'total')::int,1,'invalid ISBN reported separately');
select is(jsonb_array_length(public.admin_list_corpus_metadata_reviews('all','all','',0,20,'73000000-0000-4000-8000-000000000004')->'items'->0->'issues'),0,'a missing ISBN is not an identity error');
select is((public.admin_list_corpus_metadata_reviews('attention','description','Metadata Review')->>'total')::int,1,'missing description queue');
select is((public.admin_list_corpus_metadata_reviews('all','all','',0,1,'73000000-0000-4000-8000-000000000001')->'items'->0->>'relatedTotal')::int,2,'related evidence spans ISBN and normalized identity');
select is(jsonb_array_length(public.admin_list_corpus_metadata_reviews('all','all','Metadata Review',0,1)->'items'),1,'page size is enforced');
select throws_ok($$select public.admin_list_corpus_metadata_reviews('all','all','',0,26)$$,'22023','invalid metadata queue request','oversized page rejected');
select throws_ok($$select public.admin_review_corpus_metadata('73000000-0000-4000-8000-000000000001',(select fingerprint from metadata_snapshot),0,'description','Checked','https://publisher.example/book','A checked synopsis',false)$$,'22023',null,'description requires identity confirmation');
select throws_ok($$select public.admin_review_corpus_metadata('73000000-0000-4000-8000-000000000001',(select fingerprint from metadata_snapshot),0,'description','Checked','','A checked synopsis',true)$$,'22023',null,'description requires a source');
select throws_ok($$select public.admin_review_corpus_metadata('73000000-0000-4000-8000-000000000001',(select fingerprint from metadata_snapshot),0,'description','Checked','javascript:alert(1)','A checked synopsis',true)$$,'22023',null,'unsafe evidence links rejected');
select lives_ok($$select public.admin_review_corpus_metadata('73000000-0000-4000-8000-000000000001',(select fingerprint from metadata_snapshot),0,'description','Checked publisher identity','https://publisher.example/book','A checked synopsis',true)$$,'administrator corrects description with evidence');
select is((public.admin_list_corpus_metadata_reviews('attention','description','Metadata Review')->>'total')::int,0,'description repair leaves missing queue');
select is((public.admin_list_corpus_metadata_reviews('attention','isbn_conflict','Metadata Review')->>'total')::int,2,'description correction does not dismiss identity concerns');
select throws_ok($$select public.admin_review_corpus_metadata('73000000-0000-4000-8000-000000000001',(select fingerprint from metadata_snapshot),0,'defer')$$,'P0001',null,'stale description/revision refused');
reset role;
select is((select to_jsonb(b) from public.books b where id='73000000-0000-4000-8000-000000000005'),(select value from metadata_baseline),'all personal fields remain unchanged');
select is((select to_jsonb(w) - array['description','updated_at','metadata_provenance'] from public.works w where id='73000000-0000-4000-8000-000000000001'),
  (select original - array['description','updated_at','metadata_provenance'] from metadata_snapshot),'description correction changes no unrelated corpus field');
select is((select metadata_provenance->'description'->>'sourceRef' from public.works where id='73000000-0000-4000-8000-000000000001'),'https://publisher.example/book','manual description source replaces stale provider attribution');
select is((select next_value->>'description' from public.work_metadata_edits where work_id='73000000-0000-4000-8000-000000000001' order by created_at desc limit 1),'A checked synopsis','public edit history records correction');
update metadata_snapshot set fingerprint=(select public.catalog_metadata_review_record(w)->>'fingerprint' from public.works w where w.id=metadata_snapshot.id);
set local role authenticated;
select lives_ok($$select public.admin_review_corpus_metadata('73000000-0000-4000-8000-000000000001',(select fingerprint from metadata_snapshot),1,'defer','Need edition evidence')$$,'defer keeps unresolved record findable');
select is((public.admin_list_corpus_metadata_reviews('deferred','all','Metadata Review')->>'total')::int,1,'deferred queue persists');
select throws_ok($$select public.admin_review_corpus_metadata('73000000-0000-4000-8000-000000000001',(select fingerprint from metadata_snapshot),1,'reviewed','Checked','',null,true)$$,'P0001',null,'concurrent assessment cannot overwrite newer deferral');
select lives_ok($$select public.admin_review_corpus_metadata('73000000-0000-4000-8000-000000000001',(select fingerprint from metadata_snapshot),2,'reviewed','Edition evidence retained for owner repair','https://publisher.example/book',null,true)$$,'explicit assessment persists separately from correction');
select is((public.admin_list_corpus_metadata_reviews('reviewed','all','Metadata Review')->>'total')::int,1,'assessed queue retains unresolved concerns');
reset role;
update public.works set publisher='New peer evidence' where id='73000000-0000-4000-8000-000000000002';
set local role authenticated;
select is(public.admin_list_corpus_metadata_reviews('all','all','',0,20,'73000000-0000-4000-8000-000000000001')->'items'->0->>'state','open','changed related evidence reopens old assessment');
select throws_ok($$select public.admin_review_corpus_metadata('73000000-0000-4000-8000-000000000001',(select fingerprint from metadata_snapshot),3,'defer')$$,'P0001',null,'changed peer evidence rejects stale assessment');
select set_config('request.jwt.claims','{"sub":"73222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select is((select count(*)::int from public.corpus_metadata_reviews),0,'reader cannot see assessment notes');
select is((select count(*)::int from public.corpus_metadata_review_events),0,'reader cannot see history');
reset role;
select is((select count(*)::int from public.corpus_metadata_review_events),3,'only successful decisions have audit events');
select is((select count(*)::int from public.works where id in ('73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000003')),3,'possible duplicates were never merged or deleted');
delete from public.corpus_admins where user_id='73111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"73111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select throws_ok($$select public.admin_review_corpus_metadata('73000000-0000-4000-8000-000000000001','x',3,'defer')$$,'42501','corpus administrator required','revoked administrator cannot finish opened review');
reset role;
select * from finish();
rollback;
