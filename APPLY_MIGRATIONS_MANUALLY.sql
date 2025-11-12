-- ============================================================================
-- MANUAL MIGRATION APPLICATION
-- ============================================================================
-- Copy this entire file and paste it into Supabase SQL Editor
-- Dashboard URL: https://supabase.com/dashboard/project/kcutwtjpsupmdixynyoh/sql/new
--
-- These migrations fix the critical bugs:
-- 1. Session creation error (Error 42P10)
-- 2. Wagers foreign key issue (handled in frontend)
-- 3. Settlement approval workflow
-- ============================================================================

-- ============================================================================
-- MIGRATION 1: Fix Session Constraints (20251112_fix_session_constraints.sql)
-- ============================================================================
-- Fixes: Error 42P10 "no unique or exclusion constraint matching the ON CONFLICT specification"

DO $$
BEGIN
  RAISE NOTICE '=== MIGRATION 1: Fixing session_members constraints ===';

  -- Check if the unique index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = 'session_members'
    AND indexname = 'session_members_pkey'
  ) THEN
    RAISE NOTICE 'Creating unique index session_members_pkey';
    CREATE UNIQUE INDEX session_members_pkey
      ON public.session_members (session_id, user_id);
  ELSE
    RAISE NOTICE 'Index session_members_pkey already exists';
  END IF;

  -- Ensure it's used as primary key constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_members_pkey'
    AND connamespace = 'public'::regnamespace
  ) THEN
    RAISE NOTICE 'Adding primary key constraint session_members_pkey';
    ALTER TABLE public.session_members
      ADD CONSTRAINT session_members_pkey
      PRIMARY KEY USING INDEX session_members_pkey;
  ELSE
    RAISE NOTICE 'Primary key constraint session_members_pkey already exists';
  END IF;
END;
$$;

-- Verify the constraint is in place
DO $$
DECLARE
  v_constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_members_pkey'
    AND contype = 'p'
  ) INTO v_constraint_exists;

  IF v_constraint_exists THEN
    RAISE NOTICE '✓ SUCCESS: session_members primary key constraint verified';
  ELSE
    RAISE EXCEPTION '✗ FAILED: session_members primary key constraint not found after migration';
  END IF;
END;
$$;

-- ============================================================================
-- MIGRATION 2: Add Outcome Abbreviation (20251112_add_outcome_abbreviation.sql)
-- ============================================================================
-- Adds abbreviation column for compact UI display

RAISE NOTICE '=== MIGRATION 2: Adding outcome abbreviation column ===';

ALTER TABLE public.outcomes
ADD COLUMN IF NOT EXISTS abbreviation text;

COMMENT ON COLUMN public.outcomes.abbreviation IS 'Short abbreviation for the outcome (e.g., "LSC" for "Los Santos Customs")';

-- Populate abbreviations for existing outcomes
UPDATE public.outcomes
SET abbreviation =
  CASE
    WHEN LENGTH(label) <= 4 THEN UPPER(label)
    ELSE UPPER(LEFT(REGEXP_REPLACE(label, '[^A-Za-z]', '', 'g'), 4))
  END
WHERE abbreviation IS NULL;

RAISE NOTICE '✓ Outcome abbreviation column added';

-- ============================================================================
-- MIGRATION 3: Settlement Approval System (20251112_add_settlement_approval.sql)
-- ============================================================================
-- Creates the manual approval workflow for market settlements

RAISE NOTICE '=== MIGRATION 3: Creating settlement approval system ===';

-- Table to track pending settlements awaiting approval
CREATE TABLE IF NOT EXISTS public.pending_settlements (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  proposed_outcome_id uuid not null references public.outcomes(id) on delete cascade,
  proposed_by uuid references auth.users(id) on delete set null,
  timing_data jsonb,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  rejection_reason text,
  constraint unique_pending_settlement_per_market unique (market_id, status)
    deferrable initially deferred
);

CREATE INDEX IF NOT EXISTS idx_pending_settlements_status on public.pending_settlements(status);
CREATE INDEX IF NOT EXISTS idx_pending_settlements_market_id on public.pending_settlements(market_id);
CREATE INDEX IF NOT EXISTS idx_pending_settlements_session_id on public.pending_settlements(session_id);

