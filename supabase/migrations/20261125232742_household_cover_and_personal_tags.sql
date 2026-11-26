begin;
alter table public.household_works add column designated_cover text;

create function public.set_household_cover(p_household uuid, p_work uuid, p_book uuid, p_cover text, p_previous text)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid(); b public.books; previous text;
begin
  if caller is null then raise exception 'Sign in to select a household cover' using errcode='42501'; end if;
  if p_book is not null then
    select * into strict b from public.books
      where owner_id=caller and id=p_book and corpus_work_id=p_work and removed_at is null for update;
  end if;
  perform 1 from public.household_members where household_id=p_household and user_id=caller for key share;
  if not found then raise exception 'Household membership required' using errcode='42501'; end if;
  perform 1 from public.households where id=p_household for update;
  select designated_cover into strict previous from public.household_works
    where household_id=p_household and work_id=p_work and removed_at is null for update;
  if p_book is not null then
    if b.cover_url is distinct from p_cover or p_cover is null or
      public.hosted_book_cover_object_name(p_cover,caller,p_book) is null or
      (b.ownership <> 'owned' and not exists(select 1 from public.household_book_shares
        where household_id=p_household and work_id=p_work and book_id=p_book and removed_at is null)) then
      raise exception 'Choose a saved image from a current household copy' using errcode='22023';
    end if;
  elsif p_cover is not null then
    raise exception 'A source copy is required' using errcode='22023';
  end if;
  if previous is not distinct from p_cover then return; end if;
  if previous is distinct from p_previous then
    raise exception 'The household cover changed. Reload to review it.' using errcode='P0001';
  end if;
  update public.household_works set designated_cover=p_cover where household_id=p_household and work_id=p_work;
end; $$;
revoke all on function public.set_household_cover(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.set_household_cover(uuid,uuid,uuid,text,text) to authenticated;

create or replace function public.household_library_works_v2()
returns setof jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(row) || coalesce(enrichment.bibliography,'{}') ||
    jsonb_build_object('designated_cover', hw.designated_cover, 'corpus_bibliography', to_jsonb(row),
      'household_tropes', public.corpus_and_household_tropes(hw.work_id, labels.items))
  from public.household_library_works() row
  join public.household_members mine on mine.user_id=auth.uid()
  join public.household_works hw on hw.household_id=mine.household_id and hw.work_id=row.work_id and hw.removed_at is null
  left join public.household_work_enrichment enrichment on enrichment.household_id=mine.household_id and enrichment.work_id=row.work_id
  -- Refresh the spelling only for an existing shared assignment from a current member.
  -- Reading the label avoids promoting unrelated tags or rewriting a historical snapshot.
  left join lateral (
    select jsonb_agg(case when current_tag.name is null then item
      else jsonb_set(item,'{name}',to_jsonb(current_tag.name)) end order by ordinal) items
    from jsonb_array_elements(enrichment.tropes) with ordinality snapshot(item,ordinal)
    left join public.tropes current_tag on current_tag.id::text=item->>'id' and exists (
      select 1 from public.household_members member
      join public.books b on b.owner_id=member.user_id and b.corpus_work_id=hw.work_id and b.removed_at is null
      join public.book_tropes bt on bt.book_id=b.id and bt.owner_id=b.owner_id and bt.trope_id=current_tag.id
      where member.household_id=mine.household_id and member.user_id=current_tag.owner_id
      and (b.ownership='owned' or exists (select 1 from public.household_book_shares sh
        where sh.household_id=member.household_id and sh.work_id=hw.work_id and sh.book_id=b.id and sh.removed_at is null))
    )
  ) labels on true;
$$;

create function public.publish_personal_book_tag(p_book uuid,p_work uuid,p_tag uuid,p_name text)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid(); b public.books;
begin
  perform 1 from public.corpus_admins where user_id=caller for key share;
  if not found then raise exception 'Corpus administrator required' using errcode='42501'; end if;
  select * into strict b from public.books where id=p_book and owner_id=caller and corpus_work_id=p_work and removed_at is null for update;
  if not public.book_corpus_binding_is_unambiguous(p_work,b.title,
    coalesce(nullif(b.authors_display,''),trim(concat_ws(' ',b.author_first,b.author_last))),b.isbn) then
    raise exception 'Review the shared book identity first' using errcode='22023';
  end if;
  perform 1 from public.book_tropes a join public.tropes t on t.id=a.trope_id
    where a.book_id=p_book and a.owner_id=caller and t.id=p_tag and t.name=p_name for share of a,t;
  if not found then raise exception 'The saved tag changed. Reload to review it.' using errcode='P0001'; end if;
  perform public.promote_corpus_work_trope(p_work,p_tag,caller,'personal');
end; $$;
revoke all on function public.publish_personal_book_tag(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_personal_book_tag(uuid,uuid,uuid,text) to authenticated;
commit;
