begin;
select no_plan();
select ok(not has_function_privilege(role_name,'public.admin_push_corpus_record(uuid,text,jsonb,text,text,text)','EXECUTE'),role_name||' cannot push') from unnest(array['anon','service_role']) role_name;
select ok(not has_function_privilege(role_name,'corpus_admin_private.apply_corpus_record_change(uuid,text,text,jsonb,text,text,boolean,text)','EXECUTE'),role_name||' cannot call internal writer') from unnest(array['anon','authenticated','service_role']) role_name;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('c9111111-1111-4111-8111-111111111111','authenticated','authenticated','push-admin@example.com','{}','{}',now(),now()),
('c9222222-2222-4222-8222-222222222222','authenticated','authenticated','push-reader@example.com','{}','{"corpus_admin":true}',now(),now());
insert into public.corpus_admins(user_id) values('c9111111-1111-4111-8111-111111111111');
insert into public.works(id,work_key,title,author_text,contributors,isbns,genre,genres,subgenre,subgenres,shared_spice,shared_darkness) values
('c9000000-0000-4000-8000-000000000001','batch push fixture','Batch Push','Writer','[{"name":"Writer","role":"author"}]','{9780306406157}','fantasy','{fantasy}','Epic','{Epic}',3,4),
('c9000000-0000-4000-8000-000000000002','other batch work','Other','Writer','[{"name":"Writer","role":"author"}]','{9780143117841}',null,'{}',null,'{}',null,null);
insert into public.books(id,owner_id,corpus_work_id,title,authors_display,isbn,pages,intensity,darkness,rating) values
('c9000000-0000-4000-8000-000000000003','c9222222-2222-4222-8222-222222222222','c9000000-0000-4000-8000-000000000001','Private title','Writer','9780306406157',123,5,2,4);
create temp table push_personal_before as select to_jsonb(b) value from public.books b where id='c9000000-0000-4000-8000-000000000003';
create function pg_temp.push_changes(pages integer default 250,spice integer default 0) returns jsonb language sql security definer as $$
  select jsonb_build_array(
    jsonb_build_object('action','guidance','value',jsonb_build_object('genres',array['horror'],'subgenres',array['Epic'],'spice',spice,'darkness',4)),
    jsonb_build_object('action','edition','value',jsonb_build_object('id',(select id from public.corpus_editions where isbn='9780306406157'),'isbn','9780306406157','details',jsonb_build_object('pages',pages))));
$$;
create function pg_temp.push_save(changes jsonb,mode text default 'direct',source text default null,note text default null) returns uuid language sql security definer as $$
 select public.admin_push_corpus_record('c9000000-0000-4000-8000-000000000001',public.corpus_record_fingerprint('c9000000-0000-4000-8000-000000000001'),changes,mode,source,note);
$$;
select set_config('request.jwt.claim.sub','c9222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select throws_ok($$select pg_temp.push_save(pg_temp.push_changes())$$,'42501','corpus administrator required','user metadata cannot grant direct push authority');
select set_config('request.jwt.claim.sub','c9111111-1111-4111-8111-111111111111',true);
select throws_ok($$select pg_temp.push_save(pg_temp.push_changes(),'evidence')$$,'22023',null,'evidence mode still requires evidence');
select throws_ok($$select pg_temp.push_save(pg_temp.push_changes(),'other')$$,'22023',null,'unknown review mode refused');
select throws_ok($$select pg_temp.push_save('[]')$$,'22023',null,'empty selection refused');
select throws_ok($$select pg_temp.push_save('[{"action":"remove_isbn","value":{"isbn":"9780306406157"}}]')$$,'22023',null,'direct push cannot remove ISBN assignments');
select throws_ok($$select pg_temp.push_save(pg_temp.push_changes() || jsonb_build_array(pg_temp.push_changes()->0))$$,'22023',null,'oversized changes refused');
select throws_ok($$select pg_temp.push_save(jsonb_build_array(pg_temp.push_changes()->0,pg_temp.push_changes()->0))$$,'22023',null,'duplicate action refused');
select throws_ok($$select public.admin_save_corpus_record('c9000000-0000-4000-8000-000000000001','unused','guidance',pg_temp.push_changes()->0->'value',null,null,true)$$,'22023',null,'legacy API still requires evidence');
select lives_ok($$select pg_temp.push_save(pg_temp.push_changes())$$,'administrator saves edition and guidance together without evidence');
reset role;
select is((select details->>'pages' from public.corpus_editions where isbn='9780306406157'),'250','edition saved');
select is((select shared_spice from public.works where id='c9000000-0000-4000-8000-000000000001'),0,'explicit zero saved');
select is((select count(*)::integer from public.corpus_record_edits where work_id='c9000000-0000-4000-8000-000000000001' and review_mode='direct' and source_url is null and note=''),2,'both audit events honestly record direct changes without fake sources');
select is((select provenance->>'reviewMode' from public.corpus_editions where isbn='9780306406157'),'direct','edition provenance records direct mode');
select is((select metadata_provenance->'sharedGuidance'->>'reviewMode' from public.works where id='c9000000-0000-4000-8000-000000000001'),'direct','guidance provenance records direct mode');
select is((select to_jsonb(b) from public.books b where id='c9000000-0000-4000-8000-000000000003'),(select value from push_personal_before),'all personal fields remain unchanged');
create temp table push_before_failure as select public.corpus_record_fingerprint('c9000000-0000-4000-8000-000000000001') fingerprint,(select count(*) from public.corpus_record_edits) audits;
set local role authenticated;
select throws_ok($$select pg_temp.push_save(pg_temp.push_changes(700,8))$$,'22023',null,'invalid guidance rejects the whole batch even after edition processing');
reset role;
select is(public.corpus_record_fingerprint('c9000000-0000-4000-8000-000000000001'),(select fingerprint from push_before_failure),'failed second action rolls back first action and its revision');
select is((select count(*) from public.corpus_record_edits),(select audits from push_before_failure),'failed batch rolls back audit entries');
set local role authenticated;
select throws_ok($$select public.admin_push_corpus_record('c9000000-0000-4000-8000-000000000001','stale',pg_temp.push_changes(),'direct')$$,'PT409',null,'direct mode cannot bypass stale snapshot protection');
select throws_ok($$select pg_temp.push_save(jsonb_set(pg_temp.push_changes(),'{1,value,isbn}','"9780306406158"'))$$,'22023',null,'direct mode cannot bypass checksum validation');
select throws_ok($$select pg_temp.push_save(jsonb_set(pg_temp.push_changes(),'{1,value,isbn}','"9780143117841"'))$$,'23505',null,'direct mode cannot steal another work ISBN');
select throws_ok($$select pg_temp.push_save(jsonb_set(pg_temp.push_changes(),'{1,value,details}','{"condition":"private"}'))$$,'22023',null,'private copy fields cannot enter an edition');
select lives_ok($$select pg_temp.push_save(pg_temp.push_changes(260,1),'evidence','https://publisher.example/edition','Verified published details.')$$,'optional evidence-backed batch works');
reset role;
select is((select count(*)::integer from public.corpus_record_edits where work_id='c9000000-0000-4000-8000-000000000001' and review_mode='evidence' and source_url='https://publisher.example/edition'),2,'evidence mode retains genuine sources');
select is((select to_jsonb(b) from public.books b where id='c9000000-0000-4000-8000-000000000003'),(select value from push_personal_before),'evidence batch also preserves all personal fields');
select * from finish();
rollback;
