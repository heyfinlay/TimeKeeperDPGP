-- ============================================================================
-- Migration: Fix ambiguous session_id column references in RLS policies
-- ============================================================================
-- Issue: RLS policies on multiple tables reference session_id without table
-- qualification, causing "column reference 'session_id' is ambiguous" errors
-- when policies are evaluated in contexts involving multiple tables (e.g.,
-- inside SECURITY DEFINER functions like log_lap_atomic).
--
-- Root Cause: When PostgreSQL evaluates RLS policies in a SECURITY DEFINER
-- function that touches multiple tables with session_id columns, the policy
-- expression session_has_access(session_id) becomes ambiguous because it
-- doesn't specify which table's session_id to use.
--
-- Fix: Explicitly qualify column names in all RLS policy expressions.

-- ============================================================================
-- FIX 1: drivers table - Recreate policy with qualified column name
-- ============================================================================

DROP POLICY IF EXISTS "Session scoped access for drivers" ON public.drivers;

CREATE POLICY "Session scoped access for drivers"
  ON public.drivers
  FOR ALL
  TO public
  USING (session_has_access(drivers.session_id))
  WITH CHECK (session_has_access(drivers.session_id));

-- ============================================================================
-- FIX 2: laps table - Recreate policy with qualified column name
-- ============================================================================

DROP POLICY IF EXISTS "Session scoped access for laps" ON public.laps;

CREATE POLICY "Session scoped access for laps"
  ON public.laps
  FOR ALL
  TO public
  USING (session_has_access(laps.session_id))
  WITH CHECK (session_has_access(laps.session_id));

-- ============================================================================
-- FIX 3: race_events table - Recreate policy with qualified column name
-- ============================================================================

DROP POLICY IF EXISTS "Session scoped access for race events" ON public.race_events;

CREATE POLICY "Session scoped access for race events"
  ON public.race_events
  FOR ALL
  TO public
  USING (session_has_access(race_events.session_id))
  WITH CHECK (session_has_access(race_events.session_id));

-- ============================================================================
-- FIX 4: session_state table - Recreate policy with qualified column name
-- ============================================================================

DROP POLICY IF EXISTS "Session scoped access for session state" ON public.session_state;

CREATE POLICY "Session scoped access for session state"
  ON public.session_state
  FOR ALL
  TO public
  USING (session_has_access(session_state.session_id))
  WITH CHECK (session_has_access(session_state.session_id));

-- ============================================================================
-- FIX 5: session_logs table - Recreate policies with qualified column names
-- ============================================================================

DROP POLICY IF EXISTS "Members view session logs" ON public.session_logs;
DROP POLICY IF EXISTS "Owners record session logs" ON public.session_logs;

CREATE POLICY "Members view session logs"
  ON public.session_logs
  FOR SELECT
  TO public
  USING (session_has_access(session_logs.session_id));

CREATE POLICY "Owners record session logs"
  ON public.session_logs
  FOR INSERT
  TO public
  WITH CHECK (session_has_access(session_logs.session_id));

-- ============================================================================
-- FIX 6: session_entries table - Recreate policy (if table exists)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'session_entries'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "Session scoped access for session entries" ON public.session_entries';
    EXECUTE 'CREATE POLICY "Session scoped access for session entries" ON public.session_entries FOR ALL TO public USING (session_has_access(session_entries.session_id)) WITH CHECK (session_has_access(session_entries.session_id))';
  END IF;
END $$;
