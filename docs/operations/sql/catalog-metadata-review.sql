begin read only;
set local statement_timeout = '10s';
with evidence as (
  select id, title, author_text, isbns, edition_ids, pages, pub_y, pub_m, pub_d,
    metadata_provenance, updated_at,
    array_remove(array[
      case when pub_y is null and (pub_m is not null or pub_d is not null)
        or pub_m is null and pub_d is not null
        or pub_y < 1 or pub_y > 9999 or pub_m < 1 or pub_m > 12 or pub_d < 1
        or pub_d > case pub_m when 2 then case when mod(pub_y,4)=0 and (mod(pub_y,100)<>0 or mod(pub_y,400)=0) then 29 else 28 end
          when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end
        then 'invalid_or_disconnected_publication_date' end,
      case when (select count(distinct value->>'source') from jsonb_each(metadata_provenance)
        where key in ('pubY','pubM','pubD')) > 1 then 'publication_fields_have_different_sources' end,
      case when pages is not null and cardinality(isbns)>1 and cardinality(edition_ids)=0
        then 'pages_with_multiple_isbns_and_no_edition_locator' end,
      case when exists (select 1 from jsonb_each(metadata_provenance) where value->>'source'='isbndb')
        then 'retired_provider_provenance_requires_owner_review' end
    ], null) as reasons
  from public.works
), selected as (
  select id, title, author_text, isbns, edition_ids, pages,
    jsonb_build_object('y',pub_y,'m',pub_m,'d',pub_d) as publication,
    reasons, metadata_provenance, updated_at,
    md5(row(id,title,author_text,isbns,edition_ids,pages,pub_y,pub_m,pub_d,metadata_provenance,updated_at)::text) as snapshot_fingerprint
  from evidence where cardinality(reasons)>0
    or '9780143117841'=any(isbns)
  order by ('9780143117841'=any(isbns)) desc,
    ('invalid_or_disconnected_publication_date'=any(reasons)) desc,
    ('publication_fields_have_different_sources'=any(reasons)) desc, id
  limit 25
)
select jsonb_build_object(
  'captured_at',now(),
  'work_count',(select count(*) from evidence),
  'reason_counts',(select coalesce(jsonb_object_agg(reason,n),'{}') from (select reason,count(*) as n from evidence cross join lateral unnest(reasons) reason group by reason) counts),
  'review_rows',(select coalesce(jsonb_agg(to_jsonb(selected)),'[]') from selected)
) as review;
rollback;
