-- Honor explicit edition references when shared values enter a personal copy. No backfill.
begin;
create function public.corpus_edition_fields_match(p_provenance jsonb, p_fields text[], p_isbn text)
returns boolean language plpgsql immutable security definer set search_path = '' as $$
declare field text; reference text; has_reference boolean := false;
begin
  if p_fields is null or cardinality(p_fields)=0 or cardinality(p_fields)>3
    or exists(select 1 from unnest(p_fields) f where f is null or f not in ('pageCount','pubY','pubM','pubD')) then
    return false;
  end if;
  foreach field in array p_fields loop
    if coalesce(p_provenance->field ? 'referenceIsbn',false) then has_reference:=true; end if;
  end loop;
  -- Preserve legacy behavior, not a claim that historical unscoped data has been verified.
  if not has_reference then return true; end if;
  if not coalesce(public.library_isbn_checksum_is_valid(p_isbn),false) then return false; end if;
  foreach field in array p_fields loop
    if jsonb_typeof(p_provenance->field->'referenceIsbn') is distinct from 'string' then return false; end if;
    reference := p_provenance->field->>'referenceIsbn';
    if not public.library_isbn_checksum_is_valid(reference)
      or public.canonical_library_isbn(reference)<>public.canonical_library_isbn(p_isbn) then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.corpus_edition_fields_match(jsonb,text[],text) from public, anon, authenticated, service_role;

-- Guard only the copy expressions in the current definitions; retain their authorization,
-- household consent, series, cover, locking and retry behavior. Fail on unexpected source drift.
do $$
declare def text; original text; replacement text; axis text; guard text;
  date_fields text := $f$array_remove(array['pubY',case when work.pub_m is not null then 'pubM' end,case when work.pub_d is not null then 'pubD' end],null)$f$;
begin
  def := pg_get_functiondef('public.adopt_corpus_work_metadata(uuid)'::regprocedure);
  guard := format('public.corpus_edition_fields_match(work.metadata_provenance,%s,book.isbn)',date_fields);
  foreach axis in array array['y','m','d'] loop
    original := format('pub_%s = work.pub_%s',axis,axis);
    replacement := format('pub_%s = case when %s then work.pub_%s else book.pub_%s end',axis,guard,axis,axis);
    if length(def)-length(replace(def,original,''))<>length(original) then raise exception 'adoption edition expression drift: %',axis; end if;
    def := replace(def,original,replacement);
  end loop;
  execute def;
  def := pg_get_functiondef('public.add_corpus_work_to_member_library(uuid,uuid)'::regprocedure);
  original := 'work.status, work.pages,';
  replacement := $r$work.status, case when public.corpus_edition_fields_match(work.metadata_provenance,array['pageCount'],work.isbns[1]) then work.pages else null end,$r$;
  if length(def)-length(replace(def,original,''))<>length(original) then raise exception 'delegated pages expression drift'; end if;
  def := replace(def,original,replacement);
  guard := format('public.corpus_edition_fields_match(work.metadata_provenance,%s,work.isbns[1])',date_fields);
  original := 'work.pub_y, work.pub_m, work.pub_d,';
  replacement := format('case when %s then work.pub_y else null end, case when %s then work.pub_m else null end, case when %s then work.pub_d else null end,',guard,guard,guard);
  if length(def)-length(replace(def,original,''))<>length(original) then raise exception 'delegated date expression drift'; end if;
  def := replace(def,original,replacement);
  execute def;
end;
$$;
commit;
