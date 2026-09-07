-- Administrator metadata triage. No backfill, identity reassignment, or personal-row writes.
-- A description is the only editable bibliographic field in this first workspace.
create table public.corpus_metadata_reviews (
  work_id uuid primary key references public.works(id) on delete cascade,
  fingerprint text not null,
  revision integer not null check (revision > 0),
  state text not null check (state in ('reviewed','deferred','open')),
  note text not null default '' check (length(note) <= 1200),
  source_url text not null default '' check (length(source_url) <= 2000),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz not null default now()
);
create table public.corpus_metadata_review_events (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete restrict,
  action text not null check (action in ('description','reviewed','defer','reopen')),
  previous_value jsonb not null,
  next_value jsonb not null,
  editor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index corpus_metadata_review_events_work_idx on public.corpus_metadata_review_events(work_id, created_at desc, id);
alter table public.corpus_metadata_reviews enable row level security;
alter table public.corpus_metadata_review_events enable row level security;
revoke all on public.corpus_metadata_reviews, public.corpus_metadata_review_events from public, anon, authenticated, service_role;
grant select on public.corpus_metadata_reviews, public.corpus_metadata_review_events to authenticated;
grant all on public.corpus_metadata_reviews, public.corpus_metadata_review_events to service_role;
create policy "administrators read metadata reviews" on public.corpus_metadata_reviews for select to authenticated using ((select public.is_corpus_admin()));
create policy "administrators read metadata history" on public.corpus_metadata_review_events for select to authenticated using ((select public.is_corpus_admin()));

create function public.catalog_review_isbns(p_isbns text[])
returns text[] language sql immutable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct public.canonical_library_isbn(i) order by public.canonical_library_isbn(i)), '{}')
  from unnest(p_isbns) i where public.library_isbn_checksum_is_valid(i);
$$;
revoke all on function public.catalog_review_isbns(text[]) from public, anon, authenticated, service_role;
-- Index expressions also run during service-role writes; this pure helper reveals no records.
grant execute on function public.catalog_review_isbns(text[]) to service_role;
create index works_review_isbns_idx on public.works using gin (public.catalog_review_isbns(isbns));
create index works_review_identity_idx on public.works (public.library_work_key(title, author_text));

-- Internal read model: exact normalized title/full-author or checksum-valid equivalent ISBNs.
-- Similar spelling is not a match. Missing author/title is never duplicate evidence.
create function public.catalog_metadata_review_record(p_work public.works)
returns jsonb language sql stable security definer set search_path = '' as $$
  with related as (
    select w.id, w.title, coalesce(w.author_text,'') as author, w.isbns,
      w.description, w.pub_y, w.publisher, w.language,
      public.catalog_review_isbns(w.isbns) && public.catalog_review_isbns(p_work.isbns) as isbn_match,
      (nullif(trim(p_work.title),'') is not null and nullif(trim(p_work.author_text),'') is not null
        and public.library_work_key(w.title,w.author_text) = public.library_work_key(p_work.title,p_work.author_text)) as identity_match
    from public.works w where w.id <> p_work.id and (
      public.catalog_review_isbns(w.isbns) && public.catalog_review_isbns(p_work.isbns)
      or (nullif(trim(p_work.title),'') is not null and nullif(trim(p_work.author_text),'') is not null
        and public.library_work_key(w.title,w.author_text) = public.library_work_key(p_work.title,p_work.author_text))
    )
  ), evidence as (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') as peers,
      coalesce(bool_or(isbn_match),false) as conflict,
      coalesce(bool_or(identity_match),false) as duplicate from related r
  )
  select jsonb_build_object(
    'id', p_work.id, 'title', p_work.title, 'author', coalesce(p_work.author_text,''),
    'contributors', p_work.contributors, 'isbns', p_work.isbns, 'description', coalesce(p_work.description,''),
    'descriptionSource', p_work.metadata_provenance->'description'->>'sourceRef',
    'cover', p_work.cover_url, 'year', p_work.pub_y, 'publisher', p_work.publisher, 'language', p_work.language,
    'issues', to_jsonb(array_remove(array[
      case when conflict then 'isbn_conflict' end,
      case when duplicate then 'duplicate_identity' end,
      case when exists(select 1 from unnest(p_work.isbns) i where not public.library_isbn_checksum_is_valid(i)) then 'invalid_isbn' end,
      case when nullif(btrim(p_work.description, E' \t\r\n'),'') is null then 'description' end
    ],null)),
    'related', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select * from related order by id limit 10) r),'[]'),
    'relatedTotal', (select count(*) from related),
    'fingerprint', md5(jsonb_build_array(p_work.title,p_work.author_text,p_work.contributors,p_work.isbns,
      p_work.description,p_work.metadata_provenance->'description',p_work.pub_y,p_work.publisher,p_work.language,peers)::text)
  ) from evidence;
