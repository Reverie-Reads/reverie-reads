begin;
-- The filing name stays unique for existing book imports, older clients and archive restores.
-- Distinct series may share a display title; each continues to own its membership by UUID.
alter table public.series add column display_name text check (length(trim(display_name)) between 1 and 300);
create function public.name_distinct_personal_series(p_series uuid,p_other uuid,p_title text,p_qualifier text,p_expected text)
returns text language plpgsql security invoker set search_path='' as $$
declare owner uuid := auth.uid(); filing text := trim(p_title)||' · '||trim(p_qualifier);
begin
  if owner is null or p_series=p_other or nullif(trim(p_title),'') is null or nullif(trim(p_qualifier),'') is null or length(filing)>300 then
    raise exception 'Enter a series title and a short distinguishing label' using errcode='22023'; end if;
  perform 1 from public.series where owner_id=owner and id in (p_series,p_other) order by id for update;
  if not exists(select 1 from public.series where id=p_other and owner_id=owner and archived_at is null
    and lower(coalesce(display_name,name))=lower(trim(p_title))) then raise exception 'The other series changed. Review again.' using errcode='PT409'; end if;
  update public.series set name=filing,display_name=trim(p_title) where id=p_series and owner_id=owner and name=p_expected and archived_at is null;
  if not found then raise exception 'The series changed. Review again.' using errcode='PT409'; end if;
  return filing;
end; $$;
revoke all on function public.name_distinct_personal_series(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.name_distinct_personal_series(uuid,uuid,text,text,text) to authenticated;
create function public.clear_changed_series_display_name() returns trigger language plpgsql set search_path='' as $$
begin
  if new.name is distinct from old.name and new.display_name is not distinct from old.display_name
    and new.display_name is not null and not starts_with(new.name,new.display_name||' · ') then new.display_name:=null; end if;
  return new;
end; $$;
create trigger clear_changed_series_display_name before update of name on public.series for each row execute function public.clear_changed_series_display_name();
-- Private filing labels never become a public series title. Review and write resolve the same saved membership.
do $patch$
declare def text; anchor text;
begin
  def := pg_get_functiondef('public.get_corpus_record(uuid)'::regprocedure);
  anchor := '''isbns'',w.isbns,';
  if position(anchor in def)=0 then raise exception 'Corpus snapshot changed'; end if;
  execute replace(def,anchor,
    '''personalSeriesTitles'',(select coalesce(jsonb_object_agg(b.id::text,s.display_name),''{}'') from public.books b join public.series_entries e on e.book_id=b.id and e.is_primary and e.removed_at is null join public.series s on s.id=e.series_id and s.owner_id=b.owner_id and s.archived_at is null and s.display_name is not null where b.owner_id=auth.uid() and b.corpus_work_id=w.id and b.removed_at is null),'||anchor);
  def:=pg_get_functiondef('public.admin_push_corpus_record(uuid,text,jsonb,text,text,text)'::regprocedure);
  anchor:='  if nullif(btrim(b.series),'''') is null or';
  if position(anchor in def)=0 then raise exception 'Personal series validation changed'; end if;
  def:=replace(def,anchor,'  select coalesce(s.display_name,s.name) into shared_title from public.series_entries e join public.series s on s.id=e.series_id and s.owner_id=caller where e.book_id=b.id and e.is_primary and e.removed_at is null and s.archived_at is null; '||anchor);
  def:=replace(def,'old_manual text :=','shared_title text; old_manual text :=');
  def:=replace(def,'''name'',b.series,''position'',b.position','''name'',shared_title,''position'',b.position');
  anchor:='  before_value := jsonb_build_object(';
  if position(anchor in def)=0 then raise exception 'Series review audit boundary changed'; end if;
  def:=replace(def,anchor,'  b.series:=shared_title; '||anchor);
  execute def;
  def:=pg_get_functiondef('public.review_personal_series_publication(uuid)'::regprocedure);
  anchor:='''name'',b.series,''position'',b.position';
  if position(anchor in def)=0 then raise exception 'Series publication snapshot changed'; end if;
  execute replace(def,anchor,'''name'',coalesce(s.display_name,b.series),''position'',b.position');
end; $patch$;
commit;
