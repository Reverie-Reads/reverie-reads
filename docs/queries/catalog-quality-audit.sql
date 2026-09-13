-- Read-only shared bibliographic inventory. No personal rows, notes, provider requests or repairs.
-- Run with: supabase db query --linked --file <absolute-path-to-this-file> --output json
-- Retain case-level output privately, never in the public repository.
begin isolation level repeatable read read only;
set local statement_timeout = '30s';
with base as materialized (
  select w.*, public.catalog_review_isbns(isbns) as valid_isbns,
    public.library_work_key(title,author_text) as identity_key,
    case when jsonb_typeof(contributors)='array' then contributors else '[]'::jsonb end as safe_contributors,
    case when jsonb_typeof(metadata_provenance)='object' then metadata_provenance else '{}'::jsonb end as provenance
  from public.works w
), isbn_groups as (
  select isbn, array_agg(id order by id) as ids from base cross join lateral unnest(valid_isbns) isbn
  group by isbn having count(*)>1
), identity_groups as (
  select identity_key, array_agg(id order by id) as ids from base
  where nullif(trim(title),'') is not null and nullif(trim(author_text),'') is not null
  group by identity_key having count(*)>1
), active_series as materialized (
  select * from public.corpus_series where archived_at is null and merged_into is null
), entries as materialized (
  select e.*, s.name, s.declared_count from public.corpus_series_entries e
  join active_series s on s.id=e.series_id where e.removed_at is null
), checked as materialized (
  select w.id,w.title,w.author_text,w.pages,w.pub_y,w.pub_m,w.pub_d,w.isbns,w.series,w.position,
    w.series_check_state,w.metadata_status,w.updated_at,
    array_remove(array[
      case when nullif(trim(w.title),'') is null then 'missing_title' end,
      case when nullif(trim(w.author_text),'') is null then 'missing_author' end,
      case when jsonb_typeof(w.contributors) is distinct from 'array' then 'malformed_contributors' end,
      case when jsonb_array_length(w.safe_contributors)=0 then 'missing_structured_contributors' end,
      case when exists(select 1 from jsonb_array_elements(w.safe_contributors) c where
        jsonb_typeof(c->'name') is distinct from 'string' or nullif(trim(c->>'name'),'') is null
        or coalesce(c->>'role','') not in ('author','co_author','editor','translator','illustrator','narrator')) then 'invalid_contributor_name_or_role' end,
      case when jsonb_array_length(w.safe_contributors)>0 and public.library_work_key('',w.author_text) is distinct from
        (select public.library_work_key('',string_agg(c->>'name',' ' order by ord)) from jsonb_array_elements(w.safe_contributors) with ordinality a(c,ord))
        then 'contributor_display_disagreement_review' end,
      case when exists(select 1 from isbn_groups g where w.id=any(g.ids)) then 'isbn_conflict_review' end,
      case when exists(select 1 from identity_groups g where w.id=any(g.ids)) then 'duplicate_identity_review' end,
      case when nullif(trim(w.work_id),'') is not null and exists(select 1 from base x where x.id<>w.id and x.work_id=w.work_id)
        then 'shared_provider_locator_review' end,
      case when exists(select 1 from unnest(w.isbns) i where public.library_isbn_checksum_is_valid(i) is not true) then 'invalid_isbn' end,
      case when cardinality(w.valid_isbns)=0 then 'no_valid_isbn' end,
      case when w.pages is not null and w.pages not between 1 and 20000 then 'invalid_pages' end,
      case when w.pages is null then 'missing_pages' end,
      case when (w.pub_y is not null or w.pub_m is not null or w.pub_d is not null)
        and not public.publication_tuple_is_valid(w.pub_y,w.pub_m,w.pub_d) then 'invalid_publication' end,
      case when w.pub_y is null and w.pub_m is null and w.pub_d is null then 'missing_publication' end,
      case when w.pages is not null and not coalesce(w.provenance->'pageCount' ? 'referenceIsbn',false) then 'pages_without_reference_edition_review' end,
      case when w.pub_y is not null and not coalesce(w.provenance->'pubY' ? 'referenceIsbn',false) then 'date_without_reference_edition_review' end,
      case when w.pages is not null and w.provenance->'pageCount' ? 'referenceIsbn' and not exists(
        select 1 from unnest(w.valid_isbns) i where public.corpus_edition_fields_match(w.provenance,array['pageCount'],i,jsonb_build_object('pages',w.pages)))
        then 'page_reference_mismatch' end,
      case when (w.provenance->'pubY' ? 'referenceIsbn' or w.provenance->'pubM' ? 'referenceIsbn' or w.provenance->'pubD' ? 'referenceIsbn') and not exists(
        select 1 from unnest(w.valid_isbns) i where public.corpus_edition_fields_match(w.provenance,
          array_remove(array['pubY',case when w.pub_m is not null then 'pubM' end,case when w.pub_d is not null then 'pubD' end],null),i,
          jsonb_build_object('y',w.pub_y,'m',w.pub_m,'d',w.pub_d))) then 'date_reference_mismatch' end,
      case when (select count(distinct value->>'source') from jsonb_each(w.provenance) where key in ('pubY','pubM','pubD'))>1 then 'mixed_date_sources_review' end,
      case when exists(select 1 from jsonb_each(w.provenance) where value->>'source'='isbndb') then 'retired_provider_provenance_review' end,
      case when jsonb_typeof(w.metadata_provenance) is distinct from 'object' then 'malformed_provenance' end,
      case when w.provenance='{}' then 'missing_provenance' end,
      case when nullif(btrim(w.description,E' \t\r\n'),'') is null then 'missing_description' end,
      case when nullif(trim(w.publisher),'') is null then 'missing_publisher' end,
      case when nullif(trim(w.language),'') is null then 'missing_language' end,
      case when nullif(trim(w.cover_url),'') is null then 'missing_cover' end,
      case when nullif(trim(w.cover_url),'') is not null and w.cover_url !~ '^https://' then 'non_https_cover_review' end,
      case when nullif(trim(w.cover_url),'') is not null and nullif(trim(w.cover_source),'') is null then 'cover_without_source_review' end,
      case when w.cover_url like '%/storage/v1/object/public/covers/u/%' then 'cover_on_personal_storage_path_review' end,
      case when w.cover_url like '%/storage/v1/object/public/covers/%' and not exists(
        select 1 from storage.objects o where o.bucket_id='covers' and o.name=split_part(split_part(w.cover_url,'/storage/v1/object/public/covers/',2),'?',1))
        then 'cover_storage_object_not_registered_review' end,
      case when nullif(trim(w.genre),'') is null then 'missing_genre' end,
      case when nullif(trim(w.genre),'') is not null and lower(trim(w.genre)) not in
        ('romance','fantasy','science fiction','horror','mystery','literary','cozy','nonfiction','young adult') then 'noncanonical_genre_review' end,
      case when w.subgenre is distinct from coalesce(w.subgenres[1],'') and nullif(trim(w.subgenre),'') is not null then 'subgenre_projection_review' end,
      case when w.series_check_state in ('unresolved','review') then 'series_unresolved_or_review' end,
      case when w.series_check_state='unknown' then 'series_not_checked' end,
      case when w.series_check_state='no_series' and nullif(trim(w.series),'') is not null then 'no_series_with_candidate_label_review' end,
      case when nullif(trim(w.series),'') is not null and not exists(select 1 from entries e where e.work_id=w.id and e.is_primary) then 'series_label_without_primary_graph_review' end,
      case when w.series_check_state='found' and not exists(select 1 from entries e where e.work_id=w.id and e.is_primary) then 'found_without_primary_graph' end,
      case when exists(select 1 from entries e where e.work_id=w.id and e.is_primary and
        (w.series is distinct from e.name or w.position is distinct from e.position or w.series_count is distinct from e.declared_count)) then 'series_projection_disagreement' end,
      case when nullif(trim(w.series),'') is null and (w.position is not null or w.series_count is not null) then 'series_values_without_name' end,
      case when w.title ~* '(omnibus|box[ -]?set|[0-9]+[ -]book (set|collection))' then 'possible_collection_identity_review' end
    ],null) as concerns
  from base w
), graph_checks as materialized (
  select e.id,e.series_id,e.work_id,e.title,e.name,e.position,
    array_remove(array[
      case when e.work_id is null then 'unbound_slot_review' end,
      case when e.position is null then 'unknown_position' end,
      case when e.position<0 then 'negative_position_review' end,
      case when e.membership_claim is null or e.membership_claim='{}' or e.membership_claim->>'origin'='unknown' then 'unknown_membership_provenance' end,
      case when e.position is not null and (e.position_claim is null or e.position_claim='{}' or e.position_claim->>'origin'='unknown') then 'unknown_position_provenance' end,
      case when e.position is not null and exists(select 1 from entries x where x.series_id=e.series_id and x.position=e.position and x.id<>e.id) then 'shared_ordinal_review' end,
      case when e.is_primary and exists(select 1 from entries x where x.work_id=e.work_id and x.is_primary and x.id<>e.id) then 'multiple_primary_memberships' end,
      case when e.declared_count is not null and e.position>e.declared_count then 'position_exceeds_declared_count_review' end
    ],null) as concerns
  from entries e
)
select jsonb_build_object(
  'version',3,'captured_at',now(),'transaction_read_only',current_setting('transaction_read_only'),
  'detector_controls',jsonb_build_object('invalid_2025_feb29',not public.publication_tuple_is_valid(2025,2,29),
    'valid_2024_feb29',public.publication_tuple_is_valid(2024,2,29),'valid_year_only',public.publication_tuple_is_valid(2025,null,null),
    'invalid_disconnected_day',not public.publication_tuple_is_valid(2025,null,12)),
  'work_count',(select count(*) from base),'inventoried_work_count',(select count(*) from checked),
  'invalid_isbn_entries',(select count(*) from base cross join lateral unnest(isbns) i where public.library_isbn_checksum_is_valid(i) is not true),
  'multi_isbn_works',(select count(*) from base where cardinality(valid_isbns)>1),
  'maximum_isbns_per_work',(select max(cardinality(isbns)) from base),
  'field_source_counts',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from (
    select key as field,coalesce(value->>'source','unspecified') as source,count(*) as n
    from base cross join lateral jsonb_each(provenance) group by key,value->>'source' order by key,value->>'source') c),
  'cover_source_counts',(select jsonb_object_agg(source,n) from (
    select coalesce(nullif(cover_source,''),'unspecified') source,count(*) n from base group by coalesce(nullif(cover_source,''),'unspecified')) c),
  'snapshot_digest',(select md5(string_agg(md5((to_jsonb(b)-'created_by')::text),'' order by id)) from base b),
  'work_concern_counts',(select coalesce(jsonb_object_agg(concern,n),'{}') from (select concern,count(*) n from checked cross join lateral unnest(concerns) concern group by concern) c),
  'work_rows',(select jsonb_agg(to_jsonb(c) order by id) from checked c),
  'isbn_collision_groups',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from isbn_groups g),
  'duplicate_identity_groups',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from identity_groups g),
  'active_series_count',(select count(*) from active_series),
  'total_series_count',(select count(*) from public.corpus_series),
  'active_entry_count',(select count(*) from entries),
  'total_entry_count',(select count(*) from public.corpus_series_entries),
  'series_missing_length',(select count(*) from active_series where declared_count is null),
  'series_without_active_entries',(select count(*) from active_series s where not exists(select 1 from entries e where e.series_id=s.id)),
  'series_without_canonical_name',(select count(*) from active_series s where not exists(select 1 from public.corpus_series_names n where n.series_id=s.id and n.kind='canonical' and n.name=s.name)),
  'graph_concern_counts',(select coalesce(jsonb_object_agg(concern,n),'{}') from (select concern,count(*) n from graph_checks cross join lateral unnest(concerns) concern group by concern) c),
  'graph_rows',(select coalesce(jsonb_agg(to_jsonb(g) order by id),'[]') from graph_checks g),
  'series_state_counts',(select jsonb_object_agg(series_check_state,n) from (select series_check_state,count(*) n from base group by series_check_state) c),
  'metadata_status_counts',(select jsonb_object_agg(metadata_status,n) from (select metadata_status,count(*) n from base group by metadata_status) c)
) as audit;
rollback;
