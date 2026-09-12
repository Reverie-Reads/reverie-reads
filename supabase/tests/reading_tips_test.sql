begin;
select no_plan();

select col_not_null('public', 'profiles', 'show_reading_tips', 'the reading tips choice cannot be null');

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f9400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'tips-one@example.com', '{}', '{}', now(), now()),
  ('f9400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'tips-two@example.com', '{}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9400000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select show_reading_tips from public.profiles), true, 'a new reader sees tips by default');
select lives_ok($$update public.profiles set show_reading_tips = false where id = 'f9400000-0000-4000-8000-000000000001'$$, 'the reader can quiet their own app');
select is((select show_reading_tips from public.profiles), false, 'the explicit off choice is stored');
select lives_ok($$select public.update_reader_guidance(p_mode => 'full', p_complete => true, p_milestones => array['books'])$$, 'the reader can change their guide independently');
select is((select show_reading_tips from public.profiles), false, 'guide mode and milestones do not turn tips back on');
select throws_ok($$update public.profiles set show_reading_tips = null where id = 'f9400000-0000-4000-8000-000000000001'$$, '23502', null, 'a null preference is rejected');
select is((select count(*) from public.books), 0::bigint, 'changing tips creates no books');

select set_config('request.jwt.claims', '{"sub":"f9400000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select show_reading_tips from public.profiles), true, 'another reader keeps their own default');
select is((select count(*) from public.profiles where id = 'f9400000-0000-4000-8000-000000000001'), 0::bigint, 'another reader cannot read the preference');
with changed as (
  update public.profiles set show_reading_tips = true
  where id = 'f9400000-0000-4000-8000-000000000001' returning id
) select is((select count(*) from changed), 0::bigint, 'another reader cannot change the preference');

reset role;
select is((select show_reading_tips from public.profiles where id = 'f9400000-0000-4000-8000-000000000001'), false, 'the attempted cross-account write left the owner choice unchanged');
select * from finish();
rollback;
