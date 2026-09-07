-- Deliberate shared-cover curation. No existing catalog or personal rows are backfilled.
-- The review transaction reuses the existing corpus ingestion/selection boundary; a review
-- never edits a personal copy or infers a bibliographic correction from an image.
create table public.corpus_cover_reviews (
  work_id uuid primary key references public.works(id) on delete cascade,
  fingerprint text not null,
  revision integer not null check (revision > 0),
  state text not null check (state in ('approved', 'flagged', 'deferred')),
  reason text check (reason in ('identity', 'artwork', 'broken', 'soft')),
  note text not null default '' check (length(note) <= 600),
  measurement jsonb,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz not null default now()
);
create table public.corpus_cover_review_events (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete restrict,
  action text not null check (action in ('keep', 'replace', 'flag', 'defer', 'reopen')),
  previous_value jsonb not null,
  next_value jsonb not null,
  editor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index corpus_cover_review_events_work_idx
  on public.corpus_cover_review_events(work_id, created_at desc, id);

alter table public.corpus_cover_reviews enable row level security;
alter table public.corpus_cover_review_events enable row level security;
revoke all on public.corpus_cover_reviews, public.corpus_cover_review_events
  from public, anon, authenticated, service_role;
grant select on public.corpus_cover_reviews, public.corpus_cover_review_events to authenticated;
grant all on public.corpus_cover_reviews, public.corpus_cover_review_events to service_role;
create policy "administrators read cover reviews" on public.corpus_cover_reviews
  for select to authenticated using ((select public.is_corpus_admin()));
create policy "administrators read cover review history" on public.corpus_cover_review_events
  for select to authenticated using ((select public.is_corpus_admin()));

create function public.corpus_cover_review_fingerprint(p_work public.works)
returns text language sql immutable set search_path = '' as $$
  select md5(jsonb_build_array(p_work.title, p_work.author_text, p_work.contributors,
    p_work.isbns, p_work.cover_url, p_work.cover_source, p_work.cover_source_url,
    p_work.cover_color, p_work.cover_options)::text);
$$;
revoke all on function public.corpus_cover_review_fingerprint(public.works)
  from public, anon, authenticated, service_role;

create function public.admin_list_corpus_cover_reviews(
  p_state text default 'attention', p_query text default '', p_offset integer default 0,
  p_limit integer default 20, p_work uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_corpus_admin() then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  if p_state is null or p_state not in ('attention','deferred','approved','all')
    or p_limit is null or p_limit not between 1 and 25
    or p_offset is null or p_offset not between 0 and 100000
    or p_query is null or length(p_query) > 200 then
    raise exception 'invalid review queue request' using errcode = '22023';
  end if;
  with catalog as (
    select w.*, public.corpus_cover_review_fingerprint(w) as fingerprint,
      coalesce(r.revision, 0) as review_revision,
      case when r.fingerprint = public.corpus_cover_review_fingerprint(w)
        then r.state else 'unreviewed' end as review_state,
      case when r.fingerprint = public.corpus_cover_review_fingerprint(w)
        then r.reason end as review_reason,
      case when r.fingerprint = public.corpus_cover_review_fingerprint(w)
        then r.note end as review_note,
      case when r.fingerprint = public.corpus_cover_review_fingerprint(w)
        then r.measurement end as measurement,
      r.reviewed_at
    from public.works w left join public.corpus_cover_reviews r on r.work_id = w.id
    where (p_work is null or w.id = p_work)
      and (p_query = '' or strpos(lower(w.title || ' ' || coalesce(w.author_text,'')),
        lower(trim(p_query))) > 0 or p_query = any(w.isbns))
  ), filtered as (
    select *, case
      when review_reason in ('identity','artwork') then 0
      when nullif(trim(cover_url),'') is null then 1
      when review_reason = 'broken' then 2
      when review_reason = 'soft' then 3 else 4 end as priority
    from catalog
    where p_state = 'all' or review_state = p_state
      or (p_state = 'attention' and review_state in ('unreviewed','flagged'))
  ), page as (
    select * from filtered order by priority, lower(title), id limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'author', coalesce(author_text,''), 'isbns', isbns,
      'cover', cover_url, 'source', cover_source, 'sourceUrl', cover_source_url,
      'confidence', cover_confidence, 'fingerprint', fingerprint,
      'revision', review_revision, 'state', review_state, 'reason', review_reason,
      'note', coalesce(review_note,''), 'measurement', measurement, 'reviewedAt', reviewed_at
    ) order by priority, lower(title), id) from page), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_list_corpus_cover_reviews(text,text,integer,integer,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_corpus_cover_reviews(text,text,integer,integer,uuid)
  to authenticated;

create function public.admin_review_corpus_cover(
  p_work uuid, p_expected_fingerprint text, p_expected_revision integer, p_action text,
  p_note text default '', p_reason text default null, p_measurement jsonb default null,
  p_identity_confirmed boolean default false, p_candidate jsonb default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  work_row public.works;
  previous_review public.corpus_cover_reviews;
  saved_review public.corpus_cover_reviews;
  previous_cover jsonb;
  next_cover jsonb;
  reviewed_identity jsonb;
  next_state text;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- Same lock order as set_corpus_work_cover: profile -> administrator -> work.
  perform 1 from public.profiles where id = caller for key share;
  perform 1 from public.corpus_admins where user_id = caller for update;
  if not found then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  select * into work_row from public.works where id = p_work for update;
  if not found then raise exception 'corpus work not found' using errcode = 'P0002'; end if;
  select * into previous_review from public.corpus_cover_reviews where work_id = p_work for update;
  if p_expected_fingerprint is distinct from public.corpus_cover_review_fingerprint(work_row)
    or p_expected_revision is distinct from coalesce(previous_review.revision, 0) then
    raise exception 'This catalog record or review changed. Refresh before deciding.'
      using errcode = 'P0001';
  end if;
  if p_action is null or p_action not in ('keep','replace','flag','defer','reopen')
    or p_note is null or length(p_note) > 600
    or (p_reason is not null and p_reason not in ('identity','artwork','broken','soft'))
    or (p_action = 'flag' and p_reason is null)
    or (p_action <> 'replace' and p_candidate is not null) then
    raise exception 'invalid cover review decision' using errcode = '22023';
  end if;
  if p_measurement is not null then
    if jsonb_typeof(p_measurement) <> 'object'
      or coalesce(p_measurement->>'url','') !~ '^https?://'
      or coalesce(p_measurement->>'width','') !~ '^[0-9]{1,6}$'
      or coalesce(p_measurement->>'height','') !~ '^[0-9]{1,6}$' then
      raise exception 'invalid image measurement' using errcode = '22023';
    end if;
    if (p_measurement->>'width')::integer < 50 or (p_measurement->>'height')::integer < 50 then
      raise exception 'image is too small to review as cover art' using errcode = '22023';
    end if;
    -- Measurements are attributed browser observations, never provider or identity certification.
    p_measurement := jsonb_build_object('url', p_measurement->>'url',
      'width', (p_measurement->>'width')::integer, 'height', (p_measurement->>'height')::integer,
      'basis', 'browser_decode');
  end if;
  if p_action in ('keep','replace') and
    (p_identity_confirmed is distinct from true or p_measurement is null) then
    raise exception 'confirm the cover identity and load its image before approval' using errcode = '22023';
  end if;
  if p_action = 'keep' and nullif(trim(work_row.cover_url),'') is null then
    raise exception 'a missing cover cannot be approved' using errcode = '22023';
  end if;
  reviewed_identity := jsonb_build_object('title', work_row.title, 'author', work_row.author_text,
    'contributors', work_row.contributors, 'isbns', work_row.isbns);
  previous_cover := jsonb_build_object('url', work_row.cover_url,
    'source', work_row.cover_source, 'sourceUrl', work_row.cover_source_url);
  if p_action = 'replace' then
    if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' then
      raise exception 'a replacement cover is required' using errcode = '22023';
    end if;
    perform public.set_corpus_work_cover(p_work, p_candidate->>'url', p_candidate->>'source',
      p_candidate->>'sourceUrl', p_candidate->>'color');
    select * into work_row from public.works where id = p_work;
  end if;
  next_cover := jsonb_build_object('url', work_row.cover_url,
    'source', work_row.cover_source, 'sourceUrl', work_row.cover_source_url);
  next_state := case when p_action in ('keep','replace') then 'approved'
    when p_action = 'defer' then 'deferred' else 'flagged' end;
  insert into public.corpus_cover_reviews(work_id, fingerprint, revision, state, reason,
    note, measurement, reviewed_by, reviewed_at)
  values(p_work, public.corpus_cover_review_fingerprint(work_row), coalesce(previous_review.revision,0)+1,
    next_state, case when p_action in ('keep','replace','reopen') then null else p_reason end,
    trim(p_note), p_measurement, caller, now())
  on conflict (work_id) do update set fingerprint = excluded.fingerprint,
    revision = excluded.revision, state = excluded.state, reason = excluded.reason,
    note = excluded.note, measurement = excluded.measurement, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at
  returning * into saved_review;
  insert into public.corpus_cover_review_events(work_id, action, previous_value, next_value, editor_id)
  values(p_work, p_action,
    jsonb_build_object('identity', reviewed_identity, 'cover', previous_cover, 'review', to_jsonb(previous_review)),
    jsonb_build_object('identity', reviewed_identity, 'cover', next_cover, 'review', to_jsonb(saved_review),
      'identityConfirmed', p_identity_confirmed), caller);
  return p_work;
end;
$$;
revoke all on function public.admin_review_corpus_cover(uuid,text,integer,text,text,text,jsonb,boolean,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_review_corpus_cover(uuid,text,integer,text,text,text,jsonb,boolean,jsonb)
  to authenticated;
