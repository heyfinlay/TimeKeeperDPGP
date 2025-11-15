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
      and status = 'accepted'
    for update;

  select
    coalesce(sum(stake), 0),
    coalesce(sum(case when outcome_id = p_winning_outcome_id then stake else 0 end), 0)
  into v_total_pool, v_winning_pool
  from public.wagers
  where market_id = p_market_id
    and status = 'accepted';

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
        where market_id = p_market_id and status = 'accepted'
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
      update public.wagers set status = 'lost' where market_id = p_market_id and status = 'accepted';
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
      and status = 'accepted'
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
    and status = 'accepted';

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

----------------------------
-- pending_settlements_with_context view alignment
----------------------------
drop view if exists public.pending_settlements_with_context;
create view public.pending_settlements_with_context as
select
  ps.id as settlement_id,
  ps.status as settlement_status,
  ps.created_at as proposed_at,
  ps.reviewed_at,
  ps.notes,
  ps.rejection_reason,
  ps.timing_data,
  ps.proposed_by,
  ps.reviewed_by,
  m.id as market_id,
  m.name as market_name,
  m.status as market_status,
  m.type as market_type,
  m.requires_approval,
  o.id as outcome_id,
  o.label as outcome_label,
  o.driver_id,
  d.name as driver_name,
  d.number as driver_number,
  s.id as session_id,
  s.name as session_name,
  s.status as session_status,
  proposer.display_name as proposed_by_name,
  reviewer.display_name as reviewed_by_name,
  (select count(*) from public.wagers w where w.market_id = m.id and w.status = 'accepted') as total_wagers,
  (select coalesce(sum(stake), 0) from public.wagers w where w.market_id = m.id and w.status = 'accepted') as total_pool,
  (
    select coalesce(sum(stake), 0)
    from public.wagers w
    where w.market_id = m.id
      and w.outcome_id = o.id
      and w.status = 'accepted'
  ) as winning_pool
from public.pending_settlements ps
join public.markets m on m.id = ps.market_id
join public.outcomes o on o.id = ps.proposed_outcome_id
left join public.drivers d on d.id = o.driver_id
left join public.sessions s on s.id = ps.session_id
left join public.profiles proposer on proposer.id = ps.proposed_by
left join public.profiles reviewer on reviewer.id = ps.reviewed_by;

grant select on public.pending_settlements_with_context to authenticated;

----------------------------
-- market/outcome pool views use accepted wagers
----------------------------
create or replace view public.market_pools as
select
  m.id as market_id,
  coalesce(sum(case when w.status = 'accepted' then w.stake else 0 end), 0)::numeric as total_pool,
  count(*) filter (where w.status = 'accepted')::bigint as total_wagers,
  count(distinct w.user_id) filter (where w.status = 'accepted')::bigint as unique_bettors,
  m.takeout
from public.markets m
left join public.wagers w on w.market_id = m.id
where m.status in ('open', 'suspended', 'closing')
group by m.id;

create or replace view public.outcome_pools as
select
  o.id as outcome_id,
  o.market_id,
  coalesce(sum(case when w.status = 'accepted' then w.stake else 0 end), 0)::numeric as total_staked,
  count(*) filter (where w.status = 'accepted')::bigint as wager_count
from public.outcomes o
left join public.wagers w on w.outcome_id = o.id
where o.market_id is not null
group by o.id, o.market_id;

