begin;
select no_plan();
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('f9600000-0000-4000-8000-000000000001','authenticated','authenticated','copies-one@example.com','{}','{}',now(),now()),
 ('f9600000-0000-4000-8000-000000000002','authenticated','authenticated','copies-two@example.com','{}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f9600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.books(id,owner_id,title,author_first,author_last,ownership,owned_physical,read_status,progress,rating)
 values ('f9600000-0000-4000-8000-000000000010','f9600000-0000-4000-8000-000000000001','Copies test','Test','Reader','owned','paperback','Reading',45,4);
insert into public.reads(book_id,owner_id,read_on,format,notes) values
 ('f9600000-0000-4000-8000-000000000010','f9600000-0000-4000-8000-000000000001','2025-01-01','paperback','Private reading history');
select ok((select copy_inventory is null from public.books where id='f9600000-0000-4000-8000-000000000010'),'legacy book has no fabricated inventory');
select set_config('test.inventory', '{"version":1,"editions":[
 {"id":"f9600000-0000-4000-8000-000000000100","label":"Paperback","format":"paperback","isbn":"9780143117841","publisher":"","published":"2026","pages":240,"cover":""},
 {"id":"f9600000-0000-4000-8000-000000000101","label":"Signed edition","format":"hardcover","isbn":"","publisher":"","published":"2026-09","pages":null,"cover":""},
 {"id":"f9600000-0000-4000-8000-000000000102","label":"Audio","format":"audiobook","isbn":"","publisher":"","published":"","pages":null,"cover":""}],
 "copies":[
 {"id":"f9600000-0000-4000-8000-000000000200","editionId":"f9600000-0000-4000-8000-000000000100","state":"owned","label":"","location":"Home"},
 {"id":"f9600000-0000-4000-8000-000000000201","editionId":"f9600000-0000-4000-8000-000000000101","state":"owned","label":"Signed","location":"Study"},
 {"id":"f9600000-0000-4000-8000-000000000202","editionId":"f9600000-0000-4000-8000-000000000101","state":"owned","label":"Second hardback","location":""},
 {"id":"f9600000-0000-4000-8000-000000000203","editionId":"f9600000-0000-4000-8000-000000000102","state":"borrowed","label":"","location":"Library"}]}',true);
select lives_ok($$select public.save_copy_inventory('f9600000-0000-4000-8000-000000000010',0,current_setting('test.inventory')::jsonb)$$,'owner saves multiple editions and identical copies');
select is((select copy_inventory_revision from public.books where id='f9600000-0000-4000-8000-000000000010'),1,'inventory save increments revision');
select is((select jsonb_array_length(copy_inventory->'copies') from public.books where id='f9600000-0000-4000-8000-000000000010'),4,'four distinct copies retained');
select ok((select ownership='owned' and borrowed and owned_physical='yes' and owned_audiobook from public.books where id='f9600000-0000-4000-8000-000000000010'),'aggregate includes paperback hardback and borrowed audio');
select ok((select progress=45 and read_status='Reading' and rating=4 from public.books where id='f9600000-0000-4000-8000-000000000010'),'reading state and rating unchanged');
select is((select count(*) from public.reads where book_id='f9600000-0000-4000-8000-000000000010'),1::bigint,'no new reading history');
select lives_ok($$select public.save_copy_inventory('f9600000-0000-4000-8000-000000000010',0,current_setting('test.inventory')::jsonb)$$,'identical retry after lost response succeeds read-only');
select is((select copy_inventory_revision from public.books where id='f9600000-0000-4000-8000-000000000010'),1,'retry does not increment or add copies');
select throws_ok($$select public.save_copy_inventory('f9600000-0000-4000-8000-000000000010',0,jsonb_set(current_setting('test.inventory')::jsonb,'{copies,0,location}','"Elsewhere"'))$$,'PT409',null,'stale draft rejected');
select throws_ok($$update public.books set ownership='unowned' where id='f9600000-0000-4000-8000-000000000010'$$,'P0001','Manage possession in Your editions & copies','legacy possession control cannot erase copy facts');
select lives_ok($$update public.books set progress=51 where id='f9600000-0000-4000-8000-000000000010'$$,'ordinary reading edits still work');
select throws_ok($$update public.books set copy_inventory=null where id='f9600000-0000-4000-8000-000000000010'$$,'P0001',null,'cannot lose inventory by clearing field');
select is(public.valid_copy_inventory(jsonb_set(current_setting('test.inventory')::jsonb,'{editions,0,published}','"2026-02-29"')),false,'impossible date rejected');
select is(public.valid_copy_inventory(jsonb_set(current_setting('test.inventory')::jsonb,'{editions,0,pages}','0')),false,'zero pages rejected');
select is(public.valid_copy_inventory(jsonb_set(current_setting('test.inventory')::jsonb,'{copies,0,editionId}','"unknown"')),false,'orphan copy rejected');
select is(public.valid_copy_inventory(jsonb_set(current_setting('test.inventory')::jsonb,'{copies,1,id}','"f9600000-0000-4000-8000-000000000200"')),false,'duplicate copy ID rejected');
select is(public.valid_copy_inventory(jsonb_set(current_setting('test.inventory')::jsonb,'{editions,0,cover}','"javascript:alert(1)"')),false,'unsafe cover rejected');
insert into public.books(id,owner_id,title,author_first,author_last) values ('f9600000-0000-4000-8000-000000000011','f9600000-0000-4000-8000-000000000001','Another book','Test','Reader');
select throws_ok($$select public.merge_books_authoritative('f9600000-0000-4000-8000-000000000011','f9600000-0000-4000-8000-000000000010','{}')$$,'P0001','These books have individual editions and copies. Keep both to preserve their inventories.','merge refuses before deleting inventoried loser');
select is((select count(*) from public.books where id in ('f9600000-0000-4000-8000-000000000010','f9600000-0000-4000-8000-000000000011')),2::bigint,'both records survive rejected merge');
select set_config('request.jwt.claims','{"sub":"f9600000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.books where id='f9600000-0000-4000-8000-000000000010'),0::bigint,'other reader cannot see private copy locations');
select throws_ok($$select public.save_copy_inventory('f9600000-0000-4000-8000-000000000010',1,current_setting('test.inventory')::jsonb)$$,'42501','Book unavailable','other reader cannot write inventory');
reset role;
set local role anon;
select throws_ok($$select public.save_copy_inventory('f9600000-0000-4000-8000-000000000010',1,'{}')$$,'42501',null,'anonymous role denied by ACL');
reset role;
select ok(not has_function_privilege('service_role','public.save_copy_inventory(uuid,integer,jsonb)','execute'),'service role has no unintended RPC grant');
select is(public.valid_copy_inventory(jsonb_set(current_setting('test.inventory')::jsonb,'{editions,0,sourceUrl}','"https://hardcover.app/books/copies-test"')),true,'release source link accepted');
select is(public.valid_copy_inventory(jsonb_set(current_setting('test.inventory')::jsonb,'{editions,0,sourceUrl}','"https://hardcover.app.evil.test/books/copies-test"')),false,'source lookalike rejected');
select is(public.valid_copy_inventory(jsonb_set(current_setting('test.inventory')::jsonb,'{editions,0,sourceUrl}','"https://hardcover.app/books/copies-test?token=private"')),false,'source query data rejected');
select * from finish();
rollback;
