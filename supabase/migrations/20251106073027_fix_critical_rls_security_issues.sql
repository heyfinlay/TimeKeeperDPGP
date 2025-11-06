-- ============================================================================
-- Migration: Fix Critical RLS Security Issues
-- ============================================================================
-- This migration addresses the following security vulnerabilities:
-- 1. drivers_marshal_map has no RLS enabled (CRITICAL)
-- 2. session_entries has RLS enabled but no policies (blocks all access)
-- 3. session_state_has_access has mutable search_path

-- ============================================================================
-- FIX 1: Enable RLS on drivers_marshal_map and add policies
-- ============================================================================
-- This table maps legacy marshal IDs to user IDs for authentication
-- Only admins should be able to modify this mapping

ALTER TABLE public.drivers_marshal_map ENABLE ROW LEVEL SECURITY;

-- Policy: Admins have full access to marshal mappings
CREATE POLICY "Admin full access to marshal mappings"
  ON public.drivers_marshal_map
  FOR ALL
  TO public
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Policy: Authenticated users can read their own mapping
CREATE POLICY "Users can read their own marshal mapping"
  ON public.drivers_marshal_map
  FOR SELECT
  TO public
  USING (user_id = auth.uid());

-- ============================================================================
-- FIX 2: Add RLS policies to session_entries
-- ============================================================================
-- session_entries tracks which drivers are in which sessions
-- Access should follow the same pattern as drivers table

CREATE POLICY "Admin full access to session entries"
  ON public.session_entries
  FOR ALL
  TO public
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Session scoped access for session entries"
  ON public.session_entries
  FOR ALL
  TO public
  USING (public.session_has_access(session_id))
  WITH CHECK (public.session_has_access(session_id));

-- ============================================================================
-- FIX 3: Fix mutable search_path on session_state_has_access
-- ============================================================================
-- Add immutable search_path to prevent security vulnerabilities

CREATE OR REPLACE FUNCTION public.session_state_has_access(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.session_has_access(p_session_id);
$function$;
