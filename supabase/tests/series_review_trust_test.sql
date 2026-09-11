begin;
select no_plan();

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('f5300000-0000-4000-8000-000000000001','authenticated','authenticated','review-admin@example.test','{}','{}',now(),now()),
('f5300000-0000-4000-8000-000000000002','authenticated','authenticated','review-reader@example.test','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values ('f5300000-0000-4000-8000-000000000001');
insert into public.works(id,work_key,title,author_text,contributors,series,position,series_count,series_check_state,series_check_evidence)
select ('f5310000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'review trust ' || n || '|review writer','Review Trust ' || n,'Review Writer','[]',
  'Old Label ' || n,4,case when n=6 then 5 else null end,'unresolved',
  jsonb_build_array(jsonb_build_object('source','hardcover','kind','candidate_label',
    'sourceRef','hardcover:' || (1000+n),'series','Old Label ' || n,'position',4))
from generate_series(1,7) n;

insert into public.books(id,owner_id,corpus_work_id,title,authors_display,series,position,series_user_chosen,series_claim)
values
('f5320000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000002','f5310000-0000-4000-8000-000000000001','Review Trust 1','Review Writer','Old Label 1',4,false,'{"origin":"enrichment"}'),
('f5320000-0000-4000-8000-000000000002','f5300000-0000-4000-8000-000000000002','f5310000-0000-4000-8000-000000000001','Review Trust 1','Review Writer','Reader Choice',9,true,'{"origin":"reader"}'),
('f5320000-0000-4000-8000-000000000003','f5300000-0000-4000-8000-000000000002','f5310000-0000-4000-8000-000000000001','Review Trust 1','Review Writer','Import Choice',8,false,'{"origin":"import"}');

create function pg_temp.w(n integer) returns uuid language sql immutable as $$
  select ('f5310000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.propose(n integer, label text, ordinal numeric default 4, total integer default null, ref text default null)
returns jsonb language sql as $$
  select public.record_corpus_series_discovery(pg_temp.w(n),jsonb_build_object(
    'outcome','found','matched',true,'identityConfidence','high','membershipConfidence','high',
    'source',case when total is null then 'hardcover' else 'publisher' end,'sourceRef',ref,
    'series',label,'position',ordinal,'count',total,'reason','Synthetic exact relationship.',
    'evidence',jsonb_build_array(
      jsonb_build_object('source','hardcover','kind','candidate_label','sourceRef','hardcover:' || (1000+n),
        'series','Old Label ' || n,'position',4),
      jsonb_build_object('source',case when total is null then 'hardcover' else 'publisher' end,
        'kind','relational_membership','sourceRef',coalesce(ref,(9000+n)::text),'series',label,'position',ordinal))));
$$;
create function pg_temp.decide(n integer, decision text) returns uuid language sql as $$
  select public.review_corpus_series_suggestion(id,decision)
  from public.work_series_suggestions where work_id=pg_temp.w(n) and status='pending';
$$;
-- Whole graph snapshots catch hidden source/alias/claim/audit/revision writes, not just scalar names.
create function pg_temp.graph_snapshot() returns jsonb language sql as $$
  select jsonb_build_object(
    'series',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.corpus_series t),
    'names',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.corpus_series_names t),
    'sources',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.corpus_series_sources t),
    'entries',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.corpus_series_entries t),
    'edits',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.corpus_series_edits t));
$$;
create function pg_temp.personal_snapshot() returns jsonb language sql as $$
  select jsonb_build_object(
    'books',(select jsonb_agg(to_jsonb(t) order by id) from public.books t where corpus_work_id=pg_temp.w(1)),
    'entries',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.series_entries t where owner_id='f5300000-0000-4000-8000-000000000002'),
    'parents',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.series t where owner_id='f5300000-0000-4000-8000-000000000002'));
