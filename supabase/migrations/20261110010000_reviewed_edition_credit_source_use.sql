-- CLI-created; ordered after combined public/private history through 20261109010000.
-- Separate human attestation for retaining edition identity/credit facts. No provider promotion,
-- legal determination, prose/images, export or model-input permission is implied.
-- Existing accepted credits and all personal rows are unchanged by this migration.
begin;

create function public.edition_credit_source_use_valid(v jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare ts timestamptz; u text; authority text; port text;
begin
  if jsonb_typeof(v) is distinct from 'object'
    or not v ?& array['version','basis','url','note','checkedAt','scope','confirmed']
    or v-array['version','basis','url','note','checkedAt','scope','confirmed']<>'{}'
    or v->'version' is distinct from '1'::jsonb
    or jsonb_typeof(v->'basis') is distinct from 'string'
    or v->>'basis' not in ('public_terms','written_permission')
    or v->'scope' is distinct from '"edition_identity_and_credit_facts"'::jsonb
    or v->'confirmed' is distinct from 'true'::jsonb
    or jsonb_typeof(v->'url') is distinct from 'string'
    or jsonb_typeof(v->'note') is distinct from 'string'
    or length(v->>'note') not between 1 and 1000 or v->>'note' !~ '[^[:space:]]'
    or jsonb_typeof(v->'checkedAt') is distinct from 'string'
    or v->>'checkedAt' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$'
    then return false; end if;
  u:=v->>'url';
  -- No credentials, whitespace, backslashes or query component. Fragments are allowed.
  -- No URL is fetched here, and source URLs never confer publisher or corpus authority.
  if length(u)>2000 or u !~* '^https://[^/?#]+([/#].*)?$'
    or u ~ '[[:space:]]' or position(chr(92) in u)>0
    or position('?' in split_part(u,'#',1))>0 then return false; end if;
  authority:=substring(u from '(?i)^https://([^/?#]+)');
  if authority ~ '[@%<>"^|]' then return false; end if;
  if left(authority,1)='[' then
    if authority !~ '^\[[0-9A-Fa-f:.]+\](:[0-9]+)?$' then return false; end if;
    -- Reject malformed IPv6 literals rather than accepting any bracketed text.
    if family(substring(authority from '^\[([^]]+)\]')::inet)<>6 then return false; end if;
    port:=substring(authority from '\]:([0-9]+)$');
  else
    if authority !~ '^[^:]+(:[0-9]+)?$' then return false; end if;
    port:=substring(authority from ':([0-9]+)$');
  end if;
  if port is not null and (length(port)>5 or port::integer>65535) then return false; end if;
  ts:=(v->>'checkedAt')::timestamptz;
  -- PostgreSQL accepts 24:00 and leap-second rollovers; the contract does not.
  if to_char(ts at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(v->>'checkedAt',19) then return false; end if;
  return true;
exception when others then return false;
end;
$$;

create function public.edition_credit_source_use_hold(v jsonb)
returns text language plpgsql stable set search_path='' as $$
begin
  if not public.edition_credit_source_use_valid(v) then return 'source_use_review_required'; end if;
  if (v->>'checkedAt')::timestamptz>now() or (v->>'checkedAt')::timestamptz<now()-interval '720 hours'
    then return 'source_use_stale'; end if;
  return null;
end;
$$;
revoke all on function public.edition_credit_source_use_valid(jsonb),public.edition_credit_source_use_hold(jsonb) from public,anon,authenticated,service_role;

create table public.corpus_edition_credit_source_use_receipts (
  review_id uuid primary key references public.corpus_edition_credit_reviews(id) on delete restrict,
  source_use jsonb not null check(public.edition_credit_source_use_valid(source_use))
);
alter table public.corpus_edition_credit_source_use_receipts enable row level security;
revoke all on public.corpus_edition_credit_source_use_receipts from public,anon,authenticated,service_role;
comment on table public.corpus_edition_credit_source_use_receipts is
  'Frozen administrator attestation scoped only to edition identity and credit facts, not a legal approval, source qualification or license for other uses. No direct API access.';

create function public.edition_credit_review_decisions(p_work uuid,p_edition uuid,p_evidence jsonb,p_source_use jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare decisions jsonb; hold text;
begin
  decisions:=public.edition_credit_decisions(p_work,p_edition,p_evidence);
  hold:=public.edition_credit_source_use_hold(p_source_use);
  if hold is null then return decisions; end if;
  return (select coalesce(jsonb_agg(d || jsonb_build_object('eligible',false,'reasons',(d->'reasons')||jsonb_build_array(hold)) order by n),'[]')
    from jsonb_array_elements(decisions) with ordinality x(d,n));
end;
$$;
revoke all on function public.edition_credit_review_decisions(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function public.admin_get_edition_credit_reviews(p_work uuid,p_edition uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not public.is_corpus_admin() then raise exception 'corpus administrator required' using errcode='42501'; end if;
  return jsonb_build_object('version',1,'reviews',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
    'sourceUseReview',s.source_use,
    'decisions',public.edition_credit_review_decisions(r.work_id,r.edition_id,r.evidence,s.source_use),
    'stale',r.expected_fingerprint is distinct from public.corpus_record_fingerprint(r.work_id)) order by r.created_at desc,r.id),'[]')
    from (select * from public.corpus_edition_credit_reviews where work_id=p_work and edition_id=p_edition order by created_at desc,id limit 20) r
    left join public.corpus_edition_credit_source_use_receipts s on s.review_id=r.id));
end;
$$;

create function public.admin_prepare_reviewed_edition_credits(p_id uuid,p_work uuid,p_edition uuid,p_expected_fingerprint text,p_evidence jsonb,p_source_use jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=(select auth.uid()); r public.corpus_edition_credit_reviews; receipt jsonb; result jsonb; hold text;
begin
  if caller is null then raise exception 'corpus administrator required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=caller for key share;
  perform 1 from public.corpus_admins where user_id=caller for update;
  if not found then raise exception 'corpus administrator required' using errcode='42501'; end if;
  if p_id is null then raise exception 'Invalid edition-credit evidence.' using errcode='22023'; end if;
  -- Different administrators can submit the same UUID; serialize before testing absence.
  -- Preserve the established profile/admin -> ISBN -> work -> edition lock order below.
  perform pg_advisory_xact_lock(hashtextextended('edition-credit-review:'||p_id::text,0));
  select * into r from public.corpus_edition_credit_reviews where id=p_id;
  if found then
    select s.source_use into receipt from public.corpus_edition_credit_source_use_receipts s where s.review_id=p_id;
    if receipt is null or r.reviewer_id is distinct from caller or r.work_id is distinct from p_work
      or r.edition_id is distinct from p_edition or r.expected_fingerprint is distinct from p_expected_fingerprint
      or r.evidence is distinct from p_evidence or receipt is distinct from p_source_use then
      raise exception 'This review ID belongs to a different draft or lacks a source-use receipt. Start a new review.' using errcode='PT409';
    end if;
    -- Exact retries are read-only even after apply, source-use expiry or a changed catalog.
    return jsonb_build_object('id',r.id,'status',r.status,'evidence',r.evidence,'sourceUseReview',receipt,
      'decisions',public.edition_credit_review_decisions(r.work_id,r.edition_id,r.evidence,receipt));
  end if;
  hold:=public.edition_credit_source_use_hold(p_source_use);
  if hold is not null then
    raise exception 'Inspect and record a current source-use basis before retaining evidence.' using errcode='22023',detail=hold;
  end if;
  result:=public.admin_prepare_edition_credits(p_id,p_work,p_edition,p_expected_fingerprint,p_evidence);
  insert into public.corpus_edition_credit_source_use_receipts(review_id,source_use) values(p_id,p_source_use);
  return result||jsonb_build_object('sourceUseReview',p_source_use);
end;
$$;

-- Keep the original prepare implementation internal; old clients cannot retain new evidence
-- without the receipt. No legacy review is automatically given a receipt or rewritten.
revoke all on function public.admin_prepare_edition_credits(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.admin_apply_edition_credits(p_id uuid,p_selected integer[],p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=(select auth.uid()); r public.corpus_edition_credit_reviews; e public.corpus_editions; chosen integer[];
  decisions jsonb; additions jsonb; workid uuid; editionid uuid; source_use jsonb; source_hold text;
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
  -- Preserve every already-applied identical retry, including legacy reviews without receipts.
  -- Only a new append needs the separate, current human source-use attestation.
  select s.source_use into source_use from public.corpus_edition_credit_source_use_receipts s where s.review_id=r.id;
  source_hold:=public.edition_credit_source_use_hold(source_use);
  if source_hold is not null then
    raise exception 'Selected credits still require source-use review.' using errcode='22023',detail=source_hold;
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

revoke all on function public.admin_prepare_reviewed_edition_credits(uuid,uuid,uuid,text,jsonb,jsonb),public.admin_get_edition_credit_reviews(uuid,uuid),public.admin_apply_edition_credits(uuid,integer[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_prepare_reviewed_edition_credits(uuid,uuid,uuid,text,jsonb,jsonb),public.admin_get_edition_credit_reviews(uuid,uuid),public.admin_apply_edition_credits(uuid,integer[],boolean) to authenticated;
notify pgrst,'reload schema';
commit;
