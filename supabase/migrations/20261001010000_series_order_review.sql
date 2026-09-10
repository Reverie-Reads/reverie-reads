-- Owner-run: changes the outcome of an explicit administrator order correction. No backfill.
-- Reuse the existing private audit; citations do not grant source authority or trigger fetches.
create function public.review_corpus_series_entry_order(
  p_series uuid, p_expected_revision bigint, p_entry uuid,
  p_position numeric, p_label text, p_source_url text, p_note text,
  p_title text, p_author text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  caller uuid := (select auth.uid());
  series_row public.corpus_series%rowtype;
  before_entry public.corpus_series_entries%rowtype;
  locked_entry public.corpus_series_entries%rowtype;
  saved_entry public.corpus_series_entries%rowtype;
  source_url text := nullif(trim(coalesce(p_source_url, '')), '');
  note text := nullif(trim(coalesce(p_note, '')), '');
  changed boolean;
  claim jsonb;
begin
  if caller is null then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = caller for key share;
  perform 1 from public.corpus_admins where user_id = caller for update;
  if not found then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  if p_position is not null and
    (p_position <= 0 or p_position::text in ('NaN', 'Infinity', '-Infinity')) then
    raise exception 'series position must be finite and greater than zero' using errcode = '22023';
  end if;
  if length(coalesce(p_label, '')) > 500 then
    raise exception 'reading-order label is too long' using errcode = '22023';
  end if;
  select * into before_entry from public.corpus_series_entries
    where id = p_entry and series_id = p_series and removed_at is null;
  if not found then
    raise exception 'active corpus series entry not found' using errcode = 'P0002';
  end if;
  -- Match existing book -> work -> catalog locking; recheck the selected binding afterwards.
  if before_entry.work_id is not null then
    perform 1 from public.books where corpus_work_id = before_entry.work_id
      and removed_at is null order by id for update;
    perform 1 from public.works where id = before_entry.work_id for update;
  end if;
  select * into series_row from public.corpus_series where id = p_series;
  perform pg_advisory_xact_lock(hashtextextended(
    'name:' || series_row.name_key || ':' || series_row.creator_key, 0));
  select * into series_row from public.corpus_series where id = p_series for update;
  if not found or series_row.archived_at is not null then
    raise exception 'active corpus series not found' using errcode = 'P0002';
  end if;
  if series_row.revision is distinct from p_expected_revision then
    raise exception 'corpus series changed; refresh before saving the slot' using errcode = 'PT409';
  end if;
  select * into locked_entry from public.corpus_series_entries where id = p_entry for update;
  if not found or locked_entry.series_id is distinct from p_series
    or locked_entry.work_id is distinct from before_entry.work_id
    or locked_entry.removed_at is not null then
    raise exception 'corpus series entry changed; refresh before saving' using errcode = 'PT409';
  end if;
  before_entry := locked_entry;
  if before_entry.work_id is null and nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'an unbound series slot needs a title' using errcode = '22023';
  end if;
  changed := before_entry.position is distinct from p_position;
  if changed or source_url is not null or note is not null then
    -- Link hygiene only, not authority validation. No credentials, queries or fragments retained.
    if source_url is null or length(source_url) > 2000
      or source_url !~ '^https://([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(/[^[:space:][:cntrl:]?#\\]*)?$'
      or note is null or length(note) > 1000 then
      raise exception 'an HTTPS source page and review explanation are required (no query or fragment)'
        using errcode = '22023';
    end if;
    claim := jsonb_build_object('origin', 'manual', 'source', 'manual',
      'sourceRef', source_url, 'position', p_position, 'reviewedBy', caller, 'at', now());
  end if;

  if (changed or claim is not null) and before_entry.work_id is not null and before_entry.is_primary then
    -- An order decision is not a new membership decision. Preserve the existing membership
    -- provenance and let the established default-only propagation protect reader/import choices.
    -- A cited same-value confirmation also repairs missing eligible personal defaults/membership.
    perform set_config('reverie.series_classifier', 'on', true);
    perform set_config('reverie.corpus_series_target', p_series::text, true);
    update public.works set position = p_position where id = before_entry.work_id;
    perform set_config('reverie.corpus_series_target', '', true);
    perform set_config('reverie.series_classifier', '', true);
  end if;
  update public.corpus_series_entries set
    title = case when before_entry.work_id is null then trim(p_title) else before_entry.title end,
    author_text = case when before_entry.work_id is null then trim(coalesce(p_author, '')) else before_entry.author_text end,
    position = p_position, label = nullif(trim(coalesce(p_label, '')), ''),
    membership_claim = before_entry.membership_claim,
    evidence = before_entry.evidence, source = before_entry.source, source_ref = before_entry.source_ref,
    position_claim = coalesce(claim, before_entry.position_claim)
  where id = p_entry returning * into saved_entry;
  -- Also advance on same-value re-review and label-only saves, so stale drafts cannot reuse it.
  update public.corpus_series set revision = revision + 1, reviewed_by = caller where id = p_series;
  insert into public.corpus_series_edits(series_id, editor_id, action, previous_value, next_value)
  values (p_series, caller, 'entry_update', to_jsonb(before_entry),
    to_jsonb(saved_entry) || case when claim is null then '{}'::jsonb else
      jsonb_build_object('orderReview', jsonb_build_object('sourceUrl', source_url,
        'note', note, 'position', p_position, 'reviewedAt', now())) end);
  return to_jsonb(saved_entry);
exception when others then
  perform set_config('reverie.corpus_series_target', '', true);
  perform set_config('reverie.series_classifier', '', true);
  raise;
end;
$fn$;

revoke all on function public.review_corpus_series_entry_order(uuid,bigint,uuid,numeric,text,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.review_corpus_series_entry_order(uuid,bigint,uuid,numeric,text,text,text,text,text)
  to authenticated;
