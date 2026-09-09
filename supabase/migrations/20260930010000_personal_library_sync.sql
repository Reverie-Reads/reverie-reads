-- Content-free, owner-scoped invalidation signals for a reader's open tabs and devices.
--
-- Database Broadcast is used instead of filtered Postgres Changes because DELETE payloads on
-- RLS-protected tables cannot safely provide/filter owner_id. The topic is private and can be joined
-- only by the owner embedded in it; the payload carries no book, reading, or shelf content.

create or replace function public.broadcast_personal_library_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  v_owner := case when tg_op = 'DELETE' then old.owner_id else new.owner_id end;

  perform realtime.send(
    jsonb_build_object('table', tg_table_name, 'operation', tg_op),
    'library_changed',
    'library:' || v_owner::text,
    true
  );

  return null;
end;
$$;

revoke execute on function public.broadcast_personal_library_change()
  from public, anon, authenticated, service_role;

drop policy if exists "personal library: receive own changes" on realtime.messages;
create policy "personal library: receive own changes"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) = 'library:' || (select auth.uid())::text
);

drop trigger if exists books_broadcast_personal_library_change on public.books;
create trigger books_broadcast_personal_library_change
after insert or update or delete on public.books
for each row execute function public.broadcast_personal_library_change();

drop trigger if exists reads_broadcast_personal_library_change on public.reads;
create trigger reads_broadcast_personal_library_change
after insert or update or delete on public.reads
for each row execute function public.broadcast_personal_library_change();

drop trigger if exists lists_broadcast_personal_library_change on public.lists;
create trigger lists_broadcast_personal_library_change
after insert or update or delete on public.lists
for each row execute function public.broadcast_personal_library_change();

drop trigger if exists list_items_broadcast_personal_library_change on public.list_items;
create trigger list_items_broadcast_personal_library_change
after insert or update or delete on public.list_items
for each row execute function public.broadcast_personal_library_change();

comment on function public.broadcast_personal_library_change() is
  'Emit a content-free private signal so one reader can refresh personal library caches across tabs and devices.';
