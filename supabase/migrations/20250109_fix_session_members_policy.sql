do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'session_members'
  ) then
    execute $ddl$
      alter table public.session_members enable row level security
    $ddl$;

    execute $ddl$
      drop policy if exists "Members view membership" on public.session_members
    $ddl$;

    execute $ddl$
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
        )
    $ddl$;
  end if;
end;
$$;
