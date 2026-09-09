-- READ-ONLY known-answer controls for the marker predicate in isbndb-exit-inventory.sql.
-- A clean inventory is not interpretable unless these controls return all_passed=true.
-- Usage: supabase db query --local --file docs/queries/isbndb-exit-inventory-controls.sql
with controls(payload, expected) as (values
  ('{"provenance":{"pageCount":{"source":"isbndb"}}}'::jsonb, true),
  ('{"previous":{"metadata_provenance":{"publisher":{"source":"isbndb"}}}}'::jsonb, true),
  ('{"cover_source":"isbndb"}'::jsonb, true),
  ('{"record":{"ids":{"isbndb":"edition:synthetic"}}}'::jsonb, true),
  ('{"alternates":[{"source":"google"},{"source":"isbndb"}]}'::jsonb, true),
  ('{"record":{"description":"a discussion of isbndb","provenance":{"pageCount":{"source":"google"}}}}'::jsonb, false),
  ('{"record":{"authors":["unattributed union"],"provenance":null}}'::jsonb, false),
  ('{}'::jsonb, false)
), scored as (
  select expected,
    coalesce(jsonb_path_exists(payload, '$.**.source ? (@ == "isbndb")'), false)
    or coalesce(jsonb_path_exists(payload, '$.**.cover_source ? (@ == "isbndb")'), false)
    or coalesce(jsonb_path_exists(payload, '$.**.ids.isbndb'), false) as observed
  from controls
)
select count(*) as controls, count(*) filter (where expected = observed) as passed,
  bool_and(expected = observed) as all_passed from scored;