----------------------------
-- snapshot + summary functions align with accepted wagers
----------------------------
create or replace function public.snapshot_market_pools(p_market_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_inserted integer := 0;
begin
  with market_totals as (
    select market_id, sum(case when status = 'accepted' then stake else 0 end)::numeric as total_pool
    from public.wagers
    group by market_id
  ),
  outcome_totals as (
    select outcome_id, sum(case when status = 'accepted' then stake else 0 end)::numeric as outcome_pool
    from public.wagers
    group by outcome_id
  ),
  sources as (
    select
      m.id as market_id,
      o.id as outcome_id,
      coalesce(mt.total_pool, 0) as total_pool,
      coalesce(ot.outcome_pool, 0) as outcome_pool,
      coalesce(m.takeout, 0.10) as takeout
    from public.markets m
    join public.outcomes o on o.market_id = m.id
    left join market_totals mt on mt.market_id = m.id
    left join outcome_totals ot on ot.outcome_id = o.id
    where (p_market_id is null or m.id = p_market_id)
      and m.status in ('open', 'suspended')
  ),
  inserted as (
    insert into public.pool_snapshots (market_id, outcome_id, total_pool, outcome_pool, takeout, created_at)
    select market_id, outcome_id, total_pool, outcome_pool, takeout, v_now
    from sources
    returning 1
  )
  select count(*) into v_inserted from inserted;

  if v_inserted > 0 then
    perform public.refresh_pool_snapshots_1m();
  end if;

  return jsonb_build_object('success', true, 'rows', v_inserted, 'snapshotAt', v_now);
end;
$$;

create or replace function public.get_market_summary(p_market_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market record;
  v_total numeric := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  select id, name, status, closes_at, takeout, created_at
  into v_market
  from public.markets
  where id = p_market_id;

  if not found then
    raise exception 'Market not found';
  end if;

  select coalesce(sum(case when status = 'accepted' then stake else 0 end), 0)::numeric
  into v_total
  from public.wagers
  where market_id = p_market_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'outcomeId', o.id,
      'label', o.label,
      'sortOrder', o.sort_order,
      'pool', coalesce(sum(case when w.status = 'accepted' then w.stake else 0 end), 0)::numeric,
      'wagerCount', count(*) filter (where w.status = 'accepted')::bigint
    )
    order by o.sort_order, o.label
  ), '[]'::jsonb)
  into v_rows
  from public.outcomes o
  left join public.wagers w on w.outcome_id = o.id
  where o.market_id = p_market_id
  group by o.market_id;

  return jsonb_build_object(
    'marketId', v_market.id,
    'status', v_market.status,
    'closeTime', v_market.closes_at,
    'takeout', v_market.takeout,
    'createdAt', v_market.created_at,
    'totalPool', v_total,
    'outcomes', v_rows
  );
end;
$$;

