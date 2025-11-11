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
        insert into public.wallet_transactions (user_id, kind, amount, meta)
        values (
          v_wager.user_id,
          'refund',
          v_wager.stake,
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
    insert into public.wallet_transactions (user_id, kind, amount, meta)
    values (
      v_wager.user_id,
      'payout',
      v_payout,
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
