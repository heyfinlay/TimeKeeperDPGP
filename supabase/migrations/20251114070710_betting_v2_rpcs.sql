-- Betting V2 RPC suite: previews, placement, market control, approvals, depth, and settlement.

----------------------------
-- preview_wager
----------------------------
create or replace function public.preview_wager(
  p_market_id uuid,
  p_outcome_id uuid,
  p_stake bigint default 0,
  p_sample_rate numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market record;
  v_total_pool numeric := 0;
  v_outcome_pool numeric := 0;
  v_net_pool numeric := 0;
  v_baseline numeric;
  v_effective numeric;
  v_new_total numeric;
  v_new_outcome numeric;
  v_share_before numeric := 0;
  v_share_after numeric := 0;
  v_price_impact numeric := 0;
  v_takeout numeric := 0;
  v_balance bigint;
  v_user uuid := auth.uid();
begin
  if p_stake < 0 then
    raise exception 'Stake must be non-negative';
  end if;

  select id, status, takeout, requires_approval
  into v_market
  from public.markets
  where id = p_market_id;

  if v_market.id is null then
    raise exception 'Market not found';
  end if;

  if v_market.status is distinct from 'open' then
    raise exception 'Market is not accepting wagers';
  end if;

  v_takeout := coalesce(v_market.takeout, 0.10);

  select
    coalesce(sum(stake)::numeric, 0),
    coalesce(sum(stake)::numeric filter (where outcome_id = p_outcome_id), 0)
  into v_total_pool, v_outcome_pool
  from public.wagers
  where market_id = p_market_id
    and status = 'accepted';

  v_net_pool := v_total_pool * (1 - v_takeout);

  if v_total_pool > 0 then
    v_share_before := v_outcome_pool / v_total_pool;
  end if;

  if v_outcome_pool > 0 then
    v_baseline := case when v_net_pool > 0 then v_net_pool / v_outcome_pool else null end;
  else
    v_baseline := null;
  end if;

  v_new_total := v_total_pool + p_stake;
  v_new_outcome := v_outcome_pool + p_stake;

  if v_new_total > 0 then
    v_share_after := v_new_outcome / v_new_total;
    v_price_impact := (v_share_after - v_share_before) * 100;
  end if;

  v_effective := case
    when v_new_outcome > 0 then (v_new_total * (1 - v_takeout)) / v_new_outcome
    else null
  end;

  if v_user is not null then
    select balance into v_balance
    from public.wallet_accounts
    where user_id = v_user;
  end if;

  if p_stake > 0 then
    perform public.log_quote_telemetry(
      p_market_id,
      p_outcome_id,
      p_stake,
      v_baseline,
      v_effective,
      v_price_impact,
      coalesce(nullif(p_sample_rate, 0), 1.0)
    );
  end if;

  return jsonb_build_object(
    'marketId', p_market_id,
    'outcomeId', p_outcome_id,
    'stake', p_stake,
    'takeout', v_takeout,
    'requiresApproval', v_market.requires_approval,
    'totalPoolBefore', v_total_pool,
    'totalPoolAfter', v_new_total,
    'outcomePoolBefore', v_outcome_pool,
    'outcomePoolAfter', v_new_outcome,
    'baselineOdds', v_baseline,
    'effectiveOdds', v_effective,
    'shareBefore', v_share_before,
    'shareAfter', v_share_after,
    'priceImpactPercent', v_price_impact,
    'takeoutAmount', p_stake * v_takeout,
    'impliedProbability', v_share_after,
    'maxPayout', case when v_effective is null then null else p_stake * v_effective end,
    'estimatedPayout', case when v_effective is null then null else p_stake * v_effective end,
    'userBalance', v_balance
  );
end;
$$;

----------------------------
-- place_wager (Betting V2)
----------------------------
create or replace function public.place_wager(
  p_market_id uuid,
  p_outcome_id uuid,
  p_stake bigint,
  p_idempotency_key text default null,
  p_sample_rate numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_wallet_balance bigint;
  v_market record;
  v_outcome_exists boolean;
  v_existing_wager uuid;
  v_existing_balance bigint;
  v_status public.wager_status := 'accepted';
  v_baseline numeric;
  v_effective numeric;
  v_price_impact numeric;
  v_preview jsonb;
  v_wager_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_stake is null or p_stake <= 0 then
    raise exception 'Stake must be positive';
  end if;

  if p_idempotency_key is not null then
    select wager_id into v_existing_wager
    from public.wager_idempotency
    where idempotency_key = p_idempotency_key
      and user_id = v_user_id;

    if v_existing_wager is not null then
      select balance into v_existing_balance
      from public.wallet_accounts
      where user_id = v_user_id;

      return jsonb_build_object(
        'success', true,
        'idempotent', true,
        'wagerId', v_existing_wager,
        'newBalance', v_existing_balance
      );
    end if;
  end if;

  select id, status, takeout, requires_approval, closes_at
  into v_market
  from public.markets
  where id = p_market_id
  for update;

  if v_market.id is null then
    raise exception 'Market not found';
  end if;

  if v_market.status is distinct from 'open' then
    raise exception 'Market is not accepting wagers';
  end if;

  if v_market.closes_at is not null and v_market.closes_at <= now() then
    raise exception 'Market has closed';
  end if;

  select exists(
    select 1
    from public.outcomes
    where id = p_outcome_id
      and market_id = p_market_id
  ) into v_outcome_exists;

  if not v_outcome_exists then
    raise exception 'Outcome does not belong to market';
  end if;

  select balance into v_wallet_balance
  from public.wallet_accounts
  where user_id = v_user_id
  for update;

  if v_wallet_balance is null then
    insert into public.wallet_accounts (user_id, balance)
    values (v_user_id, 0)
    returning balance into v_wallet_balance;
  end if;

  if v_wallet_balance < p_stake then
    raise exception 'Insufficient funds';
  end if;

  v_preview := public.preview_wager(p_market_id, p_outcome_id, p_stake, p_sample_rate);
  v_baseline := (v_preview->>'baselineOdds')::numeric;
  v_effective := (v_preview->>'effectiveOdds')::numeric;
  v_price_impact := (v_preview->>'priceImpactPercent')::numeric;

  update public.wallet_accounts
  set balance = balance - p_stake,
      updated_at = timezone('utc', now())
  where user_id = v_user_id;

  if v_market.requires_approval then
    v_status := 'pending';
  end if;

  insert into public.wagers (
    user_id,
    market_id,
    outcome_id,
    stake,
    status,
    odds_before,
    odds_after,
    price_impact_pp
  )
  values (
    v_user_id,
    p_market_id,
    p_outcome_id,
    p_stake,
    v_status,
    v_baseline,
    v_effective,
    v_price_impact
  )
  returning id into v_wager_id;

  insert into public.wallet_transactions (
    user_id,
    kind,
    amount,
    direction,
    reference_type,
    reference_id,
    meta
  )
  values (
    v_user_id,
    'wager',
    -p_stake,
    'debit',
    'wager',
    v_wager_id,
    jsonb_build_object(
      'market_id', p_market_id,
      'outcome_id', p_outcome_id,
      'idempotency_key', p_idempotency_key
    )
  );

  if p_idempotency_key is not null then
    insert into public.wager_idempotency (idempotency_key, user_id, wager_id)
    values (p_idempotency_key, v_user_id, v_wager_id)
    on conflict (idempotency_key, user_id) do nothing;
  end if;

  return jsonb_build_object(
    'success', true,
    'idempotent', false,
    'wagerId', v_wager_id,
    'status', v_status,
    'requiresApproval', v_market.requires_approval,
    'newBalance', (v_wallet_balance - p_stake),
    'preview', v_preview
  );
end;
$$;

----------------------------
-- close_market
----------------------------
create or replace function public.close_market(p_market_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market record;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select id, status, closes_at
  into v_market
  from public.markets
  where id = p_market_id
  for update;

  if v_market.id is null then
    raise exception 'Market not found';
  end if;

  if v_market.status in ('closed', 'settled', 'cancelled') then
    return jsonb_build_object(
      'success', true,
      'status', v_market.status,
      'marketId', p_market_id
    );
  end if;

  update public.markets
  set status = 'closed',
      closes_at = coalesce(v_market.closes_at, timezone('utc', now()))
  where id = p_market_id;

  perform public.snapshot_market_pools(p_market_id);

  return jsonb_build_object(
    'success', true,
    'status', 'closed',
    'marketId', p_market_id
  );
end;
$$;

----------------------------
-- admin_list_pending_wagers
----------------------------
create or replace function public.admin_list_pending_wagers(
  p_market_id uuid default null
)
returns table (
  wager_id uuid,
  market_id uuid,
  market_name text,
  outcome_id uuid,
  outcome_label text,
  user_id uuid,
  bettor_name text,
  stake bigint,
  placed_at timestamptz,
  price_impact_pp numeric,
  odds_before numeric,
  odds_after numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  return query
  select
    w.id as wager_id,
    w.market_id,
    m.name as market_name,
    w.outcome_id,
    o.label as outcome_label,
    w.user_id,
    p.display_name as bettor_name,
    w.stake,
    w.placed_at,
    w.price_impact_pp,
    w.odds_before,
    w.odds_after
  from public.wagers w
  join public.markets m on m.id = w.market_id
  join public.outcomes o on o.id = w.outcome_id
  left join public.profiles p on p.id = w.user_id
  where w.status = 'pending'
    and (p_market_id is null or w.market_id = p_market_id)
  order by w.placed_at asc;
end;
$$;

----------------------------
-- approve_wager
----------------------------
create or replace function public.approve_wager(p_wager_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wager record;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select w.*, m.requires_approval
  into v_wager
  from public.wagers w
  join public.markets m on m.id = w.market_id
  where w.id = p_wager_id
  for update;

  if v_wager.id is null then
    raise exception 'Wager not found';
  end if;

  if v_wager.status <> 'pending' then
    raise exception 'Wager is not pending approval';
  end if;

  update public.wagers
  set status = 'accepted',
      approved_by = auth.uid(),
      approved_at = timezone('utc', now()),
      rejected_reason = null
  where id = p_wager_id;

  return jsonb_build_object(
    'success', true,
    'wagerId', p_wager_id,
    'status', 'accepted'
  );
end;
$$;

----------------------------
-- reject_wager
----------------------------
create or replace function public.reject_wager(
  p_wager_id uuid,
  p_reason text default 'Rejected by admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wager record;
  v_wallet_balance bigint;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select *
  into v_wager
  from public.wagers
  where id = p_wager_id
  for update;

  if v_wager.id is null then
    raise exception 'Wager not found';
  end if;

  if v_wager.status <> 'pending' then
    raise exception 'Only pending wagers can be rejected';
  end if;

  select balance into v_wallet_balance
  from public.wallet_accounts
  where user_id = v_wager.user_id
  for update;

  if v_wallet_balance is null then
    insert into public.wallet_accounts (user_id, balance)
    values (v_wager.user_id, 0)
    returning balance into v_wallet_balance;
  end if;

  update public.wallet_accounts
  set balance = balance + v_wager.stake,
      updated_at = timezone('utc', now())
  where user_id = v_wager.user_id;

  insert into public.wallet_transactions (
    user_id,
    kind,
    amount,
    direction,
    reference_type,
    reference_id,
    meta
  )
  values (
    v_wager.user_id,
    'refund',
    v_wager.stake,
    'credit',
    'wager',
    v_wager.id,
    jsonb_build_object('reason', p_reason)
  );

  update public.wagers
  set status = 'rejected',
      rejected_reason = p_reason,
      settled_at = timezone('utc', now())
  where id = p_wager_id;

  return jsonb_build_object(
    'success', true,
    'wagerId', p_wager_id,
    'status', 'rejected'
  );
end;
$$;

----------------------------
-- get_market_depth
----------------------------
create or replace function public.get_market_depth(
  p_market_id uuid,
  p_window interval default interval '15 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market record;
  v_outcomes jsonb;
  v_snapshots jsonb;
  v_telemetry jsonb;
begin
  select id, name, status, takeout
  into v_market
  from public.markets
  where id = p_market_id;

  if v_market.id is null then
    raise exception 'Market not found';
  end if;

  with total_pool as (
    select coalesce(sum(stake)::numeric, 0) as total_pool
    from public.wagers
    where market_id = p_market_id
      and status = 'accepted'
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'outcomeId', o.id,
      'label', o.label,
      'abbreviation', o.abbreviation,
      'color', o.color,
      'totalStaked', stats.total_staked,
      'share', stats.share,
      'odds', stats.odds
    )
    order by o.sort_order
  ), '[]'::jsonb)
  into v_outcomes
  from public.outcomes o
  cross join total_pool tp
  left join lateral (
    select
      coalesce(sum(stake)::numeric, 0) as total_staked,
      case when tp.total_pool = 0 then 0 else coalesce(sum(stake)::numeric, 0) / tp.total_pool end as share,
      case
        when coalesce(sum(stake)::numeric, 0) = 0 then null
        else (tp.total_pool * (1 - coalesce(v_market.takeout, 0))) / coalesce(sum(stake)::numeric, 1)
      end as odds
    from public.wagers w
    where w.market_id = p_market_id
      and w.outcome_id = o.id
      and w.status = 'accepted'
  ) stats on true
  where o.market_id = p_market_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'outcomeId', ps.outcome_id,
      'totalPool', ps.total_pool,
      'outcomePool', ps.outcome_pool,
      'takeout', ps.takeout,
      'capturedAt', ps.created_at
    )
    order by ps.created_at desc
  ), '[]'::jsonb)
  into v_snapshots
  from public.pool_snapshots ps
  where ps.market_id = p_market_id
    and ps.created_at >= timezone('utc', now()) - p_window;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'outcomeId', t.outcome_id,
      'stake', t.stake,
      'baseline', t.baseline_multiplier,
      'after', t.effective_multiplier,
      'priceImpact', t.price_impact,
      'recordedAt', t.created_at
    )
    order by t.created_at desc
  ), '[]'::jsonb)
  into v_telemetry
  from (
    select *
    from public.quote_telemetry
    where market_id = p_market_id
      and created_at >= timezone('utc', now()) - p_window
    order by created_at desc
    limit 200
  ) t;

  return jsonb_build_object(
    'market', jsonb_build_object(
      'id', v_market.id,
      'name', v_market.name,
      'status', v_market.status,
      'takeout', v_market.takeout
    ),
    'outcomes', v_outcomes,
    'snapshots', v_snapshots,
    'telemetry', v_telemetry
  );
