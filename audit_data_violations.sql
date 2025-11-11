-- Comprehensive audit of data violations before applying constraints
-- Run this to identify issues that need resolution before migration

-- ============================================================================
-- 1. WALLET INTEGRITY AUDIT
-- ============================================================================

-- Check: wallet balance vs transaction sum mismatch
SELECT
  'WALLET MISMATCH' as issue_type,
  wa.id as account_id,
  wa.user_id,
  wa.balance as recorded_balance,
  COALESCE(SUM(wt.amount), 0) as transaction_sum,
  wa.balance - COALESCE(SUM(wt.amount), 0) as difference
FROM public.wallet_accounts wa
LEFT JOIN public.wallet_transactions wt ON wt.user_id = wa.user_id
GROUP BY wa.id, wa.user_id, wa.balance
HAVING wa.balance != COALESCE(SUM(wt.amount), 0);

-- Check: negative balances
SELECT
  'NEGATIVE BALANCE' as issue_type,
  id as account_id,
  user_id,
  balance
FROM public.wallet_accounts
WHERE balance < 0;

-- Check: wallet transactions with negative amounts
SELECT
  'NEGATIVE TRANSACTION' as issue_type,
  id as transaction_id,
  user_id,
  amount,
  type
FROM public.wallet_transactions
WHERE amount < 0;

-- Check: wallet transactions without account reference
SELECT
  'ORPHAN TRANSACTION' as issue_type,
  wt.id as transaction_id,
  wt.user_id,
  wt.amount
FROM public.wallet_transactions wt
LEFT JOIN public.wallet_accounts wa ON wa.user_id = wt.user_id
WHERE wa.id IS NULL;

-- ============================================================================
-- 2. WAGERS IN CLOSED/VOID MARKETS
-- ============================================================================

-- Check: wagers placed in non-open markets
SELECT
  'WAGER IN CLOSED MARKET' as issue_type,
  w.id as wager_id,
  w.user_id,
  w.market_id,
  m.status as market_status,
  w.placed_at,
  m.closes_at
FROM public.wagers w
JOIN public.markets m ON m.id = w.market_id
WHERE m.status != 'open';

-- Check: wagers placed after market close time
SELECT
  'WAGER AFTER CLOSE TIME' as issue_type,
  w.id as wager_id,
  w.user_id,
  w.market_id,
  w.placed_at,
  m.closes_at,
  w.placed_at - m.closes_at as time_after_close
FROM public.wagers w
JOIN public.markets m ON m.id = w.market_id
WHERE m.closes_at IS NOT NULL
  AND w.placed_at > m.closes_at;

-- ============================================================================
-- 3. IDEMPOTENCY VIOLATIONS
-- ============================================================================

-- Check: duplicate idempotency keys per user
SELECT
  'DUPLICATE IDEMPOTENCY KEY' as issue_type,
  idempotency_key,
  user_id,
  COUNT(*) as duplicate_count,
  array_agg(wager_id) as wager_ids
FROM public.wager_idempotency
GROUP BY idempotency_key, user_id
HAVING COUNT(*) > 1;

-- Check: duplicate wager_id in idempotency table
SELECT
  'DUPLICATE WAGER IN IDEMPOTENCY' as issue_type,
  wager_id,
  COUNT(*) as duplicate_count,
  array_agg(idempotency_key) as keys
FROM public.wager_idempotency
GROUP BY wager_id
HAVING COUNT(*) > 1;

-- ============================================================================
-- 4. LAPS INTEGRITY
-- ============================================================================

-- Check: laps with NULL driver_id
SELECT
  'LAP WITH NULL DRIVER' as issue_type,
  id as lap_id,
  session_id,
  lap_number
FROM public.laps
WHERE driver_id IS NULL;

-- Check: duplicate laps (same session, driver, lap_number)
SELECT
  'DUPLICATE LAP' as issue_type,
  session_id,
  driver_id,
  lap_number,
  COUNT(*) as duplicate_count,
  array_agg(id) as lap_ids
FROM public.laps
WHERE driver_id IS NOT NULL
GROUP BY session_id, driver_id, lap_number
HAVING COUNT(*) > 1;

-- ============================================================================
-- 5. SESSION STATE VIOLATIONS
-- ============================================================================

-- Check: multiple state rows per session
SELECT
  'MULTIPLE SESSION STATES' as issue_type,
  session_id,
  COUNT(*) as state_count,
  array_agg(id) as state_ids
FROM public.session_state
GROUP BY session_id
HAVING COUNT(*) > 1;

-- ============================================================================
-- 6. OUTCOME/DRIVER/SESSION MISMATCHES
-- ============================================================================

-- Check: outcomes with driver from different session
SELECT
  'OUTCOME DRIVER SESSION MISMATCH' as issue_type,
  o.id as outcome_id,
  o.driver_id,
  d.session_id as driver_session_id,
  e.session_id as market_session_id,
  m.id as market_id
FROM public.outcomes o
JOIN public.drivers d ON d.id = o.driver_id
JOIN public.markets m ON m.id = o.market_id
JOIN public.events e ON e.id = m.event_id
WHERE d.session_id != e.session_id;

-- ============================================================================
-- 7. INVALID STATUS VALUES (free-text fields)
-- ============================================================================

