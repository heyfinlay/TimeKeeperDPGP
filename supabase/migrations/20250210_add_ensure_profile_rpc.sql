-- Adds a SECURITY DEFINER helper to provision the current user's profile without
-- requiring direct INSERT permissions that are blocked by RLS.
create or replace function public.ensure_profile_for_current_user(
  display_name text default null,
  role_hint text default null
) returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_display_name text;
  v_role text;
begin
  if v_user_id is null then
    raise exception 'auth.uid() is required';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id;

  if found then
    return v_profile;
  end if;

  v_display_name := nullif(trim(coalesce(display_name, '')), '');
  if v_display_name is null then
    v_display_name := 'Marshal';
  end if;

  v_role := lower(coalesce(role_hint, 'marshal'));
  if v_role not in ('spectator', 'driver', 'marshal', 'admin') then
    v_role := 'marshal';
  end if;

  if v_role = 'admin' and not public.is_admin() then
    v_role := 'marshal';
  end if;

  insert into public.profiles (id, role, display_name)
  values (v_user_id, v_role, v_display_name)
  returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.ensure_profile_for_current_user(text, text) to authenticated;
