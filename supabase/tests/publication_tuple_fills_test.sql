begin;
select plan(15);
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
insert into public.works(id, work_key, title, author_text, pub_y) values
('ab000000-0000-4000-8000-000000000004', 'preservedold|janedoe', 'Preserved Old', 'Jane Doe', 2010),
('ab000000-0000-4000-8000-000000000005', 'preservednew|janedoe', 'Preserved New', 'Jane Doe', null);
insert into public.books(id, owner_id, title, author_first, author_last, corpus_work_id, pub_y, pub_m, pub_d) values
('ab000000-0000-4000-8000-000000000006', 'ab000000-0000-4000-8000-000000000001', 'Preserved Old', 'Jane', 'Doe', 'ab000000-0000-4000-8000-000000000004', 2024,2,29),
('ab000000-0000-4000-8000-000000000007', 'ab000000-0000-4000-8000-000000000001', 'Preserved New', 'Jane', 'Doe', 'ab000000-0000-4000-8000-000000000005', 2024,2,29);
select lives_ok($q$select public.preserve_personal_book_objective_metadata('ab000000-0000-4000-8000-000000000006')$q$, 'preservation can inspect the existing source');
select lives_ok($q$select public.preserve_personal_book_objective_metadata('ab000000-0000-4000-8000-000000000007')$q$, 'preservation can fill an unknown date');
select is((select array[pub_y,pub_m,pub_d] from public.works where id='ab000000-0000-4000-8000-000000000004'), array[2010,null,null], 'preservation does not extend a different source date');
select is((select array[pub_y,pub_m,pub_d] from public.works where id='ab000000-0000-4000-8000-000000000005'), array[2024,2,29], 'preservation takes all valid incoming axes together');
set local role authenticated;
insert into public.books(id, owner_id, title, pub_y, pub_m, pub_d) values
('ab000000-0000-4000-8000-000000000008', 'ab000000-0000-4000-8000-000000000001', 'Merge Year', 2010,9,28),
('ab000000-0000-4000-8000-000000000009', 'ab000000-0000-4000-8000-000000000001', 'Merge Year', 2025,null,null);
select lives_ok($q$select public.merge_books('ab000000-0000-4000-8000-000000000008','ab000000-0000-4000-8000-000000000009','{"pub_y":2025,"pub_m":null,"pub_d":null}')$q$, 'an explicit duplicate choice accepts year precision');
select is((select array[pub_y,pub_m,pub_d]::int[] from public.books where id='ab000000-0000-4000-8000-000000000008'), array[2025,null,null], 'explicit replacement never retains the prior month and day');
reset role;
select * from finish();
rollback;
