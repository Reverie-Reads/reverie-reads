begin;
create function public.review_personal_series_publication(p_series uuid)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_corpus_admin() or not exists(select 1 from public.series where id=p_series and owner_id=auth.uid() and archived_at is null) then
    raise exception 'An administrator-owned series is required' using errcode='42501';
  end if;
  return query select jsonb_build_object('entry',e.id,'title',coalesce(b.title,e.title),'work',w.id,'book',b.id,
    'fingerprint',case when w.id is not null then public.corpus_record_fingerprint(w.id) end,
    'previous',jsonb_build_object('name',w.series,'position',w.position,'count',w.series_count,'status',w.status),
    'value',jsonb_build_object('bookId',b.id,'name',b.series,'position',b.position,'count',b.series_count,'status',b.status),
    'eligible',coalesce(e.is_primary and b.id is not null and w.id is not null and b.position>0 and b.position=e.position
      and e.membership_claim->>'origin'<>'unknown' and s.name=b.series,false))
  from public.series s join public.series_entries e on e.series_id=s.id and e.owner_id=s.owner_id
  left join public.books b on b.id=e.book_id and b.owner_id=s.owner_id and b.removed_at is null
  left join public.works w on w.id=b.corpus_work_id
  where s.id=p_series and e.removed_at is null order by e.sort_order,e.position,e.id;
end; $$;

create function public.publish_reviewed_personal_series(p_series uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare submitted jsonb; snapshot jsonb; n integer;
begin
  perform 1 from public.profiles where id=auth.uid() for key share;
  perform 1 from public.corpus_admins where user_id=auth.uid() for update;
  if not found then raise exception 'Corpus administrator required' using errcode='42501'; end if;
  perform 1 from public.series where id=p_series and owner_id=auth.uid() and archived_at is null for update;
  if not found then raise exception 'Personal series unavailable' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Select series entries' using errcode='22023'; end if;
  n := jsonb_array_length(p_rows);
  if n not between 1 and 100 or n<>(select count(distinct r->>'work') from jsonb_array_elements(p_rows) r) then
    raise exception 'Select up to 100 distinct works' using errcode='22023'; end if;
  perform 1 from public.series_entries where series_id=p_series and id in
    (select (r->>'entry')::uuid from jsonb_array_elements(p_rows) r) order by id for update;
  select jsonb_object_agg(r->>'entry',r) into snapshot from public.review_personal_series_publication(p_series) r;
  for submitted in select r from jsonb_array_elements(p_rows) r order by r->>'work' loop
    if (submitted->'eligible') is distinct from 'true'::jsonb or (snapshot->(submitted->>'entry')) is distinct from submitted then
      raise exception 'A reviewed series entry changed. Reload the review.' using errcode='PT409'; end if;
    perform public.admin_push_corpus_record((submitted->>'work')::uuid,submitted->>'fingerprint',
      jsonb_build_array(jsonb_build_object('action','series','value',submitted->'value')),'direct',null,null);
  end loop;
  return n;
end; $$;
revoke all on function public.review_personal_series_publication(uuid),public.publish_reviewed_personal_series(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.review_personal_series_publication(uuid),public.publish_reviewed_personal_series(uuid,jsonb) to authenticated;
commit;