$$;
revoke all on function public.catalog_metadata_review_record(public.works) from public, anon, authenticated, service_role;

create function public.admin_list_corpus_metadata_reviews(
  p_state text default 'attention', p_issue text default 'all', p_query text default '',
  p_offset integer default 0, p_limit integer default 20, p_work uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_corpus_admin() then raise exception 'corpus administrator required' using errcode = '42501'; end if;
  if p_state is null or p_state not in ('attention','reviewed','deferred','all')
    or p_issue is null or p_issue not in ('all','description','invalid_isbn','isbn_conflict','duplicate_identity')
    or p_query is null or length(p_query)>200 or p_offset is null or p_offset not between 0 and 100000
    or p_limit is null or p_limit not between 1 and 25 then
    raise exception 'invalid metadata queue request' using errcode = '22023';
  end if;
  with records as materialized (
    select w.id, w.title, public.catalog_metadata_review_record(w) as item
    from public.works w where (p_work is null or w.id=p_work)
      and (trim(p_query)='' or strpos(lower(w.title || ' ' || coalesce(w.author_text,'')),lower(trim(p_query)))>0
        or trim(p_query)=any(w.isbns)
        or (public.library_isbn_checksum_is_valid(p_query) and public.canonical_library_isbn(p_query)=any(public.catalog_review_isbns(w.isbns))))
  ), catalog as (
    select w.*, coalesce(r.revision,0) as revision,
      case when r.fingerprint=w.item->>'fingerprint' then r.state else 'open' end as state,
      case when r.fingerprint=w.item->>'fingerprint' then r.note else '' end as note,
      case when r.fingerprint=w.item->>'fingerprint' then r.source_url else '' end as source_url
    from records w left join public.corpus_metadata_reviews r on r.work_id=w.id
  ), filtered as (
    select *, case when item->'issues' ? 'isbn_conflict' then 0 when item->'issues' ? 'duplicate_identity' then 1
      when item->'issues' ? 'invalid_isbn' then 2 else 3 end as priority
    from catalog where (p_state='all' or state=p_state or (p_state='attention' and state='open' and jsonb_array_length(item->'issues')>0))
      and (p_issue='all' or item->'issues' ? p_issue)
  ), page as (select * from filtered order by priority,lower(title),id limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from filtered), 'items',coalesce((select jsonb_agg(
    item || jsonb_build_object('revision',revision,'state',state,'note',note,'sourceUrl',source_url)
    order by priority,lower(title),id) from page),'[]')) into result;
  return result;