COMMENT ON TABLE public.pending_settlements IS 'Tracks proposed market settlements awaiting admin approval';
COMMENT ON COLUMN public.pending_settlements.timing_data IS 'Snapshot of driver lap times and positions at time of proposal';

RAISE NOTICE '✓ pending_settlements table created';

-- Function to propose a settlement
CREATE OR REPLACE FUNCTION public.propose_settlement(
  p_market_id uuid,
  p_proposed_outcome_id uuid,
  p_timing_data jsonb default null,
  p_notes text default null
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement_id uuid;
  v_market_status text;
  v_session_id uuid;
  v_outcome_exists boolean;
  v_existing_pending uuid;
BEGIN
  IF auth.uid() is null THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT status INTO v_market_status FROM public.markets WHERE id = p_market_id;
  IF v_market_status IS NULL THEN
    RAISE EXCEPTION 'Market % not found', p_market_id;
  END IF;

  IF v_market_status = 'settled' THEN
    RAISE EXCEPTION 'Market % is already settled', p_market_id;
  END IF;

  SELECT e.session_id INTO v_session_id
  FROM public.markets m
  JOIN public.events e ON e.id = m.event_id
  WHERE m.id = p_market_id;

  SELECT exists(
    SELECT 1 FROM public.outcomes
    WHERE id = p_proposed_outcome_id AND market_id = p_market_id
  ) INTO v_outcome_exists;

  IF NOT v_outcome_exists THEN
    RAISE EXCEPTION 'Outcome % does not belong to market %', p_proposed_outcome_id, p_market_id;
  END IF;

  SELECT id INTO v_existing_pending
  FROM public.pending_settlements
  WHERE market_id = p_market_id AND status = 'pending';

  IF v_existing_pending IS NOT NULL THEN
    RAISE EXCEPTION 'Market % already has a pending settlement (ID: %)', p_market_id, v_existing_pending;
  END IF;

  INSERT INTO public.pending_settlements (
    market_id, session_id, proposed_outcome_id, proposed_by, timing_data, notes, status
  ) VALUES (
    p_market_id, v_session_id, p_proposed_outcome_id, auth.uid(), p_timing_data, p_notes, 'pending'
  )
  RETURNING id INTO v_settlement_id;

  RAISE NOTICE 'Settlement % proposed for market %', v_settlement_id, p_market_id;
  RETURN v_settlement_id;
END;
$$;

RAISE NOTICE '✓ propose_settlement() function created';

-- Function to approve a settlement
CREATE OR REPLACE FUNCTION public.approve_settlement(
  p_settlement_id uuid,
  p_payout_policy text default 'refund_if_empty'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement record;
  v_market_status text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_settlement
  FROM public.pending_settlements
  WHERE id = p_settlement_id
  FOR UPDATE;

  IF v_settlement.id IS NULL THEN
    RAISE EXCEPTION 'Settlement % not found', p_settlement_id;
  END IF;

  IF v_settlement.status != 'pending' THEN
    RAISE EXCEPTION 'Settlement % is not pending (status: %)', p_settlement_id, v_settlement.status;
  END IF;

  SELECT status INTO v_market_status FROM public.markets WHERE id = v_settlement.market_id;
  IF v_market_status = 'settled' THEN
    RAISE EXCEPTION 'Market % is already settled', v_settlement.market_id;
  END IF;

  IF v_market_status = 'open' THEN
    UPDATE public.markets SET status = 'closed' WHERE id = v_settlement.market_id;
  END IF;

  PERFORM public.settle_market(
    v_settlement.market_id,
    v_settlement.proposed_outcome_id,
    p_payout_policy
  );

  UPDATE public.pending_settlements
  SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = p_settlement_id;

  v_result := jsonb_build_object(
    'settlement_id', p_settlement_id,
    'market_id', v_settlement.market_id,
    'outcome_id', v_settlement.proposed_outcome_id,
    'approved_by', auth.uid(),
    'approved_at', now()
  );

  RAISE NOTICE 'Settlement % approved and executed', p_settlement_id;
  RETURN v_result;
END;
$$;

RAISE NOTICE '✓ approve_settlement() function created';

-- Function to reject a settlement
CREATE OR REPLACE FUNCTION public.reject_settlement(
  p_settlement_id uuid,
  p_rejection_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT status INTO v_status
  FROM public.pending_settlements
  WHERE id = p_settlement_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Settlement % not found', p_settlement_id;
  END IF;

  IF v_status != 'pending' THEN
    RAISE EXCEPTION 'Settlement % is not pending (status: %)', p_settlement_id, v_status;
  END IF;

  UPDATE public.pending_settlements
  SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(), rejection_reason = p_rejection_reason
  WHERE id = p_settlement_id;

  RAISE NOTICE 'Settlement % rejected: %', p_settlement_id, p_rejection_reason;
END;
$$;

RAISE NOTICE '✓ reject_settlement() function created';

-- Auto-proposal trigger function
CREATE OR REPLACE FUNCTION public.auto_propose_settlement_on_session_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market record;
  v_winning_driver_id uuid;
  v_winning_outcome_id uuid;
  v_timing_data jsonb;
  v_settlement_id uuid;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    FOR v_market IN
      SELECT m.id as market_id, m.name, m.type
      FROM public.markets m
      JOIN public.events e ON e.id = m.event_id
      WHERE e.session_id = NEW.id AND m.status = 'open' AND m.type = 'race_outcome'
    LOOP
      SELECT d.id INTO v_winning_driver_id
      FROM public.drivers d
      WHERE d.session_id = NEW.id
      ORDER BY d.laps DESC NULLS LAST, d.total_time_ms ASC NULLS LAST
      LIMIT 1;

      IF v_winning_driver_id IS NOT NULL THEN
        SELECT o.id INTO v_winning_outcome_id
        FROM public.outcomes o
        WHERE o.market_id = v_market.market_id AND o.driver_id = v_winning_driver_id;

        IF v_winning_outcome_id IS NOT NULL THEN
          SELECT jsonb_agg(
            jsonb_build_object(
              'driver_id', d.id, 'driver_name', d.name, 'driver_number', d.number,
              'laps', d.laps, 'total_time_ms', d.total_time_ms, 'best_lap_ms', d.best_lap_ms
            )
            ORDER BY d.laps DESC, d.total_time_ms ASC
          ) INTO v_timing_data
          FROM public.drivers d
          WHERE d.session_id = NEW.id;

          BEGIN
            SELECT public.propose_settlement(
              v_market.market_id, v_winning_outcome_id, v_timing_data,
              'Auto-proposed based on session completion'
            ) INTO v_settlement_id;

            RAISE NOTICE 'Auto-proposed settlement % for market %', v_settlement_id, v_market.market_id;
          EXCEPTION
            WHEN OTHERS THEN
              RAISE WARNING 'Failed to auto-propose settlement for market %: %', v_market.market_id, SQLERRM;
          END;
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

RAISE NOTICE '✓ auto_propose_settlement_on_session_complete() function created';

-- Create trigger
DROP TRIGGER IF EXISTS auto_propose_settlement_trigger ON public.sessions;
CREATE TRIGGER auto_propose_settlement_trigger
  AFTER UPDATE OF status ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_propose_settlement_on_session_complete();

RAISE NOTICE '✓ auto_propose_settlement_trigger created';

-- RLS Policies
ALTER TABLE public.pending_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view pending settlements" ON public.pending_settlements;
CREATE POLICY "Admins can view pending settlements"
  ON public.pending_settlements FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can propose settlements" ON public.pending_settlements;
CREATE POLICY "Admins can propose settlements"
  ON public.pending_settlements FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can update settlements" ON public.pending_settlements;
CREATE POLICY "Admins can update settlements"
  ON public.pending_settlements FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

GRANT EXECUTE ON FUNCTION public.propose_settlement TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_settlement TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_settlement TO authenticated;

RAISE NOTICE '✓ RLS policies and grants applied';

-- ============================================================================
-- MIGRATION 4: Settlement Validation (20251112_add_settlement_validation_option.sql)
-- ============================================================================

RAISE NOTICE '=== MIGRATION 4: Adding settlement validation options ===';

-- Add requires_approval column to markets
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.markets.requires_approval IS
  'When true, market settlement requires a pending_settlements approval record';

RAISE NOTICE '✓ markets.requires_approval column added';

-- Validation function
CREATE OR REPLACE FUNCTION public.validate_settlement_approval(
  p_market_id uuid,
  p_winning_outcome_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requires_approval boolean;
  v_has_approval boolean;
BEGIN
  SELECT requires_approval INTO v_requires_approval FROM public.markets WHERE id = p_market_id;

  IF v_requires_approval IS NULL THEN
    RAISE EXCEPTION 'Market % not found', p_market_id;
  END IF;

  IF NOT v_requires_approval THEN
    RETURN true;
  END IF;

  SELECT exists(
    SELECT 1 FROM public.pending_settlements
    WHERE market_id = p_market_id
      AND proposed_outcome_id = p_winning_outcome_id
      AND status = 'approved'
  ) INTO v_has_approval;

  RETURN v_has_approval;
END;
$$;

RAISE NOTICE '✓ validate_settlement_approval() function created';

-- Wrapper function with approval enforcement
CREATE OR REPLACE FUNCTION public.settle_market_with_approval(
  p_market_id uuid,
  p_winning_outcome_id uuid,
  p_payout_policy text DEFAULT 'refund_if_empty'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_approved boolean;
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  v_is_approved := public.validate_settlement_approval(p_market_id, p_winning_outcome_id);

  IF NOT v_is_approved THEN
    RAISE EXCEPTION 'Settlement not approved. Market requires approval via pending_settlements. Use propose_settlement() to create a settlement proposal, then approve_settlement() to execute it.';
  END IF;

  v_result := public.settle_market(p_market_id, p_winning_outcome_id, p_payout_policy);
  RETURN v_result;
END;
$$;

RAISE NOTICE '✓ settle_market_with_approval() function created';

-- Create view for pending settlements with context
CREATE OR REPLACE VIEW public.pending_settlements_with_context AS
SELECT
  ps.id as settlement_id,
  ps.status as settlement_status,
  ps.created_at as proposed_at,
  ps.reviewed_at,
  ps.notes,
  ps.rejection_reason,
  m.id as market_id,
  m.name as market_name,
  m.status as market_status,
  m.type as market_type,
  o.id as outcome_id,
  o.label as outcome_label,
  o.driver_id,
  d.name as driver_name,
  d.number as driver_number,
  s.id as session_id,
  s.name as session_name,
  s.status as session_status,
  proposer.display_name as proposed_by_name,
  reviewer.display_name as reviewed_by_name,
  ps.timing_data,
  (SELECT count(*) FROM public.wagers w WHERE w.market_id = m.id AND w.status = 'pending') as total_wagers,
  (SELECT coalesce(sum(stake), 0) FROM public.wagers w WHERE w.market_id = m.id AND w.status = 'pending') as total_pool,
  (SELECT coalesce(sum(stake), 0) FROM public.wagers w WHERE w.market_id = m.id AND w.outcome_id = o.id AND w.status = 'pending') as winning_pool
FROM public.pending_settlements ps
JOIN public.markets m ON m.id = ps.market_id
JOIN public.outcomes o ON o.id = ps.proposed_outcome_id
LEFT JOIN public.drivers d ON d.id = o.driver_id
LEFT JOIN public.sessions s ON s.id = ps.session_id
LEFT JOIN public.profiles proposer ON proposer.id = ps.proposed_by
LEFT JOIN public.profiles reviewer ON reviewer.id = ps.reviewed_by;

COMMENT ON VIEW public.pending_settlements_with_context IS
  'Complete view of pending settlements with all related context for admin review';

GRANT SELECT ON public.pending_settlements_with_context TO authenticated;

GRANT EXECUTE ON FUNCTION public.validate_settlement_approval TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_market_with_approval TO authenticated;

RAISE NOTICE '✓ View and grants created';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '╔════════════════════════════════════════════════════════════════╗';
  RAISE NOTICE '║  ✓ ALL MIGRATIONS APPLIED SUCCESSFULLY                        ║';
  RAISE NOTICE '╠════════════════════════════════════════════════════════════════╣';
  RAISE NOTICE '║  • Session creation bug fixed (Error 42P10)                   ║';
  RAISE NOTICE '║  • Outcome abbreviation column added                          ║';
  RAISE NOTICE '║  • Settlement approval system installed                       ║';
  RAISE NOTICE '║  • Settlement validation functions created                    ║';
  RAISE NOTICE '╚════════════════════════════════════════════════════════════════╝';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Test session creation wizard';
  RAISE NOTICE '2. Add SettlementApprovalQueue to admin dashboard';
  RAISE NOTICE '3. Review SETTLEMENT_APPROVAL_GUIDE.md for usage instructions';
END;
$$;
