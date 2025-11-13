-- Ensure admin detection relies exclusively on persisted profile roles
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and p.role = 'admin'
  );
end;
$$;
