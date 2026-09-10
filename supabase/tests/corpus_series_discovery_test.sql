begin;
select plan(51);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('b1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'series-admin@example.com', '{}', '{"display_name":"Series Admin"}', now(), now()),
  ('b1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'series-reader@example.com', '{}', '{"display_name":"Series Reader"}', now(), now());

insert into public.corpus_admins (user_id)
values ('b1000000-0000-4000-8000-000000000001');

insert into public.works (
  id, work_key, title, author_text, contributors, series, position, series_count
)
values
  ('b2000000-0000-4000-8000-000000000001', 'unknown-series|writer', 'Unknown Series', 'A Writer', '[]', null, null, null),
  ('b2000000-0000-4000-8000-000000000002', 'no-series|writer', 'No Series Result', 'A Writer', '[]', null, null, null),
  ('b2000000-0000-4000-8000-000000000003', 'high-series|writer', 'High Match', 'A Writer', '[]', null, 9, null),
  ('b2000000-0000-4000-8000-000000000004', 'medium-series|writer', 'Medium Match', 'A Writer', '[]', null, null, null),
  ('b2000000-0000-4000-8000-000000000005', 'conflict-series|writer', 'Conflict Match', 'A Writer', '[]', 'Curated Saga', 4, null),
  ('b2000000-0000-4000-8000-000000000006', 'position-conflict|writer', 'Position Conflict', 'A Writer', '[]', 'Same Saga', 4, null),
  ('b2000000-0000-4000-8000-000000000007', 'ff-match|writer', 'FF Match', 'A Writer', '[]', null, null, null),
  ('b2000000-0000-4000-8000-000000000008', 'confirmed-series|writer', 'Confirmed Match', 'A Writer', '[]', 'The Empyrean', 2, 5);

-- One automatic personal value should follow the trusted corpus default; an explicit reader value
-- on the same work must remain private authority.
insert into public.books (
  id, owner_id, corpus_work_id, title, authors_display, series, position,
  status, series_user_chosen, series_claim
) values
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002',
   'b2000000-0000-4000-8000-000000000003', 'High Match', 'A Writer',
   'Bogus Search Label', 9, 'standalone', false,
   '{"origin":"enrichment","source":"catalog","confidence":"high"}'::jsonb),
  ('b3000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002',
   'b2000000-0000-4000-8000-000000000003', 'High Match', 'A Writer',
   'My Reading Order', 7, 'ongoing', true,
   '{"origin":"reader","source":"book_edit"}'::jsonb),
  ('b3000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002',
   'b2000000-0000-4000-8000-000000000008', 'Confirmed Match', 'A Writer',
   'The Empyrean', 2, 'standalone', false,
   '{"origin":"unknown","source":"legacy_scalar"}'::jsonb),
  ('b3000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000002',
   'b2000000-0000-4000-8000-000000000006', 'Position Conflict', 'A Writer',
   'Outage Reader Choice', 7, 'ongoing', true,
   '{"origin":"reader","source":"book_edit"}'::jsonb);

select has_column('public', 'works', 'series_check_state',
  'works store a series observation separately from publication status');
select has_column('public', 'works', 'series_checked_at',
  'series discovery has its own recheck clock');
select has_table('public', 'work_series_suggestions',
  'uncertain corpus series matches have an explicit review queue');
select has_column('public', 'work_series_suggestions', 'identity_confidence',
  'series review retains book-identity confidence separately from membership confidence');

select is(
  (select series_check_state from public.works where id = 'b2000000-0000-4000-8000-000000000001'),
  'unknown', 'existing and new works begin unclassified, not presumed standalone');

set local role anon;
select throws_ok(
  $$select public.record_corpus_series_discovery(
    'b2000000-0000-4000-8000-000000000001', '{}'::jsonb, now()
  )$$,
  '42501', null, 'anonymous is refused at the function privilege boundary');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select public.record_corpus_series_discovery(
    'b2000000-0000-4000-8000-000000000001', '{}'::jsonb, now()
  )$$,
  '42501', null, 'an ordinary reader cannot record shared series evidence');