create or replace function public.get_market_history(p_market_id uuid, p_window text default '1m')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market record;
  v_window text := coalesce(lower(p_window), '1m');
  v_anchor_at timestamptz;
  v_anchor_limit timestamptz;
  v_updated_at timestamptz;
  v_current_total numeric := 0;
  v_anchor_total numeric := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  select id, takeout, created_at
  into v_market
  from public.markets
  where id = p_market_id;

  if not found then
    raise exception 'Market not found';
  end if;

  if v_window not in ('1m', '5m', 'since_open') then
    v_window := '1m';
  end if;

  if v_window = '1m' then
    v_anchor_limit := now() - interval '1 minute';
  elsif v_window = '5m' then
    v_anchor_limit := now() - interval '5 minutes';
  else
    v_anchor_limit := null;
  end if;

  if v_anchor_limit is null then
    select min(created_at)
    into v_anchor_at
    from public.pool_snapshots
    where market_id = p_market_id;
    if v_anchor_at is null then
      v_anchor_at := v_market.created_at;
    end if;
  else
    select max(created_at)
    into v_anchor_at
    from public.pool_snapshots
    where market_id = p_market_id
      and created_at <= v_anchor_limit;
    if v_anchor_at is null then
      v_anchor_at := v_market.created_at;
    end if;
  end if;

  with current_outcomes as (
    select
      o.id as outcome_id,
      o.label,
      coalesce(sum(case when w.status = 'accepted' then w.stake else 0 end), 0)::numeric as outcome_pool,
      count(*) filter (where w.status = 'accepted')::bigint as wager_count,
      o.sort_order
    from public.outcomes o
    left join public.wagers w on w.outcome_id = o.id
    where o.market_id = p_market_id
    group by o.id
  ),
  current_total as (
    select coalesce(sum(outcome_pool), 0)::numeric as total_pool from current_outcomes
  ),
  anchor_outcomes as (
    select distinct on (ps.outcome_id)
      ps.outcome_id,
      ps.total_pool,
      ps.outcome_pool,
      ps.takeout,
      ps.created_at
    from public.pool_snapshots ps
    where ps.market_id = p_market_id
      and ps.created_at <= v_anchor_at
    order by ps.outcome_id, ps.created_at desc
  ),
  anchor_total as (
    select coalesce(max(total_pool), 0)::numeric as total_pool
    from anchor_outcomes
  ),
  sparkline as (
    select
      ps.outcome_id,
      jsonb_agg(
        jsonb_build_object(
          'createdAt', ps.created_at,
          'totalPool', ps.total_pool,
          'outcomePool', ps.outcome_pool
        )
        order by ps.created_at desc
      ) as samples
    from (
      select
        ps.outcome_id,
        ps.total_pool,
        ps.outcome_pool,
        ps.created_at,
        row_number() over (partition by ps.outcome_id order by ps.created_at desc) as rn
      from public.pool_snapshots ps
      where ps.market_id = p_market_id
    ) ps
    where ps.rn <= 120
    group by ps.outcome_id
  )
  select
    ct.total_pool as current_total,
    coalesce(at.total_pool, 0)::numeric as anchor_total,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'outcomeId', co.outcome_id,
        'label', co.label,
        'sortOrder', co.sort_order,
        'pool', co.outcome_pool,
        'wagerCount', co.wager_count,
        'shareDelta', case
          when ct.total_pool > 0 then (co.outcome_pool / ct.total_pool) -
            case when coalesce(at.total_pool, 0) > 0 then coalesce(ao.outcome_pool, 0) / at.total_pool else 0 end
          else 0
        end,
        'handleDelta', co.outcome_pool - coalesce(ao.outcome_pool, 0),
        'oddsDelta', coalesce(
          case
            when co.outcome_pool > 0 and ct.total_pool > 0 then ((1 - v_market.takeout) * ct.total_pool) / co.outcome_pool
            else null
          end, 0
        ) - coalesce(
          case
            when coalesce(ao.outcome_pool, 0) > 0 and coalesce(at.total_pool, 0) > 0 then ((1 - coalesce(ao.takeout, v_market.takeout)) * at.total_pool) / coalesce(ao.outcome_pool, 1e-9)
            else null
          end, 0
        ),
        'trend', case
          when ct.total_pool = 0 then 'flat'
          when (co.outcome_pool / ct.total_pool) -
            case when coalesce(at.total_pool, 0) > 0 then coalesce(ao.outcome_pool, 0) / at.total_pool else 0 end > 0.0005 then 'up'
          when (co.outcome_pool / ct.total_pool) -
            case when coalesce(at.total_pool, 0) > 0 then coalesce(ao.outcome_pool, 0) / at.total_pool else 0 end < -0.0005 then 'down'
          else 'flat'
        end,
        'sparkline', coalesce(sp.samples, '[]'::jsonb)
      )
      order by co.sort_order, co.label
    ), '[]'::jsonb),
    max(coalesce(ao.created_at, null))
  into v_current_total, v_anchor_total, v_rows, v_updated_at
  from current_total ct
  left join anchor_total at on true
  left join current_outcomes co on true
  left join anchor_outcomes ao on ao.outcome_id = co.outcome_id
  left join sparkline sp on sp.outcome_id = co.outcome_id;

  return jsonb_build_object(
    'window', v_window,
    'anchorAt', v_anchor_at,
    'updatedAt', coalesce(v_updated_at, now()),
    'takeout', v_market.takeout,
    'totalPool', v_current_total,
    'anchorPool', v_anchor_total,
    'runners', v_rows
  );
