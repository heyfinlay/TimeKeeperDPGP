-- ============================================================================
-- SAFE INDEX MIGRATION - Core Indexes Only
-- ============================================================================
-- This version only creates indexes on tables/columns that definitely exist
-- based on your schema. We'll skip tables that might not have created_at.
-- ============================================================================

-- Wagers Table Indexes (CRITICAL for performance)
create index if not exists idx_wagers_user_id_placed_at
  on public.wagers (user_id, placed_at desc);

create index if not exists idx_wagers_market_id_status
  on public.wagers (market_id, status);

create index if not exists idx_wagers_market_id_outcome_id
  on public.wagers (market_id, outcome_id);

-- Outcomes Table Indexes
create index if not exists idx_outcomes_market_id
  on public.outcomes (market_id);

create index if not exists idx_outcomes_market_id_sort_order
  on public.outcomes (market_id, sort_order);

-- Markets Table Indexes
create index if not exists idx_markets_event_id
  on public.markets (event_id);

create index if not exists idx_markets_status
  on public.markets (status);

create index if not exists idx_markets_event_id_status
  on public.markets (event_id, status);

create index if not exists idx_markets_closes_at
  on public.markets (closes_at)
  where closes_at is not null;

-- Wallet Transactions Table Indexes
create index if not exists idx_wallet_transactions_user_id_created_at
  on public.wallet_transactions (user_id, created_at desc);

create index if not exists idx_wallet_transactions_kind
  on public.wallet_transactions (kind);

-- Events Table Indexes
create index if not exists idx_events_session_id
  on public.events (session_id);

create index if not exists idx_events_starts_at
  on public.events (starts_at);

create index if not exists idx_events_status
  on public.events (status);

-- Session Members Table Indexes
create index if not exists idx_session_members_session_id_user_id
  on public.session_members (session_id, user_id);

create index if not exists idx_session_members_user_id
  on public.session_members (user_id);

-- ============================================================================
-- Session-related indexes (if these tables exist)
-- ============================================================================

-- Laps
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'laps' and column_name = 'created_at') then
    create index if not exists idx_laps_session_id_driver_id_created_at
      on public.laps (session_id, driver_id, created_at desc);

    create index if not exists idx_laps_session_id_created_at
      on public.laps (session_id, created_at desc);
  end if;
end $$;

-- Drivers
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'drivers') then
    create index if not exists idx_drivers_session_id
      on public.drivers (session_id);
  end if;
end $$;

-- Penalties
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'penalties' and column_name = 'created_at') then
    create index if not exists idx_penalties_session_id_created_at
      on public.penalties (session_id, created_at desc);

    create index if not exists idx_penalties_driver_id
      on public.penalties (driver_id);
  end if;
end $$;

-- Pit Events
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pit_events' and column_name = 'created_at') then
    create index if not exists idx_pit_events_session_id_created_at
      on public.pit_events (session_id, created_at desc);

    create index if not exists idx_pit_events_driver_id
      on public.pit_events (driver_id);
  end if;
end $$;

-- Control Logs
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'control_logs' and column_name = 'created_at') then
    create index if not exists idx_control_logs_session_id_created_at
      on public.control_logs (session_id, created_at desc);
  end if;
end $$;

-- Room Messages
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'room_messages' and column_name = 'created_at') then
    create index if not exists idx_room_messages_room_id_created_at
      on public.room_messages (room_id, created_at desc);
  end if;
end $$;

-- ============================================================================
-- Verification
-- ============================================================================
-- Run this to see what was created:
-- SELECT tablename, indexname FROM pg_indexes
-- WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
-- ORDER BY tablename;