select throws_ok(
  $$insert into public.work_series_suggestions
    (work_id, proposed_series, source, confidence, checked_at)
    values ('b2000000-0000-4000-8000-000000000001', 'Injected', 'reader', 'high', now())$$,
  '42501', null, 'authenticated direct writes are refused by table privilege');
select is(
  (select count(*)::int from public.work_series_suggestions),
  0, 'RLS hides the administrator queue from an ordinary reader');

select set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.complete_corpus_work_metadata(
    'b2000000-0000-4000-8000-000000000001',
    '{"series":"Bypass Saga","position":1,"provenance":{"series":{"source":"legacy"},"seriesPosition":{"source":"legacy"}}}'::jsonb,
    '2026-09-11T00:59:00Z'
  ),
  'b2000000-0000-4000-8000-000000000001'::uuid,
  'the existing general completion endpoint remains compatible for older clients');
select ok(
  (select series is null and position is null and not (metadata_provenance ? 'series')
   from public.works where id = 'b2000000-0000-4000-8000-000000000001'),
  'the general completion endpoint cannot bypass reviewable series discovery');

select is(
  public.record_corpus_series_discovery(
    'b2000000-0000-4000-8000-000000000001',
    '{"matched":false,"confidence":"none","source":"catalog"}'::jsonb,
    '2026-09-11T01:00:00Z'
  ) ->> 'outcome',
  'unresolved', 'an unmatched lookup remains recheckable rather than asserting standalone');
select ok(
  (select series is null and status is null and series_check_state = 'unresolved'
   from public.works where id = 'b2000000-0000-4000-8000-000000000001'),
  'unresolved evidence does not manufacture series membership or change publication status');

select is(
  public.record_corpus_series_discovery(
    'b2000000-0000-4000-8000-000000000002',
    '{"matched":true,"confidence":"high","source":"hardcover","series":null}'::jsonb,
    '2026-09-11T01:01:00Z'
  ) ->> 'outcome',
  'no_series', 'a matched catalog record may record that no series was returned');
select ok(
  (select series is null and series_check_state = 'no_series' and status is null
   from public.works where id = 'b2000000-0000-4000-8000-000000000002'),
  'no-series evidence stays separate from the standalone publication-status field');

select is(
  public.record_corpus_series_discovery(
    'b2000000-0000-4000-8000-000000000003',
    '{"matched":true,"identityConfidence":"high","membershipConfidence":"high","source":"hardcover","sourceRef":"hc-series-3","series":"The Sequence","position":2,"count":3,"reason":"matched relational membership","evidence":[{"source":"hardcover","kind":"relational_membership","sourceRef":"hc-series-3","series":"The Sequence","position":2,"memberCount":3}]}'::jsonb,
    '2026-09-11T01:02:00Z'
  ) ->> 'outcome',
  'applied', 'high-confidence positive evidence fills a blank shared series');
select ok(
  (select series = 'The Sequence' and position = 2 and series_check_state = 'found'
   from public.works where id = 'b2000000-0000-4000-8000-000000000003'),
  'the accepted positive evidence preserves its series and position');
select is(
  (select metadata_provenance -> 'series' ->> 'sourceRef'
   from public.works where id = 'b2000000-0000-4000-8000-000000000003'),
  'hc-series-3', 'applied series evidence retains source identity');

-- Assert the cross-owner default as the unrestricted test role. An administrator is not the
-- personal owner, so asserting through books RLS would turn both present and missing rows into the
-- same NULL and certify nothing.
reset role;
select ok(
  (select series = 'The Sequence' and position = 2 and series_count = 3 and status = 'ongoing'
     and series_claim ->> 'origin' = 'corpus'
   from public.books where id = 'b3000000-0000-4000-8000-000000000001'),
  'trusted corpus classification seeds the eligible personal default');
