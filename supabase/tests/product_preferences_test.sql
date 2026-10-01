begin;
select plan(17);
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('a4500000-0000-0000-0000-000000000001','authenticated','authenticated','products-a@example.com','{}','{}',now(),now()),
 ('a4500000-0000-0000-0000-000000000002','authenticated','authenticated','products-b@example.com','{}','{}',now(),now());
select is((select product_preferences from public.profiles where id = 'a4500000-0000-0000-0000-000000000001'), null::jsonb, 'new profile has no inferred product choice');
select is((select product_preferences_revision from public.profiles where id = 'a4500000-0000-0000-0000-000000000001'), 0, 'new choice starts at revision zero');
-- Preserve a customized Reader while enabling a second product.
update public.profiles set arrangement = '{"version":1,"priorityDestinations":["home","library","stats"],"homeModules":["year","reading","priority"]}',
 guidance = '{"version":1,"mode":"gentle","setupComplete":true}', skin = 'aphelion', mode = 'dark'
 where id = 'a4500000-0000-0000-0000-000000000001';
create temp table reader_before as select arrangement, guidance, skin, mode from public.profiles where id = 'a4500000-0000-0000-0000-000000000001';
grant select on reader_before to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a4500000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$update public.profiles set product_preferences_revision = 3 where id = auth.uid()$$, '42501', null, 'direct revision updates cannot bypass comparison');
select throws_ok($$update public.profiles set product_preferences = '{"version":1}' where id = auth.uid()$$, '42501', null, 'direct document updates cannot bypass comparison');
select is(public.save_product_preferences(auth.uid(),0,'{"version":1,"enabledProducts":["reader","collector"],"activeProduct":"collector","initialChoiceComplete":true,"presentation":{"collector":{"version":7,"dock":["trips","locations"]}}}')->>'revision', '1', 'save succeeds with an independent opaque Collector layout');
select is(public.save_product_preferences(auth.uid(),0,'{"version":1,"enabledProducts":["reader","collector"],"activeProduct":"collector","initialChoiceComplete":true,"presentation":{"collector":{"version":7,"dock":["trips","locations"]}}}')->>'revision', '1', 'lost-response replay is read-only with the original revision');
select throws_ok($$select public.save_product_preferences(auth.uid(),0,'{"version":1,"enabledProducts":["reader"],"activeProduct":"reader","initialChoiceComplete":true,"presentation":{}}')$$, 'PT409', null, 'stale different document conflicts once');
select throws_ok($$select public.save_product_preferences('a4500000-0000-0000-0000-000000000002',0,'{"version":1,"enabledProducts":["reader"],"activeProduct":"reader","initialChoiceComplete":true,"presentation":{}}')$$, '42501', null, 'cannot save another account after a session switch');
select is((select count(*)::int from public.profiles where id = 'a4500000-0000-0000-0000-000000000002'), 0, 'another profile remains unreadable');
select throws_ok($$select public.save_product_preferences(auth.uid(),1,'{"version":1,"enabledProducts":["reader","reader"],"activeProduct":"reader","initialChoiceComplete":true,"presentation":{}}')$$, '22023', null, 'duplicate products rejected');
select throws_ok($$select public.save_product_preferences(auth.uid(),1,'{"version":1,"enabledProducts":["reader"],"activeProduct":"collector","initialChoiceComplete":true,"presentation":{}}')$$, '22023', null, 'active product must be enabled');
select throws_ok($$select public.save_product_preferences(auth.uid(),1,'{"version":1,"enabledProducts":["reader"],"activeProduct":"reader","initialChoiceComplete":true,"presentation":{},"pro":true}')$$, '22023', null, 'root capability fields cannot be stored');
select results_eq($$select arrangement, guidance, skin, mode from public.profiles where id = auth.uid()$$, $$select * from reader_before$$, 'Reader arrangement, guidance and appearance are byte-for-byte unchanged');
select is((select product_preferences_revision from public.profiles where id = auth.uid()), 1, 'rejected writes and replay never increment revision');
reset role;
update public.profiles set product_preferences = '{"version":2,"unknown":"preserve"}' where id = 'a4500000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.save_product_preferences(auth.uid(),1,'{"version":1,"enabledProducts":["reader"],"activeProduct":"reader","initialChoiceComplete":true,"presentation":{}}')$$, '22023', null, 'future root cannot be overwritten by an older client');
select is((select product_preferences from public.profiles where id = auth.uid()), '{"version":2,"unknown":"preserve"}'::jsonb, 'future document is still readable without normalization');
set local role anon;
select throws_ok($$select public.save_product_preferences('a4500000-0000-0000-0000-000000000001',1,'{}')$$, '42501', null, 'anonymous callers cannot invoke save');
select * from finish();
rollback;
