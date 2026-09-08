-- A deliberate reading plan needs one state that a date cannot express: "Soon." The nullable
-- position is both queue membership and the reader's private preference order. A null position with
-- no date remains no plan; the backfill therefore touches ONLY existing dated plans. The optional
-- intention is a note to the reader's future self, not a review or reading-log annotation.

alter table public.books
  add column if not exists plan_position numeric,
  add column if not exists plan_intention text not null default '';

alter table public.books
  drop constraint if exists books_plan_intention_length_check,
  add constraint books_plan_intention_length_check
    check (char_length(plan_intention) <= 300);

comment on column public.books.plan_position is
  'Private reading-plan membership and preference order. Null with no plan date means unplanned; a non-null position with no date means Soon.';
comment on column public.books.plan_intention is
  'Optional private note to the reader future self for this plan; never a review or reading-log note.';

-- Existing dated plans are real plans. Give them stable spaced positions in their existing date
-- order, retaining partial precision and using added_at/id as the total-order tiebreak. Books with
-- no plan_y are deliberately absent: the migration must not manufacture queue membership.
with ranked as (
  select id,
         row_number() over (
           partition by owner_id
           order by plan_y, plan_m nulls first, plan_d nulls first, added_at, id
         ) * 1000 as plan_position
    from public.books
   where plan_y is not null
     and plan_position is null
     and removed_at is null
)
update public.books as book
   set plan_position = ranked.plan_position
  from ranked
 where book.id = ranked.id;

create index if not exists books_owner_plan_position_idx
  on public.books (owner_id, plan_position, id)
  where removed_at is null and (plan_position is not null or plan_y is not null);

-- The public merge entry point wraps the older merge_books body because the application calls this
-- authority-aware boundary. It decides plan ownership from the STORED primary before any write:
-- this preserves a primary Soon plan during a stale-client merge, while allowing an unplanned
-- primary to adopt the loser's complete plan. All five plan fields move as one object.
create or replace function public.merge_books_authoritative(
  p_primary uuid,
  p_loser uuid,
  p_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_selected text := nullif(trim(coalesce(p_fields ->> 'series', '')), '');
  v_entry uuid;
  v_primary_has_plan boolean;
  v_incoming_has_plan boolean :=
    (p_fields ->> 'plan_y') is not null or (p_fields ->> 'plan_position') is not null;
  v_merge_fields jsonb := p_fields;
begin
  select b.plan_y is not null or b.plan_position is not null
    into v_primary_has_plan
    from public.books b
   where b.id = p_primary and b.owner_id = v_owner
     for update;

  if v_primary_has_plan then
    v_merge_fields := v_merge_fields
      - 'plan_y' - 'plan_m' - 'plan_d' - 'plan_position' - 'plan_intention';
  end if;

  perform public.merge_books(p_primary, p_loser, v_merge_fields);

  if not coalesce(v_primary_has_plan, false) and v_incoming_has_plan then
    update public.books
       set plan_position = (p_fields ->> 'plan_position')::numeric,
           plan_intention = coalesce(p_fields ->> 'plan_intention', '')
     where id = p_primary and owner_id = v_owner;
  end if;

  if v_selected is null then return; end if;

  select e.id into v_entry
  from public.series_entries e
  join public.series s on s.id = e.series_id
  where e.owner_id = v_owner
    and e.book_id = p_primary
    and e.removed_at is null
    and e.membership_claim ->> 'origin' <> 'unknown'
    and s.name = v_selected
  order by e.id
  limit 1;
  if v_entry is null then return; end if;

  update public.series_entries set is_primary = false
   where owner_id = v_owner and book_id = p_primary and removed_at is null
     and is_primary and id <> v_entry;
  update public.series_entries set is_primary = true where id = v_entry;
  perform public.refresh_book_series_projection(p_primary);
end;
$$;

revoke all on function public.merge_books_authoritative(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.merge_books_authoritative(uuid, uuid, jsonb) to authenticated;
