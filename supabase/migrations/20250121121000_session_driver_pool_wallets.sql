begin;

alter table public.drivers
  add column if not exists team_color text;

create table if not exists public.market_wallets (
  market_id uuid primary key references public.markets(id) on delete cascade,
  balance bigint not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint market_wallets_balance_nonnegative check (balance >= 0)
);

create table if not exists public.market_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.market_wallets(market_id) on delete cascade,
  kind text not null,
  amount bigint not null,
  direction text not null check (direction in ('credit', 'debit')),
  reference_type text,
  reference_id uuid,
  meta jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists market_wallet_transactions_market_idx
  on public.market_wallet_transactions (market_id, created_at desc);

alter table public.market_wallets enable row level security;
alter table public.market_wallet_transactions enable row level security;

drop policy if exists "market_wallets_admin_read" on public.market_wallets;
drop policy if exists "market_wallets_admin_all" on public.market_wallets;
create policy "market_wallets_admin_read"
  on public.market_wallets
  for select
  using (public.is_admin());
create policy "market_wallets_admin_all"
  on public.market_wallets
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "market_wallet_transactions_admin_read" on public.market_wallet_transactions;
drop policy if exists "market_wallet_transactions_admin_all" on public.market_wallet_transactions;
create policy "market_wallet_transactions_admin_read"
  on public.market_wallet_transactions
  for select
  using (public.is_admin());
create policy "market_wallet_transactions_admin_all"
  on public.market_wallet_transactions
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.market_wallets to authenticated;
grant select on public.market_wallet_transactions to authenticated;

