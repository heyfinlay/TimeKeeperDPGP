-- ============================================================================
-- Migration: Add RLS Policies for admin_credentials and teams
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

-- ============================================================================
-- FIX: Add RLS policies to teams
-- ============================================================================
-- teams table stores team names used across sessions
-- Anyone can read teams, but only admins can modify

CREATE POLICY "Admin full access to teams"
  ON public.teams
  FOR ALL
  TO public
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Anyone can read teams"
  ON public.teams
  FOR SELECT
  TO public
  USING (true);
