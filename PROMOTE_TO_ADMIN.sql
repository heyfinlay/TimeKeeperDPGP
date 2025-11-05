-- ============================================================================
-- PROMOTE USER TO ADMIN - Step 2 of 2
-- ============================================================================
-- Run this in Supabase Dashboard > SQL Editor
-- URL: https://supabase.com/dashboard/project/kcutwtjpsupmdixynyoh/sql
--
-- This script:
-- 1. Finds the auth user created in Step 1
-- 2. Creates/updates their profile with admin role
-- 3. Creates admin credentials for /admin/login
--
-- Prerequisites:
-- - Run create_admin_user.mjs FIRST to create the auth user
-- ============================================================================

-- Ensure pgcrypto extension exists for bcrypt
create extension if not exists pgcrypto;

-- ============================================================================
-- CONFIGURE YOUR ADMIN CREDENTIALS HERE
-- ============================================================================
do $$
declare
  v_email text := 'admin@diamondsportsbook.local';  -- MUST match email from Step 1
  v_password text := 'ChangeThisPassword123!';       -- MUST match password from Step 1
  v_admin_username text := 'race-control-admin';    -- Username for /admin/login
  v_user_id uuid;
begin
  -- Look up the auth user created via Admin API
  select id into v_user_id
  from auth.users
  where email = v_email;

  if v_user_id is null then
    raise exception 'No auth.users row found for %. Run create_admin_user.mjs first!', v_email;
  end if;

  -- Create or update profile with admin role
  insert into public.profiles (id, email, display_name, role, created_at, updated_at)
  values (v_user_id, v_email, 'System Administrator', 'admin', now(), now())
  on conflict (id) do update
    set role = 'admin', updated_at = now();

  -- Create or update admin credentials with bcrypt hash
  insert into public.admin_credentials (id, username, password_hash, rotated_at)
  values (v_user_id, v_admin_username, crypt(v_password, gen_salt('bf')), now())
  on conflict (username) do update
    set password_hash = excluded.password_hash, rotated_at = now();

  raise notice '✅ Promoted % to admin (id=%)', v_email, v_user_id;
  raise notice '📋 Admin username: %', v_admin_username;
  raise notice '🔗 Login at: /admin/login';
end $$;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Check auth user exists and is confirmed
select
  id,
  email,
  email_confirmed_at,
  created_at
from auth.users
where email = 'admin@diamondsportsbook.local';

-- Check profile has admin role
select
  id,
  email,
  role,
  display_name,
  created_at
from public.profiles
where email = 'admin@diamondsportsbook.local';

-- Check admin credentials exist
select
  username,
  (password_hash is not null) as has_password,
  rotated_at
from public.admin_credentials
where username = 'race-control-admin';

-- Test is_admin() function (should return user's admin status)
select
  email,
  public.is_admin() as is_currently_admin
from public.profiles
where email = 'admin@diamondsportsbook.local';

-- ============================================================================
-- SUCCESS!
-- ============================================================================
-- If all queries above return results, you can now:
-- 1. Go to: http://localhost:5173/admin/login
-- 2. Username: race-control-admin (or whatever you set above)
-- 3. Password: (the password you set in create_admin_user.mjs)
-- 4. You should be redirected to /admin/markets
-- ============================================================================
