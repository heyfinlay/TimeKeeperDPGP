-- ============================================================================
-- Migration: Deprecate admin_credentials table and legacy admin auth
-- ============================================================================
-- Diamond Sports Book now uses Discord OAuth for ALL authentication.
-- Admin access is gated by profiles.role='admin' (single source of truth).
--
-- This migration:
-- 1. Locks down admin_credentials table with restrictive RLS policies
-- 2. Drops the verify_admin_credentials() function (no longer needed)
-- 3. Adds deprecation comments to the table
--
-- The table is preserved for historical reference but made read-only for admins.
-- ============================================================================

-- ============================================================================
-- Drop legacy admin credential verification function
-- ============================================================================

DROP FUNCTION IF EXISTS public.verify_admin_credentials(text, text);

-- ============================================================================
-- Lock down admin_credentials table with restrictive RLS
-- ============================================================================

-- Ensure RLS is enabled
ALTER TABLE IF EXISTS public.admin_credentials ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DROP POLICY IF EXISTS "Admin credentials are private" ON public.admin_credentials;
DROP POLICY IF EXISTS "Only admins can view credentials" ON public.admin_credentials;
DROP POLICY IF EXISTS "Only admins can insert credentials" ON public.admin_credentials;
DROP POLICY IF EXISTS "Only admins can update credentials" ON public.admin_credentials;
DROP POLICY IF EXISTS "Only admins can delete credentials" ON public.admin_credentials;

-- Create read-only policy for admins only (for historical reference)
CREATE POLICY "admin_credentials_read_only_for_admins"
  ON public.admin_credentials
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Explicitly deny all modifications
CREATE POLICY "admin_credentials_no_inserts"
  ON public.admin_credentials
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "admin_credentials_no_updates"
  ON public.admin_credentials
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "admin_credentials_no_deletes"
  ON public.admin_credentials
  FOR DELETE
  TO authenticated
  USING (false);

-- ============================================================================
-- Add deprecation comment to table
-- ============================================================================

COMMENT ON TABLE public.admin_credentials IS
  'DEPRECATED: This table is no longer used for authentication. Diamond Sports Book now uses Discord OAuth exclusively. Admin access is controlled by profiles.role="admin". This table is preserved for historical reference only and is read-only.';

COMMENT ON COLUMN public.admin_credentials.username IS
  'DEPRECATED: No longer used. All authentication is via Discord OAuth.';

COMMENT ON COLUMN public.admin_credentials.password_hash IS
  'DEPRECATED: No longer used. All authentication is via Discord OAuth.';

-- ============================================================================
-- Revoke Edge Function access
-- ============================================================================

-- Revoke any grants that might have been given to the anon role
REVOKE ALL ON public.admin_credentials FROM anon;
REVOKE ALL ON public.admin_credentials FROM authenticated;

-- Grant SELECT only to authenticated users (via RLS policies above)
GRANT SELECT ON public.admin_credentials TO authenticated;

-- ============================================================================
-- Migration complete
-- ============================================================================

-- Verification query (for manual testing):
-- SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'admin_credentials';
