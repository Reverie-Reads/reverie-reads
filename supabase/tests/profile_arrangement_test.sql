begin;
select plan(6);

select has_column(
  'public',
  'profiles',
  'arrangement',
  'profiles store the reader arrangement'
);
select col_not_null(
  'public',
  'profiles',
  'arrangement',
  'an account arrangement is never SQL null'
);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  'a4400000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'profile-arrangement@example.com',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

select is(
  (
    select arrangement
    from public.profiles
    where id = 'a4400000-0000-0000-0000-000000000001'
  ),
  '{"version":1,"priorityDestinations":["home","match","library"],"homeModules":["next-read","reading","priority"]}'::jsonb,
  'new accounts begin with the Next read arrangement'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a4400000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$update public.profiles
    set arrangement = '{"version":1,"priorityDestinations":["home","library","stats"],"homeModules":["reading","year","priority"]}'::jsonb
    where id = 'a4400000-0000-0000-0000-000000000001'$$,
  'a reader can save an arrangement on their own profile'
);

select throws_ok(
  $$update public.profiles
    set arrangement = '[]'::jsonb
    where id = 'a4400000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'a non-object arrangement is rejected'
);

select is(
  (
    select arrangement -> 'priorityDestinations'
    from public.profiles
    where id = 'a4400000-0000-0000-0000-000000000001'
  ),
  '["home","library","stats"]'::jsonb,
  'the saved priority order remains on the account'
);

select * from finish();
rollback;
