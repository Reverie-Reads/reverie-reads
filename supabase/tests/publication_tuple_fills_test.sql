begin;
select plan(9);
select ok(public.publication_tuple_is_valid(2024, 2, 29), 'valid leap date');
select ok(not public.publication_tuple_is_valid(2023, 2, 29), 'impossible day is rejected');
select ok(not public.publication_tuple_is_valid(2024, null, 1), 'day cannot borrow a missing month');
select ok(public.publication_tuple_is_valid(2010, null, null), 'year precision remains valid');
insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('ab000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'date-fill@example.com', '{}', '{}');
insert into public.corpus_admins(user_id) values ('ab000000-0000-4000-8000-000000000001');
insert into public.works(id, work_key, title, author_text, pub_y) values
('ab000000-0000-4000-8000-000000000002', 'tupleone|awriter', 'Tuple One', 'A Writer', 2010),
('ab000000-0000-4000-8000-000000000003', 'tupletwo|awriter', 'Tuple Two', 'A Writer', null);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ab000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($q$select public.complete_corpus_work_metadata('ab000000-0000-4000-8000-000000000002', '{"pubY":2024,"pubM":2,"pubD":29,"provenance":{"pubM":{"source":"openlibrary"},"pubD":{"source":"openlibrary"}}}')$q$, 'admin completion preserves an existing source date');
select lives_ok($q$select public.complete_corpus_work_metadata('ab000000-0000-4000-8000-000000000003', '{"pubY":2024,"pubM":2,"pubD":29}')$q$, 'admin completion fills a valid complete tuple');
reset role;
select is((select array[pub_y,pub_m,pub_d] from public.works where id = 'ab000000-0000-4000-8000-000000000002'), array[2010,null,null], 'does not append another source month/day');
select is((select array[pub_y,pub_m,pub_d] from public.works where id = 'ab000000-0000-4000-8000-000000000003'), array[2024,2,29], 'all incoming axes travel together');
select is((select metadata_provenance from public.works where id = 'ab000000-0000-4000-8000-000000000002'), '{}'::jsonb, 'unapplied month/day never acquire provenance');
select * from finish();
rollback;
