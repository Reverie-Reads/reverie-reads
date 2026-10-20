-- Application conflicts must return once. SQLSTATE 40001 tells PostgREST that the whole
-- transaction is retryable and can turn a permanent stale-context refusal into an infinite loop.
-- Include the internal corpus writer: moving a guard out of the exposed API schema must not
-- remove it from this inventory. Both API entrypoints retain the same three internal checks.
begin;
select plan(3);

select is(
  (
    select count(*)::int
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname in ('public','corpus_admin_private') and function.prosrc like '%40001%'
  ),
  0,
  'no application function misclassifies an application conflict as a serialization failure'
);

select is(
  (
    select count(*)::int
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname in ('public','corpus_admin_private') and function.prosrc like '%PT409%'
  ),
  32,
  'all thirty-two conflict-bearing functions return a bounded HTTP conflict'
);

select is(
  (
    select sum(regexp_count(function.prosrc, 'PT409'))::int
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname in ('public','corpus_admin_private')
  ),
  -- Edition credit prepare/apply add four draft/selection/fingerprint conflicts;
  -- reviewed prepare adds the immutable source-use receipt conflict.
  46,
  'all forty-six remaining stale-context paths use the non-retryable conflict code'
);

select * from finish();
rollback;
