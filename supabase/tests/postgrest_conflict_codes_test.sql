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
  29,
  'all twenty-nine conflict-bearing functions return a bounded HTTP conflict'
);

select is(
  (
    select sum(regexp_count(function.prosrc, 'PT409'))::int
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname in ('public','corpus_admin_private')
  ),
  -- Corpus edition/admin review add five stale-context paths; each returns one bounded response.
  41,
  'all forty-one remaining stale-context paths use the non-retryable conflict code'
);

select * from finish();
rollback;
