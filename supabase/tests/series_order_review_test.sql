begin;
select no_plan();
select ok(not has_function_privilege('anon',
  'public.review_corpus_series_entry_order(uuid,bigint,uuid,numeric,text,text,text,text,text)', 'EXECUTE'), 'anonymous execution denied');
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('da000000-0000-4000-8000-000000000001','authenticated','authenticated','order-admin@example.com','{}','{}',now(),now()),
('da000000-0000-4000-8000-000000000002','authenticated','authenticated','order-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values ('da000000-0000-4000-8000-000000000001');
insert into public.works(id,work_key,title,author_text,contributors) values
('db000000-0000-4000-8000-000000000001','citation-title|writer','Citation Title','Test Writer','[]');
insert into public.books(id,owner_id,corpus_work_id,title,authors_display,series,position,status,series_user_chosen,series_claim) values
('dc000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000002','db000000-0000-4000-8000-000000000001','Citation Title','Test Writer',null,null,'standalone',false,'{"origin":"unknown"}'),
('dc000000-0000-4000-8000-000000000002','da000000-0000-4000-8000-000000000002','db000000-0000-4000-8000-000000000001','Citation Title','Test Writer','Reader Choice',7,'ongoing',true,'{"origin":"reader"}'),
('dc000000-0000-4000-8000-000000000003','da000000-0000-4000-8000-000000000002','db000000-0000-4000-8000-000000000001','Citation Title','Test Writer','Imported Choice',8,'ongoing',true,'{"origin":"import"}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.record_corpus_series_discovery('db000000-0000-4000-8000-000000000001',
'{"matched":true,"identityConfidence":"high","membershipConfidence":"high","source":"hardcover","sourceRef":"citation-series","series":"Citation Saga","position":1,"count":2,"evidence":[{"source":"hardcover","kind":"relational_membership","sourceRef":"citation-series","series":"Citation Saga","position":1,"memberCount":2}]}',now());
reset role;
create temp table before_order as select e.*, s.revision from public.corpus_series_entries e join public.corpus_series s on s.id=e.series_id where e.work_id='db000000-0000-4000-8000-000000000001' and e.removed_at is null;
grant select on before_order to authenticated;
create function pg_temp.correct(p numeric, u text, n text, r bigint default null) returns jsonb language sql as $$
  select public.review_corpus_series_entry_order(e.series_id,coalesce(r,s.revision),e.id,p,'',u,n,'Ignored linked title','Ignored linked author')
  from before_order e join public.corpus_series s on s.id=e.series_id;
$$;
set local role authenticated;
select throws_ok($$select pg_temp.correct(5,null,null)$$,'22023',null,'changed position needs citation');
select throws_ok($$select pg_temp.correct(5,'https://user:pass@publisher.example/book','Check')$$,'22023',null,'credentials refused');
select throws_ok($$select pg_temp.correct(5,'https://publisher.example/book?key=secret','Check')$$,'22023',null,'query credentials cannot be retained');
select throws_ok($$select pg_temp.correct('NaN','https://publisher.example/book','Check')$$,'22023',null,'NaN refused');
select throws_ok($$select pg_temp.correct(5,'https://publisher.example/book','Check',-1)$$,'PT409',null,'stale revision refused');
select lives_ok($$select pg_temp.correct(5,'https://publisher.example/book','Publisher explicitly numbers this exact work fifth.')$$,'cited correction succeeds');
reset role;
select is((select position from public.works where id='db000000-0000-4000-8000-000000000001'),5::numeric,'shared work updated');
select is((select title from public.works where id='db000000-0000-4000-8000-000000000001'),'Citation Title','linked identity cannot be changed by the order writer');
select is((select position from public.books where id='dc000000-0000-4000-8000-000000000001'),5::numeric,'eligible personal default updated');
select is((select position from public.books where id='dc000000-0000-4000-8000-000000000002'),7::numeric,'reader choice retained');
select is((select position from public.books where id='dc000000-0000-4000-8000-000000000003'),8::numeric,'import choice retained');
select ok((select e.membership_claim=b.membership_claim and e.evidence=b.evidence and e.source=b.source from public.corpus_series_entries e join before_order b on b.id=e.id),'membership provenance retained');
select is((select e.position_claim->>'sourceRef' from public.corpus_series_entries e join before_order b on b.id=e.id),'https://publisher.example/book','position citation stored separately');
select is((select next_value->'orderReview'->>'note' from public.corpus_series_edits where next_value ? 'orderReview' and series_id=(select series_id from before_order)),'Publisher explicitly numbers this exact work fifth.','rationale persisted in private audit');
select ok((select not e.position_claim ? 'note' from public.corpus_series_entries e join before_order b on b.id=e.id),'private rationale absent from public claim');
-- Simulate an eligible legacy default that has not adopted the already-reviewed corpus tuple.
delete from public.series_entries where book_id='dc000000-0000-4000-8000-000000000001';
update public.books set series=null, position=null, series_user_chosen=false, series_claim='{"origin":"unknown"}'
where id='dc000000-0000-4000-8000-000000000001';
select ok((select position is null and series_claim->>'origin'='unknown' from public.books where id='dc000000-0000-4000-8000-000000000001'),'legacy default is missing before re-confirmation');
set local role authenticated;
select lives_ok($$select pg_temp.correct(5,'https://publisher.example/book','Rechecked the existing fifth position.')$$,'same-value cited confirmation succeeds');
reset role;
select ok((select position=5 and series='Citation Saga' and series_claim->>'origin'='corpus' from public.books where id='dc000000-0000-4000-8000-000000000001'),'same-value review repairs the eligible personal default');
select is((select count(*) from public.series_entries where book_id='dc000000-0000-4000-8000-000000000001' and removed_at is null and is_primary and position=5),1::bigint,'same-value review materializes the missing structured membership');
select is((select count(*) from public.books where (id='dc000000-0000-4000-8000-000000000002' and position=7 and series_claim->>'origin'='reader') or (id='dc000000-0000-4000-8000-000000000003' and position=8 and series_claim->>'origin'='import')),2::bigint,'same-value review still preserves reader and import choices');
set local role authenticated;
select lives_ok($$select pg_temp.correct(5,null,null)$$,'same-position label-only save needs no new citation');
select throws_ok($$select pg_temp.correct(null,null,null)$$,'22023',null,'clearing position needs a reason and source');
select lives_ok($$select pg_temp.correct(null,'https://publisher.example/book','The publisher now lists no ordinal; clear the disputed number.')$$,'explicit sourced clear succeeds');
reset role;
select ok((select position is null from public.works where id='db000000-0000-4000-8000-000000000001'),'clear persists as unknown');
-- Secondary and unbound slots use the same review boundary without rewriting the primary work.
insert into public.corpus_series(id,name,name_key,creator_key,catalog_state)
values ('dd000000-0000-4000-8000-000000000001','Other Citation Saga','other citation saga','test writer','confirmed');
insert into public.corpus_series_entries(id,series_id,work_id,title,author_text,is_primary,position)
values ('de000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000001','db000000-0000-4000-8000-000000000001','Citation Title','Test Writer',false,1),
('de000000-0000-4000-8000-000000000002','dd000000-0000-4000-8000-000000000001',null,'Unbound Title','Test Writer',false,2);
create function pg_temp.other_slot(e uuid,p numeric,t text,r bigint default null) returns jsonb language sql as $$
  select public.review_corpus_series_entry_order(id,coalesce(r,revision),e,p,'Note',
    'https://publisher.example/book','Exact slot order checked.',t,'Corrected Writer')
  from public.corpus_series where id='dd000000-0000-4000-8000-000000000001';
$$;
set local role authenticated;
select throws_ok($$select public.review_corpus_series_entry_order(series_id,null,id,5,'','https://publisher.example/book','Checked','Ignored','Ignored') from before_order$$,'PT409',null,'null revision refused');
select lives_ok($$select pg_temp.other_slot('de000000-0000-4000-8000-000000000001',3,'Ignored linked title')$$,'secondary slot order can be reviewed');
select lives_ok($$select pg_temp.other_slot('de000000-0000-4000-8000-000000000002',4,'Corrected Unbound Title')$$,'unbound title author and cited order can be edited together');
select throws_ok($$select pg_temp.other_slot('de000000-0000-4000-8000-000000000002',5,' ')$$,'22023',null,'empty unbound title refused');
reset role;
select ok((select position is null from public.works where id='db000000-0000-4000-8000-000000000001'),'secondary order does not rewrite primary work');
select ok((select title='Corrected Unbound Title' and author_text='Corrected Writer' and position=4 from public.corpus_series_entries where id='de000000-0000-4000-8000-000000000002'),'unbound fields persist and failed empty-title edit is atomic');
select is((select count(*) from public.corpus_series_edits where series_id='dd000000-0000-4000-8000-000000000001' and next_value ? 'orderReview'),2::bigint,'failed review leaves no audit event');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select pg_temp.correct(6,'https://publisher.example/book','Injected')$$,'42501','corpus administrator required','reader cannot correct shared order');
select is((select count(*) from public.corpus_series_edits where series_id=(select series_id from before_order)),0::bigint,'reader cannot read administrator history');
reset role;
select * from finish();
rollback;
