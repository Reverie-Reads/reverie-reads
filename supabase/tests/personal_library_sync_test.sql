begin;
select plan(16);

select ok(
  not has_function_privilege('anon', 'public.broadcast_personal_library_change()', 'EXECUTE'),
  'anonymous clients cannot invoke the broadcast trigger function'
);
select ok(
  not has_function_privilege('authenticated', 'public.broadcast_personal_library_change()', 'EXECUTE'),
  'readers cannot invoke the broadcast trigger function directly'
);
select ok(
  not has_function_privilege('service_role', 'public.broadcast_personal_library_change()', 'EXECUTE'),
  'service clients cannot invoke the broadcast trigger function directly'
);

select is(
  (select prosecdef from pg_proc where oid = 'public.broadcast_personal_library_change()'::regprocedure),
  true,
  'the trigger owns the permission needed to send a database broadcast'
);
select is(
  (select proconfig from pg_proc where oid = 'public.broadcast_personal_library_change()'::regprocedure),
  array['search_path=""'],
  'the security-definer trigger has an empty search path'
);

select is(
  (select count(*)::int from pg_trigger
   where not tgisinternal and tgname like '%_broadcast_personal_library_change'),
  4,
  'all four personal library tables emit change signals'
);

select ok(
  exists(
    select 1 from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'personal library: receive own changes'
      and roles = array['authenticated'::name]
      and cmd = 'SELECT'
  ),
  'the private broadcast topic has an authenticated read policy'
);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '73111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'library-sync@example.com',
  '{}',
  '{}',
  now(),
  now()
);

select lives_ok(
  $$insert into public.books (id, owner_id, title)
    values ('73111111-1111-4111-8111-111111111112',
            '73111111-1111-4111-8111-111111111111', 'Signal Book')$$,
  'book inserts remain available with the broadcast trigger installed'
);
select lives_ok(
  $$update public.books set title = 'Signal Book Revised'
    where id = '73111111-1111-4111-8111-111111111112'$$,
  'book updates remain available with the broadcast trigger installed'
);
select lives_ok(
  $$insert into public.reads (id, book_id, owner_id, read_on)
    values ('73111111-1111-4111-8111-111111111113',
            '73111111-1111-4111-8111-111111111112',
            '73111111-1111-4111-8111-111111111111', '2026-09-09')$$,
  'reading-history writes emit without changing their write contract'
);
select lives_ok(
  $$insert into public.lists (id, owner_id, name, kind)
    values ('73111111-1111-4111-8111-111111111114',
            '73111111-1111-4111-8111-111111111111', 'Signal Shelf', 'collection')$$,
  'shelf writes emit without changing their write contract'
);
select lives_ok(
  $$insert into public.list_items (list_id, book_id, owner_id)
    values ('73111111-1111-4111-8111-111111111114',
            '73111111-1111-4111-8111-111111111112',
            '73111111-1111-4111-8111-111111111111')$$,
  'shelf placement writes emit without changing their write contract'
);
select lives_ok(
  $$delete from public.list_items
    where list_id = '73111111-1111-4111-8111-111111111114'
      and book_id = '73111111-1111-4111-8111-111111111112'$$,
  'shelf placement deletes emit safely'
);
select lives_ok(
  $$delete from public.lists where id = '73111111-1111-4111-8111-111111111114'$$,
  'shelf deletes emit safely'
);
select lives_ok(
  $$delete from public.books where id = '73111111-1111-4111-8111-111111111112'$$,
  'book deletes and their cascades emit safely'
);

select ok(
  pg_get_functiondef('public.broadcast_personal_library_change()'::regprocedure)
    like '%jsonb_build_object(''table'', tg_table_name, ''operation'', tg_op)%',
  'the broadcast payload contains table and operation only'
);

select * from finish();
rollback;
