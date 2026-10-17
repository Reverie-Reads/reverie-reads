-- Additive shared bibliography only. Never migrate or project personal contributors/history.
-- CLI-created migration ordered after the combined public/private 20261108010000 history.
begin;
create function public.edition_credit_key(v text) returns text language sql immutable set search_path='' as $$
  select lower(regexp_replace(btrim(normalize(v,NFKC)), '[[:space:]]+', ' ', 'g'));
$$;
create function public.edition_credit_ambiguous(v text) returns boolean language sql immutable set search_path='' as $$
  select coalesce(array_length(words,1)>1 and not exists(
    select 1 from unnest(words[1:array_length(words,1)-1]) w where length(w)>1),false)
  from (select array(select m[1] from regexp_matches(v,'([[:alpha:]]+)','g') m) words) s;
$$;
create function public.edition_credit_evidence_valid(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare c jsonb; s jsonb; i jsonb; k text; seen text[] := '{}'; ck text; ts timestamptz;
begin
  if jsonb_typeof(v) is distinct from 'object' or not v ?& array['version','source','identity','credits','confirmations']
    or v-array['version','source','identity','credits','confirmations']<>'{}' or v->'version'<>'1'::jsonb then return false; end if;
  s:=v->'source'; i:=v->'identity';
  if jsonb_typeof(s) is distinct from 'object' or not s ?& array['url','kind','checkedAt','locator','retentionConfirmed']
    or s-array['url','kind','checkedAt','locator','retentionConfirmed']<>'{}' or s->'retentionConfirmed' is distinct from 'true'::jsonb
    or s->>'kind' is null or s->>'kind' not in ('publisher','author','unverified')
    or jsonb_typeof(s->'url') is distinct from 'string' or length(s->>'url')>2000
    or s->>'url' !~ '^https://[^[:space:]/?#@:]+([/?#][^[:space:]]*)?$'
    or jsonb_typeof(s->'locator') is distinct from 'string' or length(btrim(s->>'locator')) not between 1 and 1000
    or jsonb_typeof(s->'checkedAt') is distinct from 'string' or s->>'checkedAt' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$'
    then return false; end if;
  ts := (s->>'checkedAt')::timestamptz;
  if jsonb_typeof(i) is distinct from 'object' or not i ?& array['title','authors','isbn','format','language']
    or i-array['title','authors','isbn','format','language']<>'{}' then return false; end if;
  foreach k in array array['title','isbn'] loop
    if jsonb_typeof(i->k) is distinct from 'string' or length(btrim(i->>k)) not between 1 and 1000 then return false; end if;
  end loop;
  if i->'format'<>'null' and (jsonb_typeof(i->'format')<>'string' or i->>'format' not in ('paperback','hardcover','ebook','audiobook','other')) then return false; end if;
  if i->'language'<>'null' and (jsonb_typeof(i->'language')<>'string' or length(btrim(i->>'language')) not between 1 and 100) then return false; end if;
  if jsonb_typeof(i->'authors') is distinct from 'array' or jsonb_array_length(i->'authors') not between 1 and 20 then return false; end if;
  if exists(select 1 from jsonb_array_elements(i->'authors') a where jsonb_typeof(a)<>'string' or length(btrim(a#>>'{}')) not between 1 and 1000) then return false; end if;
  if jsonb_typeof(v->'confirmations') is distinct from 'object' or not (v->'confirmations') ?& array['sourceChecked','identityChecked','creditsChecked']
    or (v->'confirmations')-array['sourceChecked','identityChecked','creditsChecked']<>'{}'
    or exists(select 1 from jsonb_each(v->'confirmations') e where jsonb_typeof(e.value)<>'boolean') then return false; end if;
  if jsonb_typeof(v->'credits') is distinct from 'array' or jsonb_array_length(v->'credits') not between 1 and 32 then return false; end if;
  for c in select value from jsonb_array_elements(v->'credits') loop
    if jsonb_typeof(c) is distinct from 'object' or not c ?& array['name','role','scope'] or c-array['name','role','scope','part','sourceRole','basis']<>'{}'
      or jsonb_typeof(c->'name') is distinct from 'string' or length(btrim(c->>'name')) not between 1 and 1000
      or c->>'role' is null or c->>'role' not in ('author','editor','translator','illustrator','narrator','original_story','playwright','foreword','introduction','contributor','unknown')
      or c->>'scope' is null or c->>'scope' not in ('whole','part') then return false; end if;
    if (c->>'scope'='whole' and c ? 'part') or (c->>'scope'='part' and (jsonb_typeof(c->'part') is distinct from 'string' or length(btrim(c->>'part')) not between 1 and 1000)) then return false; end if;
    if c ? 'basis' and (c->>'basis' is null or c->>'basis' not in ('work','edition')) then return false; end if;
    if c ? 'sourceRole' and c->'sourceRole'<>'null' and (jsonb_typeof(c->'sourceRole')<>'string' or length(c->>'sourceRole')>200) then return false; end if;
    ck:=jsonb_build_array(c->>'name',c->>'role',c->>'scope',c->>'part')::text;
    if ck=any(seen) then return false; end if; seen:=array_append(seen,ck);
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.edition_credit_key(text), public.edition_credit_ambiguous(text),public.edition_credit_evidence_valid(jsonb) from public,anon,authenticated,service_role;

alter table public.corpus_editions add column credits jsonb not null default '[]' check(jsonb_typeof(credits)='array' and jsonb_array_length(credits)<=256);
-- Accepted evidence is historical, not authority for a subsequently changed identity.
-- Preserve every original value and receipt while explicitly withdrawing current qualification.
create function public.hold_edition_credits_after_identity_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if jsonb_array_length(new.credits)>0 and (
    new.work_id is distinct from old.work_id or new.isbn is distinct from old.isbn
    or (new.details->'title') is distinct from (old.details->'title')
    or (new.details->'statement') is distinct from (old.details->'statement')
    or (new.details->'format') is distinct from (old.details->'format')
    or (new.details->'language') is distinct from (old.details->'language')) then
    select jsonb_agg(c || '{"reviewRequired":true}'::jsonb order by n) into new.credits
      from jsonb_array_elements(new.credits) with ordinality x(c,n);
    new.revision:=greatest(new.revision,old.revision+1); new.updated_at:=now();
  end if;
  return new;
end;
$$;
create trigger edition_credits_identity_hold before update of work_id,isbn,details on public.corpus_editions
for each row execute function public.hold_edition_credits_after_identity_change();
create function public.hold_work_edition_credits_after_identity_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.corpus_editions e set credits=(select jsonb_agg(c || '{"reviewRequired":true}'::jsonb order by n)
    from jsonb_array_elements(e.credits) with ordinality x(c,n)),revision=e.revision+1,updated_at=now()
    where e.work_id=new.id and exists(select 1 from jsonb_array_elements(e.credits) c where c->'reviewRequired' is distinct from 'true'::jsonb)
    and (new.title is distinct from old.title or new.author_text is distinct from old.author_text
      or new.contributors is distinct from old.contributors or e.isbn is null
      or not e.isbn=any(public.catalog_review_isbns(new.isbns)));
  return new;
end;
$$;
create trigger work_edition_credits_identity_hold after update of title,author_text,contributors,isbns on public.works
for each row execute function public.hold_work_edition_credits_after_identity_change();
revoke all on function public.hold_edition_credits_after_identity_change(),public.hold_work_edition_credits_after_identity_change() from public,anon,authenticated,service_role;
create table public.corpus_edition_credit_reviews (
  id uuid primary key,
  work_id uuid not null references public.works(id) on delete restrict,
  edition_id uuid not null references public.corpus_editions(id) on delete restrict,
  reviewer_id uuid references public.profiles(id) on delete set null,
  expected_fingerprint text not null,
  evidence jsonb not null check(public.edition_credit_evidence_valid(evidence)),
  status text not null default 'prepared' check(status in ('prepared','applied')),
  selected integer[] not null default '{}',
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index corpus_edition_credit_reviews_edition_idx on public.corpus_edition_credit_reviews(edition_id,created_at desc,id);
create index corpus_edition_credit_reviews_work_idx on public.corpus_edition_credit_reviews(work_id);
create index corpus_edition_credit_reviews_reviewer_idx on public.corpus_edition_credit_reviews(reviewer_id);
alter table public.corpus_edition_credit_reviews enable row level security;
revoke all on public.corpus_edition_credit_reviews from public,anon,authenticated,service_role;

-- Internal deterministic checks. Explicit reviewer attestation establishes source entailment;
-- a submitted URL, publisher string or provider role alone never does so.
create function public.edition_credit_decisions(p_work uuid,p_edition uuid,v jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w public.works; e public.corpus_editions; credit_item jsonb; reasons text[] := '{}'; held text[];
  names text[]; source_names text[]; result jsonb := '[]'; credit_position integer:=0; consistent boolean:=true;
begin
  if not public.edition_credit_evidence_valid(v) then raise exception 'Invalid edition-credit evidence.' using errcode='22023'; end if;
  select * into w from public.works where id=p_work;
  select * into e from public.corpus_editions where id=p_edition and work_id=p_work;
  if w.id is null or e.id is null then raise exception 'Selected edition not found.' using errcode='P0002'; end if;
  if jsonb_typeof(w.contributors) is distinct from 'array' then consistent:=false; names:='{}';
  elsif jsonb_array_length(w.contributors)=0 then names:=array[w.author_text];
  else
    select coalesce(array_agg(c->>'name' order by ord),'{}') into names
      from jsonb_array_elements(w.contributors) with ordinality a(c,ord)
      where c->>'role' in ('author','co_author','editor','playwright','original_story');
    if exists(select 1 from jsonb_array_elements(w.contributors) c where jsonb_typeof(c->'name') is distinct from 'string'
      or nullif(btrim(c->>'name'),'') is null or c->>'role' is null or c->>'role' not in ('author','co_author','editor','playwright','original_story','translator','illustrator','narrator','foreword','introduction','contributor')) then consistent:=false; end if;
    if public.edition_credit_key(w.author_text) is distinct from public.edition_credit_key(array_to_string(names,', ')) then consistent:=false; end if;
  end if;
  if not consistent or cardinality(names)=0 or exists(select 1 from unnest(names) n where nullif(btrim(n),'') is null) then reasons:=array_append(reasons,'catalog_identity_review'); end if;
  select array_agg(public.edition_credit_key(a) order by public.edition_credit_key(a)) into source_names from jsonb_array_elements_text(v->'identity'->'authors') a;
  if public.edition_credit_key(w.title) is distinct from public.edition_credit_key(v->'identity'->>'title')
    or source_names is distinct from (select array_agg(public.edition_credit_key(a) order by public.edition_credit_key(a)) from unnest(names) a) then reasons:=array_append(reasons,'identity_conflict'); end if;
  if exists(select 1 from unnest(names || source_names) n where public.edition_credit_ambiguous(n)) then reasons:=array_append(reasons,'ambiguous_name'); end if;
  if e.isbn is null or not public.library_isbn_checksum_is_valid(v->'identity'->>'isbn')
    or public.canonical_library_isbn(v->'identity'->>'isbn') is distinct from e.isbn
    or not e.isbn=any(public.catalog_review_isbns(w.isbns))
    or exists(select 1 from public.works other where other.id<>w.id and e.isbn=any(public.catalog_review_isbns(other.isbns))) then reasons:=array_append(reasons,'isbn_conflict'); end if;
  if (e.details->>'format' is not null and v->'identity'->>'format' is not null and e.details->>'format'<>v->'identity'->>'format')
    or (e.details->>'language' is not null and v->'identity'->>'language' is not null and public.edition_credit_key(e.details->>'language')<>public.edition_credit_key(v->'identity'->>'language')) then reasons:=array_append(reasons,'edition_conflict'); end if;
  if v->'source'->>'kind'='unverified' then reasons:=array_append(reasons,'source_unverified'); end if;
  if (v->'source'->>'checkedAt')::timestamptz>now() or (v->'source'->>'checkedAt')::timestamptz<now()-interval '30 days' then reasons:=array_append(reasons,'stale_evidence'); end if;
  if exists(select 1 from jsonb_each(v->'confirmations') c where c.value<>'true'::jsonb) then reasons:=array_append(reasons,'confirmation_missing'); end if;
  for credit_item in select value from jsonb_array_elements(v->'credits') loop
    held:=reasons;
    if credit_item->>'role'='unknown' or nullif(btrim(credit_item->>'sourceRole'),'') is null then held:=array_append(held,'role_unverified'); end if;
    if credit_item->>'basis' is distinct from 'edition' then held:=array_append(held,'credit_scope_unverified'); end if;
    if public.edition_credit_ambiguous(credit_item->>'name') then held:=array_append(held,'ambiguous_name'); end if;
    if exists(select 1 from jsonb_array_elements(e.credits) old where old->'reviewRequired' is distinct from 'true'::jsonb and
      public.edition_credit_key(old->'credit'->>'name')=public.edition_credit_key(credit_item->>'name')
      and old->'credit'->>'role'=credit_item->>'role' and old->'credit'->>'scope'=credit_item->>'scope'
      and old->'credit'->>'part' is not distinct from credit_item->>'part') then held:=array_append(held,'existing_credit'); end if;
    result:=result || jsonb_build_array(jsonb_build_object('position',credit_position,'credit',credit_item,'eligible',cardinality(held)=0,'reasons',to_jsonb(held)));
    credit_position:=credit_position+1;
  end loop;
  return result;
end;
$$;
revoke all on function public.edition_credit_decisions(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.admin_get_edition_credit_reviews(p_work uuid,p_edition uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not public.is_corpus_admin() then raise exception 'corpus administrator required' using errcode='42501'; end if;
  return jsonb_build_object('version',1,'reviews',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
    'decisions',public.edition_credit_decisions(r.work_id,r.edition_id,r.evidence),
    'stale',r.expected_fingerprint is distinct from public.corpus_record_fingerprint(r.work_id)) order by r.created_at desc,r.id),'[]')
    from (select * from public.corpus_edition_credit_reviews where work_id=p_work and edition_id=p_edition order by created_at desc,id limit 20) r));
end;
$$;

create function public.admin_prepare_edition_credits(p_id uuid,p_work uuid,p_edition uuid,p_expected_fingerprint text,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=(select auth.uid()); r public.corpus_edition_credit_reviews; e public.corpus_editions;
begin
  if caller is null then raise exception 'corpus administrator required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=caller for key share;
  perform 1 from public.corpus_admins where user_id=caller for update;
  if not found then raise exception 'corpus administrator required' using errcode='42501'; end if;
  if p_id is null or not public.edition_credit_evidence_valid(p_evidence) then raise exception 'Invalid edition-credit evidence.' using errcode='22023'; end if;
  -- Same ID is a read-only identical retry, even after a save or a newer catalog revision.
  select * into r from public.corpus_edition_credit_reviews where id=p_id;
  if found then
    if r.reviewer_id is distinct from caller or r.work_id is distinct from p_work or r.edition_id is distinct from p_edition
      or r.expected_fingerprint is distinct from p_expected_fingerprint or r.evidence is distinct from p_evidence then
      raise exception 'This review ID belongs to a different draft.' using errcode='PT409'; end if;
    return jsonb_build_object('id',r.id,'status',r.status,'evidence',r.evidence,'decisions',public.edition_credit_decisions(p_work,p_edition,r.evidence));
  end if;
  -- Serialize the current ISBN assignment before locking work/edition.
  perform public.lock_library_isbns(array[(select isbn from public.corpus_editions where id=p_edition and work_id=p_work)]);
  perform 1 from public.works where id=p_work for update;
  select * into e from public.corpus_editions where id=p_edition and work_id=p_work for update;
  if not found then raise exception 'Selected edition not found.' using errcode='P0002'; end if;
  if p_expected_fingerprint is distinct from public.corpus_record_fingerprint(p_work) then raise exception 'The catalog changed. Reload before reviewing.' using errcode='PT409'; end if;
  insert into public.corpus_edition_credit_reviews(id,work_id,edition_id,reviewer_id,expected_fingerprint,evidence)
    values(p_id,p_work,p_edition,caller,p_expected_fingerprint,p_evidence);
  return jsonb_build_object('id',p_id,'status','prepared','evidence',p_evidence,'decisions',public.edition_credit_decisions(p_work,p_edition,p_evidence));
end;
$$;

create function public.admin_apply_edition_credits(p_id uuid,p_selected integer[],p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=(select auth.uid()); r public.corpus_edition_credit_reviews; e public.corpus_editions; chosen integer[];
  decisions jsonb; additions jsonb; workid uuid; editionid uuid;
begin
  if caller is null then raise exception 'corpus administrator required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=caller for key share;
  perform 1 from public.corpus_admins where user_id=caller for update;
  if not found then raise exception 'corpus administrator required' using errcode='42501'; end if;
  if p_confirmed is distinct from true or p_selected is null or cardinality(p_selected) not between 1 and 32
    or array_position(p_selected,null) is not null then raise exception 'Select and confirm supported credits.' using errcode='22023'; end if;
  select array_agg(distinct x order by x) into chosen from unnest(p_selected) x;
  if cardinality(chosen)<>cardinality(p_selected) then raise exception 'Select each credit once.' using errcode='22023'; end if;
  select work_id,edition_id into workid,editionid from public.corpus_edition_credit_reviews where id=p_id and reviewer_id=caller;
  if not found then raise exception 'Review not found for this administrator.' using errcode='P0002'; end if;
  perform public.lock_library_isbns(array[(select isbn from public.corpus_editions where id=editionid and work_id=workid)]);
  perform 1 from public.works where id=workid for update;
  select * into e from public.corpus_editions where id=editionid and work_id=workid for update;
  select * into r from public.corpus_edition_credit_reviews where id=p_id for update;
  if r.status='applied' then
    if r.selected is distinct from chosen then raise exception 'The saved review used a different selection.' using errcode='PT409'; end if;
    return jsonb_build_object('id',r.id,'status','applied','selected',r.selected,'appliedAt',r.applied_at);
  end if;
  if r.expected_fingerprint is distinct from public.corpus_record_fingerprint(workid) then raise exception 'The catalog changed. Reload before reviewing.' using errcode='PT409'; end if;
  decisions:=public.edition_credit_decisions(workid,editionid,r.evidence);
  if exists(select 1 from unnest(chosen) n where n<0 or n>=jsonb_array_length(decisions) or (decisions->n->>'eligible')::boolean is distinct from true) then
    raise exception 'Selected credits still require review.' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('reviewId',r.id,'position',n,'credit',r.evidence->'credits'->n,
    'source',r.evidence->'source','identity',r.evidence->'identity') order by n) into additions from unnest(chosen) n;
  update public.corpus_editions set credits=credits||additions,revision=revision+1,updated_at=now() where id=editionid;
  update public.corpus_edition_credit_reviews set status='applied',selected=chosen,applied_at=now() where id=r.id
    returning * into r;
  return jsonb_build_object('id',r.id,'status','applied','selected',r.selected,'appliedAt',r.applied_at);
end;
$$;
revoke all on function public.admin_get_edition_credit_reviews(uuid,uuid),public.admin_prepare_edition_credits(uuid,uuid,uuid,text,jsonb),public.admin_apply_edition_credits(uuid,integer[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_edition_credit_reviews(uuid,uuid),public.admin_prepare_edition_credits(uuid,uuid,uuid,text,jsonb),public.admin_apply_edition_credits(uuid,integer[],boolean) to authenticated;
notify pgrst,'reload schema';
commit;
