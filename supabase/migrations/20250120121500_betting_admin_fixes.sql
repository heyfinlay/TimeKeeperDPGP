-- Ensure wager approval RPCs exist and fix settlement locking issues

----------------------------
-- approve_wager
----------------------------
create or replace function public.approve_wager(p_wager_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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

revoke all on function public.approve_wager(uuid) from public;
grant execute on function public.approve_wager(uuid) to authenticated;
comment on function public.approve_wager(uuid) is 'Admin RPC for approving a pending wager.';

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
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select status into v_status
  from public.wagers
  where id = p_wager_id
  for update;

  if v_status is null then
    raise exception 'Wager not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Wager is not pending approval';
  end if;

  update public.wagers
  set status = 'rejected',
      rejected_reason = nullif(p_reason, ''),
      approved_by = auth.uid(),
      approved_at = timezone('utc', now())
  where id = p_wager_id;

  return jsonb_build_object(
    'success', true,
    'wagerId', p_wager_id,
    'status', 'rejected'
  );
end;
$$;

revoke all on function public.reject_wager(uuid, text) from public;
grant execute on function public.reject_wager(uuid, text) to authenticated;
comment on function public.reject_wager(uuid, text) is 'Admin RPC for rejecting a pending wager with an optional reason.';

----------------------------
-- settle_market locking fix
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
  v_market_status text;
  v_takeout numeric(5,4);
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
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select status, takeout, rake_bps
  into v_market_status, v_takeout, v_rake_bps
  from public.markets
  where id = p_market_id;

  if v_market_status is null then
    raise exception 'Market not found';
  end if;

  if v_market_status != 'closed' then
    raise exception 'Market must be closed before settlement (current status: %)', v_market_status;
  end if;

  v_takeout := coalesce(v_takeout, greatest(0, least(0.25, coalesce(v_rake_bps, 0) / 10000.0)));

  select exists(
    select 1 from public.outcomes
    where id = p_winning_outcome_id
      and market_id = p_market_id
  ) into v_outcome_exists;

  if not v_outcome_exists then
    raise exception 'Winning outcome does not belong to this market';
  end if;

  perform 1
    from public.wagers
    where market_id = p_market_id
      and status = 'pending'
    for update;

  select
    coalesce(sum(stake), 0),
    coalesce(sum(case when outcome_id = p_winning_outcome_id then stake else 0 end), 0)
  into v_total_pool, v_winning_pool
  from public.wagers
  where market_id = p_market_id
    and status = 'pending';

  if v_total_pool = 0 then
    update public.markets set status = 'settled' where id = p_market_id;
    return jsonb_build_object(
      'success', true,
      'message', 'No wagers placed',
      'total_pool', 0,
      'winning_pool', 0,
      'net_pool', 0,
      'rake', 0,
      'takeout', v_takeout
    );
  end if;

  if v_winning_pool = 0 then
    if p_payout_policy = 'refund_if_empty' then
      for v_wager in
        select id, user_id, stake
        from public.wagers
        where market_id = p_market_id and status = 'pending'
      loop
        insert into public.wallet_accounts (user_id, balance)
        values (v_wager.user_id, v_wager.stake)
        on conflict (user_id)
        do update set balance = wallet_accounts.balance + v_wager.stake;

        insert into public.wallet_transactions (user_id, kind, amount, direction, meta)
        values (
          v_wager.user_id,
          'refund',
          v_wager.stake,
          'credit',
          jsonb_build_object('market_id', p_market_id, 'wager_id', v_wager.id, 'reason', 'no_winners')
        );

        update public.wagers set status = 'refunded' where id = v_wager.id;
      end loop;

      update public.markets set status = 'settled' where id = p_market_id;
      return jsonb_build_object(
        'success', true,
        'message', 'All wagers refunded (no winners)',
        'total_pool', v_total_pool,
        'refunded', v_total_pool,
        'takeout', v_takeout
      );
    else
      update public.wagers set status = 'lost' where market_id = p_market_id and status = 'pending';
      update public.markets set status = 'settled' where id = p_market_id;
      return jsonb_build_object(
        'success', true,
        'message', 'House wins (no winning wagers)',
        'total_pool', v_total_pool,
        'house_take', v_total_pool,
        'takeout', v_takeout
      );
    end if;
  end if;

  v_rake_amount := floor(v_total_pool * coalesce(v_takeout, 0));
  v_net_pool := v_total_pool - v_rake_amount;

  for v_wager in
    select id, user_id, stake
    from public.wagers
    where market_id = p_market_id
      and outcome_id = p_winning_outcome_id
      and status = 'pending'
    order by placed_at asc
  loop
    v_payout := floor((v_wager.stake::numeric / v_winning_pool::numeric) * v_net_pool);

    insert into public.wallet_accounts (user_id, balance)
    values (v_wager.user_id, v_payout)
    on conflict (user_id)
    do update set balance = wallet_accounts.balance + v_payout;

    insert into public.wallet_transactions (user_id, kind, amount, direction, meta)
    values (
      v_wager.user_id,
      'payout',
      v_payout,
      'credit',
      jsonb_build_object(
        'market_id', p_market_id,
        'wager_id', v_wager.id,
        'outcome_id', p_winning_outcome_id
      )
    );

    update public.wagers set status = 'won' where id = v_wager.id;

    v_total_paid := v_total_paid + v_payout;
    v_winners_count := v_winners_count + 1;
  end loop;

  v_dust := v_net_pool - v_total_paid;

  update public.wagers
  set status = 'lost'
  where market_id = p_market_id
    and outcome_id != p_winning_outcome_id
    and status = 'pending';

  update public.markets set status = 'settled' where id = p_market_id;

  return jsonb_build_object(
    'success', true,
    'total_pool', v_total_pool,
    'winning_pool', v_winning_pool,
    'rake_amount', v_rake_amount,
    'net_pool', v_net_pool,
    'total_paid', v_total_paid,
    'dust', v_dust,
    'winners_count', v_winners_count,
    'takeout', v_takeout
  );
end;
$$;

grant execute on function public.settle_market(uuid, uuid, text) to authenticated;
