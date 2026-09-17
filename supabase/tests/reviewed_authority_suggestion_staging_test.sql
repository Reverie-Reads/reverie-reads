begin;
select no_plan();

select ok(not has_function_privilege('anon',
  'public.admin_stage_reviewed_authority_series_suggestions(text,text,jsonb)','EXECUTE'),
  'anonymous callers cannot stage reviewed authority suggestions');
select ok(has_function_privilege('authenticated',
  'public.admin_stage_reviewed_authority_series_suggestions(text,text,jsonb)','EXECUTE'),
  'authenticated callers still require administrator authorization in the body');

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('78111111-1111-4111-8111-111111111111','authenticated','authenticated','authority-admin@example.com','{}','{}',now(),now()),
('78222222-2222-4222-8222-222222222222','authenticated','authenticated','authority-reader@example.com','{}','{}',now(),now());
insert into public.corpus_admins(user_id) values('78111111-1111-4111-8111-111111111111');

insert into public.works(id,work_key,title,author_text,contributors,series,position,series_check_state)
values
(
  '78000000-0000-4000-8000-000000000001','reviewed authority fixture','Reviewed Authority Fixture',
  'Exact Writer','[{"name":"Exact Writer","role":"author"}]','Old Saga',1,'found'
),
(
  '78000000-0000-4000-8000-000000000002','ordinary pending fixture','Ordinary Pending Fixture',
  'Exact Writer','[{"name":"Exact Writer","role":"author"}]','Other Saga',1,'found'
);
insert into public.books(
  id,owner_id,corpus_work_id,title,authors_display,series,position,
  series_user_chosen,series_claim,ownership
) values(
  '78000000-0000-4000-8000-000000000011','78222222-2222-4222-8222-222222222222',
  '78000000-0000-4000-8000-000000000001','Reviewed Authority Fixture','Exact Writer',
  'Reader Saga',7,true,'{"origin":"reader"}','unowned'
);

create temp table authority_personal_before as
select to_jsonb(book) value from public.books book
where id='78000000-0000-4000-8000-000000000011';
grant select on table authority_personal_before to authenticated;

create function pg_temp.authority_removal_item() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workId', work.id,
    'identityFingerprint', md5(jsonb_build_object(
      'id',work.id,'title',work.title,'contributors',work.contributors,'pubY',work.pub_y
    )::text),
    'action','review_historical_authority',
    'expectedBaseline', jsonb_build_object(
      'currentOrigin','graph',
      'currentMemberships',jsonb_build_array(jsonb_build_object(
        'series','Old Saga','position',1,'role','primary'
      )),
      'pendingSuggestionCount',0
    ),
    'expectedPendingSuggestions','[]'::jsonb,
    'proposal',jsonb_build_object(
      'action','remove','series','Old Saga','position',1,'role','primary',
      'decisionSha256',repeat('d',64)
    )
  ) from public.works work where id='78000000-0000-4000-8000-000000000001'
$$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"78111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok(
  $$select public.admin_stage_corpus_shadow_series_removal_reviews(
    repeat('a',64),repeat('b',64),jsonb_build_array(pg_temp.authority_removal_item())
  )$$,
  'fixture starts with one exact pending corpus-shadow removal review'
);
reset role;

create function pg_temp.reviewed_authority_item(p_work uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workId', work.id,
    'identityFingerprint', md5(jsonb_build_object(
      'id',work.id,'title',work.title,'contributors',work.contributors,'pubY',work.pub_y
    )::text),
    'expectedSeriesFingerprint', public.catalog_series_positive_suggestion_fingerprint(work),
    'expectedReviewRevision', coalesce(review.revision,0),
    'expectedPendingSuggestion', case when suggestion.id is null then 'null'::jsonb
      else jsonb_build_object(
        'id',suggestion.id,
        'proposalAction',suggestion.proposal_action,
        'series',suggestion.proposed_series,
        'position',suggestion.proposed_position,
        'source',suggestion.source,
        'stagingManifestSha256',suggestion.staging_manifest_sha256,
        'stagingProposalSha256',suggestion.staging_proposal_sha256
      ) end,
    'proposal',jsonb_build_object(
      'series','New Saga','position',3,'role','primary',
      'sourceUrl','https://publisher.example/series/new-saga',
      'note','Publisher series page explicitly lists this exact work as volume three.',
      'decisionSha256',repeat('e',64)
    )
  )
  from public.works work
  left join public.corpus_metadata_reviews review on review.work_id=work.id
  left join public.work_series_suggestions suggestion
    on suggestion.work_id=work.id and suggestion.status='pending'
  where work.id=p_work