-- Check: invalid market statuses
SELECT
  'INVALID MARKET STATUS' as issue_type,
  id as market_id,
  status
FROM public.markets
WHERE status NOT IN ('draft', 'open', 'closed', 'settled', 'void');

-- Check: invalid wager statuses
SELECT
  'INVALID WAGER STATUS' as issue_type,
  id as wager_id,
  status
FROM public.wagers
WHERE status NOT IN ('accepted', 'refunded', 'paid', 'void');

-- Check: invalid withdrawal statuses
SELECT
  'INVALID WITHDRAWAL STATUS' as issue_type,
  id as withdrawal_id,
  status
FROM public.withdrawals
WHERE status NOT IN ('queued', 'approved', 'rejected', 'paid');

-- Check: invalid profile roles
SELECT
  'INVALID PROFILE ROLE' as issue_type,
  id as profile_id,
  role
FROM public.profiles
WHERE role NOT IN ('user', 'admin', 'marshal');

-- Check: invalid session member roles
SELECT
  'INVALID SESSION MEMBER ROLE' as issue_type,
  id as member_id,
  role
FROM public.session_members
WHERE role NOT IN ('marshal', 'admin', 'driver', 'spectator');

-- ============================================================================
-- 8. MISSING UNIQUE CONSTRAINTS
-- ============================================================================

-- Check: duplicate outcome labels per market
SELECT
  'DUPLICATE OUTCOME LABEL' as issue_type,
  market_id,
  label,
  COUNT(*) as duplicate_count,
  array_agg(id) as outcome_ids
FROM public.outcomes
GROUP BY market_id, label
HAVING COUNT(*) > 1;

-- Check: duplicate market names per event
SELECT
  'DUPLICATE MARKET NAME' as issue_type,
  event_id,
  name,
  COUNT(*) as duplicate_count,
  array_agg(id) as market_ids
FROM public.markets
GROUP BY event_id, name
HAVING COUNT(*) > 1;

-- ============================================================================
-- 9. MISSING FOREIGN KEYS
-- ============================================================================

-- Check: profiles with invalid team_id
SELECT
  'INVALID TEAM REFERENCE' as issue_type,
  p.id as profile_id,
  p.team_id
FROM public.profiles p
LEFT JOIN public.teams t ON t.id = p.team_id
WHERE p.team_id IS NOT NULL AND t.id IS NULL;

-- ============================================================================
-- 10. DRIVERS WITHOUT UUID DEFAULT
-- ============================================================================

-- Check: drivers with NULL id (shouldn't happen, but checking)
SELECT
  'DRIVER WITH NULL ID' as issue_type,
  session_id,
  name
FROM public.drivers
WHERE id IS NULL;

-- ============================================================================
-- 11. MISSING SETTLEMENT AUDIT TRAIL
-- ============================================================================

-- Check: wagers marked as 'paid' but no corresponding wallet transaction
SELECT
  'PAID WAGER NO TRANSACTION' as issue_type,
  w.id as wager_id,
  w.user_id,
  w.market_id,
  w.stake
FROM public.wagers w
WHERE w.status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM public.wallet_transactions wt
    WHERE wt.user_id = w.user_id
      AND wt.type = 'payout'
      AND wt.created_at >= w.placed_at
  );

-- ============================================================================
-- 12. EVENT/SESSION RELATIONSHIP
-- ============================================================================

-- Check: multiple events pointing to same session
SELECT
  'MULTIPLE EVENTS PER SESSION' as issue_type,
  session_id,
  COUNT(*) as event_count,
  array_agg(id) as event_ids
FROM public.events
WHERE session_id IS NOT NULL
GROUP BY session_id
HAVING COUNT(*) > 1;

-- ============================================================================
-- 13. RACE EVENTS MARSHAL TYPE MISMATCH
-- ============================================================================

-- Check: race_events with text marshal_id that can't convert to uuid
SELECT
  'INVALID MARSHAL ID TYPE' as issue_type,
  id as race_event_id,
  marshal_id,
  session_id
FROM public.race_events
WHERE marshal_id IS NOT NULL
  AND marshal_id != ''
  AND marshal_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- ============================================================================
-- SUMMARY COUNTS
-- ============================================================================

SELECT
  'AUDIT SUMMARY' as report_type,
  (SELECT COUNT(*) FROM public.wallet_accounts WHERE balance < 0) as negative_balances,
  (SELECT COUNT(*) FROM public.wagers w JOIN public.markets m ON m.id = w.market_id WHERE m.status != 'open') as wagers_in_closed_markets,
  (SELECT COUNT(*) FROM public.laps WHERE driver_id IS NULL) as laps_without_driver,
  (SELECT COUNT(DISTINCT session_id) FROM public.session_state GROUP BY session_id HAVING COUNT(*) > 1) as sessions_with_multiple_states,
  (SELECT COUNT(*) FROM public.outcomes o JOIN public.drivers d ON d.id = o.driver_id JOIN public.markets m ON m.id = o.market_id JOIN public.events e ON e.id = m.event_id WHERE d.session_id != e.session_id) as mismatched_driver_sessions,
  (SELECT COUNT(*) FROM public.markets WHERE status NOT IN ('draft', 'open', 'closed', 'settled', 'void')) as invalid_market_statuses;