select ok(
  (select series = 'My Reading Order' and position = 7
     and series_claim ->> 'origin' = 'reader'
   from public.books where id = 'b3000000-0000-4000-8000-000000000002'),
  'trusted corpus classification preserves an explicit reader series');
select is(
  (select count(*)::int from public.series_entries entry
   join public.series series_row on series_row.id = entry.series_id
   where series_row.name = 'Bogus Search Label' and entry.removed_at is null),
  0, 'replacing an automatic default retires its conflicting structured membership');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.record_corpus_series_discovery(
    'b2000000-0000-4000-8000-000000000008',
    '{"matched":true,"identityConfidence":"high","membershipConfidence":"high","source":"hardcover","sourceRef":"hc-series-8","series":"The Empyrean","position":2,"count":5,"reason":"confirmed relational membership","evidence":[{"source":"hardcover","kind":"relational_membership","sourceRef":"hc-series-8","series":"The Empyrean","position":2,"memberCount":5}]}'::jsonb,
    '2026-09-11T01:02:30Z'
  ) ->> 'outcome',
  'confirmed', 'same-tuple high-confidence evidence reports a reconciliation');

reset role;
select ok(
  (select series = 'The Empyrean' and position = 2 and series_count = 5
     and status = 'ongoing' and series_claim ->> 'origin' = 'corpus'
   from public.books where id = 'b3000000-0000-4000-8000-000000000003'),
  'same-tuple confirmation repairs the eligible personal default');
select ok(
  (select count(*) = 1
   from public.series_entries entry
   join public.series series_row on series_row.id = entry.series_id
   where entry.book_id = 'b3000000-0000-4000-8000-000000000003'
     and entry.removed_at is null
     and series_row.name = 'The Empyrean'
     and entry.membership_claim ->> 'origin' = 'corpus'),
  'same-tuple confirmation materializes the missing structured membership');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.record_corpus_series_discovery(
    'b2000000-0000-4000-8000-000000000004',
    '{"matched":true,"identityConfidence":"high","membershipConfidence":"medium","source":"hardcover","series":"Possible Saga","position":1,"count":1,"reason":"singleton needs review","evidence":[{"source":"hardcover","kind":"relational_membership","sourceRef":"hc-series-4","series":"Possible Saga","position":1,"memberCount":1}]}'::jsonb,
    '2026-09-11T01:03:00Z'
  ) ->> 'outcome',
  'review', 'medium-confidence positive evidence waits for administrator review');
select ok(
  (select series is null and series_check_state = 'review'
   from public.works where id = 'b2000000-0000-4000-8000-000000000004'),
  'a pending proposal does not pre-write the shared work');
select is(
  (select count(*)::int from public.work_series_suggestions
   where work_id = 'b2000000-0000-4000-8000-000000000004' and status = 'pending'),
  1, 'the uncertain match appears once in the administrator queue');

select is(
  public.record_corpus_series_discovery(
    'b2000000-0000-4000-8000-000000000007',
    '{"matched":true,"identityConfidence":"high","membershipConfidence":"medium","source":"fantasticfiction","sourceRef":"https://www.fantasticfiction.com/w/a-writer/ff-saga/","series":"FF Saga","position":1,"count":8,"evidence":[{"source":"fantasticfiction","kind":"relational_membership","sourceRef":"https://www.fantasticfiction.com/w/a-writer/ff-saga/","series":"FF Saga","position":1,"memberCount":8,"orderType":"publication","description":"must not be retained"}]}'::jsonb,
    '2026-09-11T01:03:30Z'
  ) ->> 'outcome',
  'review', 'Fantastic Fiction membership may surface for administrator review');
select ok(
  (select proposed_count is null
     and not (evidence -> 0 ? 'memberCount')
     and not (evidence -> 0 ? 'description')
   from public.work_series_suggestions
   where work_id = 'b2000000-0000-4000-8000-000000000007' and status = 'pending'),
  'Fantastic Fiction retains neither series size nor arbitrary page content');
