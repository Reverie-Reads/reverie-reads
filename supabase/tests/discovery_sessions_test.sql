begin;
select no_plan();
-- Check the installed migration first, then exercise its ACL reset against legacy auto-exposure.
select ok(not has_table_privilege('anon','public.discovery_sessions','SELECT'), 'installed table is private');
grant all on public.discovery_sessions to public, anon, authenticated;
select ok(has_table_privilege('anon','public.discovery_sessions','DELETE'), 'dirty ACL precondition is present');
revoke all on public.discovery_sessions from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.discovery_sessions to authenticated;
grant all on public.discovery_sessions to service_role;
select ok(not has_table_privilege('anon','public.discovery_sessions',operation), 'anon denied ' || operation)
from unnest(array['SELECT','INSERT','UPDATE','DELETE']) operation;
select ok(has_table_privilege('authenticated','public.discovery_sessions',operation), 'authenticated RLS-scoped ' || operation)
from unnest(array['SELECT','INSERT','UPDATE','DELETE']) operation;
select ok(has_table_privilege('service_role','public.discovery_sessions',operation), 'service role ' || operation)
from unnest(array['SELECT','INSERT','UPDATE','DELETE']) operation;
select ok(not has_function_privilege(role_name, 'public.guard_discovery_sessions()', 'EXECUTE'), role_name || ' cannot invoke trigger directly')
from unnest(array['anon','authenticated']) role_name;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('f9100000-0000-4000-8000-000000000001','authenticated','authenticated','discovery-owner@example.com','{}','{}',now(),now()),
('f9100000-0000-4000-8000-000000000002','authenticated','authenticated','discovery-other@example.com','{}','{}',now(),now());
create function pg_temp.snapshot(id uuid) returns jsonb language sql as $$
select jsonb_build_object('version',1,'id',id,'createdAt','2026-09-06T00:00:00Z','intent',jsonb_build_object('kind','mood','moods',jsonb_build_array('Hopeful')),'picks',jsonb_build_array(jsonb_build_object('book',jsonb_build_object('title','A welcome','authors',jsonb_build_array('Nell Stone'),'cover','','isbn','','pub',''),'basis','description','reason','Catalog description includes hope.')),'dismissed','[]'::jsonb)
$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f9100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$insert into public.discovery_sessions(owner_id,id,document) values (auth.uid(),'f9200000-0000-4000-8000-000000000001',pg_temp.snapshot('f9200000-0000-4000-8000-000000000001'))$$,'reader saves their own shortlist');
select is((select count(*) from public.books),0::bigint,'saving creates no personal book');
select throws_ok($$insert into public.discovery_sessions(owner_id,id,document) values ('f9100000-0000-4000-8000-000000000002','f9200000-0000-4000-8000-000000000002',pg_temp.snapshot('f9200000-0000-4000-8000-000000000002'))$$,'42501',null,'cannot save for another reader');
select throws_ok($$insert into public.discovery_sessions(owner_id,id,document) values (auth.uid(),'f9200000-0000-4000-8000-000000000002','{}')$$,'23514',null,'malformed document refused');
select throws_ok($$update public.discovery_sessions set id='f9200000-0000-4000-8000-000000000003'$$,'23514',null,'identity immutable');
select set_config('request.jwt.claims','{"sub":"f9100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.discovery_sessions),0::bigint,'other reader sees no shortlist');
with changed as (update public.discovery_sessions set document='{}' returning id) select is((select count(*) from changed),0::bigint,'other reader updates no shortlist');
with changed as (delete from public.discovery_sessions returning id) select is((select count(*) from changed),0::bigint,'other reader deletes no shortlist');
select set_config('request.jwt.claims','{"sub":"f9100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.discovery_sessions(owner_id,id,document)
select auth.uid(),id,pg_temp.snapshot(id) from (select gen_random_uuid() id from generate_series(1,49)) ids;
select is((select count(*) from public.discovery_sessions),50::bigint,'50 distinct shortlists fit');
select throws_ok($$insert into public.discovery_sessions(owner_id,id,document) values (auth.uid(),'f9200000-0000-4000-8000-000000000099',pg_temp.snapshot('f9200000-0000-4000-8000-000000000099'))$$,'23514',null,'51st shortlist is refused');
select lives_ok($$insert into public.discovery_sessions(owner_id,id,document) values (auth.uid(),'f9200000-0000-4000-8000-000000000001',pg_temp.snapshot('f9200000-0000-4000-8000-000000000001')) on conflict(owner_id,id) do update set document=excluded.document$$,'updating an existing shortlist works at quota');
select lives_ok($$delete from public.discovery_sessions where id='f9200000-0000-4000-8000-000000000001'$$,'reader can remove a saved shortlist');
reset role;
select set_config('request.jwt.claims','{}',true);
-- Account deletion is deliberately exercised locally, inside the rollback-only fixture.
delete from auth.users where id='f9100000-0000-4000-8000-000000000001';
select is((select count(*) from public.discovery_sessions where owner_id='f9100000-0000-4000-8000-000000000001'),0::bigint,'account deletion removes all saved shortlists');
select * from finish();
rollback;
