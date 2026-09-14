begin;
select no_plan();

select ok(
  not has_function_privilege('authenticated', 'public.validate_publication_tuple_write()', 'EXECUTE'),
  'publication tuple trigger function is not a reader endpoint'
);

select lives_ok(
  $$insert into public.works(id,work_key,title,author_text,pub_y,pub_m,pub_d) values
    ('ac000000-0000-4000-8000-000000000001','date-guard-valid','Date guard valid','Date Writer',2024,2,29),
    ('ac000000-0000-4000-8000-000000000002','date-guard-year','Date guard year','Date Writer',2025,null,null),
    ('ac000000-0000-4000-8000-000000000003','date-guard-month','Date guard month','Date Writer',2025,2,null),
    ('ac000000-0000-4000-8000-000000000004','date-guard-unknown','Date guard unknown','Date Writer',null,null,null)$$,
  'valid work publication precisions are accepted'
);
select throws_ok(
  $$insert into public.works(id,work_key,title,author_text,pub_y,pub_m,pub_d) values
    ('ac000000-0000-4000-8000-000000000005','date-guard-invalid','Date guard invalid','Date Writer',2025,2,29)$$,
  '22007',
  'Use a valid year, year-month, or complete publication date.',
  'an impossible work date is rejected on insert'
);
select throws_ok(
  $$update public.works set pub_m=null,pub_d=15 where id='ac000000-0000-4000-8000-000000000001'$$,
  '22007',
  'Use a valid year, year-month, or complete publication date.',
  'a disconnected work date is rejected on update'
);

-- Recreate a pre-guard work solely to prove that unrelated repairs remain possible.
alter table public.works disable trigger works_validate_publication_tuple;
insert into public.works(id,work_key,title,author_text,pub_y,pub_m,pub_d)
values ('ac000000-0000-4000-8000-000000000006','date-guard-legacy-work','Date guard legacy work','Date Writer',2025,2,29);
alter table public.works enable trigger works_validate_publication_tuple;
select lives_ok(
  $$update public.works set description='Unrelated repair' where id='ac000000-0000-4000-8000-000000000006'$$,
  'an unrelated work update does not strand historical invalid data'
);
select is(
  (select array[pub_y,pub_m,pub_d]::int[] from public.works where id='ac000000-0000-4000-8000-000000000006'),
  array[2025,2,29],
  'an unrelated work update preserves the historical tuple'
);
select lives_ok(
  $$update public.works set pub_y=2024 where id='ac000000-0000-4000-8000-000000000006'$$,
  'a historical invalid work date can be corrected'
);

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values ('ac000000-0000-4000-8000-000000000010','authenticated','authenticated','date-guard-reader@example.com','{}','{}');
select lives_ok(
  $$insert into public.books(id,owner_id,title,pub_y,pub_m,pub_d) values
    ('ac000000-0000-4000-8000-000000000011','ac000000-0000-4000-8000-000000000010','Date guard personal year',2025,null,null),
    ('ac000000-0000-4000-8000-000000000012','ac000000-0000-4000-8000-000000000010','Date guard personal complete',2024,2,29)$$,
  'valid personal publication precisions are accepted'
);
select throws_ok(
  $$insert into public.books(id,owner_id,title,pub_y,pub_m,pub_d) values
    ('ac000000-0000-4000-8000-000000000013','ac000000-0000-4000-8000-000000000010','Date guard personal invalid',2025,4,31)$$,
  '22007',
  'Use a valid year, year-month, or complete publication date.',
  'an impossible personal date is rejected on insert'
);
select throws_ok(
  $$update public.books set pub_y=null where id='ac000000-0000-4000-8000-000000000012'$$,
  '22007',
  'Use a valid year, year-month, or complete publication date.',
  'a disconnected personal date is rejected on update'
);

-- The same grandfathering rule applies to the one known historical personal date.
alter table public.books disable trigger books_validate_publication_tuple;
insert into public.books(id,owner_id,corpus_work_id,title,authors_display,pub_y,pub_m,pub_d)
values (
  'ac000000-0000-4000-8000-000000000014',
  'ac000000-0000-4000-8000-000000000010',
  'ac000000-0000-4000-8000-000000000001',
  'Date guard valid',
  'Date Writer',
  2025,
  2,
  29
);
alter table public.books enable trigger books_validate_publication_tuple;
select lives_ok(
  $$update public.books set fave=true where id='ac000000-0000-4000-8000-000000000014'$$,
  'an unrelated personal update does not strand historical invalid data'
);
select throws_ok(
  $$update public.books set pub_m=4,pub_d=31 where id='ac000000-0000-4000-8000-000000000014'$$,
  '22007',
  'Use a valid year, year-month, or complete publication date.',
  'a historical invalid personal tuple cannot be replaced with another invalid tuple'
);
select lives_ok(
  $$update public.books set pub_y=null,pub_m=null,pub_d=null where id='ac000000-0000-4000-8000-000000000014'$$,
  'a historical invalid personal date can be cleared'
);

select * from finish();
rollback;