end;
$$;
revoke all on function public.admin_list_corpus_metadata_reviews(text,text,text,integer,integer,uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_corpus_metadata_reviews(text,text,text,integer,integer,uuid) to authenticated;

create function public.admin_review_corpus_metadata(
  p_work uuid, p_expected_fingerprint text, p_expected_revision integer, p_action text,
  p_note text default '', p_source_url text default '', p_description text default null,
  p_identity_confirmed boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  work_row public.works;
  previous_review public.corpus_metadata_reviews;
  saved_review public.corpus_metadata_reviews;
  before_record jsonb;
  after_record jsonb;
begin
  if caller is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform 1 from public.profiles where id=caller for key share;
  perform 1 from public.corpus_admins where user_id=caller for update;
  if not found then raise exception 'corpus administrator required' using errcode = '42501'; end if;
  select * into work_row from public.works where id=p_work for update;
  if not found then raise exception 'corpus work not found' using errcode = 'P0002'; end if;
  before_record := public.catalog_metadata_review_record(work_row);
  select * into previous_review from public.corpus_metadata_reviews where work_id=p_work for update;
  if p_expected_fingerprint is distinct from before_record->>'fingerprint'
    or p_expected_revision is distinct from coalesce(previous_review.revision,0) then
    raise exception 'This catalog record or review changed. Refresh before deciding.' using errcode = 'P0001';
  end if;
  if p_action is null or p_action not in ('description','reviewed','defer','reopen')
    or p_note is null or length(p_note)>1200 or p_source_url is null or length(p_source_url)>2000
    or (p_source_url<>'' and p_source_url !~ '^https://[^[:space:]/?#]+[^[:space:]]*$')
    or (p_action<>'description' and p_description is not null)
    or (p_action in ('description','reviewed') and (nullif(btrim(p_note, E' \t\r\n'),'') is null or p_identity_confirmed is distinct from true)) then
    raise exception 'Confirm the book identity and record your evidence before completing a review.' using errcode = '22023';
  end if;
  if p_action='description' then
    if p_description is null or nullif(btrim(p_description, E' \t\r\n'),'') is null or length(p_description)>12000
      or p_source_url='' then
      raise exception 'A description and HTTPS source link are required.' using errcode = '22023';
    end if;
    -- Deliberately narrow: no call to the broad editor that also establishes manual series intent.
    update public.works set description=btrim(p_description, E' \t\r\n'), updated_at=now(),
      metadata_provenance=coalesce(metadata_provenance,'{}') || jsonb_build_object('description',
        jsonb_build_object('source','manual','sourceRef',trim(p_source_url),'observedAt',now()))
      where id=p_work returning * into work_row;
    insert into public.work_metadata_edits(work_id,editor_id,previous_value,next_value)
      values(p_work,caller,jsonb_build_object('description',before_record->>'description'),
        jsonb_build_object('description',work_row.description,'sourceUrl',p_source_url));
  end if;
  after_record := public.catalog_metadata_review_record(work_row);
  insert into public.corpus_metadata_reviews(work_id,fingerprint,revision,state,note,source_url,reviewed_by)
    values(p_work,after_record->>'fingerprint',coalesce(previous_review.revision,0)+1,
      case when p_action='reviewed' then 'reviewed' when p_action='defer' then 'deferred' else 'open' end,
      trim(p_note),trim(p_source_url),caller)
    on conflict(work_id) do update set fingerprint=excluded.fingerprint,revision=excluded.revision,state=excluded.state,
      note=excluded.note,source_url=excluded.source_url,reviewed_by=excluded.reviewed_by,reviewed_at=now()
    returning * into saved_review;
  -- Full evidence snapshots stay admin-only; public edit history gets only the description/source.
  insert into public.corpus_metadata_review_events(work_id,action,previous_value,next_value,editor_id)
    values(p_work,p_action,jsonb_build_object('record',before_record,'review',to_jsonb(previous_review)),
      jsonb_build_object('record',after_record,'review',to_jsonb(saved_review),'identityConfirmed',p_identity_confirmed),caller);
  return p_work;
end;
$$;
revoke all on function public.admin_review_corpus_metadata(uuid,text,integer,text,text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_review_corpus_metadata(uuid,text,integer,text,text,text,text,boolean) to authenticated;
