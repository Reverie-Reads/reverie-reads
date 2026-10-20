-- CLI-created, ordered after combined public/private history through 20261110010000.
-- Collective administrator evidence history; excluded from reader export/restore/offline data.
-- No backfill, provider qualification, intake cutover or personal-row changes.
begin;

-- Supplement legacy compact keys without changing stored identity/verdict keys.
-- Strip ordinary Latin accent marks only; non-Latin vowel signs remain identity-bearing.
create function public.catalog_evidence_identity_key(v text)
returns text language sql immutable set search_path='' as $$
  select regexp_replace(regexp_replace(lower(normalize(coalesce(v,''),NFKD)),
    '([a-z])'||U&'[\0300-\036F]+','\1','g'),$separators$[[:space:]'’.,:;!?()"_-]$separators$,'','g');
$$;
revoke all on function public.catalog_evidence_identity_key(text) from public,anon,authenticated,service_role;

create function public.catalog_evidence_draft_valid(v jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare s jsonb; i jsonb; u jsonb; p jsonb; x jsonb; k text;
begin
  if jsonb_typeof(v) is distinct from 'object' or not v ?& array['version','field','editionId','value','identity','source','support','sourceUse','note']
    or v-array['version','field','editionId','value','identity','source','support','sourceUse','note']<>'{}'
    or v->'version' is distinct from '1'::jsonb or jsonb_typeof(v->'field') is distinct from 'string' or v->>'field' not in ('description','pages','publication') then return false; end if;
  i:=v->'identity'; s:=v->'source'; u:=v->'sourceUse'; p:=v->'support'; x:=v->'value';
  if jsonb_typeof(i) is distinct from 'object' or not i ?& array['title','author','isbn'] or i-array['title','author','isbn']<>'{}'
    or jsonb_typeof(s) is distinct from 'object' or not s ?& array['url','recordId','locator','checkedAt','kind'] or s-array['url','recordId','locator','checkedAt','kind']<>'{}'
    or jsonb_typeof(p) is distinct from 'object' or not p ?& array['explanation','scope','independentlyChecked'] or p-array['explanation','scope','independentlyChecked']<>'{}'
    or p->'independentlyChecked' is distinct from 'true'::jsonb
    or jsonb_typeof(s->'kind') is distinct from 'string' or s->>'kind' not in ('publisher','author','published_book') then return false; end if;
  foreach k in array array['title','author'] loop
    if jsonb_typeof(i->k) is distinct from 'string' or length(i->>k) not between 1 and (case when k='title' then 1000 else 2000 end) or i->>k !~ '[^[:space:]]' then return false; end if;
  end loop;
  foreach k in array array['recordId','locator'] loop
    if jsonb_typeof(s->k) is distinct from 'string' or length(s->>k) not between 1 and (case when k='recordId' then 200 else 1000 end) or s->>k !~ '[^[:space:]]' then return false; end if;
  end loop;
  if jsonb_typeof(v->'note') is distinct from 'string' or length(v->>'note') not between 1 and 1200 or v->>'note' !~ '[^[:space:]]'
    or jsonb_typeof(p->'explanation') is distinct from 'string' or length(p->>'explanation') not between 1 and 1200 or p->>'explanation' !~ '[^[:space:]]'
    or not public.edition_credit_source_use_valid(jsonb_build_object('version',1,'basis','public_terms','url',s->'url','note','URL validation only',
      'checkedAt',s->'checkedAt','scope','edition_identity_and_credit_facts','confirmed',true))
    or not public.edition_credit_source_use_valid(u||jsonb_build_object('scope','edition_identity_and_credit_facts')) then return false; end if;
  if v->>'field'='description' then
    return v->'editionId'='null'::jsonb and i->'isbn'='null'::jsonb and p->>'scope'='work' and u->>'scope'='catalog_description'
      and jsonb_typeof(x)='string' and length(x#>>'{}') between 1 and 10000 and x#>>'{}' ~ '[^[:space:]]';
  end if;
  if jsonb_typeof(v->'editionId') is distinct from 'string' or (v->>'editionId')::uuid is null
    or jsonb_typeof(i->'isbn') is distinct from 'string' or not public.library_isbn_checksum_is_valid(i->>'isbn')
    or p->>'scope' is distinct from 'edition' or u->>'scope' is distinct from 'catalog_edition_facts' then return false; end if;
  if v->>'field'='pages' then
    return jsonb_typeof(x)='object' and x ? 'pages' and x-'pages'='{}' and jsonb_typeof(x->'pages')='number'
      and x->>'pages' ~ '^[0-9]{1,5}$' and (x->>'pages')::integer between 1 and 20000;
  end if;
  return jsonb_typeof(x)='object' and x ?& array['y','m','d'] and x-array['y','m','d']='{}'
    and x->'y'<>'null'::jsonb and public.corpus_edition_details_valid(jsonb_build_object('publication',x));
exception when others then return false;
end;
$$;
revoke all on function public.catalog_evidence_draft_valid(jsonb) from public,anon,authenticated,service_role;

create table public.corpus_metadata_evidence_reviews (
  id uuid primary key,
  work_id uuid not null references public.works(id) on delete restrict,
  edition_id uuid references public.corpus_editions(id) on delete restrict,
  reviewer_id uuid references public.profiles(id) on delete set null,
  expected_fingerprint text not null,
  draft jsonb not null check(public.catalog_evidence_draft_valid(draft) is true),
  previous_value jsonb not null,
  applied_at timestamptz not null default now()
);
alter table public.corpus_metadata_evidence_reviews enable row level security;
revoke all on public.corpus_metadata_evidence_reviews from public,anon,authenticated,service_role;
create index corpus_metadata_evidence_reviews_work on public.corpus_metadata_evidence_reviews(work_id,applied_at desc,id);
comment on table public.corpus_metadata_evidence_reviews is 'Collective, immutable applied administrator evidence decisions, not provider payloads or personal library data. Profile deletion anonymizes attribution; excluded from reader backups.';

create function public.catalog_evidence_fingerprint(p_work uuid)
returns text language sql stable security definer set search_path='' as $$
  select md5(jsonb_build_array(public.corpus_record_fingerprint(w.id),public.catalog_metadata_review_record(w)->>'fingerprint',
    coalesce((select revision from public.corpus_metadata_reviews where work_id=w.id),0))::text) from public.works w where w.id=p_work;
$$;
revoke all on function public.catalog_evidence_fingerprint(uuid) from public,anon,authenticated,service_role;

create function public.admin_get_catalog_evidence(p_work uuid,p_review uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not public.is_corpus_admin() then raise exception 'corpus administrator required' using errcode='42501'; end if;
  return jsonb_build_object('version',1,'fingerprint',public.catalog_evidence_fingerprint(p_work),'record',public.get_corpus_record(p_work),
    'attempt',(select to_jsonb(a) from public.corpus_metadata_evidence_reviews a where a.id=p_review and a.work_id=p_work and a.reviewer_id=(select auth.uid())),
    'history',(select coalesce(jsonb_agg(to_jsonb(r) order by r.applied_at desc,r.id),'[]') from
      (select * from public.corpus_metadata_evidence_reviews where work_id=p_work order by applied_at desc,id limit 20) r));
end;
$$;

create function public.admin_apply_catalog_evidence(p_id uuid,p_work uuid,p_expected_fingerprint text,p_draft jsonb,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=(select auth.uid()); saved public.corpus_metadata_evidence_reviews; w public.works; e public.corpus_editions;
  record jsonb; before_value jsonb; v_details jsonb; v_edition_id uuid; ref text; prior_guard text:=current_setting('reverie.series_review_preserve_catalog',true);
begin
  if caller is null then raise exception 'corpus administrator required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=caller for key share;
  perform 1 from public.corpus_admins where user_id=caller for update;
  if not found then raise exception 'corpus administrator required' using errcode='42501'; end if;
  if p_id is null or p_confirmed is distinct from true then raise exception 'Confirm the exact reviewed fact.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog-evidence:'||p_id::text,0));
  select * into saved from public.corpus_metadata_evidence_reviews where id=p_id;
  if found then
    if saved.reviewer_id is distinct from caller or saved.work_id is distinct from p_work or saved.expected_fingerprint is distinct from p_expected_fingerprint or saved.draft is distinct from p_draft then
      raise exception 'This retry identity belongs to a different reviewed change.' using errcode='PT409'; end if;
    return jsonb_build_object('id',saved.id,'status','applied','appliedAt',saved.applied_at);
  end if;
  if public.catalog_evidence_draft_valid(p_draft) is distinct from true then raise exception 'Invalid reviewed evidence.' using errcode='22023'; end if;
  if public.edition_credit_source_use_hold((p_draft->'sourceUse')||jsonb_build_object('scope','edition_identity_and_credit_facts')) is not null
    or (p_draft->'source'->>'checkedAt')::timestamptz>now() or (p_draft->'source'->>'checkedAt')::timestamptz<now()-interval '720 hours' then
      raise exception 'Inspect current evidence and source use before saving.' using errcode='22023'; end if;
  perform public.lock_library_isbns((select isbns from public.works where id=p_work));
  select * into w from public.works where id=p_work for update;
  if not found then raise exception 'Catalog work not found.' using errcode='P0002'; end if;
  if public.catalog_evidence_fingerprint(p_work) is distinct from p_expected_fingerprint then raise exception 'The catalog or review changed. Reload before deciding.' using errcode='PT409'; end if;
  if exists(select 1 from public.corpus_metadata_reviews where work_id=p_work and state='deferred') then
    raise exception 'Reconcile and explicitly reopen the deferred review before applying evidence.' using errcode='22023'; end if;
  record:=public.catalog_metadata_review_record(w);
  if record->'issues' ?| array['invalid_isbn','isbn_conflict','duplicate_identity','reader_report'] then
    raise exception 'Resolve the recorded identity concerns before applying evidence.' using errcode='22023'; end if;
  if w.title !~ '[[:alnum:]]' or jsonb_array_length(w.contributors)=0 or public.edition_credit_ambiguous(w.author_text) or public.edition_credit_ambiguous(p_draft->'identity'->>'author')
    or regexp_replace(normalize(w.author_text,NFKD),'[^[:alpha:]]','','g') ~ '^[A-Za-z]$'
    or public.catalog_evidence_identity_key(w.title) is distinct from public.catalog_evidence_identity_key(p_draft->'identity'->>'title')
    or public.catalog_evidence_identity_key(w.author_text) is distinct from public.catalog_evidence_identity_key(p_draft->'identity'->>'author')
    or (jsonb_array_length(w.contributors)>0 and (exists(select 1 from jsonb_array_elements(w.contributors) c where c->>'name' is null or c->>'name' !~ '[[:alpha:]]' or c->>'role' is null or c->>'role' not in ('author','co_author') or public.edition_credit_ambiguous(c->>'name') or regexp_replace(normalize(c->>'name',NFKD),'[^[:alpha:]]','','g') ~ '^[A-Za-z]$')
      or public.catalog_evidence_identity_key(w.author_text) is distinct from (select public.catalog_evidence_identity_key(string_agg(c->>'name',' ' order by ord)) from jsonb_array_elements(w.contributors) with ordinality x(c,ord)))) then
    raise exception 'Resolve contributor identity before applying evidence.' using errcode='22023'; end if;
  if p_draft->>'field'='description' then
    before_value:=to_jsonb(w.description);
    perform set_config('reverie.series_review_preserve_catalog','on',true);
    perform public.admin_review_corpus_metadata(p_work,record->>'fingerprint',coalesce((select revision from public.corpus_metadata_reviews where work_id=p_work),0),
      'description',p_draft->>'note',p_draft->'source'->>'url',p_draft->>'value',true);
    perform set_config('reverie.series_review_preserve_catalog',coalesce(prior_guard,''),true);
  else
    v_edition_id:=(p_draft->>'editionId')::uuid; ref:=public.canonical_library_isbn(p_draft->'identity'->>'isbn');
    select * into e from public.corpus_editions where id=v_edition_id and work_id=p_work for update;
    if not found or e.isbn is distinct from ref or not ref=any(public.catalog_review_isbns(w.isbns)) then raise exception 'Select the exact existing edition ISBN.' using errcode='22023'; end if;
    if p_draft->>'field'='pages' and coalesce(e.details->>'format','other') not in ('paperback','hardcover','ebook') then raise exception 'Verify the selected edition format before reviewing pages.' using errcode='22023'; end if;
    before_value:=coalesce(e.details->(p_draft->>'field'),'null'::jsonb);
    v_details:=e.details||jsonb_build_object(p_draft->>'field',case when p_draft->>'field'='pages' then p_draft->'value'->'pages' else p_draft->'value' end);
    if not public.corpus_edition_details_valid(v_details) then raise exception 'Invalid selected edition value.' using errcode='22023'; end if;
    perform set_config('reverie.series_review_preserve_catalog','on',true);
    update public.corpus_editions set details=v_details,revision=revision+1,updated_at=now(),
      provenance=provenance||jsonb_build_object(p_draft->>'field',jsonb_build_object('source','administrator_evidence','sourceRef',p_draft->'source'->>'url',
        'reviewId',p_id,'referenceIsbn',ref,'observedAt',now())) where id=v_edition_id;
    perform set_config('reverie.series_review_preserve_catalog',coalesce(prior_guard,''),true);
    insert into public.corpus_record_edits(work_id,edition_id,editor_id,action,previous_value,next_value,source_url,note)
      values(p_work,v_edition_id,caller,'edition',jsonb_build_object(p_draft->>'field',before_value),jsonb_build_object(p_draft->>'field',v_details->(p_draft->>'field')),p_draft->'source'->>'url',p_draft->>'note');
  end if;
  insert into public.corpus_metadata_evidence_reviews(id,work_id,edition_id,reviewer_id,expected_fingerprint,draft,previous_value)
    values(p_id,p_work,v_edition_id,caller,p_expected_fingerprint,p_draft,coalesce(before_value,'null'::jsonb)) returning * into saved;
  return jsonb_build_object('id',saved.id,'status','applied','appliedAt',saved.applied_at);
end;
$$;
revoke all on function public.admin_get_catalog_evidence(uuid,uuid),public.admin_apply_catalog_evidence(uuid,uuid,text,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_catalog_evidence(uuid,uuid),public.admin_apply_catalog_evidence(uuid,uuid,text,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
