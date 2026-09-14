-- Detect impossible/disconnected dates in the existing administrator queue. No data repair.
begin;
do $$
declare def text; original text; replacement text;
begin
  def := pg_get_functiondef('public.catalog_metadata_review_record(public.works)'::regprocedure);
  original := $s$case when nullif(btrim(p_work.description, E' \t\r\n'),'') is null then 'description' end$s$;
  replacement := $r$case when (p_work.pub_y is not null or p_work.pub_m is not null or p_work.pub_d is not null)
        and not public.publication_tuple_is_valid(p_work.pub_y,p_work.pub_m,p_work.pub_d)
        then 'invalid_publication' end,
      case when nullif(btrim(p_work.description, E' \t\r\n'),'') is null then 'description' end$r$;
  if length(def)-length(replace(def,original,''))<>length(original) then raise exception 'metadata issues definition drift'; end if;
  def := replace(def,original,replacement);
  original := $s$md5(jsonb_build_array(p_work.title,p_work.author_text,p_work.contributors,p_work.isbns,
      p_work.description,p_work.metadata_provenance->'description',p_work.pub_y,p_work.publisher,p_work.language,peers)::text)$s$;
  -- Preserve existing assessments for valid/unknown dates. An invalid tuple contributes its exact
  -- axes, so historical assessments reopen only for affected works; changing the bad tuple also
  -- invalidates stale decisions. Edition correction fingerprints already include every date axis.
  replacement := $r$md5((jsonb_build_array(p_work.title,p_work.author_text,p_work.contributors,p_work.isbns,
      p_work.description,p_work.metadata_provenance->'description',p_work.pub_y,p_work.publisher,p_work.language,peers)
      || case when (p_work.pub_y is not null or p_work.pub_m is not null or p_work.pub_d is not null)
        and not public.publication_tuple_is_valid(p_work.pub_y,p_work.pub_m,p_work.pub_d)
        then jsonb_build_array('invalid-publication-v1',p_work.pub_y,p_work.pub_m,p_work.pub_d)
        else '[]'::jsonb end)::text)$r$;
  if length(def)-length(replace(def,original,''))<>length(original) then raise exception 'metadata fingerprint definition drift'; end if;
  execute replace(def,original,replacement);

  def := pg_get_functiondef('public.admin_list_corpus_metadata_reviews(text,text,text,integer,integer,uuid)'::regprocedure);
  original := $s$('all','description','invalid_isbn','isbn_conflict','duplicate_identity')$s$;
  replacement := $r$('all','description','invalid_isbn','invalid_publication','isbn_conflict','duplicate_identity')$r$;
  if length(def)-length(replace(def,original,''))<>length(original) then raise exception 'metadata issue filter definition drift'; end if;
  def := replace(def,original,replacement);
  original := $s$when item->'issues' ? 'invalid_isbn' then 2 else 3 end$s$;
  replacement := $r$when item->'issues' ? 'invalid_isbn' then 2 when item->'issues' ? 'invalid_publication' then 3 else 4 end$r$;
  if length(def)-length(replace(def,original,''))<>length(original) then raise exception 'metadata priority definition drift'; end if;
  execute replace(def,original,replacement);
end;
$$;
-- Same functions/signatures: CREATE OR REPLACE preserves the existing restricted grants.
commit;
