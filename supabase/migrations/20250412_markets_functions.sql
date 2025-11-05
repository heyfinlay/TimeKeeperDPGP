-- RPC functions for market operations

-- place_wager: transactionally debit wallet and create wager
create or replace function public.place_wager(
  p_market_id uuid,
  p_outcome_id uuid,
  p_stake bigint
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
  set balance = balance - p_stake
  where user_id = v_user_id;

  -- Record transaction
  insert into public.wallet_transactions (user_id, kind, amount, meta)
  values (
    v_user_id,
    'wager',
    -p_stake,
    jsonb_build_object(
      'market_id', p_market_id,
      'outcome_id', p_outcome_id
    )
  );

  -- Create wager
  insert into public.wagers (user_id, market_id, outcome_id, stake, status)
  values (v_user_id, p_market_id, p_outcome_id, p_stake, 'pending')
  returning id into v_wager_id;

  return jsonb_build_object(
    'success', true,
    'wager_id', v_wager_id,
    'new_balance', v_current_balance - p_stake
  );
end;
$$;

-- Grant execute to authenticated users
grant execute on function public.place_wager(uuid, uuid, bigint) to authenticated;

-- close_market: flip market status to closed
create or replace function public.close_market(p_market_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market_status text;
begin
  -- Check admin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  -- Get market status
  select status into v_market_status
  from public.markets
  where id = p_market_id;

  if v_market_status is null then
    raise exception 'Market not found';
  end if;

  if v_market_status != 'open' then
    raise exception 'Market is not open (current status: %)', v_market_status;
  end if;

  -- Close market
  update public.markets
  set status = 'closed'
  where id = p_market_id;

  return jsonb_build_object('success', true, 'market_id', p_market_id, 'status', 'closed');
end;
$$;

grant execute on function public.close_market(uuid) to authenticated;

-- settle_market: calculate payouts and distribute winnings
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
begin
  -- Check admin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  -- Get market info
  select status, rake_bps
  into v_market_status, v_rake_bps
  from public.markets
  where id = p_market_id;

  if v_market_status is null then
    raise exception 'Market not found';
  end if;

  if v_market_status != 'closed' then
    raise exception 'Market must be closed before settlement (current status: %)', v_market_status;
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

  -- Calculate pools (lock all wagers for this market)
  select
    coalesce(sum(stake), 0),
    coalesce(sum(case when outcome_id = p_winning_outcome_id then stake else 0 end), 0)
  into v_total_pool, v_winning_pool
  from public.wagers
  where market_id = p_market_id
    and status = 'pending'
  for update;

  -- Handle empty pool or no winners
  if v_total_pool = 0 then
    update public.markets set status = 'settled' where id = p_market_id;
    return jsonb_build_object(
      'success', true,
      'message', 'No wagers placed',
      'total_pool', 0,
      'winning_pool', 0,
      'net_pool', 0,
      'rake', 0
    );
  end if;

  if v_winning_pool = 0 then
    -- Handle refund policy
    if p_payout_policy = 'refund_if_empty' then
      -- Refund all wagers
      for v_wager in
        select id, user_id, stake
        from public.wagers
        where market_id = p_market_id and status = 'pending'
      loop
        -- Credit wallet
        insert into public.wallet_accounts (user_id, balance)
        values (v_wager.user_id, v_wager.stake)
        on conflict (user_id)
        do update set balance = wallet_accounts.balance + v_wager.stake;

        -- Record transaction
        insert into public.wallet_transactions (user_id, kind, amount, meta)
        values (
          v_wager.user_id,
          'refund',
          v_wager.stake,
          jsonb_build_object('market_id', p_market_id, 'wager_id', v_wager.id, 'reason', 'no_winners')
        );

        -- Mark wager as refunded
        update public.wagers set status = 'refunded' where id = v_wager.id;
      end loop;

      update public.markets set status = 'settled' where id = p_market_id;
      return jsonb_build_object(
        'success', true,
        'message', 'All wagers refunded (no winners)',
        'total_pool', v_total_pool,
        'refunded', v_total_pool
      );
    else
      -- House takes all
      update public.wagers set status = 'lost' where market_id = p_market_id and status = 'pending';
      update public.markets set status = 'settled' where id = p_market_id;
      return jsonb_build_object(
        'success', true,
        'message', 'House wins (no winning wagers)',
        'total_pool', v_total_pool,
        'house_take', v_total_pool
      );
    end if;
  end if;

  -- Calculate rake and net pool
  v_rake_amount := floor(v_total_pool * v_rake_bps / 10000.0);
  v_net_pool := v_total_pool - v_rake_amount;

  -- Distribute payouts to winners
  for v_wager in
    select id, user_id, stake
    from public.wagers
    where market_id = p_market_id
      and outcome_id = p_winning_outcome_id
      and status = 'pending'
    order by placed_at asc  -- Deterministic ordering
  loop
    -- Calculate proportional payout (floor to avoid fractional diamonds)
    v_payout := floor((v_wager.stake::numeric / v_winning_pool::numeric) * v_net_pool);

    -- Credit wallet
    insert into public.wallet_accounts (user_id, balance)
    values (v_wager.user_id, v_payout)
    on conflict (user_id)
    do update set balance = wallet_accounts.balance + v_payout;

    -- Record transaction
    insert into public.wallet_transactions (user_id, kind, amount, meta)
    values (
      v_wager.user_id,
      'payout',
      v_payout,
      jsonb_build_object(
        'market_id', p_market_id,
        'wager_id', v_wager.id,
        'outcome_id', p_winning_outcome_id
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

  -- Update market status
  update public.markets set status = 'settled' where id = p_market_id;

  return jsonb_build_object(
    'success', true,
    'total_pool', v_total_pool,
    'winning_pool', v_winning_pool,
    'rake_amount', v_rake_amount,
    'net_pool', v_net_pool,
    'total_paid', v_total_paid,
    'dust', v_dust,
    'winners_count', v_winners_count
  );
end;
$$;

grant execute on function public.settle_market(uuid, uuid, text) to authenticated;

-- Admin action log trigger
create table if not exists public.admin_actions_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  market_id uuid references public.markets(id),
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_actions_log_actor_id_idx on public.admin_actions_log (actor_id);
create index if not exists admin_actions_log_market_id_idx on public.admin_actions_log (market_id);

grant select on table public.admin_actions_log to authenticated;

-- Enable RLS
alter table public.admin_actions_log enable row level security;

-- Only admins can see logs
create policy "admin_actions_log_admin_only"
  on public.admin_actions_log
  for select
  using (public.is_admin());

-- Function to log admin actions
create or replace function public.log_admin_action(
  p_action text,
  p_market_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return;
  end if;

  insert into public.admin_actions_log (actor_id, action, market_id, meta)
  values (auth.uid(), p_action, p_market_id, p_meta);
end;
$$;

grant execute on function public.log_admin_action(text, uuid, jsonb) to authenticated;
