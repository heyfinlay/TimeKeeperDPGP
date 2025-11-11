-- ============================================================================
-- Migration: Add Critical Performance Indexes
-- ============================================================================
-- This migration adds essential indexes for query performance based on
-- identified hot paths in the application:
--
-- 1. Lap timing queries (session_id, driver_id, created_at)
-- 2. Driver session lookups (session_id)
-- 3. Wager queries (market_id, user_id, created_at)
-- 4. Outcome lookups (market_id)
-- 5. Market lookups (event_id, status)
-- 6. Wallet transactions (account_id, created_at)
--
-- All indexes are created with IF NOT EXISTS to support idempotent execution.
-- ============================================================================

-- ============================================================================
-- Laps Table Indexes
-- ============================================================================
-- Hot path: Live timing board queries filtering by session and driver
create index if not exists idx_laps_session_id_driver_id_created_at
  on public.laps (session_id, driver_id, created_at desc);

-- Additional index for session-wide queries
create index if not exists idx_laps_session_id_created_at
  on public.laps (session_id, created_at desc);

-- ============================================================================
-- Drivers Table Indexes
-- ============================================================================
-- Hot path: Loading all drivers for a session
create index if not exists idx_drivers_session_id
  on public.drivers (session_id);

-- ============================================================================
-- Wagers Table Indexes
-- ============================================================================
-- Hot path: Loading user's wagers
create index if not exists idx_wagers_user_id_created_at
  on public.wagers (user_id, created_at desc);

-- Hot path: Market settlement and pool calculations
create index if not exists idx_wagers_market_id_status
  on public.wagers (market_id, status);

-- Combined index for outcome-specific queries
create index if not exists idx_wagers_market_id_outcome_id
  on public.wagers (market_id, outcome_id);

-- ============================================================================
-- Outcomes Table Indexes
-- ============================================================================
-- Hot path: Loading outcomes for a market
create index if not exists idx_outcomes_market_id
  on public.outcomes (market_id);

-- Sort order for ordered display
create index if not exists idx_outcomes_market_id_sort_order
  on public.outcomes (market_id, sort_order);

-- ============================================================================
-- Markets Table Indexes
-- ============================================================================
-- Hot path: Loading markets for an event
create index if not exists idx_markets_event_id
  on public.markets (event_id);

-- Status filtering (open markets)
create index if not exists idx_markets_status
  on public.markets (status);

-- Combined index for event status queries
create index if not exists idx_markets_event_id_status
  on public.markets (event_id, status);

-- Closing soon queries
create index if not exists idx_markets_closes_at
  on public.markets (closes_at)
  where closes_at is not null;

-- ============================================================================
-- Wallet Transactions Table Indexes
-- ============================================================================
-- Hot path: User transaction history
create index if not exists idx_wallet_transactions_user_id_created_at
  on public.wallet_transactions (user_id, created_at desc);

-- Transaction kind filtering (for audit/reports)
create index if not exists idx_wallet_transactions_kind
  on public.wallet_transactions (kind);

-- ============================================================================
-- Events Table Indexes
-- ============================================================================
-- Session association
create index if not exists idx_events_session_id
  on public.events (session_id);

-- Upcoming events query
create index if not exists idx_events_starts_at
  on public.events (starts_at);

-- Status filtering
create index if not exists idx_events_status
  on public.events (status);

-- ============================================================================
-- Session Members Table Indexes
-- ============================================================================
-- Hot path: Access control checks
create index if not exists idx_session_members_session_id_user_id
  on public.session_members (session_id, user_id);

-- User's sessions
create index if not exists idx_session_members_user_id
  on public.session_members (user_id);

-- ============================================================================
-- Penalties Table Indexes
-- ============================================================================
-- Hot path: Loading penalties for a session
create index if not exists idx_penalties_session_id_created_at
  on public.penalties (session_id, created_at desc);

-- Driver-specific penalties
create index if not exists idx_penalties_driver_id
  on public.penalties (driver_id);

-- ============================================================================
-- Pit Events Table Indexes
-- ============================================================================
-- Hot path: Loading pit events for a session
create index if not exists idx_pit_events_session_id_created_at
  on public.pit_events (session_id, created_at desc);

-- Driver-specific pit stops
create index if not exists idx_pit_events_driver_id
  on public.pit_events (driver_id);

-- ============================================================================
-- Control Logs Table Indexes
-- ============================================================================
-- Hot path: Race control log for a session
create index if not exists idx_control_logs_session_id_created_at
  on public.control_logs (session_id, created_at desc);

-- ============================================================================
-- Room Messages Table Indexes
-- ============================================================================
-- Hot path: Loading chat messages for a room
create index if not exists idx_room_messages_room_id_created_at
  on public.room_messages (room_id, created_at desc);

-- ============================================================================
-- Analysis & Monitoring
-- ============================================================================

comment on index idx_laps_session_id_driver_id_created_at is
  'Optimizes live timing board queries for driver laps in a session';

comment on index idx_wagers_market_id_status is
  'Critical for market settlement: SELECT wagers WHERE market_id = X AND status = ''pending'' FOR UPDATE';

comment on index idx_wagers_user_id_created_at is
  'Optimizes user wager history queries';

comment on index idx_markets_event_id_status is
  'Optimizes loading open markets for an event';

comment on index idx_wallet_transactions_user_id_created_at is
  'Optimizes user transaction history and balance reconciliation';

-- ============================================================================
-- Verification Queries
-- ============================================================================
-- To verify indexes were created, run:
--
-- SELECT schemaname, tablename, indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname LIKE 'idx_%'
-- ORDER BY tablename, indexname;
--
-- To analyze query performance with indexes:
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM wagers
-- WHERE market_id = 'some-uuid' AND status = 'pending'
-- FOR UPDATE;
-- ============================================================================