$$;
create temp table checkpoints(name text primary key, value jsonb);
insert into checkpoints values ('empty_graph',pg_temp.graph_snapshot()),('personal',pg_temp.personal_snapshot());
select is((select count(*) from public.corpus_series_entries where work_id=pg_temp.w(1)),0::bigint,'unverified label has no initial graph membership');
select is((select count(*) from public.books where corpus_work_id=pg_temp.w(1)),3::bigint,'three personal fixtures really exist before assertions');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f5300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(pg_temp.propose(1,'Verified Name 1')->>'outcome','review','unverified old label conflicts with the new relationship');
reset role;
select is(pg_temp.graph_snapshot(),(select value from checkpoints where name='empty_graph'),'review does not create graph, aliases, provider refs or audit records');
select is(pg_temp.personal_snapshot(),(select value from checkpoints where name='personal'),'review leaves personal copies and structured membership byte-identical');
select ok((select series='Old Label 1' and position=4 and series_count is null and series_check_state='review' from public.works where id=pg_temp.w(1)),'old scalar tuple is retained without confirming it');
select is((select count(*) from public.work_series_suggestions where work_id=pg_temp.w(1) and status='pending' and proposed_series='Verified Name 1'),1::bigint,'the proposal is available in the actual review queue');
select is((select count(*) from public.corpus_series_sources where source_ref='hardcover:1001'),0::bigint,'a candidate book id is not published as a series id');
-- Repeated reviews and unrelated corpus metadata changes cannot reopen graph publication.
set local role authenticated;
select is(pg_temp.propose(1,'Verified Name 1')->>'outcome','review','a repeat proposal still only queues review');
reset role;
update public.works set metadata_provenance=coalesce(metadata_provenance,'{}') || '{"pages":{"source":"manual"}}' where id=pg_temp.w(1);
select is(pg_temp.graph_snapshot(),(select value from checkpoints where name='empty_graph'),'repeat review and unrelated provenance writes cannot manufacture membership');

-- Explicit acceptance is the positive control: it still materializes the correct relationship.
set local role authenticated;
select lives_ok($$select pg_temp.decide(1,'accept')$$,'administrator acceptance succeeds');
reset role;
select ok((select series='Verified Name 1' and position=4 and series_count is null and series_check_state='found' from public.works where id=pg_temp.w(1)),'acceptance writes the reviewed tuple');
select is((select count(*) from public.corpus_series_entries e join public.corpus_series c on c.id=e.series_id where e.work_id=pg_temp.w(1) and e.removed_at is null and e.is_primary and c.name='Verified Name 1'),1::bigint,'acceptance creates exactly one primary shared membership');
select is((select source_ref from public.corpus_series_entries where work_id=pg_temp.w(1) and removed_at is null and is_primary),'9001','accepted graph uses relational series reference, not the first candidate book reference');
select ok((select series='Verified Name 1' and series_claim->>'origin'='corpus' from public.books where id='f5320000-0000-4000-8000-000000000001'),'eligible personal default follows explicit acceptance');
select is((select count(*) from public.series_entries where book_id='f5320000-0000-4000-8000-000000000001' and removed_at is null and is_primary),1::bigint,'accepted default has real structured membership');
select is((select to_jsonb(b) from public.books b where id='f5320000-0000-4000-8000-000000000002'),(select item from checkpoints,jsonb_array_elements(value->'books') item where name='personal' and item->>'id'='f5320000-0000-4000-8000-000000000002'),'reader-chosen copy is fully preserved on acceptance');
select is((select to_jsonb(b) from public.books b where id='f5320000-0000-4000-8000-000000000003'),(select item from checkpoints,jsonb_array_elements(value->'books') item where name='personal' and item->>'id'='f5320000-0000-4000-8000-000000000003'),'import-chosen copy is fully preserved on acceptance');

-- A real confirmed relationship, not a string merely called Curated in a fixture.
set local role authenticated;
select is(pg_temp.propose(2,'Old Label 2',4,null,'9002')->>'outcome','confirmed','matching relationship establishes a trusted graph anchor');
reset role;
insert into checkpoints values ('trusted',pg_temp.graph_snapshot());
set local role authenticated;
select is(pg_temp.propose(2,'Different Proposal 2',5,null,'9902')->>'outcome','review','a trusted work can queue a conflicting name/order');
reset role;
select is(pg_temp.graph_snapshot(),(select value from checkpoints where name='trusted'),'review preserves trusted claims, order, evidence, aliases and revision exactly');
set local role authenticated;
select lives_ok($$select pg_temp.decide(2,'dismiss')$$,'trusted-work proposal can be dismissed');
reset role;
select is((select series_check_state from public.works where id=pg_temp.w(2)),'found','dismissal retains a previously confirmed membership');
select is(pg_temp.graph_snapshot(),(select value from checkpoints where name='trusted'),'dismissal cannot copy rejected evidence into the trusted graph');
select isnt(coalesce(current_setting('reverie.series_review_preserve_catalog',true),''),'on','dismissal restores its transaction-local preservation flag');

