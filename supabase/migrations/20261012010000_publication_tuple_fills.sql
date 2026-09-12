-- Future fills preserve a source's date precision as a whole. No historical rows are rewritten.
begin;
create function public.publication_tuple_is_valid(y integer, m integer, d integer)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if y is null or y < 1 or y > 9999 then return false; end if;
  if m is null then return d is null; end if;
  if m < 1 or m > 12 then return false; end if;
  if d is null then return true; end if;
  perform make_date(y, m, d);
  return true;
exception when datetime_field_overflow then return false;
end;
$$;
revoke all on function public.publication_tuple_is_valid(integer, integer, integer) from public, anon, authenticated;

-- Patch the current implementations so subsequent series/cover/authentication guards are retained.
-- The completion entry point is a wrapper; its private implementation owns these fills.
do $$
declare
  def text;
  old text;
  replacement text;
  guard text;
  axis text;
  source_axis text;
  target regprocedure;
begin
  foreach target in array array[
    'public.complete_corpus_work_metadata_without_series_review(uuid,jsonb,timestamp with time zone)'::regprocedure,
    'public.preserve_personal_book_objective_metadata(uuid)'::regprocedure
  ] loop
    def := pg_get_functiondef(target);
    if target = 'public.complete_corpus_work_metadata_without_series_review(uuid,jsonb,timestamp with time zone)'::regprocedure then
      guard := $g$public.publication_tuple_is_valid(nullif(trim(p_patch ->> 'pubY'), '')::int, nullif(trim(p_patch ->> 'pubM'), '')::int, nullif(trim(p_patch ->> 'pubD'), '')::int)$g$;
    else
      guard := 'public.publication_tuple_is_valid(b.pub_y, b.pub_m, b.pub_d)';
    end if;
    foreach axis in array array['y', 'm', 'd'] loop
      if target = 'public.complete_corpus_work_metadata_without_series_review(uuid,jsonb,timestamp with time zone)'::regprocedure then
        source_axis := format('nullif(trim(p_patch ->> %L), '''')::int', 'pub' || upper(axis));
        old := format('when %L then before_value ->> %L is null and p_patch ? %L', 'pub' || upper(axis), 'pub_' || axis, 'pub' || upper(axis));
        replacement := format('when %L then before_value ->> ''pub_y'' is null and %s and %s is not null', 'pub' || upper(axis), guard, source_axis);
        if position(old in def) = 0 then raise exception 'publication provenance definition drift for %', axis; end if;
        def := replace(def, old, replacement);
      else
        source_axis := 'b.pub_' || axis;
      end if;
      old := format('pub_%s = coalesce(w.pub_%s, %s)', axis, axis, source_axis);
      replacement := format('pub_%s = case when w.pub_y is null and %s then %s else w.pub_%s end', axis, guard, source_axis, axis);
      if position(old in def) = 0 then raise exception 'publication fill definition drift for % / %', target, axis; end if;
      def := replace(def, old, replacement);
    end loop;
    execute def;
  end loop;
end;
$$;
-- Explicit duplicate-field selections must also replace the publication tuple together.
do $$
declare
  def text := pg_get_functiondef('public.merge_books(uuid,uuid,jsonb)'::regprocedure);
  axis text;
  old text;
  replacement text;
begin
  foreach axis in array array['y', 'm', 'd'] loop
    old := format('coalesce((p_fields ->> %L)::smallint, pub_%s)', 'pub_' || axis, axis);
    replacement := format($f$case when p_fields ? 'pub_y' and
      public.publication_tuple_is_valid((p_fields ->> 'pub_y')::integer, (p_fields ->> 'pub_m')::integer, (p_fields ->> 'pub_d')::integer)
      then (p_fields ->> %L)::smallint else pub_%s end$f$, 'pub_' || axis, axis);
    if position(old in def) = 0 then raise exception 'merge publication definition drift for %', axis; end if;
    def := replace(def, old, replacement);
  end loop;
  execute def;
end;
$$;
commit;
