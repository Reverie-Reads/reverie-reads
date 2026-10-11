-- Personal series edits reuse an exact live placeholder and an unambiguous existing name.
-- Forward behavior only: no historical row rewrite or shared catalog change.

create or replace function public.apply_series_membership(
  p_owner uuid,
  p_book uuid,
  p_series uuid,
  p_series_name text,
  p_position numeric,
  p_length integer,
  p_make_primary boolean,
  p_membership_claim jsonb,
  p_position_claim jsonb,
  p_strict_position boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series uuid := p_series;
  v_entry uuid;
  v_named uuid[];
  v_position numeric := p_position;
  v_claim jsonb := coalesce(p_membership_claim, '{"origin":"unknown"}'::jsonb);
  v_position_claim jsonb := coalesce(p_position_claim, '{"origin":"unknown"}'::jsonb);
  v_title text;
  v_author text;
begin
  select b.title, coalesce(nullif(b.authors_display, ''), trim(concat_ws(' ', b.author_first, b.author_last)), '')
    into v_title, v_author
  from public.books b
  where b.id = p_book and b.owner_id = p_owner
  for update;
  if not found then raise exception 'not owner of book'; end if;

  if v_series is null then
    if nullif(trim(coalesce(p_series_name, '')), '') is null then
      raise exception 'series name is required' using errcode = '22023';
    end if;
    -- The owner/name lock also serializes two differently cased new names. It does not merge
    -- historical duplicates or equate subtitles, punctuation, or "Series" suffixes.
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text || ':' || lower(trim(p_series_name)), 0));
    select s.id into v_series
    from public.series s
    where s.owner_id = p_owner and s.name = trim(p_series_name) and s.archived_at is null
    for update;
    if v_series is null then
      select array_agg(s.id) into v_named from public.series s
      where s.owner_id = p_owner and lower(trim(s.name)) = lower(trim(p_series_name))
        and s.archived_at is null;
      if cardinality(v_named) > 1 then
        raise exception 'multiple existing series match this name; choose its exact name' using errcode = '22023';
      elsif cardinality(v_named) = 1 then
        v_series := v_named[1];
        perform 1 from public.series s where s.id = v_series for update;
      end if;
    end if;
    if v_series is null then
      insert into public.series (owner_id, name, length)
      values (p_owner, trim(p_series_name), p_length)
      returning id into v_series;
    end if;
  else
    perform 1 from public.series s where s.id = v_series and s.owner_id = p_owner and s.archived_at is null for update;
    if not found then raise exception 'not owner of series'; end if;
  end if;

  if p_length is not null then
    update public.series set length = p_length where id = v_series and length is distinct from p_length;
  end if;

  select e.id into v_entry
  from public.series_entries e
  where e.series_id = v_series
    and e.owner_id = p_owner
    and e.book_id = p_book
    and e.removed_at is null
  for update;

  -- A deliberate reader edit may attach the exact title AND contributor to its existing
  -- unlinked slot. Never absorb a different book, a removal tombstone, or an unknown author.
  -- This uses the locked current book and series, not a client's stale placeholder identity.
  if v_entry is null and v_position is not null and v_claim ->> 'origin' = 'reader'
     and nullif(trim(v_author), '') is not null then
    select e.id into v_entry from public.series_entries e
    where e.series_id = v_series and e.owner_id = p_owner and e.removed_at is null
      and e.book_id is null and e.position = v_position
      and lower(trim(e.title)) = lower(trim(v_title))
      and lower(trim(e.author)) = lower(trim(v_author))
    for update;
  end if;

  if v_position is null then
    select floor(coalesce(max(e.position), 0)) + 1 into v_position
    from public.series_entries e where e.series_id = v_series and e.removed_at is null;
    v_position_claim := '{"origin":"unknown"}'::jsonb;
  elsif exists (
    select 1 from public.series_entries e
    where e.series_id = v_series and e.removed_at is null and e.position = v_position
      and (v_entry is null or e.id <> v_entry)
  ) then
    if p_strict_position then
      raise exception 'series position is already occupied' using errcode = '23505';
    end if;
    select floor(greatest(coalesce(max(e.position), 0), v_position)) + 1 into v_position
    from public.series_entries e where e.series_id = v_series and e.removed_at is null;
    v_position_claim := '{"origin":"unknown"}'::jsonb;
  end if;

  if p_make_primary then
    update public.series_entries
       set is_primary = false
     where owner_id = p_owner and book_id = p_book and removed_at is null and is_primary
       and (v_entry is null or id <> v_entry);
  end if;

  if v_entry is null then
    insert into public.series_entries (
      series_id, owner_id, position, title, author, book_id, source, user_edited,
      is_primary, membership_claim, position_claim
    ) values (
      v_series, p_owner, v_position, v_title, v_author, p_book, 'manual',
      coalesce(v_claim ->> 'origin', 'unknown') = 'reader',
      p_make_primary, v_claim, v_position_claim
    ) returning id into v_entry;
  else
    update public.series_entries
       set position = v_position,
           book_id = p_book,
           membership_claim = v_claim,
           position_claim = v_position_claim,
           is_primary = p_make_primary or is_primary,
           user_edited = user_edited or coalesce(v_claim ->> 'origin', 'unknown') = 'reader'
     where id = v_entry;
  end if;

  if p_make_primary then perform public.refresh_book_series_projection(p_book); end if;
  return v_entry;
end;
$$;

revoke all on function public.apply_series_membership(uuid, uuid, uuid, text, numeric, integer, boolean, jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role;
