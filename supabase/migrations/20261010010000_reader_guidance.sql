-- Account-scoped welcome choice and content-free learning milestones. This controls presentation,
-- never authorization. Existing readers keep the full app; only new profiles begin unconfigured.
alter table public.profiles add column guidance jsonb,
  add constraint profiles_guidance_document check (
    guidance is null or (jsonb_typeof(guidance) = 'object' and octet_length(guidance::text) <= 2048)
  );
update public.profiles set guidance = '{"version":1,"mode":"full","setupComplete":true,"milestones":[],"revealed":[],"tour":null}'::jsonb;

-- Merge independent milestone observations under a row lock so a background observation cannot
-- replace a simultaneous explicit mode/tour choice or forget a milestone from another device.
create function public.update_reader_guidance(
  p_mode text default null,
  p_complete boolean default false,
  p_milestones text[] default '{}',
  p_reveal text[] default '{}',
  p_set_tour boolean default false,
  p_tour text default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_current jsonb;
  v_next jsonb;
  v_ids text[] := array['books','reading','choose','plan','organize','reflect','explore','share','personalize','privacy'];
begin
  if v_user is null then raise exception 'Sign in to save your guide' using errcode = '42501'; end if;
  if (p_mode is not null and p_mode not in ('gentle','full'))
     or p_milestones is null or not (p_milestones <@ array['books','reading','finished','planned'])
     or p_reveal is null or not (p_reveal <@ v_ids)
     or (p_tour is not null and not p_tour = any(v_ids)) then
    raise exception 'Unknown reader guidance choice' using errcode = '22023';
  end if;
  select guidance into v_current from public.profiles where id = v_user for update;
  if not found then raise exception 'Reader profile is unavailable' using errcode = '42501'; end if;
  if v_current is not null and v_current->>'version' is distinct from '1' then
    raise exception 'This guide was saved by a newer version. Refresh Reverie first.' using errcode = '22023';
  end if;
  v_next := jsonb_build_object(
    'version', 1,
    'mode', coalesce(p_mode, v_current->>'mode', 'full'),
    'setupComplete', coalesce(p_complete, false) or coalesce((v_current->>'setupComplete')::boolean, false),
    'milestones', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from (
      select distinct jsonb_array_elements_text(coalesce(v_current->'milestones', '[]'::jsonb)) as id
      union select unnest(p_milestones)
    ) m),
    'revealed', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from (
      select distinct jsonb_array_elements_text(coalesce(v_current->'revealed', '[]'::jsonb)) as id
      union select unnest(p_reveal)
    ) r),
    'resume', case when p_set_tour and p_tour is not null then to_jsonb(p_tour) else coalesce(nullif(v_current->'tour', 'null'::jsonb), v_current->'resume') end,
    'tour', case when p_set_tour then to_jsonb(p_tour) else v_current->'tour' end
  );
  update public.profiles set guidance = v_next where id = v_user;
  return v_next;
end;
$$;
revoke execute on function public.update_reader_guidance(text, boolean, text[], text[], boolean, text) from public, anon, authenticated;
grant execute on function public.update_reader_guidance(text, boolean, text[], text[], boolean, text) to authenticated;
comment on column public.profiles.guidance is 'Reader-owned presentation preference and coarse learning milestones. Never an entitlement, telemetry stream or reading-content record. Included in personal backup.';
