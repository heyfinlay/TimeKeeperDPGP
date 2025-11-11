-- Ensure access helper functions exist before any policies reference them
set check_function_bodies = off;

-- Create or replace is_admin()
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(auth.jwt()->>'role', '');
begin
  if jwt_role = 'admin' then
    return true;
  end if;
  return exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
end;
$$;

-- Create or replace session_has_access(uuid)
create or replace function public.session_has_access(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or (
      target_session_id is not null
      and (
        exists (
          select 1 from public.sessions s
          where s.id = target_session_id
            and (s.created_by = auth.uid() or s.created_by is null)
        )
        or exists (
          select 1 from public.session_members sm
          where sm.session_id = target_session_id
            and sm.user_id = auth.uid()
        )
      )
    );
$$;