drop function if exists public.adjust_market_wallet(uuid, bigint, text, text, text, uuid, jsonb);
create or replace function public.adjust_market_wallet(
  p_market_id uuid,
  p_amount bigint,
  p_kind text,
  p_direction text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_meta jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_effect bigint;
  v_direction text := lower(coalesce(p_direction, ''));
  v_kind text := lower(coalesce(nullif(trim(coalesce(p_kind, '')), ''), 'adjustment'));
begin
  if p_market_id is null then
    raise exception 'market id is required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than zero';
  end if;

  if v_direction not in ('credit', 'debit') then
    raise exception 'Invalid market wallet direction: %', p_direction;
  end if;

  v_effect := case when v_direction = 'credit' then p_amount else -p_amount end;

  insert into public.market_wallets (market_id, balance, updated_at)
  values (p_market_id, v_effect, timezone('utc', now()))
  on conflict (market_id)
  do update set
    balance = public.market_wallets.balance + v_effect,
    updated_at = excluded.updated_at;

  insert into public.market_wallet_transactions (
    market_id,
    kind,
    amount,
    direction,
    reference_type,
    reference_id,
    meta
  ) values (
    p_market_id,
    v_kind,
    v_effect,
    v_direction,
    p_reference_type,
    p_reference_id,
    coalesce(p_meta, '{}'::jsonb)
  );
end;
$$;

grant execute on function public.adjust_market_wallet(uuid, bigint, text, text, text, uuid, jsonb) to authenticated;

insert into public.market_wallets (market_id, balance)
select m.id, 0
from public.markets m
on conflict (market_id) do nothing;

with current_balances as (
  select market_id, coalesce(sum(stake) filter (where status in ('pending', 'accepted')), 0)::bigint as total_locked
  from public.wagers
  group by market_id
)
update public.market_wallets mw
set balance = coalesce(cb.total_locked, 0),
    updated_at = timezone('utc', now())
from current_balances cb
where mw.market_id = cb.market_id;

create or replace function public.admin_create_market(
  p_session_id uuid,
  p_market_name text,
  p_outcomes jsonb,
  p_rake_bps int default 500,
  p_closes_at timestamptz default null,
  p_market_type text default 'parimutuel',
  p_takeout numeric default null,
  p_requires_approval boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_name text;
  v_event_id uuid;
  v_market_id uuid;
  v_created_outcomes jsonb := '[]'::jsonb;
  v_market record;
  v_now timestamptz := now();
  v_outcome record;
  v_color text;
  v_driver uuid;
  v_label text;
  v_sort_order int;
  v_driver_session_id uuid;
  v_takeout numeric(5,4);
  v_requires_approval boolean;
BEGIN
  if not is_admin() then
    raise exception 'Only admins may create markets.' using errcode = '42501';
  end if;

  if p_session_id is null then
    raise exception 'A session is required to create a market.';
  end if;

  if coalesce(trim(p_market_name), '') = '' then
    raise exception 'Market name is required.';
  end if;

  if p_rake_bps is null then
    p_rake_bps := 500;
  end if;

  if p_rake_bps < 0 or p_rake_bps > 2000 then
    raise exception 'Rake must be between 0 and 2000 basis points.';
  end if;

  if p_closes_at is not null and p_closes_at <= v_now then
    raise exception 'Close time must be in the future.';
  end if;

  if p_outcomes is null or jsonb_typeof(p_outcomes) <> 'array' or jsonb_array_length(p_outcomes) = 0 then
    raise exception 'At least one outcome is required.';
  end if;

  select name into v_session_name from public.sessions where id = p_session_id;
  if v_session_name is null then
    raise exception 'Session not found.';
  end if;

  select id into v_event_id
  from public.events
  where session_id = p_session_id
  limit 1;

  if v_event_id is null then
    insert into public.events (title, status, session_id)
    values (v_session_name, 'upcoming', p_session_id)
    returning id into v_event_id;
  end if;

  v_takeout := coalesce(p_takeout, greatest(0, least(0.25, p_rake_bps / 10000.0)));
  v_requires_approval := coalesce(p_requires_approval, true);

  insert into public.markets (event_id, name, type, rake_bps, status, closes_at, takeout, requires_approval)
  values (
    v_event_id,
    p_market_name,
    coalesce(nullif(trim(p_market_type), ''), 'parimutuel'),
    p_rake_bps,
    'open',
    p_closes_at,
    v_takeout,
    v_requires_approval
  )
  returning * into v_market;

  insert into public.market_wallets (market_id, balance)
  values (v_market.id, 0)
  on conflict (market_id) do nothing;

  for v_outcome in
    select value, ordinality as idx
    from jsonb_array_elements(p_outcomes) with ordinality
  loop
    v_label := coalesce(trim(v_outcome.value->>'label'), '');
    if v_label = '' then
      raise exception 'Each outcome must include a label.';
    end if;

    v_color := nullif(trim(v_outcome.value->>'color'), '');
    if v_color is not null and length(v_color) > 64 then
      raise exception 'Outcome color values must be 64 characters or less.';
    end if;

    v_driver := null;
    if v_outcome.value ? 'driver_id' then
      begin
        v_driver := (v_outcome.value->>'driver_id')::uuid;
      exception when others then
        raise exception 'Outcome driver_id must be a valid UUID.';
      end;
      if v_driver is not null then
        select session_id into v_driver_session_id from public.drivers where id = v_driver;
        if v_driver_session_id is null or v_driver_session_id <> p_session_id then
          raise exception 'Driver % does not belong to the selected session.', v_driver;
        end if;
      end if;
    end if;

    v_sort_order := coalesce((v_outcome.value->>'sort_order')::int, v_outcome.idx::int - 1);

    insert into public.outcomes (market_id, label, sort_order, color, driver_id)
    values (v_market.id, v_label, greatest(0, v_sort_order), v_color, v_driver)
    returning id, label, sort_order, color, driver_id into v_outcome;

    v_created_outcomes := coalesce(v_created_outcomes, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'id', v_outcome.id,
        'label', v_outcome.label,
        'sort_order', v_outcome.sort_order,
        'color', v_outcome.color,
        'driver_id', v_outcome.driver_id
      )
    );
  end loop;

  perform public.log_admin_action('create_market', v_market.id, jsonb_build_object('session_id', p_session_id));

  return jsonb_build_object(
    'success', true,
    'market_id', v_market.id,
    'event_id', v_market.event_id,
    'market', row_to_json(v_market),
    'outcomes', v_created_outcomes
  );
END;
$$;

create or replace function public.create_session_atomic(p_session jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid;
  v_creator_id uuid := auth.uid();
  v_driver record;
  v_event_type text;
  v_total_laps integer;
  v_total_duration integer;
begin
  if v_creator_id is null then
    raise exception 'auth.uid() is required to create a session';
  end if;

  insert into public.sessions (name, status, starts_at, created_by)
  values (
    coalesce(nullif(trim(p_session->>'name'), ''), 'Session'),
    coalesce(nullif(trim(p_session->>'status'), ''), 'draft'),
    nullif(p_session->>'starts_at', '')::timestamptz,
    v_creator_id
  )
  returning id into v_session_id;

  insert into public.session_members (session_id, user_id, role)
  values (v_session_id, v_creator_id, 'owner'::session_member_role)
  on conflict (session_id, user_id)
  do update set role = excluded.role, inserted_at = timezone('utc', now());

  insert into public.session_members (session_id, user_id, role)
  select v_session_id,
         (member->>'user_id')::uuid,
         coalesce(nullif(member->>'role', ''), 'marshal')::session_member_role
  from jsonb_array_elements(coalesce(p_session->'members', '[]'::jsonb)) as member
  where nullif(member->>'user_id', '') is not null
  on conflict (session_id, user_id)
  do update set role = excluded.role, inserted_at = timezone('utc', now());

  v_event_type := coalesce(nullif(trim(p_session->>'event_type'), ''), 'race');
  v_total_laps := coalesce((p_session->>'total_laps')::integer, 50);
  v_total_duration := coalesce((p_session->>'total_duration')::integer, 60);

  if exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'session_state'
  ) then
    insert into public.session_state (id, session_id, event_type, total_laps, total_duration)
    values (v_session_id, v_session_id, v_event_type, v_total_laps, v_total_duration)
    on conflict (session_id)
    do update set
      event_type = excluded.event_type,
      total_laps = excluded.total_laps,
      total_duration = excluded.total_duration;
  end if;

  if jsonb_typeof(p_session->'drivers') = 'array' then
    for v_driver in
      select
        coalesce((driver->>'id')::uuid, gen_random_uuid()) as id,
        (driver->>'number')::integer as number,
        coalesce(nullif(trim(driver->>'name'), ''), 'Driver') as name,
        nullif(trim(driver->>'team'), '') as team,
        coalesce(
          nullif(trim(driver->>'team_color'), ''),
          nullif(trim(driver->>'teamColor'), ''),
          nullif(trim(driver->>'team_colour'), ''),
          nullif(trim(driver->>'teamColour'), ''),
          nullif(trim(driver->>'color'), '')
        ) as team_color
      from jsonb_array_elements(p_session->'drivers') as driver
    loop
      if exists (
        select 1 from information_schema.tables where table_schema = 'public' and table_name = 'drivers'
      ) then
        insert into public.drivers (
          id, session_id, number, name, team, team_color,
          laps, last_lap_ms, best_lap_ms, pits,
          status, driver_flag, pit_complete, total_time_ms
        )
        values (
          v_driver.id, v_session_id, v_driver.number, v_driver.name, v_driver.team, v_driver.team_color,
          0, null, null, 0,
          'ready', 'none', false, 0
        )
        on conflict (id)
        do update set
          session_id = excluded.session_id,
          number = excluded.number,
          name = excluded.name,
          team = excluded.team,
          team_color = excluded.team_color;
      end if;
    end loop;
  end if;

  return v_session_id;
end;
$$;

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
set search_path = public, pg_temp
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

  perform public.adjust_market_wallet(
    p_market_id,
    p_stake,
    'wager_in',
    'credit',
    'wager',
    v_wager_id,
    jsonb_build_object(
      'user_id', v_user_id,
      'outcome_id', p_outcome_id,
      'status', v_status
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
  v_wager record;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select w.*
    into v_wager
  from public.wagers w
  where w.id = p_wager_id
  for update;

  if v_wager.id is null then
    raise exception 'Wager not found';
  end if;

  if v_wager.status <> 'pending' then
    raise exception 'Wager is not pending approval';
  end if;

  insert into public.wallet_accounts (user_id, balance)
  values (v_wager.user_id, v_wager.stake)
  on conflict (user_id)
  do update set balance = public.wallet_accounts.balance + v_wager.stake,
               updated_at = timezone('utc', now());

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
    'wager_refund',
    v_wager.stake,
    'credit',
    'wager',
    p_wager_id,
    jsonb_build_object(
      'market_id', v_wager.market_id,
      'outcome_id', v_wager.outcome_id,
      'reason', coalesce(nullif(p_reason, ''), 'rejected')
    )
  );

  perform public.adjust_market_wallet(
    v_wager.market_id,
    v_wager.stake,
    'wager_refund',
    'debit',
    'wager',
    p_wager_id,
    jsonb_build_object('reason', coalesce(nullif(p_reason, ''), 'rejected'))
  );

  update public.wagers
  set status = 'rejected',
      rejected_reason = nullif(p_reason, ''),
      approved_by = auth.uid(),
      approved_at = timezone('utc', now())
  where id = p_wager_id;

  return jsonb_build_object(
    'success', true,
    'wagerId', p_wager_id,
    'status', 'rejected',
    'refunded', v_wager.stake
  );
end;
$$;

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

        perform public.adjust_market_wallet(
          p_market_id,
          v_wager.stake,
          'wager_refund',
          'debit',
          'wager',
          v_wager.id,
          jsonb_build_object('reason', 'no_winners')
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
      perform public.adjust_market_wallet(
        p_market_id,
        v_total_pool,
        'takeout',
        'debit',
        'market',
        p_market_id,
        jsonb_build_object('reason', 'house_wins_no_winners')
      );
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

    perform public.adjust_market_wallet(
      p_market_id,
      v_payout,
      'payout',
      'debit',
      'wager',
      v_wager.id,
      jsonb_build_object('outcome_id', p_winning_outcome_id)
    );

    update public.wagers set status = 'won' where id = v_wager.id;

    v_total_paid := v_total_paid + v_payout;
    v_winners_count := v_winners_count + 1;
  end loop;

  v_dust := v_net_pool - v_total_paid;

  if v_rake_amount > 0 then
    perform public.adjust_market_wallet(
      p_market_id,
      v_rake_amount,
      'takeout',
      'debit',
      'market',
      p_market_id,
      jsonb_build_object('reason', 'rake')
    );
  end if;

  if v_dust > 0 then
    perform public.adjust_market_wallet(
      p_market_id,
      v_dust,
      'adjustment',
      'debit',
      'market',
      p_market_id,
      jsonb_build_object('reason', 'rounding_dust')
    );
  end if;

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

commit;