$$;

create temp table authority_frozen_item(item jsonb);
insert into authority_frozen_item
values(pg_temp.reviewed_authority_item('78000000-0000-4000-8000-000000000001'));
grant select on table authority_frozen_item to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"78222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select throws_ok(
  $$select public.admin_stage_reviewed_authority_series_suggestions(
    repeat('c',64),repeat('f',64),jsonb_build_array(
      (select item from authority_frozen_item)
    )
  )$$,
  '42501','corpus administrator required','ordinary readers cannot stage reviewed findings'
);
select set_config('request.jwt.claims','{"sub":"78111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok(
  $$select public.admin_stage_reviewed_authority_series_suggestions(
    repeat('c',64),repeat('f',64),jsonb_build_array(
      (select item from authority_frozen_item)
    )
  )$$,
  'administrator can replace the exact frozen removal review with a positive suggestion'
);
select is((select status from public.work_series_suggestions
  where work_id='78000000-0000-4000-8000-000000000001'
    and source='corpus_shadow_authority_removal_review'),'superseded',
  'the exact older removal review is superseded');
select is((select proposed_series from public.work_series_suggestions
  where work_id='78000000-0000-4000-8000-000000000001'
    and status='pending'),'New Saga','the reviewed finding becomes one normal pending suggestion');
select is((select source_ref from public.work_series_suggestions
  where work_id='78000000-0000-4000-8000-000000000001'
    and status='pending'),'https://publisher.example/series/new-saga',
  'the pending suggestion retains the independently reviewed source');
select is((select series from public.works
  where id='78000000-0000-4000-8000-000000000001'),'Old Saga',
  'staging does not change the shared catalog');
reset role;
select is((select to_jsonb(book) from public.books book
  where id='78000000-0000-4000-8000-000000000011'),
  (select value from authority_personal_before),
  'staging leaves the reader-chosen personal book byte-for-byte unchanged');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"78111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok(
  $$select public.admin_stage_reviewed_authority_series_suggestions(
    repeat('c',64),repeat('f',64),jsonb_build_array(
      (select item from authority_frozen_item)
    )
  )$$,
  'replaying the same hash-bound reviewed finding is idempotent'
);
select is((select count(*) from public.work_series_suggestions
  where work_id='78000000-0000-4000-8000-000000000001' and status='pending'),1::bigint,
  'idempotent staging does not duplicate the pending suggestion');
reset role;

insert into public.work_series_suggestions(
  work_id,proposed_series,proposed_position,source,confidence,checked_at
) values(
  '78000000-0000-4000-8000-000000000002','Different Saga',2,'ordinary-review','medium',now()
);
create temp table authority_unsafe_pending_item(item jsonb);
insert into authority_unsafe_pending_item
values(pg_temp.reviewed_authority_item('78000000-0000-4000-8000-000000000002'));
grant select on table authority_unsafe_pending_item to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"78111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select throws_ok(
  $$select public.admin_stage_reviewed_authority_series_suggestions(
    repeat('1',64),repeat('2',64),jsonb_build_array(
      (select item from authority_unsafe_pending_item)
    )
  )$$,
  '22023','only an exact corpus shadow removal review may be superseded',
  'an ordinary pending suggestion cannot be displaced by this bridge'
);

select lives_ok(
  $$select public.review_corpus_series_suggestion_revisioned(
    (select id from public.work_series_suggestions
      where work_id='78000000-0000-4000-8000-000000000001' and status='pending'),
    'accept'
  )$$,
  'the existing revision-checked administrator action accepts the reviewed suggestion'
);
reset role;
select is((select series from public.works
  where id='78000000-0000-4000-8000-000000000001'),'New Saga',
  'final acceptance changes the shared series');
select is((select position from public.works
  where id='78000000-0000-4000-8000-000000000001'),3::numeric,
  'final acceptance changes the shared position');
select is((select count(*) from public.corpus_series_entries entry
  join public.corpus_series parent on parent.id=entry.series_id and parent.archived_at is null
  where entry.work_id='78000000-0000-4000-8000-000000000001'
    and entry.removed_at is null and entry.is_primary and parent.name='New Saga'),1::bigint,
  'final acceptance links the existing work to the canonical destination series');
select is((select to_jsonb(book) from public.books book
  where id='78000000-0000-4000-8000-000000000011'),
  (select value from authority_personal_before),
  'final acceptance still preserves the reader-chosen personal series');

select * from finish();
rollback;
