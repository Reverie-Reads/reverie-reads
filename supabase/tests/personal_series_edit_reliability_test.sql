begin;
select plan(11);
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('de200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'series-edit-owner@example.com', '{}', '{}', now(), now()),
('de200000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'series-edit-other@example.com', '{}', '{}', now(), now());
insert into public.books (id, owner_id, title, author_first, author_last) values
('de220000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001', 'Second Book', 'Ada', 'North'),
('de220000-0000-0000-0000-000000000002', 'de200000-0000-0000-0000-000000000001', 'Different Book', 'Ada', 'North');
insert into public.series (id, owner_id, name) values
('de210000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001', 'Existing Saga');
insert into public.series_entries (id, owner_id, series_id, title, author, position, membership_claim, position_claim) values
('de230000-0000-0000-0000-000000000001', 'de200000-0000-0000-0000-000000000001', 'de210000-0000-0000-0000-000000000001', 'Second Book', 'Ada North', 2, '{"origin":"enrichment"}', '{"origin":"enrichment"}');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'de200000-0000-0000-0000-000000000001', true);
select lives_ok($q$select public.set_book_series_membership('de220000-0000-0000-0000-000000000001', null, ' existing saga ', 2, null, true, '{"origin":"reader"}', '{"origin":"reader"}')$q$, 'reader attaches their book to an exact existing placeholder');
select is((select count(*)::int from public.series), 1, 'case and outer whitespace reuse the existing series');
select is((select count(*)::int from public.series_entries), 1, 'no duplicate slot is inserted');
select is((select book_id from public.series_entries where id='de230000-0000-0000-0000-000000000001'), 'de220000-0000-0000-0000-000000000001'::uuid, 'the original placeholder links the book');
select ok((select is_primary and user_edited and membership_claim->>'origin'='reader' from public.series_entries where id='de230000-0000-0000-0000-000000000001'), 'membership is a protected explicit reader choice');
select ok((select series='Existing Saga' and position=2 from public.books where id='de220000-0000-0000-0000-000000000001'), 'library compatibility fields agree with the series');
select lives_ok($q$select public.set_book_series_membership('de220000-0000-0000-0000-000000000001', null, 'Existing Saga', 2, null, true, '{"origin":"reader"}', '{"origin":"reader"}')$q$, 'retry reuses the linked row');
select throws_ok($q$select public.set_book_series_membership('de220000-0000-0000-0000-000000000002', null, 'Existing Saga', 2, null, true, '{"origin":"reader"}', '{"origin":"reader"}')$q$, '23505', 'series position is already occupied', 'a different book cannot replace this slot');
select set_config('request.jwt.claim.sub', 'de200000-0000-0000-0000-000000000002', true);
select throws_ok($q$select public.set_book_series_membership('de220000-0000-0000-0000-000000000001', null, 'Existing Saga', 2, null, true, '{"origin":"reader"}', '{"origin":"reader"}')$q$, 'P0001', 'not owner of book', 'other readers cannot adopt the placeholder');
select ok(not has_function_privilege('anon', 'public.set_book_series_membership(uuid,uuid,text,numeric,integer,boolean,jsonb,jsonb)', 'EXECUTE'), 'anonymous cannot call the boundary');
select ok(not has_function_privilege('authenticated', 'public.apply_series_membership(uuid,uuid,uuid,text,numeric,integer,boolean,jsonb,jsonb,boolean)', 'EXECUTE'), 'the internal helper stays private');
select * from finish();
rollback;
