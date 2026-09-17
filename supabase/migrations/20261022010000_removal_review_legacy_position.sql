-- A removal-review suggestion records the frozen historical tuple that an administrator may
-- remove. Legacy compatibility projections can contain position 0 even though new positive
-- membership proposals cannot. Keep the stricter rule for set proposals while allowing a
-- removal review to preserve the exact value it must recheck at decision time.
begin;

alter table public.work_series_suggestions
  drop constraint work_series_suggestions_proposed_position_check,
  add constraint work_series_suggestions_proposed_position_check check (
    proposal_action = 'remove'
    or proposed_position is null
    or proposed_position > 0
  );

commit;
