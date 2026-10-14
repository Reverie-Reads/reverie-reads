begin;
-- Add the shared series tuple to the same frozen record already reviewed by the administrator.
do $patch$
declare definition text; anchor text := '''isbns'',w.isbns,''fingerprint'',public.corpus_record_fingerprint(w.id),';
begin
  definition := pg_get_functiondef('public.get_corpus_record(uuid)'::regprocedure);
  if position(anchor in definition)=0 then raise exception 'corpus record snapshot changed'; end if;
  execute replace(definition, anchor,
    '''series'',jsonb_build_object(''name'',w.series,''position'',w.position,''count'',w.series_count,''status'',w.status,''confirmed'',exists(select 1 from public.corpus_series_entries e join public.corpus_series s on s.id=e.series_id where e.work_id=w.id and e.is_primary and e.removed_at is null and s.archived_at is null and public.corpus_series_identity_key(s.name)=public.corpus_series_identity_key(w.series) and e.position is not distinct from w.position)), ' || anchor);
end;
$patch$;

-- Keep the edition/guidance implementation and its narrow field masks intact.
alter function public.admin_push_corpus_record(uuid,text,jsonb,text,text,text) set schema corpus_admin_private;
revoke all on function corpus_admin_private.admin_push_corpus_record(uuid,text,jsonb,text,text,text) from public,anon,authenticated,service_role;

