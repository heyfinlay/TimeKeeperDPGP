-- ============================================================================
-- Migration: Fix all ambiguous session_id references in RLS policies
-- ============================================================================
-- Fix remaining tables that may encounter the same ambiguous column issue

-- ============================================================================
-- FIX: race_events table
-- ============================================================================

DROP POLICY IF EXISTS "Session scoped access for race events" ON public.race_events;

CREATE POLICY "Session scoped access for race events"
  ON public.race_events
  FOR ALL
  TO public
  USING (session_has_access(race_events.session_id))
  WITH CHECK (session_has_access(race_events.session_id));

-- ============================================================================
-- FIX: session_state table
-- ============================================================================

DROP POLICY IF EXISTS "Session scoped access for session state" ON public.session_state;

CREATE POLICY "Session scoped access for session state"
  ON public.session_state
  FOR ALL
  TO public
  USING (session_has_access(session_state.session_id))
  WITH CHECK (session_has_access(session_state.session_id));

-- ============================================================================
-- FIX: session_logs table
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
-- FIX: session_entries table (if exists)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'session_entries') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Session scoped access for session entries" ON public.session_entries';
    EXECUTE 'CREATE POLICY "Session scoped access for session entries" ON public.session_entries FOR ALL TO public USING (session_has_access(session_entries.session_id)) WITH CHECK (session_has_access(session_entries.session_id))';
  END IF;
END $$;