select ok(
  (select evidence -> 0 ->> 'series' = 'FF Saga'
     and evidence -> 0 ->> 'position' = '1'
     and evidence -> 0 ->> 'orderType' = 'publication'
   from public.work_series_suggestions
   where work_id = 'b2000000-0000-4000-8000-000000000007' and status = 'pending'),
  'Fantastic Fiction retains only the allowed membership, series, and order facts');

select lives_ok(
  $$select public.review_corpus_series_suggestion(
    (select id from public.work_series_suggestions
     where work_id = 'b2000000-0000-4000-8000-000000000004' and status = 'pending'),
    'accept'
  )$$,
  'an administrator can accept a pending series proposal');
select ok(
  (select series = 'Possible Saga' and position = 1 and series_check_state = 'found'
   from public.works where id = 'b2000000-0000-4000-8000-000000000004'),
  'acceptance writes the reviewed shared series and position');
select is(
  (select status from public.work_series_suggestions
   where work_id = 'b2000000-0000-4000-8000-000000000004'),
  'accepted', 'the accepted proposal remains as review history');

select is(
  public.record_corpus_series_discovery(
    'b2000000-0000-4000-8000-000000000005',
    '{"matched":true,"identityConfidence":"high","membershipConfidence":"high","source":"hardcover","series":"Conflicting Saga","position":1,"count":3,"evidence":[{"source":"hardcover","kind":"relational_membership","sourceRef":"hc-series-5","series":"Conflicting Saga","position":1,"memberCount":3}]}'::jsonb,
    '2026-09-11T01:04:00Z'
  ) ->> 'outcome',
  'review', 'high-confidence evidence still cannot replace a conflicting curated series silently');
select is(
  (select concat_ws('|', series, position) from public.works
   where id = 'b2000000-0000-4000-8000-000000000005'),
  'Curated Saga|4', 'the conflict leaves existing shared metadata intact before review');
select lives_ok(
  $$select public.review_corpus_series_suggestion(
    (select id from public.work_series_suggestions
     where work_id = 'b2000000-0000-4000-8000-000000000005' and status = 'pending'),
    'dismiss'
  )$$,
  'an administrator can dismiss a conflicting proposal');
select is(
  (select concat_ws('|', series, position, series_check_state) from public.works
   where id = 'b2000000-0000-4000-8000-000000000005'),
  'Curated Saga|4|found', 'dismissal preserves the curated series and closes the review state');

select is(
  public.record_corpus_series_discovery(
    'b2000000-0000-4000-8000-000000000006',
    '{"matched":true,"identityConfidence":"high","membershipConfidence":"high","source":"hardcover","series":"Same Saga","position":1,"count":3,"evidence":[{"source":"hardcover","kind":"relational_membership","sourceRef":"hc-series-6","series":"Same Saga","position":1,"memberCount":3}]}'::jsonb,
    '2026-09-11T01:05:00Z'
  ) ->> 'outcome',
  'review', 'a high-confidence position conflict still waits for administrator review');
select ok(
  (select series = 'Same Saga' and position = 4 and series_check_state = 'review'
   from public.works where id = 'b2000000-0000-4000-8000-000000000006'),
  'a position conflict leaves the existing shared membership intact before review');

reset role;
select ok(
  (select count(*) >= 4 from public.work_metadata_edits
   where work_id in (
     'b2000000-0000-4000-8000-000000000001',
     'b2000000-0000-4000-8000-000000000002',
     'b2000000-0000-4000-8000-000000000003',
     'b2000000-0000-4000-8000-000000000004',
     'b2000000-0000-4000-8000-000000000005'
   )),
  'series discovery and review writes remain append-only audited');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select public.review_corpus_series_suggestion(
    (select id from public.work_series_suggestions
     where work_id = 'b2000000-0000-4000-8000-000000000004'),
    'accept'
  )$$,
  'P0001', null, 'a reviewed suggestion cannot be replayed');
reset role;

