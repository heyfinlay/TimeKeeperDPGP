-- ============================================================================
-- IDEMPOTENCY MIGRATIONS ONLY
-- ============================================================================
-- This creates the idempotency tables and enhanced RPC functions
-- Apply AFTER the indexes have been created
-- ============================================================================

-- ============================================================================
-- PART 1: Idempotent place_wager
-- ============================================================================

-- Idempotency Tracking Table
create table if not exists public.wager_idempotency (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  wager_id uuid not null references public.wagers(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint wager_idempotency_key_user unique (idempotency_key, user_id)
);

create index if not exists idx_wager_idempotency_created_at
  on public.wager_idempotency (created_at);

-- RLS
alter table public.wager_idempotency enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
    and tablename = 'wager_idempotency'
    and policyname = 'wager_idempotency_own_records'
  ) then
    create policy "wager_idempotency_own_records"
      on public.wager_idempotency
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

grant select on public.wager_idempotency to authenticated;

-- Enhanced place_wager function
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
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_stake <= 0 then
    raise exception 'Stake must be positive';
  end if;

  -- Idempotency check
  if p_idempotency_key is not null then
    select wager_id into v_existing_wager_id
    from public.wager_idempotency
    where idempotency_key = p_idempotency_key
      and user_id = v_user_id;

    if v_existing_wager_id is not null then
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

  -- Market validation
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

  select exists(
    select 1
    from public.outcomes
    where id = p_outcome_id
      and market_id = p_market_id
  ) into v_outcome_exists;

  if not v_outcome_exists then
    raise exception 'Outcome not found or does not belong to this market';
  end if;

  -- Wallet operations
  select balance into v_current_balance
  from public.wallet_accounts
  where user_id = v_user_id
  for update;

  if v_current_balance is null then
    insert into public.wallet_accounts (user_id, balance)
    values (v_user_id, 0)
    returning balance into v_current_balance;
  end if;

  if v_current_balance < p_stake then
    raise exception 'Insufficient funds. Balance: %, Required: %', v_current_balance, p_stake;
  end if;

  update public.wallet_accounts
  set balance = balance - p_stake,
      updated_at = now()
  where user_id = v_user_id;

  insert into public.wallet_transactions (user_id, kind, amount, meta)
  values (
    v_user_id,
    'wager',
    -p_stake,
    jsonb_build_object(
      'market_id', p_market_id,
      'outcome_id', p_outcome_id,
      'idempotency_key', p_idempotency_key
    )
  );

  insert into public.wagers (user_id, market_id, outcome_id, stake, status)
  values (v_user_id, p_market_id, p_outcome_id, p_stake, 'pending')
  returning id into v_wager_id;

  if p_idempotency_key is not null then
    insert into public.wager_idempotency (idempotency_key, user_id, wager_id)
    values (p_idempotency_key, v_user_id, v_wager_id)
    on conflict (idempotency_key, user_id) do nothing;
  end if;

  return jsonb_build_object(
    'success', true,
    'wager_id', v_wager_id,
    'new_balance', v_current_balance - p_stake,
    'idempotent', false
  );
end;
$$;

grant execute on function public.place_wager(uuid, uuid, bigint, text) to authenticated;

-- ============================================================================
-- PART 2: Idempotent settle_market
-- ============================================================================

-- Settlement Audit Log Table (CREATE FIRST!)
create table if not exists public.market_settlements (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null unique references public.markets(id) on delete cascade,
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
  meta jsonb
);

create index if not exists idx_market_settlements_market_id
  on public.market_settlements (market_id);

create index if not exists idx_market_settlements_settled_at
  on public.market_settlements (settled_at desc);

-- RLS
alter table public.market_settlements enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
    and tablename = 'market_settlements'
    and policyname = 'market_settlements_admin_only'
  ) then
    create policy "market_settlements_admin_only"
      on public.market_settlements
      for select
      to authenticated
      using (public.is_admin());
  end if;
end $$;

grant select on public.market_settlements to authenticated;

-- Settlement Reconciliation View (CREATE AFTER TABLE!)
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
  (ms.rake_amount + ms.total_paid + ms.dust) as calculated_total,
  (ms.total_pool - (ms.rake_amount + ms.total_paid + ms.dust)) as discrepancy,
  ms.settled_by,
  ms.settled_at
from public.market_settlements ms
join public.markets m on m.id = ms.market_id
join public.outcomes o on o.id = ms.winning_outcome_id
order by ms.settled_at desc;

grant select on public.settlement_reconciliation to authenticated;

-- ============================================================================
-- Enhanced settle_market function with idempotency
-- ============================================================================
-- Note: The full settle_market function is complex. If your database already has
-- a settle_market function, this will update it. If not, you'll need to create
-- the full version from the migration file.
--
-- The key addition is checking for existing settlements:
-- SELECT * FROM market_settlements WHERE market_id = p_market_id
-- If found, return cached result (idempotent).
-- ============================================================================

-- For now, just ensure the table and view exist.
-- The full settle_market function should be updated separately if needed,
-- or you can add it here if the current one doesn't have idempotency checks.

-- ============================================================================
-- COMPLETE!
-- ============================================================================
-- Verify tables were created:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name IN ('wager_idempotency', 'market_settlements');
--
-- Verify view was created:
-- SELECT table_name FROM information_schema.views
-- WHERE table_schema = 'public' AND table_name = 'settlement_reconciliation';
-- ============================================================================