insert into checkpoints values ('before_unknown_dismiss',pg_temp.graph_snapshot());
set local role authenticated;
select is(pg_temp.propose(3,'Proposed Name 3')->>'outcome','review','unknown fixture enters review');
select lives_ok($$select pg_temp.decide(3,'dismiss')$$,'unknown-work proposal can be dismissed');
reset role;
select is((select series_check_state from public.works where id=pg_temp.w(3)),'unresolved','dismissing a proposal never verifies an old unknown label');
select is(pg_temp.graph_snapshot(),(select value from checkpoints where name='before_unknown_dismiss'),'unknown dismissal neither publishes nor rewrites graph data');
select is((select status from public.work_series_suggestions where work_id=pg_temp.w(3)),'dismissed','dismissal remains in administrator history');

-- Secondary and removed memberships must not become primary merely by review/dismissal.
set local role authenticated;
select is(pg_temp.propose(4,'Old Label 4')->>'outcome','confirmed','secondary fixture first establishes an actual relationship');
select is(pg_temp.propose(5,'Old Label 5')->>'outcome','confirmed','removed fixture first establishes an actual relationship');
reset role;
update public.corpus_series_entries set is_primary=false where work_id=pg_temp.w(4);
update public.corpus_series_entries set removed_at=now(),is_primary=false where work_id=pg_temp.w(5);
update public.works set series_check_state='unresolved' where id in (pg_temp.w(4),pg_temp.w(5));
insert into checkpoints values ('non_primary',pg_temp.graph_snapshot());
set local role authenticated;
select is(pg_temp.propose(4,'Different 4')->>'outcome','review','secondary fixture enters review');
select is(pg_temp.propose(5,'Different 5')->>'outcome','review','removed fixture enters review');
select lives_ok($$select pg_temp.decide(4,'dismiss')$$,'secondary fixture dismissal succeeds');
select lives_ok($$select pg_temp.decide(5,'dismiss')$$,'removed fixture dismissal succeeds');
reset role;
select is(pg_temp.graph_snapshot(),(select value from checkpoints where name='non_primary'),'review/dismissal cannot promote a secondary or revive a tombstone');
select is((select count(*) from public.works where id in (pg_temp.w(4),pg_temp.w(5)) and series_check_state='unresolved'),2::bigint,'neither a secondary nor a removed anchor establishes primary found status');

set local role authenticated;
select is(pg_temp.propose(6,'Old Label 6')->>'outcome','confirmed','count/order fixture is truly confirmed first');
reset role;
insert into checkpoints values ('order_count',pg_temp.graph_snapshot());
set local role authenticated;
select is(pg_temp.propose(6,'Old Label 6',5)->>'outcome','review','same-name order conflict remains review-only');
select is(pg_temp.propose(6,'Old Label 6',4,7,'https://publisher.example/series-six')->>'outcome','review','same-name count conflict remains review-only');
reset role;
select is(pg_temp.graph_snapshot(),(select value from checkpoints where name='order_count'),'order/count review does not refresh the trusted graph');
set local role authenticated;
select lives_ok($$select pg_temp.decide(6,'accept')$$,'explicit count acceptance still writes');
reset role;
select is((select series_count from public.works where id=pg_temp.w(6)),7,'reviewed count persists after acceptance');

-- Never use an explicitly typed Hardcover book locator even if supplied as result provenance.
set local role authenticated;
select is(pg_temp.propose(7,'Old Label 7',4,null,'hardcover:1007')->>'outcome','confirmed','legacy same-label observation remains compatible');
reset role;
select is((select count(*) from public.corpus_series_sources where source_ref='hardcover:1007'),0::bigint,'explicit book reference cannot become a catalog series identity');
select ok((select source_ref is null from public.corpus_series_entries where work_id=pg_temp.w(7) and removed_at is null and is_primary),'invalid typed provider reference remains unset rather than guessed');

select ok(not has_function_privilege('anon','public.sync_corpus_series_catalog_work(uuid,text)','execute'),'graph helper denies anonymous execution');
select ok(not has_function_privilege('authenticated','public.sync_corpus_series_catalog_work(uuid,text)','execute'),'graph helper denies reader execution');
select ok(not has_function_privilege('service_role','public.sync_corpus_series_catalog_work(uuid,text)','execute'),'graph helper remains internal');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f5300000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.review_corpus_series_suggestion((select id from public.work_series_suggestions limit 1),'dismiss')$$,'42501','corpus administrator required','ordinary reader cannot dismiss a proposal');
reset role;
select * from finish();
rollback;