end;
$$;

create or replace function public.quote_market_outcome(
  p_market_id uuid,
  p_outcome_id uuid,
  p_stake numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market record;
  v_total numeric := 0;
  v_runner numeric := 0;
  v_stake numeric := greatest(coalesce(p_stake, 0), 0);
  v_takeout numeric := 0.10;
  v_baseline numeric;
  v_effective numeric := 0;
  v_est numeric := 0;
  v_max numeric := 0;
  v_price_impact numeric := 0;
  v_implied numeric := 0;
begin
  if v_stake < 0 then
    raise exception 'Stake must be non-negative';
  end if;

  select id, takeout
  into v_market
  from public.markets
  where id = p_market_id;

  if not found then
    raise exception 'Market not found';
  end if;

  v_takeout := coalesce(v_market.takeout, 0.10);

  select coalesce(sum(case when status = 'accepted' then stake else 0 end), 0)::numeric
  into v_total
  from public.wagers
  where market_id = p_market_id;

  select coalesce(sum(case when status = 'accepted' then stake else 0 end), 0)::numeric
  into v_runner
  from public.wagers
  where outcome_id = p_outcome_id;

  if v_runner > 0 then
    v_baseline := ((1 - v_takeout) * greatest(v_total, 0)) / greatest(v_runner, 1e-9);
  else
    v_baseline := null;
  end if;

  if v_runner + v_stake > 0 then
    v_effective := ((1 - v_takeout) * (v_total + v_stake)) / (v_runner + v_stake);
    v_implied := (v_runner + v_stake) / nullif(v_total + v_stake, 0);
  else
    v_effective := 0;
    v_implied := 0;
  end if;

  v_est := v_stake * v_effective;
  v_max := (1 - v_takeout) * (v_total + v_stake);
  if v_est > v_max then
    v_est := v_max;
  end if;

  if v_baseline is not null and v_baseline > 0 then
    v_price_impact := 1 - (v_effective / v_baseline);
  else
    v_price_impact := 0;
  end if;

  return jsonb_build_object(
    'marketId', p_market_id,
    'outcomeId', p_outcome_id,
    'stake', v_stake,
    'takeout', v_takeout,
    'baselineMultiplier', v_baseline,
    'effectiveMultiplier', v_effective,
    'estPayout', v_est,
    'impliedProb', v_implied,
    'priceImpact', v_price_impact,
    'maxPossiblePayout', v_max
  );
end;
$$;

----------------------------
-- ensure_profile also provisions wallets
----------------------------
create or replace function public.ensure_profile_for_current_user(
  display_name text default null,
  role_hint text default null
) returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_display_name text;
  v_role text;
begin
  if v_user_id is null then
    raise exception 'auth.uid() is required';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id;

  if not found then
    v_display_name := nullif(trim(coalesce(display_name, '')), '');
    if v_display_name is null then
      v_display_name := 'Marshal';
    end if;

    v_role := lower(coalesce(role_hint, 'marshal'));
    if v_role not in ('spectator', 'driver', 'marshal', 'admin') then
      v_role := 'marshal';
    end if;

    if v_role = 'admin' and not public.is_admin() then
      v_role := 'marshal';
    end if;

    insert into public.profiles (id, role, display_name)
    values (v_user_id, v_role, v_display_name)
    returning * into v_profile;
  end if;

  insert into public.wallet_accounts (user_id, balance)
  values (v_user_id, 0)
  on conflict (user_id) do nothing;

  return v_profile;
end;
$$;

grant execute on function public.ensure_profile_for_current_user(text, text) to authenticated;

-- backfill wallets for any existing profiles
insert into public.wallet_accounts (user_id, balance)
select id, 0
from public.profiles
on conflict (user_id) do nothing;
