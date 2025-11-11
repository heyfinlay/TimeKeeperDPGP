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
