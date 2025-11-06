-- ============================================================================
-- Migration: Add RLS Policies for admin_credentials
-- ============================================================================

-- ============================================================================
-- FIX: Add RLS policies to admin_credentials
-- ============================================================================
-- admin_credentials stores sensitive authentication data
-- Only admins should have any access to this table

CREATE POLICY "Admin full access to admin credentials"
  ON public.admin_credentials
  FOR ALL
  TO public
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