-- The real classifier's outage shape: a positive identity but NO confirmed series name.
-- Keep this packet aligned with seriesClassification.test.ts, not a manufactured proposed label.
select ok(
  (select corpus_work_id = 'b2000000-0000-4000-8000-000000000006'
     and series = 'Outage Reader Choice' and position = 7 and series_user_chosen
     and series_claim ->> 'origin' = 'reader'
   from public.books where id = 'b3000000-0000-4000-8000-000000000004'),
  'the outage fixture starts with a real reader choice on the affected work');
set local role authenticated;
select is(
  public.record_corpus_series_discovery(
    'b2000000-0000-4000-8000-000000000006',
    '{"outcome":"unresolved","matched":true,"series":null,"position":null,"count":null,"identityConfidence":"high","membershipConfidence":"low","source":"hardcover","sourceRef":"hc-book-2","reason":"The relational series source was unavailable; the search label was not accepted by itself.","evidence":[{"source":"hardcover","kind":"candidate_label","sourceRef":"hc-book-2","series":"The Sequence","position":99,"memberCount":null,"orderType":"unspecified"},{"source":"hardcover","kind":"provider_unavailable","sourceRef":"hc-series-7","series":"The Sequence","position":null,"memberCount":null,"orderType":"unspecified"}]}'::jsonb,
    '2026-09-11T02:00:00Z'
  ) ->> 'outcome',
  'unresolved', 'a matched identity with an unavailable relationship is not a no-series observation');
reset role;
select ok(
  (select series_check_state = 'unresolved' and series_checked_at = '2026-09-11T02:00:00Z'
     and series = 'Same Saga' and position = 4
     and series_check_evidence @> '[{"kind":"provider_unavailable","source":"hardcover"}]'
     and series_check_reason like '%source was unavailable%'
   from public.works where id = 'b2000000-0000-4000-8000-000000000006'),
  'outage records retryable state, time and evidence without replacing the existing tuple');
select is(
  (select count(*)::int from public.work_series_suggestions
   where work_id = 'b2000000-0000-4000-8000-000000000006' and status = 'pending'),
  1, 'an outage cannot supersede a pending administrator review');
set local role authenticated;
select is(
  public.record_corpus_series_discovery('b2000000-0000-4000-8000-000000000001',
    '{"matched":true,"identityConfidence":"medium","membershipConfidence":"low","series":null,"evidence":[{"source":"hardcover","kind":"candidate_label","series":"The Sequence"}]}'::jsonb
  ) ->> 'outcome', 'unresolved', 'legacy missing-membership packets remain unresolved without outcome');
select is(
  public.record_corpus_series_discovery('b2000000-0000-4000-8000-000000000001',
    '{"outcome":"no_series","matched":true,"identityConfidence":"high","series":null,"evidence":[{"source":"hardcover","kind":"provider_unavailable"}]}'::jsonb
  ) ->> 'outcome', 'unresolved', 'an explicit no-series label cannot override outage evidence');
select is(
  public.record_corpus_series_discovery('b2000000-0000-4000-8000-000000000001',
    '{"outcome":"unresolved","matched":true,"identityConfidence":"high","series":null,"evidence":[]}'::jsonb
  ) ->> 'outcome', 'unresolved', 'explicit unresolved remains unresolved even without evidence');
select is(
  public.record_corpus_series_discovery('b2000000-0000-4000-8000-000000000002',
    '{"outcome":"no_series","matched":true,"identityConfidence":"high","membershipConfidence":"none","series":null,"evidence":[]}'::jsonb
  ) ->> 'outcome', 'no_series', 'the actual successful no-label classifier packet still works');
reset role;
select ok(
  (select series is null and status is null and series_check_state = 'no_series'
   from public.works where id = 'b2000000-0000-4000-8000-000000000002'),
  'no-label observation still does not assert standalone');
select ok(
  (select series = 'Outage Reader Choice' and position = 7 and series_user_chosen
     and series_claim ->> 'origin' = 'reader'
   from public.books where id = 'b3000000-0000-4000-8000-000000000004'),
  'an outage keeps the affected work reader-chosen membership and order intact');

select * from finish();
rollback;
