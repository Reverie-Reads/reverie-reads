begin;
select no_plan();
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('ba600000-0000-4000-8000-000000000001','authenticated','authenticated','planner-reader@example.com','{}','{}',now(),now()),
 ('ba600000-0000-4000-8000-000000000002','authenticated','authenticated','planner-other@example.com','{}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ba600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$insert into public.reader_planner_entries(id,kind,title,timing) values ('ba600000-0000-4000-8000-000000000010','watch','A future title','2027-09')$$,'save a month-only release watch');
select is((select count(*) from public.books where owner_id=auth.uid()),0::bigint,'watch creates no personal books');
select throws_ok($$insert into public.reader_planner_entries(id,kind,title,timing) values ('ba600000-0000-4000-8000-000000000011','plan','Impossible date','2027-02-31')$$,'22008',null,'invalid day rejected');
select throws_ok($$select public.review_personal_series_publication('ba600000-0000-4000-8000-000000000001')$$,'42501',null,'only administrators can prepare shared publication');
select throws_ok($$select public.publish_personal_book_tag(null,null,null,null)$$,'42501',null,'only administrators can push a personal tag');
select throws_ok($$select public.set_household_cover('ba600000-0000-4000-8000-000000000001',null,null,null,null)$$,'42501',null,'membership is required to clear a cover');
insert into public.series(id,owner_id,name) values
('ba600000-0000-4000-8000-000000000020',auth.uid(),'North'),
('ba600000-0000-4000-8000-000000000021',auth.uid(),'North draft');
select is(public.name_distinct_personal_series('ba600000-0000-4000-8000-000000000021','ba600000-0000-4000-8000-000000000020','North','Second author','North draft'),'North · Second author','same-title series keeps an independent filing name');
select is((select count(*) from public.series where owner_id=auth.uid() and coalesce(display_name,name)='North'),2::bigint,'two distinct series share a display title');
select throws_ok($$select public.name_distinct_personal_series('ba600000-0000-4000-8000-000000000021','ba600000-0000-4000-8000-000000000020','North','Changed','North draft')$$,'PT409',null,'stale rename cannot change another edition of the series');
select set_config('request.jwt.claims','{"sub":"ba600000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.reader_planner_entries),0::bigint,'other reader cannot see watches');
select * from finish();
rollback;