create function public.admin_push_corpus_record(p_work uuid,p_expected_fingerprint text,p_changes jsonb,p_review_mode text,p_source_url text default null,p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  proposal jsonb; remaining jsonb; b public.books; w public.works; before_value jsonb;
  caller uuid := (select auth.uid()); expected text := p_expected_fingerprint;
  old_manual text := current_setting('reverie.series_manual_editor',true);
  isbns_to_lock text[]; evidence jsonb; primary_series uuid;
  target_before text := current_setting('reverie.corpus_series_target',true);
  classifier_before text := current_setting('reverie.series_classifier',true);
  preserve_before text := current_setting('reverie.series_review_preserve_catalog',true);
begin
  if caller is null or not public.is_corpus_admin() then
    raise exception 'corpus administrator required' using errcode='42501'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Select changes to push.' using errcode='22023'; end if;
  if jsonb_array_length(p_changes) not between 1 and 3 or exists(
    select 1 from jsonb_array_elements(p_changes) c where jsonb_typeof(c)<>'object'
      or not c ?& array['action','value'] or c-array['action','value','fields']<>'{}'::jsonb
      or coalesce(c->>'action','') not in ('edition','guidance','series'))
    or (select count(distinct c->>'action') from jsonb_array_elements(p_changes) c)<>jsonb_array_length(p_changes) then
    raise exception 'Select one change of each kind.' using errcode='22023'; end if;
  select c into proposal from jsonb_array_elements(p_changes) c where c->>'action'='series';
  if proposal is null then
    return corpus_admin_private.admin_push_corpus_record(p_work,expected,p_changes,p_review_mode,p_source_url,p_note);
  end if;
  if p_review_mode is null or p_review_mode not in ('direct','evidence')
    or length(coalesce(p_note,''))>1200 or length(coalesce(p_source_url,''))>2000
    or (nullif(btrim(p_source_url),'') is not null and p_source_url !~ '^https://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$')
    or (p_review_mode='evidence' and (nullif(btrim(p_source_url),'') is null or nullif(btrim(p_note),'') is null)) then
    raise exception 'Evidence review needs an HTTPS link and explanation.' using errcode='22023'; end if;
  if proposal ? 'fields' or jsonb_typeof(proposal->'value') is distinct from 'object'
    or not (proposal->'value') ?& array['bookId','name','position','count','status']
    or (proposal->'value')-array['bookId','name','position','count','status']<>'{}'::jsonb then
    raise exception 'Review the saved book series as one relationship.' using errcode='22023'; end if;

  -- Follow the existing editor's profile/admin -> books -> work order, with ISBN locks first
  -- when the same transaction also publishes an edition. Never take personal locks under a work.
  perform 1 from public.profiles where id=caller for key share;
  perform 1 from public.corpus_admins where user_id=caller for update;
  if not found then raise exception 'corpus administrator required' using errcode='42501'; end if;
  select isbns into isbns_to_lock from public.works where id=p_work;
  select isbns_to_lock || coalesce(array_agg(c->'value'->>'isbn'),'{}') into isbns_to_lock
    from jsonb_array_elements(p_changes) c where c->>'action'='edition';
  perform public.lock_library_isbns(isbns_to_lock);
  perform 1 from public.books where corpus_work_id=p_work and removed_at is null order by id for update;
  select * into b from public.books where id=(proposal->'value'->>'bookId')::uuid
    and owner_id=caller and corpus_work_id=p_work and removed_at is null;
  if not found then raise exception 'Review your saved book again.' using errcode='PT409'; end if;
  if nullif(btrim(b.series),'') is null or
    (proposal->'value')-'bookId' is distinct from jsonb_build_object('name',b.series,'position',b.position,'count',b.series_count,'status',b.status)
    or not exists (select 1 from public.series_entries e join public.series s on s.id=e.series_id
      where e.book_id=b.id and e.owner_id=caller and e.is_primary and e.removed_at is null
        and s.archived_at is null and s.name=b.series and e.position is not distinct from b.position) then
    raise exception 'The saved series changed or has no confirmed membership. Reload your book.' using errcode='PT409'; end if;
  select * into w from public.works where id=p_work for update;
  if not found or expected is distinct from public.corpus_record_fingerprint(p_work) then
    raise exception 'This catalog record changed. Reload before reviewing again.' using errcode='PT409'; end if;
  before_value := jsonb_build_object('name',w.series,'position',w.position,'count',w.series_count,'status',w.status);
  select coalesce(jsonb_agg(c),'[]') into remaining from jsonb_array_elements(p_changes) c where c->>'action'<>'series';
  if jsonb_array_length(remaining)>0 then
    perform corpus_admin_private.admin_push_corpus_record(p_work,expected,remaining,p_review_mode,p_source_url,p_note);
  end if;
  select e.series_id into primary_series from public.corpus_series_entries e
    join public.corpus_series s on s.id=e.series_id
    where e.work_id=p_work and e.is_primary and e.removed_at is null and s.archived_at is null
      and public.corpus_series_identity_key(s.name)=public.corpus_series_identity_key(b.series);
  perform set_config('reverie.corpus_series_target',coalesce(primary_series::text,''),true);
  -- Reuse the authorized editor: it supersedes pending suggestions, records manual relational
  -- evidence, refreshes the shared graph, and reconciles only eligible personal defaults.
  select * into w from public.works where id=p_work;
  perform public.edit_corpus_work_metadata(p_work,b.series,b.position,b.series_count,b.status,
    w.genre,w.subgenre,w.genres,w.subgenres,w.cover_url,w.cover_options,w.pub_y,w.pub_m,w.pub_d);
  -- An unchanged legacy tuple is still an explicit publication. The ordinary editor's
  -- change-only marker cannot certify it, so publish its administrator observation here too.
  evidence := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('source','manual','kind','relational_membership',
    'sourceRef',coalesce(nullif(btrim(p_source_url),''),p_work::text),'series',b.series,'position',b.position,
    'memberCount',b.series_count,'reviewedBy',caller,'reviewMode',p_review_mode,'at',now())));
  perform set_config('reverie.series_classifier','on',true);
  perform set_config('reverie.series_review_preserve_catalog','',true);
  update public.works set series=series,position=position,series_count=series_count,
    series_check_state='found',series_checked_at=now(),series_check_source='manual',series_check_evidence=evidence,
    series_check_reason='A corpus administrator explicitly published the saved personal series relationship.',
    metadata_provenance=coalesce(metadata_provenance,'{}') || jsonb_build_object('series',jsonb_build_object(
      'source','manual','sourceRef',coalesce(nullif(btrim(p_source_url),''),p_work::text),'confidence','high',
      'membershipConfidence','high','reviewedBy',caller,'evidence',evidence,'at',now())) where id=p_work;
  perform set_config('reverie.series_classifier',coalesce(classifier_before,''),true);
  perform set_config('reverie.series_review_preserve_catalog',coalesce(preserve_before,''),true);
  perform set_config('reverie.series_manual_editor',coalesce(old_manual,''),true);
  perform set_config('reverie.corpus_series_target',coalesce(target_before,''),true);
  insert into public.corpus_record_edits(work_id,editor_id,action,previous_value,next_value,source_url,note,review_mode)
    values(p_work,caller,'series',before_value,(proposal->'value')-'bookId',nullif(btrim(p_source_url),''),coalesce(btrim(p_note),''),p_review_mode);
  return p_work;
end;
$$;
revoke all on function public.admin_push_corpus_record(uuid,text,jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_push_corpus_record(uuid,text,jsonb,text,text,text) to authenticated;
-- Extend the audit action enum without changing any existing history.
alter table public.corpus_record_edits drop constraint corpus_record_edits_action_check;
alter table public.corpus_record_edits add constraint corpus_record_edits_action_check check(action in ('edition','guidance','remove_isbn','resolve_report','series'));
commit;
