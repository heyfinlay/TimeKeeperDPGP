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

-- ============================================================================
-- Idempotent place_wager RPC
-- ===========================================================================
-- ============================================================================
-- Migration: Make place_wager Idempotent
-- ============================================================================
-- This migration enhances the place_wager RPC to be idempotent by adding
-- an optional idempotency_key parameter. This prevents duplicate wagers
-- from being created due to network retries or race conditions.
--
-- Key features:
-- 1. Optional idempotency_key parameter (defaults to NULL for backward compat)
-- 2. Idempotency tracking table with automatic cleanup
-- 3. Proper row-level locking to prevent races
-- 4. Returns existing wager if key already processed
-- ============================================================================

-- ============================================================================
-- Idempotency Tracking Table
-- ============================================================================
create table if not exists public.wager_idempotency (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  wager_id uuid not null references public.wagers(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- Composite unique constraint
  constraint wager_idempotency_key_user unique (idempotency_key, user_id)
);

-- Index for cleanup queries
create index if not exists idx_wager_idempotency_created_at
  on public.wager_idempotency (created_at);

comment on table public.wager_idempotency is
  'Tracks idempotency keys for wager placement to prevent duplicate wagers from retries';

-- RLS: Users can only see their own idempotency records
alter table public.wager_idempotency enable row level security;

create policy "wager_idempotency_own_records"
  on public.wager_idempotency
  for select
  to authenticated
  using (user_id = auth.uid());

-- Grant access
grant select on public.wager_idempotency to authenticated;

-- ============================================================================
-- Enhanced place_wager with Idempotency
-- ============================================================================
create or replace function public.place_wager(
  p_market_id uuid,
  p_outcome_id uuid,
  p_stake bigint,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_current_balance bigint;
  v_market_status text;
  v_market_closes_at timestamptz;
  v_wager_id uuid;
  v_outcome_exists boolean;
  v_existing_wager_id uuid;
  v_existing_balance bigint;
begin
  -- Get authenticated user
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Validate stake
  if p_stake <= 0 then
    raise exception 'Stake must be positive';
  end if;

  -- ============================================================================
  -- Idempotency Check
  -- ============================================================================
  if p_idempotency_key is not null then
    -- Check if this operation was already processed
    select wager_id into v_existing_wager_id
    from public.wager_idempotency
    where idempotency_key = p_idempotency_key
      and user_id = v_user_id;

    if v_existing_wager_id is not null then
      -- Return existing wager info
      select balance into v_existing_balance
      from public.wallet_accounts
      where user_id = v_user_id;

      return jsonb_build_object(
        'success', true,
        'wager_id', v_existing_wager_id,
        'new_balance', v_existing_balance,
        'idempotent', true,
        'message', 'Wager already placed with this idempotency key'
      );
    end if;
  end if;

  -- ============================================================================
  -- Market Validation
  -- ============================================================================
  -- Check market exists and is open
  select status, closes_at
  into v_market_status, v_market_closes_at
  from public.markets
  where id = p_market_id;

  if v_market_status is null then
    raise exception 'Market not found';
  end if;

  if v_market_status != 'open' then
    raise exception 'Market is not open';
  end if;

  if v_market_closes_at is not null and v_market_closes_at <= now() then
    raise exception 'Market has closed';
  end if;

  -- Check outcome exists and belongs to this market
  select exists(
    select 1
    from public.outcomes
    where id = p_outcome_id
      and market_id = p_market_id
  ) into v_outcome_exists;

  if not v_outcome_exists then
    raise exception 'Outcome not found or does not belong to this market';
  end if;

  -- ============================================================================
  -- Wallet Operations (with row-level locking)
  -- ============================================================================
  -- Lock and get current balance
  select balance into v_current_balance
  from public.wallet_accounts
  where user_id = v_user_id
  for update;

  -- Create wallet if it doesn't exist
  if v_current_balance is null then
    insert into public.wallet_accounts (user_id, balance)
    values (v_user_id, 0)
    returning balance into v_current_balance;
  end if;

  -- Check sufficient funds
  if v_current_balance < p_stake then
    raise exception 'Insufficient funds. Balance: %, Required: %', v_current_balance, p_stake;
  end if;

  -- Debit wallet
  update public.wallet_accounts
  set balance = balance - p_stake,
      updated_at = now()
  where user_id = v_user_id;

  -- Record transaction
  insert into public.wallet_transactions (user_id, kind, amount, direction, meta)
  values (
    v_user_id,
    'wager',
    -p_stake,
    'debit',
    jsonb_build_object(
      'market_id', p_market_id,
      'outcome_id', p_outcome_id,
      'idempotency_key', p_idempotency_key
    )
  );

  -- ============================================================================
  -- Create Wager
  -- ============================================================================
  insert into public.wagers (user_id, market_id, outcome_id, stake, status)
  values (v_user_id, p_market_id, p_outcome_id, p_stake, 'pending')
  returning id into v_wager_id;

  -- ============================================================================
  -- Store Idempotency Key
  -- ============================================================================
  if p_idempotency_key is not null then
    insert into public.wager_idempotency (idempotency_key, user_id, wager_id)
    values (p_idempotency_key, v_user_id, v_wager_id)
    on conflict (idempotency_key, user_id) do nothing;
  end if;

  -- ============================================================================
  -- Return Success
  -- ============================================================================
  return jsonb_build_object(
    'success', true,
    'wager_id', v_wager_id,
    'new_balance', v_current_balance - p_stake,
    'idempotent', false
  );
end;
$$;

-- Grant execute to authenticated users
grant execute on function public.place_wager(uuid, uuid, bigint, text) to authenticated;

-- ============================================================================
-- Cleanup Function for Old Idempotency Records
-- ============================================================================
-- Run this periodically (e.g., via pg_cron) to clean up old idempotency keys
-- Keep records for 7 days to handle delayed retries
create or replace function public.cleanup_wager_idempotency()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.wager_idempotency
  where created_at < now() - interval '7 days';
end;
$$;

comment on function public.cleanup_wager_idempotency is
  'Removes wager idempotency records older than 7 days. Run via pg_cron or manually.';

-- ============================================================================
-- Usage Examples
-- ============================================================================
-- Example 1: Place wager without idempotency key (legacy behavior)
-- SELECT place_wager(
--   'market-uuid',
--   'outcome-uuid',
--   1000  -- 10.00 in lowest denomination
-- );
--
-- Example 2: Place wager with idempotency key (prevents duplicates)
-- SELECT place_wager(
--   'market-uuid',
--   'outcome-uuid',
--   1000,
--   'user-123_market-abc_outcome-xyz_1699999999'
-- );
--
-- Example 3: Retry same operation (returns existing wager)
-- SELECT place_wager(
--   'market-uuid',
--   'outcome-uuid',
--   1000,
--   'user-123_market-abc_outcome-xyz_1699999999'  -- Same key
-- );
-- Returns: {"idempotent": true, "message": "Wager already placed..."}
-- ============================================================================

-- ============================================================================
-- Idempotent settle_market RPC
-- ===========================================================================
-- ============================================================================
-- Migration: Make settle_market Idempotent and Add Settlement Audit
-- ============================================================================
-- This migration enhances the settle_market RPC to be truly idempotent
-- and adds comprehensive audit logging for all settlement operations.
--
-- Key improvements:
-- 1. Idempotent operation - safe to retry without double-paying
-- 2. Settlement audit log for compliance and debugging
-- 3. Deterministic settlement order (by placed_at)
-- 4. Dust tracking and reconciliation
-- 5. Prevents partial settlements on error
-- ============================================================================

-- ============================================================================
-- Settlement Audit Log Table
-- ============================================================================
create table if not exists public.market_settlements (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  winning_outcome_id uuid not null references public.outcomes(id) on delete cascade,
  total_pool bigint not null,
  winning_pool bigint not null,
  rake_amount bigint not null,
  net_pool bigint not null,
  total_paid bigint not null,
  dust bigint not null,
  winners_count int not null,
  losers_count int not null,
  payout_policy text not null,
  settled_by uuid references auth.users(id),
  settled_at timestamptz not null default now(),
  meta jsonb,

  -- Only one settlement per market
  constraint market_settlements_market_id_unique unique (market_id)
);

create index if not exists idx_market_settlements_market_id
  on public.market_settlements (market_id);

create index if not exists idx_market_settlements_settled_at
  on public.market_settlements (settled_at desc);

comment on table public.market_settlements is
  'Audit log of all market settlements for compliance and reconciliation';

-- RLS: Only admins can view settlement logs
alter table public.market_settlements enable row level security;

create policy "market_settlements_admin_only"
  on public.market_settlements
  for select
  to authenticated
  using (public.is_admin());

grant select on public.market_settlements to authenticated;

-- ============================================================================
-- Enhanced settle_market with Idempotency
-- ============================================================================
create or replace function public.settle_market(
  p_market_id uuid,
  p_winning_outcome_id uuid,
  p_payout_policy text default 'refund_if_empty'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market_status text;
  v_rake_bps int;
  v_total_pool bigint := 0;
  v_winning_pool bigint := 0;
  v_net_pool bigint := 0;
  v_rake_amount bigint := 0;
  v_total_paid bigint := 0;
  v_dust bigint := 0;
  v_outcome_exists boolean;
  v_wager record;
  v_payout bigint;
  v_winners_count int := 0;
  v_losers_count int := 0;
  v_existing_settlement record;
begin
  -- Check admin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  -- ============================================================================
  -- Idempotency Check - Return existing settlement if already processed
  -- ============================================================================
  select * into v_existing_settlement
  from public.market_settlements
  where market_id = p_market_id;

  if v_existing_settlement.id is not null then
    -- Market already settled, return cached result
    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'settlement_id', v_existing_settlement.id,
      'message', 'Market already settled',
      'total_pool', v_existing_settlement.total_pool,
      'winning_pool', v_existing_settlement.winning_pool,
      'rake_amount', v_existing_settlement.rake_amount,
      'net_pool', v_existing_settlement.net_pool,
      'total_paid', v_existing_settlement.total_paid,
      'dust', v_existing_settlement.dust,
      'winners_count', v_existing_settlement.winners_count,
      'settled_at', v_existing_settlement.settled_at
    );
  end if;

  -- ============================================================================
  -- Market Validation
  -- ============================================================================
  -- Get market info with row lock
  select status, rake_bps
  into v_market_status, v_rake_bps
  from public.markets
  where id = p_market_id
  for update;

  if v_market_status is null then
    raise exception 'Market not found';
  end if;

  -- Allow settlement of 'closed' markets (normal flow) or already 'settled' markets (retry)
  if v_market_status not in ('closed', 'settled') then
    raise exception 'Market must be closed before settlement (current status: %)', v_market_status;
  end if;

  -- If already marked as settled but no settlement record, something is wrong
  if v_market_status = 'settled' and v_existing_settlement.id is null then
    raise exception 'Market marked as settled but no settlement record found. Data integrity issue.';
  end if;

  -- Validate outcome belongs to market
  select exists(
    select 1 from public.outcomes
    where id = p_winning_outcome_id
      and market_id = p_market_id
  ) into v_outcome_exists;

  if not v_outcome_exists then
    raise exception 'Winning outcome does not belong to this market';
  end if;

  -- ============================================================================
  -- Calculate Pools (with row-level locking to prevent concurrent modifications)
  -- ============================================================================
  select
    coalesce(sum(stake), 0),
    coalesce(sum(case when outcome_id = p_winning_outcome_id then stake else 0 end), 0)
  into v_total_pool, v_winning_pool
  from public.wagers
  where market_id = p_market_id
    and status = 'pending'
  for update;

  -- ============================================================================
  -- Handle Empty Pool or No Winners
  -- ============================================================================
  if v_total_pool = 0 then
    -- No wagers placed - mark as settled
    update public.markets set status = 'settled' where id = p_market_id;

    -- Record settlement
    insert into public.market_settlements (
      market_id, winning_outcome_id, total_pool, winning_pool,
      rake_amount, net_pool, total_paid, dust,
      winners_count, losers_count, payout_policy, settled_by
    ) values (
      p_market_id, p_winning_outcome_id, 0, 0,
      0, 0, 0, 0,
      0, 0, p_payout_policy, auth.uid()
    );

    return jsonb_build_object(
      'success', true,
      'idempotent', false,
      'message', 'No wagers placed',
      'total_pool', 0,
      'winning_pool', 0,
      'net_pool', 0,
      'rake', 0
    );
  end if;

  if v_winning_pool = 0 then
    -- No winners - handle based on policy
    if p_payout_policy = 'refund_if_empty' then
      -- Refund all wagers
      for v_wager in
        select id, user_id, stake
        from public.wagers
        where market_id = p_market_id and status = 'pending'
        order by placed_at asc  -- Deterministic order
      loop
        -- Credit wallet
        insert into public.wallet_accounts (user_id, balance)
        values (v_wager.user_id, v_wager.stake)
        on conflict (user_id)
        do update set balance = wallet_accounts.balance + v_wager.stake,
                      updated_at = now();

        -- Record transaction
        insert into public.wallet_transactions (user_id, kind, amount, direction, meta)
        values (
          v_wager.user_id,
          'refund',
          v_wager.stake,
          'credit',
          jsonb_build_object(
            'market_id', p_market_id,
            'wager_id', v_wager.id,
            'reason', 'no_winners'
          )
        );

        -- Mark wager as refunded
        update public.wagers set status = 'refunded' where id = v_wager.id;
        v_winners_count := v_winners_count + 1;  -- Count refunds as "winners"
      end loop;

      update public.markets set status = 'settled' where id = p_market_id;

      -- Record settlement
      insert into public.market_settlements (
        market_id, winning_outcome_id, total_pool, winning_pool,
        rake_amount, net_pool, total_paid, dust,
        winners_count, losers_count, payout_policy, settled_by
      ) values (
        p_market_id, p_winning_outcome_id, v_total_pool, 0,
        0, v_total_pool, v_total_pool, 0,
        v_winners_count, 0, p_payout_policy, auth.uid()
      );

      return jsonb_build_object(
        'success', true,
        'idempotent', false,
        'message', 'All wagers refunded (no winners)',
        'total_pool', v_total_pool,
        'refunded', v_total_pool
      );
    else
      -- House takes all
      update public.wagers set status = 'lost'
      where market_id = p_market_id and status = 'pending';

      select count(*) into v_losers_count
      from public.wagers
      where market_id = p_market_id and status = 'lost';

      update public.markets set status = 'settled' where id = p_market_id;

      -- Record settlement
      insert into public.market_settlements (
        market_id, winning_outcome_id, total_pool, winning_pool,
        rake_amount, net_pool, total_paid, dust,
        winners_count, losers_count, payout_policy, settled_by
      ) values (
        p_market_id, p_winning_outcome_id, v_total_pool, 0,
        v_total_pool, 0, 0, 0,
        0, v_losers_count, p_payout_policy, auth.uid()
      );

      return jsonb_build_object(
        'success', true,
        'idempotent', false,
        'message', 'House wins (no winning wagers)',
        'total_pool', v_total_pool,
        'house_take', v_total_pool
      );
    end if;
  end if;

  -- ============================================================================
  -- Normal Settlement: Calculate Rake and Distribute Payouts
  -- ============================================================================
  -- Calculate rake and net pool
  v_rake_amount := floor(v_total_pool * v_rake_bps / 10000.0);
  v_net_pool := v_total_pool - v_rake_amount;

  -- Distribute payouts to winners (deterministic order)
  for v_wager in
    select id, user_id, stake
    from public.wagers
    where market_id = p_market_id
      and outcome_id = p_winning_outcome_id
      and status = 'pending'
    order by placed_at asc  -- Deterministic ordering for consistent dust allocation
  loop
    -- Calculate proportional payout (floor to avoid fractional units)
    v_payout := floor((v_wager.stake::numeric / v_winning_pool::numeric) * v_net_pool);

    -- Credit wallet
    insert into public.wallet_accounts (user_id, balance)
    values (v_wager.user_id, v_payout)
    on conflict (user_id)
    do update set balance = wallet_accounts.balance + v_payout,
                  updated_at = now();

    -- Record transaction
    insert into public.wallet_transactions (user_id, kind, amount, direction, meta)
    values (
      v_wager.user_id,
      'payout',
      v_payout,
      'credit',
      jsonb_build_object(
        'market_id', p_market_id,
        'wager_id', v_wager.id,
        'outcome_id', p_winning_outcome_id,
        'rake_bps', v_rake_bps
      )
    );

    -- Mark wager as won
    update public.wagers set status = 'won' where id = v_wager.id;

    v_total_paid := v_total_paid + v_payout;
    v_winners_count := v_winners_count + 1;
  end loop;

  -- Calculate dust (leftover from floor operations)
  v_dust := v_net_pool - v_total_paid;

  -- Mark losing wagers
  update public.wagers
  set status = 'lost'
  where market_id = p_market_id
    and outcome_id != p_winning_outcome_id
    and status = 'pending';

  select count(*) into v_losers_count
  from public.wagers
  where market_id = p_market_id
    and outcome_id != p_winning_outcome_id
    and status = 'lost';

  -- Update market status
  update public.markets set status = 'settled' where id = p_market_id;

  -- Record settlement for audit and idempotency
  insert into public.market_settlements (
    market_id, winning_outcome_id, total_pool, winning_pool,
    rake_amount, net_pool, total_paid, dust,
    winners_count, losers_count, payout_policy, settled_by
  ) values (
    p_market_id, p_winning_outcome_id, v_total_pool, v_winning_pool,
    v_rake_amount, v_net_pool, v_total_paid, v_dust,
    v_winners_count, v_losers_count, p_payout_policy, auth.uid()
  );

  -- ============================================================================
  -- Return Success
  -- ============================================================================
  return jsonb_build_object(
    'success', true,
    'idempotent', false,
    'total_pool', v_total_pool,
    'winning_pool', v_winning_pool,
    'rake_amount', v_rake_amount,
    'net_pool', v_net_pool,
    'total_paid', v_total_paid,
    'dust', v_dust,
    'winners_count', v_winners_count,
    'losers_count', v_losers_count
  );
end;
$$;

grant execute on function public.settle_market(uuid, uuid, text) to authenticated;

-- ============================================================================
-- Settlement Reconciliation View
-- ============================================================================
-- View to help reconcile settlements and identify any discrepancies
create or replace view public.settlement_reconciliation as
select
  ms.id as settlement_id,
  ms.market_id,
  m.name as market_name,
  ms.winning_outcome_id,
  o.label as winning_outcome,
  ms.total_pool,
  ms.winning_pool,
  ms.rake_amount,
  ms.net_pool,
  ms.total_paid,
  ms.dust,
  ms.winners_count,
  ms.losers_count,
  -- Verification: total_pool should equal rake + total_paid + dust
  (ms.rake_amount + ms.total_paid + ms.dust) as calculated_total,
  (ms.total_pool - (ms.rake_amount + ms.total_paid + ms.dust)) as discrepancy,
  ms.settled_by,
  ms.settled_at
from public.market_settlements ms
join public.markets m on m.id = ms.market_id
join public.outcomes o on o.id = ms.winning_outcome_id
order by ms.settled_at desc;

comment on view public.settlement_reconciliation is
  'Reconciliation view for market settlements. Discrepancy should always be 0.';

grant select on public.settlement_reconciliation to authenticated;

-- ============================================================================
-- Usage Examples
-- ============================================================================
-- Example 1: Settle market (first time)
-- SELECT settle_market(
--   'market-uuid',
--   'winning-outcome-uuid',
--   'refund_if_empty'
-- );
--
-- Example 2: Retry settlement (idempotent - returns cached result)
-- SELECT settle_market(
--   'market-uuid',
--   'winning-outcome-uuid',
--   'refund_if_empty'
-- );
-- Returns: {"idempotent": true, "message": "Market already settled", ...}
--
-- Example 3: Check reconciliation
-- SELECT * FROM settlement_reconciliation WHERE discrepancy != 0;
-- (Should always return 0 rows)
-- ============================================================================
