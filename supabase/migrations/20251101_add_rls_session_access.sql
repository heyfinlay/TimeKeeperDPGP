create or replace function session_has_access(target_session_id uuid)
returns boolean
security definer
language sql as $$
  select exists (
    select 1
    from public.session_members
    where session_members.session_id = target_session_id
      and session_members.user_id = auth.uid()
  );
$$;

alter table public.session_entries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'session_entries'
    and policyname = 'Allow access to session entries'
  ) then
    create policy "Allow access to session entries"
    on public.session_entries
    for select
    using (public.session_has_access(session_entries.session_id));
  end if;
end $$;