end;
$$;

-- settle_market (Betting V2)
----------------------------
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
  v_market record;
  v_existing record;
  v_total_pool numeric := 0;
  v_winning_pool numeric := 0;
  v_net_pool numeric := 0;
  v_rake_amount numeric := 0;
  v_total_paid numeric := 0;
  v_dust numeric := 0;
  v_winner record;
  v_policy text := coalesce(lower(p_payout_policy), 'refund_if_empty');
  v_winners_count int := 0;
  v_losers_count int := 0;
  v_payout bigint;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select market_id, id
  into v_existing
  from public.market_settlements
  where market_id = p_market_id;

  if v_existing.market_id is not null then
    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'settlementId', v_existing.id,
      'message', 'Market already settled'
    );
  end if;

  select id, status, takeout, rake_bps, requires_approval
  into v_market
  from public.markets
  where id = p_market_id
  for update;

  if v_market.id is null then
    raise exception 'Market not found';
  end if;

  if v_market.status not in ('closed', 'settled') then
    raise exception 'Market must be closed before settlement';
  end if;

  if v_market.requires_approval then
    if not public.validate_settlement_approval(p_market_id, p_winning_outcome_id) then
      raise exception 'Settlement not approved for this market/outcome';
    end if;
  end if;

  select
    coalesce(sum(stake)::numeric, 0),
    coalesce(sum(stake)::numeric filter (where outcome_id = p_winning_outcome_id), 0)
  into v_total_pool, v_winning_pool
  from public.wagers
  where market_id = p_market_id
    and status = 'accepted'
  for update;

  if v_total_pool = 0 then
    update public.markets
    set status = 'settled',
        settles_at = timezone('utc', now())
    where id = p_market_id;

    insert into public.market_settlements (
      market_id, winning_outcome_id, total_pool, winning_pool,
      rake_amount, net_pool, total_paid, dust,
      winners_count, losers_count, payout_policy, settled_by
    ) values (
      p_market_id, p_winning_outcome_id, 0, 0,
      0, 0, 0, 0,
      0, 0, v_policy, auth.uid()
    );

    return jsonb_build_object(
      'success', true,
      'message', 'No wagers to settle',
      'idempotent', false
    );
  end if;

  v_rake_amount := floor(v_total_pool * coalesce(v_market.rake_bps, 0) / 10000.0);
  v_net_pool := v_total_pool - v_rake_amount;

  if v_winning_pool = 0 then
    if v_policy = 'refund_if_empty' then
      for v_winner in
        select id, user_id, stake
        from public.wagers
        where market_id = p_market_id
          and status = 'accepted'
        order by placed_at asc
      loop
        update public.wallet_accounts
        set balance = balance + v_winner.stake,
            updated_at = timezone('utc', now())
        where user_id = v_winner.user_id;

        insert into public.wallet_transactions (
          user_id, kind, amount, direction, reference_type, reference_id, meta
        ) values (
          v_winner.user_id,
          'refund',
          v_winner.stake,
          'credit',
          'wager',
          v_winner.id,
          jsonb_build_object('reason', 'no_winners')
        );

        update public.wagers
        set status = 'cancelled',
            payout_amount = v_winner.stake,
            settled_at = timezone('utc', now())
        where id = v_winner.id;

        v_winners_count := v_winners_count + 1;
      end loop;

      update public.markets
      set status = 'settled',
          settles_at = timezone('utc', now())
      where id = p_market_id;

      insert into public.market_settlements (
        market_id, winning_outcome_id, total_pool, winning_pool,
        rake_amount, net_pool, total_paid, dust,
        winners_count, losers_count, payout_policy, settled_by
      ) values (
        p_market_id, p_winning_outcome_id, v_total_pool, 0,
        0, v_total_pool, v_total_pool, 0,
        v_winners_count, 0, v_policy, auth.uid()
      );

      return jsonb_build_object(
        'success', true,
        'message', 'All wagers refunded (no winners)',
        'idempotent', false
      );
    else
      update public.wagers
      set status = 'settled_loss',
          payout_amount = 0,
          settled_at = timezone('utc', now())
      where market_id = p_market_id
        and status = 'accepted';

      update public.markets
      set status = 'settled',
          settles_at = timezone('utc', now())
      where id = p_market_id;

      insert into public.market_settlements (
        market_id, winning_outcome_id, total_pool, winning_pool,
        rake_amount, net_pool, total_paid, dust,
        winners_count, losers_count, payout_policy, settled_by
      ) values (
        p_market_id, p_winning_outcome_id, v_total_pool, 0,
        v_rake_amount, v_net_pool, 0, v_net_pool,
        0, (select count(*) from public.wagers where market_id = p_market_id and status = 'settled_loss'),
        v_policy, auth.uid()
      );

      return jsonb_build_object(
        'success', true,
        'message', 'House keeps pool (no winners)',
        'idempotent', false
      );
    end if;
  end if;

  for v_winner in
    select id, user_id, stake
    from public.wagers
    where market_id = p_market_id
      and outcome_id = p_winning_outcome_id
      and status = 'accepted'
    order by placed_at asc
  loop
    v_payout := floor((v_winner.stake::numeric / v_winning_pool) * v_net_pool);

    update public.wallet_accounts
    set balance = balance + v_payout,
        updated_at = timezone('utc', now())
    where user_id = v_winner.user_id;

    insert into public.wallet_transactions (
      user_id, kind, amount, direction, reference_type, reference_id, meta
    ) values (
      v_winner.user_id,
      'payout',
      v_payout,
      'credit',
      'wager',
      v_winner.id,
      jsonb_build_object(
        'market_id', p_market_id,
        'outcome_id', p_winning_outcome_id
      )
    );

    update public.wagers
    set status = 'settled_win',
        payout_amount = v_payout,
        settled_at = timezone('utc', now())
    where id = v_winner.id;

    v_total_paid := v_total_paid + v_payout;
    v_winners_count := v_winners_count + 1;
  end loop;

  v_dust := v_net_pool - v_total_paid;

  update public.wagers
  set status = 'settled_loss',
      payout_amount = 0,
      settled_at = timezone('utc', now())
  where market_id = p_market_id
    and outcome_id <> p_winning_outcome_id
    and status = 'accepted';

  select count(*) into v_losers_count
  from public.wagers
  where market_id = p_market_id
    and outcome_id <> p_winning_outcome_id
    and status = 'settled_loss';

  update public.markets
  set status = 'settled',
      settles_at = timezone('utc', now())
  where id = p_market_id;

  insert into public.market_settlements (
    market_id, winning_outcome_id, total_pool, winning_pool,
    rake_amount, net_pool, total_paid, dust,
    winners_count, losers_count, payout_policy, settled_by
  ) values (
    p_market_id, p_winning_outcome_id, v_total_pool, v_winning_pool,
    v_rake_amount, v_net_pool, v_total_paid, v_dust,
    v_winners_count, v_losers_count, v_policy, auth.uid()
  );

  return jsonb_build_object(
    'success', true,
    'idempotent', false,
    'marketId', p_market_id,
    'winningOutcomeId', p_winning_outcome_id,
    'totalPool', v_total_pool,
    'winningPool', v_winning_pool,
    'netPool', v_net_pool,
    'totalPaid', v_total_paid,
    'dust', v_dust
  );
end;
$$;
