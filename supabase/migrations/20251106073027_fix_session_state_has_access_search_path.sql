-- ============================================================================
-- Migration: Fix Critical RLS Security Issues
-- ============================================================================
-- This migration addresses the mutable search_path security vulnerability

CREATE OR REPLACE FUNCTION public.session_state_has_access(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.session_has_access(p_session_id);
$function$;
