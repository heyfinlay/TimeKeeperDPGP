-- ============================================================================
-- CREATE FIRST ADMIN ACCOUNT FOR DIAMOND SPORTS BOOK
-- ============================================================================
-- Run this in Supabase Dashboard > SQL Editor
-- URL: https://supabase.com/dashboard/project/kcutwtjpsupmdixynyoh/sql
--
-- This creates:
-- 1. A Supabase Auth user (email/password)
-- 2. A profile with admin role
-- 3. An admin credential entry for API auth
-- ============================================================================

-- ============================================================================
-- STEP 1: Create Auth User
-- ============================================================================
-- Replace these with your desired credentials:
DO $$
DECLARE
  v_user_id uuid;
  v_email text := 'admin@diamondsportsbook.local';  -- CHANGE THIS
  v_password text := 'ChangeThisPassword123!';       -- CHANGE THIS (use a strong password!)
  v_admin_username text := 'race-control-admin';    -- Username for admin_credentials table
BEGIN
  -- Create auth user
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    aud,
    role,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    confirmation_token
  ) VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    v_email,
    crypt(v_password, gen_salt('bf')),  -- bcrypt hash
    now(),
    now(),
    now(),
    'authenticated',
    'authenticated',
    '{"provider": "email", "providers": ["email"]}',
    '{}',
    false,
    ''
  )
  ON CONFLICT (email) DO UPDATE
    SET encrypted_password = EXCLUDED.encrypted_password,
        updated_at = now()
  RETURNING id INTO v_user_id;

  -- Create profile with admin role
  INSERT INTO public.profiles (
    id,
    email,
    display_name,
    role,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_email,
    'System Administrator',
    'admin',  -- This is critical!
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET role = 'admin',
        updated_at = now();

  -- Create admin credential for API authentication
  INSERT INTO public.admin_credentials (
    id,
    username,
    password_hash,
    rotated_at
  ) VALUES (
    v_user_id,
    v_admin_username,
    crypt(v_password, gen_salt('bf')),
    now()
  )
  ON CONFLICT (username) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        rotated_at = now();

  RAISE NOTICE 'Admin account created successfully!';
  RAISE NOTICE 'User ID: %', v_user_id;
  RAISE NOTICE 'Email: %', v_email;
  RAISE NOTICE 'Admin Username: %', v_admin_username;
  RAISE NOTICE '';
  RAISE NOTICE 'You can now sign in with:';
  RAISE NOTICE 'Email: %', v_email;
  RAISE NOTICE 'Password: (the one you set above)';
END $$;

-- ============================================================================
-- STEP 2: Verify Admin Account
-- ============================================================================
-- Run these queries to verify everything was created correctly:

-- Check auth user exists
SELECT
  id,
  email,
  email_confirmed_at,
  created_at
FROM auth.users
WHERE email = 'admin@diamondsportsbook.local';  -- Use the email you set above

-- Check profile has admin role
SELECT
  id,
  email,
  display_name,
  role,
  created_at
FROM public.profiles
WHERE email = 'admin@diamondsportsbook.local';  -- Use the email you set above

-- Check admin credentials
SELECT
  id,
  username,
  rotated_at,
  password_hash IS NOT NULL as has_password
FROM public.admin_credentials
WHERE username = 'race-control-admin';  -- Use the username you set above

-- Test is_admin() function
SELECT
  email,
  public.is_admin() as is_currently_admin
FROM public.profiles
WHERE email = 'admin@diamondsportsbook.local';  -- Use the email you set above

-- ============================================================================
-- STEP 3: Sign In
-- ============================================================================
-- 1. Go to your application: http://localhost:5173 (or your deployment URL)
-- 2. Click "Sign In"
-- 3. Use the email and password you set above
-- 4. You should now have access to /admin/markets and /dashboard/admin
--
-- ============================================================================
-- SECURITY NOTES:
-- ============================================================================
-- ⚠️  IMPORTANT: Change the default password immediately!
-- ⚠️  Store credentials in a secure password manager
-- ⚠️  Never commit credentials to git
-- ⚠️  Rotate passwords regularly (every 90 days recommended)
--
-- To rotate the password later, re-run this script with a new password
-- or use the supabase/seed_initial_admin.sql script with psql
-- ============================================================================
