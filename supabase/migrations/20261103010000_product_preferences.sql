begin;
-- Inert account foundation. Product choices are presentation, never entitlements or roles.
-- ALTER holds the table lock through this transaction: this update is the exact legacy cutoff.
-- Accounts created after it start unconfigured, regardless of library size or device flags.
alter table public.profiles
  add column product_preferences jsonb,
  add column product_preferences_revision integer not null default 0,
  add constraint profiles_product_preferences_revision check (product_preferences_revision >= 0),
  add constraint profiles_product_preferences_document check (
    product_preferences is null or
    (jsonb_typeof(product_preferences) = 'object' and octet_length(product_preferences::text) <= 8192)
  );
update public.profiles set
  product_preferences = '{"version":1,"enabledProducts":["reader"],"activeProduct":"reader","initialChoiceComplete":true,"presentation":{}}',
  product_preferences_revision = 1;

-- Direct profile updates must not bypass compare-and-swap. This trigger is deliberately INVOKER:
-- current_user must be the caller, except inside the narrowly granted definer RPC below.
create function public.guard_product_preferences() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('postgres', 'supabase_admin') and (
    (tg_op = 'INSERT' and (new.product_preferences is not null or new.product_preferences_revision <> 0))
    or (tg_op = 'UPDATE' and (new.product_preferences is distinct from old.product_preferences
      or new.product_preferences_revision is distinct from old.product_preferences_revision))
  ) then
    raise exception 'Use the revision-checked product preference action' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_product_preferences() from public, anon, authenticated, service_role;
create trigger profiles_product_preferences_guard before insert or update on public.profiles
for each row execute function public.guard_product_preferences();

create function public.save_product_preferences(p_owner_id uuid, p_expected_revision integer, p_document jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_current jsonb;
  v_revision integer;
  v_item jsonb;
begin
  if auth.uid() is null or p_owner_id is distinct from auth.uid() then
    raise exception 'Sign in to your own account to save preferences' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_document is null
    or jsonb_typeof(p_document) <> 'object' or octet_length(p_document::text) > 8192 then
    raise exception 'Unreadable product preferences' using errcode = '22023';
  end if;
  if not (p_document ?& array['version','enabledProducts','activeProduct','initialChoiceComplete','presentation'])
    or (p_document - array['version','enabledProducts','activeProduct','initialChoiceComplete','presentation']) <> '{}'::jsonb
    or p_document->'version' <> '1'::jsonb
    or jsonb_typeof(p_document->'enabledProducts') <> 'array'
    or jsonb_typeof(p_document->'initialChoiceComplete') <> 'boolean'
    or jsonb_typeof(p_document->'presentation') <> 'object' then
    raise exception 'Unsupported product preferences' using errcode = '22023';
  end if;
  if jsonb_array_length(p_document->'enabledProducts') not between 1 and 2
    or exists (select 1 from jsonb_array_elements(p_document->'enabledProducts') item
      where item not in ('"reader"'::jsonb, '"collector"'::jsonb))
    or (select count(distinct item) from jsonb_array_elements(p_document->'enabledProducts') item)
      <> jsonb_array_length(p_document->'enabledProducts')
    or not (p_document->'enabledProducts' @> jsonb_build_array(p_document->'activeProduct'))
    or ((p_document->'presentation') - array['reader','collector']) <> '{}'::jsonb then
    raise exception 'Unknown or inactive product choice' using errcode = '22023';
  end if;
  -- Independent versioned presentation remains opaque here, including newer presentation versions.
  for v_item in select value from jsonb_each(p_document->'presentation') loop
    if jsonb_typeof(v_item) <> 'object' or not (v_item ? 'version')
      or jsonb_typeof(v_item->'version') <> 'number' then
      raise exception 'Unreadable product presentation' using errcode = '22023';
    end if;
    if (v_item->>'version')::numeric < 1 or (v_item->>'version')::numeric > 9007199254740991
      or trunc((v_item->>'version')::numeric) <> (v_item->>'version')::numeric then
      raise exception 'Unreadable product presentation version' using errcode = '22023';
    end if;
  end loop;
  select product_preferences, product_preferences_revision into v_current, v_revision
    from public.profiles where id = p_owner_id for update;
  if not found then raise exception 'Your profile is unavailable' using errcode = '42501'; end if;
  if v_current is not null and (
    v_current->'version' is distinct from '1'::jsonb
    or (v_current - array['version','enabledProducts','activeProduct','initialChoiceComplete','presentation']) <> '{}'::jsonb
    or not (v_current->'enabledProducts' <@ '["reader","collector"]'::jsonb)
    or ((v_current->'presentation') - array['reader','collector']) <> '{}'::jsonb
  ) then
    raise exception 'These preferences need a newer app. Refresh before changing them.' using errcode = '22023';
  end if;
  -- A successful response can be lost: exact replay is read-only, even with the old revision.
  if v_current = p_document then return jsonb_build_object('document', v_current, 'revision', v_revision); end if;
  if v_revision <> p_expected_revision then
    raise exception 'Your product choices changed on another device. Review them before saving.' using errcode = 'PT409';
  end if;
  update public.profiles set product_preferences = p_document,
    product_preferences_revision = v_revision + 1 where id = p_owner_id;
  return jsonb_build_object('document', p_document, 'revision', v_revision + 1);
end;
$$;
revoke all on function public.save_product_preferences(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_product_preferences(uuid, integer, jsonb) to authenticated;
comment on column public.profiles.product_preferences is 'Portable product presentation only. Null means unconfigured. Reader arrangement and guidance remain independent. Never a capability or workspace grant.';
comment on column public.profiles.product_preferences_revision is 'Server-managed concurrency token; never restored from a backup.';

commit;
