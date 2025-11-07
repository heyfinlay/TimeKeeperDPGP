-- ============================================================================
-- Migration: Fix ambiguous session_id column references in RLS policies
-- ============================================================================
-- Issue: RLS policies on drivers and laps tables reference session_id without
-- table qualification, causing "column reference 'session_id' is ambiguous"
-- errors when policies are evaluated in contexts with multiple tables.
--
-- Fix: Explicitly qualify column names in policy expressions.

-- ============================================================================
-- FIX 1: Recreate drivers table RLS policies with qualified column names
-- ============================================================================

DROP POLICY IF EXISTS "Session scoped access for drivers" ON public.drivers;

CREATE POLICY "Session scoped access for drivers"
  ON public.drivers
  FOR ALL
  TO public
  USING (session_has_access(drivers.session_id))
  WITH CHECK (session_has_access(drivers.session_id));

-- ============================================================================
-- FIX 2: Recreate laps table RLS policies with qualified column names
-- ============================================================================

DROP POLICY IF EXISTS "Session scoped access for laps" ON public.laps;

CREATE POLICY "Session scoped access for laps"
  ON public.laps
  FOR ALL
  TO public
  USING (session_has_access(laps.session_id))
  WITH CHECK (session_has_access(laps.session_id));
