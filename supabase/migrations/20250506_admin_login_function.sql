-- ============================================================================
-- ADMIN LOGIN AUTHENTICATION FUNCTION
-- ============================================================================
-- Purpose: Verify admin credentials and return user info for session creation
-- ============================================================================

create or replace function public.verify_admin_credentials(
  p_username text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_record record;
  v_profile record;
begin
  -- Get admin credentials
  select * into v_admin_record
  from public.admin_credentials
  where username = p_username;

  if v_admin_record.id is null then
    raise exception 'Invalid credentials';
  end if;

  -- Verify password using bcrypt
  if not (v_admin_record.password_hash = crypt(p_password, v_admin_record.password_hash)) then
    raise exception 'Invalid credentials';
  end if;

  -- Get profile information
  select * into v_profile
  from public.profiles
  where id = v_admin_record.id;

  if v_profile.role != 'admin' then
    raise exception 'Account does not have admin privileges';
  end if;

  -- Return user information for session creation
  return jsonb_build_object(
    'success', true,
    'user_id', v_admin_record.id,
    'email', v_profile.email,
    'display_name', v_profile.display_name,
    'role', v_profile.role
  );
end;
$$;

-- Grant execute to anonymous users (needed for login page)
grant execute on function public.verify_admin_credentials(text, text) to anon;
grant execute on function public.verify_admin_credentials(text, text) to authenticated;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Test this function (will fail until you create an admin account):
-- SELECT public.verify_admin_credentials('race-control-admin', 'your-password');
