begin;
select plan(11);

select has_column('public', 'books', 'plan_position',
  'books store deliberate reading-plan membership and order');
select has_column('public', 'books', 'plan_intention',
  'books store the private future-self note');

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('7a000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'plan-owner@example.com', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.books
  (id, owner_id, title, plan_y, plan_m, plan_d, plan_position, plan_intention)
values
  ('7a100000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001',
   'Primary Soon', null, null, null, 1000, 'Keep the quiet mood.'),
  ('7a100000-0000-4000-8000-000000000002', '7a000000-0000-4000-8000-000000000001',
   'Loser Dated', 2028, 5, 7, 2000, 'A different plan.'),
  ('7a100000-0000-4000-8000-000000000003', '7a000000-0000-4000-8000-000000000001',
   'Primary Empty', null, null, null, null, ''),
  ('7a100000-0000-4000-8000-000000000004', '7a000000-0000-4000-8000-000000000001',
   'Loser Soon', null, null, null, 3000, 'For a rainy afternoon.');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"7a000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$select public.merge_books_authoritative(
    '7a100000-0000-4000-8000-000000000001',
    '7a100000-0000-4000-8000-000000000002',
    '{"plan_y":2028,"plan_m":5,"plan_d":7,"plan_position":2000,"plan_intention":"A different plan."}'::jsonb
  )$$,
  'a duplicate merge accepts a complete dated plan payload');

select lives_ok(
  $$select public.merge_books_authoritative(
    '7a100000-0000-4000-8000-000000000003',
    '7a100000-0000-4000-8000-000000000004',
    '{"plan_y":null,"plan_m":null,"plan_d":null,"plan_position":3000,"plan_intention":"For a rainy afternoon."}'::jsonb
  )$$,
  'a duplicate merge accepts a complete Soon plan payload');
reset role;

select is((select plan_position from public.books where id = '7a100000-0000-4000-8000-000000000001'),
  1000::numeric, 'the stored primary Soon membership wins');
select is((select plan_intention from public.books where id = '7a100000-0000-4000-8000-000000000001'),
  'Keep the quiet mood.', 'the stored primary intention wins with its plan');
select ok((select plan_y is null and plan_m is null and plan_d is null
           from public.books where id = '7a100000-0000-4000-8000-000000000001'),
  'the merge does not manufacture a date for Soon');
select is((select plan_position from public.books where id = '7a100000-0000-4000-8000-000000000003'),
  3000::numeric, 'an unplanned primary adopts the loser Soon membership');
select is((select plan_intention from public.books where id = '7a100000-0000-4000-8000-000000000003'),
  'For a rainy afternoon.', 'an adopted Soon plan carries its intention');
select is((select count(*)::int from public.books where id in (
  '7a100000-0000-4000-8000-000000000002', '7a100000-0000-4000-8000-000000000004')),
  0, 'both loser rows are deleted');

select ok(not has_function_privilege('anon',
  'public.merge_books_authoritative(uuid,uuid,jsonb)', 'EXECUTE'),
  'anonymous clients cannot invoke the merge boundary');

select * from finish();
rollback;
