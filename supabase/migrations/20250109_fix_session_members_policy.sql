-- Adjust session membership RLS to avoid recursion
alter table public.session_members enable row level security;

drop policy if exists "Members view membership" on public.session_members;

create policy "Members view membership" on public.session_members
  for select
  using (
    public.is_admin()
    or auth.uid() = public.session_members.user_id
    or exists (
      select 1
      from public.sessions s
      where s.id = public.session_members.session_id
        and (s.created_by = auth.uid() or s.created_by is null)
    )
  );
