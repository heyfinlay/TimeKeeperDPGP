-- Diamond Sports Book wallet and markets schema
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  venue text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'upcoming',
  session_id uuid references public.sessions(id) on delete set null
);

create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  type text not null,
  rake_bps int not null default 500,
  takeout numeric(5,4) not null default 0.10,
  status text not null default 'open',
  requires_approval boolean not null default true,
  closes_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.outcomes (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  label text not null,
  sort_order int not null default 0,
  color text,
  driver_id uuid references public.drivers(id) on delete set null
);

create table if not exists public.wallet_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  amount bigint not null,
  direction text not null default 'debit',
  meta jsonb,
  created_at timestamptz not null default now(),
  constraint wallet_transactions_direction_check
    check (direction in ('debit', 'credit')),
  constraint wallet_transactions_amount_direction_check
    check (
      (direction = 'debit' and amount <= 0)
      or (direction = 'credit' and amount >= 0)
    )
);

create or replace function public.wallet_transactions_enforce_direction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction not in ('debit', 'credit') then
    raise exception 'Invalid transaction direction: %', new.direction;
  end if;

  if new.direction = 'debit' and new.amount > 0 then
    raise exception 'Debit transactions must have a non-positive amount';
  end if;

  if new.direction = 'credit' and new.amount < 0 then
    raise exception 'Credit transactions must have a non-negative amount';
  end if;

  return new;
end;
$$;

create trigger wallet_transactions_enforce_direction
  before insert or update on public.wallet_transactions
  for each row
  execute function public.wallet_transactions_enforce_direction();

create table if not exists public.wagers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  market_id uuid not null references public.markets(id) on delete cascade,
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  stake bigint not null check (stake > 0),
  price_impact_pp numeric(10,4),
  odds_before numeric(12,6),
  odds_after numeric(12,6),
  placed_at timestamptz not null default now(),
  status text not null default 'pending',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejected_reason text,
  settled_at timestamptz,
  payout_amount bigint not null default 0
);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount > 0),
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount > 0),
  ic_phone_number text,
  reference_code text,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

create table if not exists public.pending_settlements (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  proposed_outcome_id uuid not null references public.outcomes(id) on delete cascade,
  proposed_by uuid references auth.users(id) on delete set null,
  timing_data jsonb,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  rejection_reason text
);

create index if not exists pending_settlements_market_idx
  on public.pending_settlements (market_id, status);

create index if not exists pending_settlements_session_idx
  on public.pending_settlements (session_id);

create unique index if not exists pending_settlements_unique_pending
  on public.pending_settlements (market_id)
  where status = 'pending';

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
  (select count(*) from public.wagers w where w.market_id = m.id and w.status = 'pending') as total_wagers,
  (select coalesce(sum(stake), 0) from public.wagers w where w.market_id = m.id) as total_pool,
  (
    select coalesce(sum(stake), 0)
    from public.wagers w
    where w.market_id = m.id
      and w.outcome_id = o.id
  ) as winning_pool
from public.pending_settlements ps
join public.markets m on m.id = ps.market_id
join public.outcomes o on o.id = ps.proposed_outcome_id
left join public.drivers d on d.id = o.driver_id
left join public.sessions s on s.id = ps.session_id
left join public.profiles proposer on proposer.id = ps.proposed_by
left join public.profiles reviewer on reviewer.id = ps.reviewed_by;

grant select on public.pending_settlements_with_context to authenticated;

alter table public.pending_settlements enable row level security;

create policy "Admins view pending settlements"
  on public.pending_settlements
  for select
  using (public.is_admin());

create policy "Admins insert pending settlements"
  on public.pending_settlements
  for insert
  with check (public.is_admin());

create policy "Admins update pending settlements"
  on public.pending_settlements
  for update
  using (public.is_admin());

alter table public.markets
  add constraint markets_takeout_check check (takeout >= 0 and takeout <= 0.25);

create index if not exists markets_event_id_idx on public.markets (event_id);
create index if not exists outcomes_market_id_idx on public.outcomes (market_id);
create index if not exists events_session_id_idx on public.events (session_id);
create index if not exists outcomes_driver_id_idx on public.outcomes (driver_id);
create index if not exists wagers_user_id_idx on public.wagers (user_id);
create index if not exists wagers_market_id_idx on public.wagers (market_id);
create index if not exists wallet_transactions_user_id_idx on public.wallet_transactions (user_id);
create index if not exists deposits_user_id_idx on public.deposits (user_id);

-- Ensure realtime publications include tables
DO
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
;

DO
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.markets;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
;

DO
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.outcomes;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
;

DO
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_accounts;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
;

DO
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.wagers;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
;

DO
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
;

DO
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.withdrawals;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
;

DO
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.deposits;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
;

-- Determine whether the current user is an admin solely from their profile row
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and p.role = 'admin'
  );
end;
$$;

-- Admin market creation helper
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

grant execute on function public.admin_create_market(uuid, text, jsonb, int, timestamptz, text, numeric, boolean) to authenticated;

-- Tote v2 historical snapshots and quote telemetry
create table if not exists public.pool_snapshots (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  total_pool numeric not null,
  outcome_pool numeric not null,
  takeout numeric(5,4) not null,
  created_at timestamptz not null default now()
);

create index if not exists pool_snapshots_market_outcome_created_idx
  on public.pool_snapshots (market_id, outcome_id, created_at desc);

create index if not exists pool_snapshots_market_created_idx
  on public.pool_snapshots (market_id, created_at desc);

create materialized view if not exists public.pool_snapshots_1m as
select
  market_id,
  outcome_id,
  date_trunc('minute', created_at) as minute_bucket,
  avg(total_pool) as avg_total_pool,
  avg(outcome_pool) as avg_outcome_pool,
  avg(takeout) as avg_takeout,
  max(created_at) as last_created_at
from public.pool_snapshots
group by market_id, outcome_id, date_trunc('minute', created_at);

create unique index if not exists pool_snapshots_1m_unique
  on public.pool_snapshots_1m (market_id, outcome_id, minute_bucket);

create or replace view public.market_pools as
select
  m.id as market_id,
  coalesce(sum(case when w.status = 'pending' then w.stake else 0 end), 0)::numeric as total_pool,
  count(*) filter (where w.status = 'pending')::bigint as total_wagers,
  count(distinct w.user_id) filter (where w.status = 'pending')::bigint as unique_bettors,
  m.takeout
from public.markets m
left join public.wagers w on w.market_id = m.id
where m.status in ('open', 'suspended', 'closing')
group by m.id;

create or replace view public.outcome_pools as
select
  o.id as outcome_id,
  o.market_id,
  coalesce(sum(case when w.status = 'pending' then w.stake else 0 end), 0)::numeric as total_staked,
  count(*) filter (where w.status = 'pending')::bigint as wager_count
from public.outcomes o
left join public.wagers w on w.outcome_id = o.id
where o.market_id is not null
group by o.id, o.market_id;

create or replace function public.refresh_pool_snapshots_1m()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.pool_snapshots_1m;
end;
$$;

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
    select market_id, sum(case when status = 'pending' then stake else 0 end)::numeric as total_pool
    from public.wagers
    group by market_id
  ),
  outcome_totals as (
    select outcome_id, sum(case when status = 'pending' then stake else 0 end)::numeric as outcome_pool
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

  select coalesce(sum(case when status = 'pending' then stake else 0 end), 0)::numeric
  into v_total
  from public.wagers
  where market_id = p_market_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'outcomeId', o.id,
      'label', o.label,
      'sortOrder', o.sort_order,
      'pool', coalesce(sum(case when w.status = 'pending' then w.stake else 0 end), 0)::numeric,
      'wagerCount', count(*) filter (where w.status = 'pending')::bigint
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
      coalesce(sum(case when w.status = 'pending' then w.stake else 0 end), 0)::numeric as outcome_pool,
      count(*) filter (where w.status = 'pending')::bigint as wager_count,
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
          'share', case when ps.total_pool > 0 then ps.outcome_pool / ps.total_pool else 0 end
        )
        order by ps.created_at desc
      )
      filter (where ps.outcome_id is not null) as samples
    from public.pool_snapshots ps
    where ps.market_id = p_market_id
      and ps.created_at >= now() - interval '15 minutes'
    group by ps.outcome_id
  )
  select
    ct.total_pool,
    coalesce(at.total_pool, 0) as anchor_pool,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'outcomeId', co.outcome_id,
        'label', co.label,
        'current', jsonb_build_object(
          'pool', co.outcome_pool,
          'share', case when ct.total_pool > 0 then co.outcome_pool / ct.total_pool else 0 end,
          'odds', case
            when co.outcome_pool > 0 and ct.total_pool > 0
              then ((1 - v_market.takeout) * ct.total_pool) / co.outcome_pool
            else null
          end,
          'wagerCount', co.wager_count
        ),
        'anchor', jsonb_build_object(
          'pool', coalesce(ao.outcome_pool, 0),
          'share', case when coalesce(at.total_pool, 0) > 0 then coalesce(ao.outcome_pool, 0) / at.total_pool else 0 end,
          'odds', case
            when coalesce(ao.outcome_pool, 0) > 0 and coalesce(at.total_pool, 0) > 0
              then ((1 - coalesce(ao.takeout, v_market.takeout)) * at.total_pool) / coalesce(ao.outcome_pool, 1e-9)
            else null
          end,
          'timestamp', ao.created_at
        ),
        'delta', jsonb_build_object(
          'share', case
            when ct.total_pool > 0 then (co.outcome_pool / ct.total_pool) -
              case when coalesce(at.total_pool, 0) > 0 then coalesce(ao.outcome_pool, 0) / at.total_pool else 0 end
            else 0
          end,
          'handle', co.outcome_pool - coalesce(ao.outcome_pool, 0),
          'odds', coalesce(
            case
              when co.outcome_pool > 0 and ct.total_pool > 0
                then ((1 - v_market.takeout) * ct.total_pool) / co.outcome_pool
              else null
            end, 0
          ) - coalesce(
            case
              when coalesce(ao.outcome_pool, 0) > 0 and coalesce(at.total_pool, 0) > 0
                then ((1 - coalesce(ao.takeout, v_market.takeout)) * at.total_pool) / coalesce(ao.outcome_pool, 1e-9)
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
          end
        ),
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

  select coalesce(sum(case when status = 'pending' then stake else 0 end), 0)::numeric
  into v_total
  from public.wagers
  where market_id = p_market_id;

  select coalesce(sum(case when status = 'pending' then stake else 0 end), 0)::numeric
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

create table if not exists public.quote_telemetry (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  stake numeric not null,
  baseline_multiplier numeric,
  effective_multiplier numeric,
  price_impact numeric,
  created_at timestamptz not null default now(),
  meta jsonb
);

create index if not exists quote_telemetry_market_idx
  on public.quote_telemetry (market_id, outcome_id, created_at desc);

create or replace function public.log_quote_telemetry(
  p_market_id uuid,
  p_outcome_id uuid,
  p_stake numeric,
  p_baseline numeric,
  p_effective numeric,
  p_price_impact numeric,
  p_sample_rate numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_should_sample boolean := true;
  v_sample_rate numeric := coalesce(nullif(p_sample_rate, 0), 1.0);
  v_payload jsonb;
begin
  if v_sample_rate < 1 then
    v_should_sample := (random() <= v_sample_rate);
  end if;

  if not v_should_sample then
    return jsonb_build_object('sampled', false);
  end if;

  insert into public.quote_telemetry (market_id, outcome_id, stake, baseline_multiplier, effective_multiplier, price_impact, meta)
  values (
    p_market_id,
    p_outcome_id,
    greatest(coalesce(p_stake, 0), 0),
    p_baseline,
    p_effective,
    p_price_impact,
    jsonb_build_object('sample_rate', v_sample_rate)
  )
  returning jsonb_build_object('id', id, 'createdAt', created_at) into v_payload;

  return jsonb_build_object('sampled', true, 'telemetry', v_payload);
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

  select
    coalesce(sum(stake), 0),
    coalesce(sum(case when outcome_id = p_winning_outcome_id then stake else 0 end), 0)
  into v_total_pool, v_winning_pool
  from public.wagers
  where market_id = p_market_id
    and status = 'pending'
  for update;

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

grant execute on function public.refresh_pool_snapshots_1m() to authenticated;
grant execute on function public.snapshot_market_pools(uuid) to authenticated;
grant execute on function public.get_market_summary(uuid) to authenticated;
grant execute on function public.get_market_history(uuid, text) to authenticated;
grant execute on function public.quote_market_outcome(uuid, uuid, numeric) to authenticated;
grant execute on function public.log_quote_telemetry(uuid, uuid, numeric, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.settle_market(uuid, uuid, text) to authenticated;

create or replace function public.propose_settlement(
  p_market_id uuid,
  p_proposed_outcome_id uuid,
  p_timing_data jsonb default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settlement_id uuid;
  v_market_status text;
  v_session_id uuid;
  v_outcome_exists boolean;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select status into v_market_status from public.markets where id = p_market_id;
  if v_market_status is null then
    raise exception 'Market % not found', p_market_id;
  end if;

  if v_market_status = 'open' then
    raise exception 'Close market % before proposing a settlement', p_market_id;
  end if;

  if v_market_status = 'settled' then
    raise exception 'Market % is already settled', p_market_id;
  end if;

  select e.session_id
    into v_session_id
  from public.markets m
  join public.events e on e.id = m.event_id
  where m.id = p_market_id;

  select exists(
    select 1
    from public.outcomes
    where id = p_proposed_outcome_id
      and market_id = p_market_id
  ) into v_outcome_exists;

  if not v_outcome_exists then
    raise exception 'Outcome % does not belong to market %', p_proposed_outcome_id, p_market_id;
  end if;

  if exists (
    select 1
    from public.pending_settlements
    where market_id = p_market_id
      and status = 'pending'
  ) then
    raise exception 'Market % already has a pending settlement', p_market_id;
  end if;

  insert into public.pending_settlements (
    market_id,
    session_id,
    proposed_outcome_id,
    proposed_by,
    timing_data,
    notes,
    status
  )
  values (
    p_market_id,
    v_session_id,
    p_proposed_outcome_id,
    auth.uid(),
    p_timing_data,
    p_notes,
    'pending'
  )
  returning id into v_settlement_id;

  return v_settlement_id;
end;
$$;

create or replace function public.approve_settlement(
  p_settlement_id uuid,
  p_payout_policy text default 'refund_if_empty'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settlement record;
  v_market_status text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select * into v_settlement
  from public.pending_settlements
  where id = p_settlement_id
  for update;

  if v_settlement.id is null then
    raise exception 'Settlement % not found', p_settlement_id;
  end if;

  if v_settlement.status <> 'pending' then
    raise exception 'Settlement % is not pending (status: %)', p_settlement_id, v_settlement.status;
  end if;

  select status into v_market_status
  from public.markets
  where id = v_settlement.market_id;

  if v_market_status is null then
    raise exception 'Market % not found', v_settlement.market_id;
  end if;

  if v_market_status = 'open' then
    update public.markets
       set status = 'closed'
     where id = v_settlement.market_id;
  end if;

  perform public.settle_market(
    v_settlement.market_id,
    v_settlement.proposed_outcome_id,
    p_payout_policy
  );

  update public.pending_settlements
     set status = 'approved',
         reviewed_at = timezone('utc', now()),
         reviewed_by = auth.uid()
   where id = p_settlement_id;

  return jsonb_build_object(
    'settlement_id', p_settlement_id,
    'market_id', v_settlement.market_id,
    'outcome_id', v_settlement.proposed_outcome_id,
    'approved_by', auth.uid(),
    'approved_at', timezone('utc', now())
  );
end;
$$;

create or replace function public.reject_settlement(
  p_settlement_id uuid,
  p_rejection_reason text default null
)
returns void
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
  from public.pending_settlements
  where id = p_settlement_id
  for update;

  if v_status is null then
    raise exception 'Settlement % not found', p_settlement_id;
  end if;

  if v_status <> 'pending' then
    raise exception 'Settlement % is not pending (status: %)', p_settlement_id, v_status;
  end if;

  update public.pending_settlements
     set status = 'rejected',
         reviewed_at = timezone('utc', now()),
         reviewed_by = auth.uid(),
         rejection_reason = nullif(p_rejection_reason, '')
   where id = p_settlement_id;
end;
$$;

drop function if exists public.validate_settlement_approval(uuid, uuid);
create function public.validate_settlement_approval(
  p_market_id uuid,
  p_outcome_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requires_approval boolean;
begin
  select requires_approval into v_requires_approval
  from public.markets
  where id = p_market_id;

  if v_requires_approval is null then
    raise exception 'Market % not found', p_market_id;
  end if;

  if not v_requires_approval then
    return true;
  end if;

  return exists (
    select 1
    from public.pending_settlements
    where market_id = p_market_id
      and proposed_outcome_id = p_outcome_id
      and status = 'approved'
  );
end;
$$;

drop function if exists public.settle_market_with_approval(uuid, uuid, text);
create function public.settle_market_with_approval(
  p_market_id uuid,
  p_outcome_id uuid,
  p_payout_policy text default 'refund_if_empty'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if not public.validate_settlement_approval(p_market_id, p_outcome_id) then
    raise exception 'Settlement not approved. Use propose_settlement() and approve_settlement() before settling this market.';
  end if;

  return public.settle_market(p_market_id, p_outcome_id, p_payout_policy);
end;
$$;

grant execute on function public.propose_settlement(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.approve_settlement(uuid, text) to authenticated;
grant execute on function public.reject_settlement(uuid, text) to authenticated;
grant execute on function public.settle_market_with_approval(uuid, uuid, text) to authenticated;
comment on function public.propose_settlement is 'Create a pending settlement that requires admin approval';
comment on function public.approve_settlement is 'Approve and execute a pending settlement';
comment on function public.reject_settlement is 'Reject a pending settlement with an optional reason';
comment on function public.settle_market_with_approval is 'Wrapper enforcing pending settlement approval before executing payouts';

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
set search_path = public, pg_temp
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

revoke all on function public.admin_list_pending_wagers(uuid) from public;
grant execute on function public.admin_list_pending_wagers(uuid) to authenticated, service_role;
comment on function public.admin_list_pending_wagers is 'Admin RPC returning pending wagers (optional market filter).';

create or replace function public.admin_list_pending_wagers()
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
language sql
security definer
set search_path = public, pg_temp
as $$
  select *
  from public.admin_list_pending_wagers(null::uuid);
$$;

revoke all on function public.admin_list_pending_wagers() from public;
grant execute on function public.admin_list_pending_wagers() to authenticated, service_role;
comment on function public.admin_list_pending_wagers() is 'Admin RPC returning pending wagers (no-arg overload).';

----------------------------
-- update_session_state_atomic
----------------------------
create or replace function public.update_session_state_atomic_core(
  p_session_id uuid,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_state public.session_state%rowtype;
  v_updated public.session_state%rowtype;
  v_actor uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_allowed_phases text[] := array['setup','warmup','grid','race','finished'];
  v_current_idx int;
  v_next_idx int;
  v_next_phase text := null;
  v_track_status text := null;
  v_flag_status text := null;
  v_total_laps integer := null;
  v_total_duration integer := null;
  v_race_time bigint := null;
  v_is_timing boolean := null;
  v_is_paused boolean := null;
  v_race_started_at timestamptz := null;
  v_pause_started_at timestamptz := null;
  v_accumulated_pause_ms bigint := null;
  v_pause_delta bigint := 0;
  v_command text := lower(coalesce(v_patch->>'command', ''));
  v_event_message text := null;
  v_session_owner uuid;
  v_is_member boolean := false;
begin
  if p_session_id is null then
    raise exception 'Session id is required';
  end if;

  select s.created_by
    into v_session_owner
  from public.sessions s
  where s.id = p_session_id;

  if not found then
    raise exception 'Session not found for %', p_session_id;
  end if;

  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  select true
    into v_is_member
  from public.session_members sm
  where sm.session_id = p_session_id
    and sm.user_id = v_actor
  limit 1;

  if not (public.is_admin() or v_session_owner = v_actor or coalesce(v_is_member, false)) then
    raise exception 'no access';
  end if;

  select * into v_state
  from public.session_state
  where session_id = p_session_id
  for update;

  if not found then
    raise exception 'Session state not found for %', p_session_id;
  end if;

  v_current_idx := coalesce(array_position(v_allowed_phases, coalesce(v_state.procedure_phase, 'setup')), 1);

  if v_patch ? 'procedure_phase' then
    v_next_phase := lower(nullif(v_patch->>'procedure_phase', ''));
    if v_next_phase is not null then
      v_next_idx := array_position(v_allowed_phases, v_next_phase);
      if v_next_idx is null then
        raise exception 'Invalid procedure phase %', v_next_phase;
      end if;
      if abs(v_next_idx - v_current_idx) > 1 then
        raise exception 'Invalid phase transition from % to %', v_state.procedure_phase, v_next_phase;
      end if;
    end if;
  end if;

  if v_patch ? 'track_status' then
    v_track_status := lower(nullif(v_patch->>'track_status', ''));
    if v_track_status not in ('green','yellow','vsc','sc','red','checkered') then
      raise exception 'Invalid track status %', v_track_status;
    end if;
  end if;

  if v_patch ? 'flag_status' then
    v_flag_status := lower(nullif(v_patch->>'flag_status', ''));
  end if;

  if v_track_status is not null and v_flag_status is null then
    v_flag_status := v_track_status;
  end if;

  v_total_laps := nullif(v_patch->>'total_laps', '')::int;
  v_total_duration := nullif(v_patch->>'total_duration', '')::int;
  v_race_time := nullif(v_patch->>'race_time_ms', '')::bigint;

  if v_command = 'start_clock' then
    if v_state.is_timing then
      raise exception 'Race clock already running';
    end if;
    v_is_timing := true;
    v_is_paused := false;
    v_race_started_at := v_now;
    v_pause_started_at := null;
    v_accumulated_pause_ms := 0;
    if v_next_phase is null then
      v_next_phase := 'race';
    end if;
    if v_track_status is null then
      v_track_status := 'green';
      v_flag_status := 'green';
    end if;
    v_event_message := 'Race timer started';
  elsif v_command = 'pause_clock' then
    if not v_state.is_timing or v_state.is_paused then
      raise exception 'Race clock is not running';
    end if;
    v_is_paused := true;
    v_pause_started_at := v_now;
    v_event_message := 'Race paused';
  elsif v_command = 'resume_clock' then
    if not v_state.is_timing or not v_state.is_paused then
      raise exception 'Race clock is not paused';
    end if;
    if v_state.pause_started_at is not null then
      v_pause_delta := greatest(0, (extract(epoch from (v_now - v_state.pause_started_at)) * 1000)::bigint);
    end if;
    v_accumulated_pause_ms := coalesce(v_state.accumulated_pause_ms, 0) + v_pause_delta;
    v_is_paused := false;
    v_pause_started_at := null;
    v_event_message := 'Race resumed';
  elsif v_command = 'finish_session' then
    v_is_timing := false;
    v_is_paused := false;
    v_pause_started_at := null;
    v_accumulated_pause_ms := coalesce(v_state.accumulated_pause_ms, 0);
    v_next_phase := coalesce(v_next_phase, 'finished');
    v_track_status := coalesce(v_track_status, 'checkered');
    v_flag_status := coalesce(v_flag_status, 'checkered');
    v_event_message := 'Session finished';
  elsif v_command = 'reset_session' then
    v_is_timing := false;
    v_is_paused := false;
    v_pause_started_at := null;
    v_accumulated_pause_ms := 0;
    v_race_started_at := null;
    v_next_phase := coalesce(v_next_phase, 'setup');
    v_track_status := coalesce(v_track_status, 'green');
    v_flag_status := coalesce(v_flag_status, 'green');
    v_event_message := 'Session reset';
  end if;

  update public.session_state
     set procedure_phase = coalesce(v_next_phase, procedure_phase),
         track_status = coalesce(v_track_status, track_status),
         flag_status = coalesce(v_flag_status, flag_status),
         announcement = coalesce(v_patch->>'announcement', announcement),
         total_laps = coalesce(v_total_laps, total_laps),
         total_duration = coalesce(v_total_duration, total_duration),
         race_time_ms = coalesce(v_race_time, race_time_ms),
         is_timing = coalesce(v_is_timing, is_timing),
         is_paused = coalesce(v_is_paused, is_paused),
         race_started_at = coalesce(v_race_started_at, race_started_at),
         pause_started_at = coalesce(v_pause_started_at, pause_started_at),
         accumulated_pause_ms = coalesce(v_accumulated_pause_ms, accumulated_pause_ms)
   where session_id = p_session_id
   returning * into v_updated;

  if v_updated.procedure_phase is distinct from v_state.procedure_phase then
    insert into public.control_logs (session_id, action, payload, actor)
    values (
      p_session_id,
      'phase_changed',
      jsonb_build_object('from', v_state.procedure_phase, 'to', v_updated.procedure_phase),
      v_actor
    );
    insert into public.race_events (session_id, message)
    values (
      p_session_id,
      format('Phase → %s', upper(coalesce(v_updated.procedure_phase, 'unknown')))
    );
  end if;

  if v_updated.track_status is distinct from v_state.track_status then
    insert into public.control_logs (session_id, action, payload, actor)
    values (
      p_session_id,
      'track_status',
      jsonb_build_object('from', v_state.track_status, 'to', v_updated.track_status),
      v_actor
    );
    insert into public.race_events (session_id, message)
    values (
      p_session_id,
      format('Track status → %s', upper(coalesce(v_updated.track_status, 'unknown')))
    );
  end if;

  if coalesce(v_state.announcement, '') <> coalesce(v_updated.announcement, '') then
    insert into public.control_logs (session_id, action, payload, actor)
    values (
      p_session_id,
      'announcement_updated',
      jsonb_build_object('announcement', coalesce(v_updated.announcement, '')),
      v_actor
    );
  end if;

  if v_event_message is not null then
    insert into public.control_logs (session_id, action, payload, actor)
    values (
      p_session_id,
      'clock_command',
      jsonb_build_object('command', v_command, 'message', v_event_message),
      v_actor
    );
    insert into public.race_events (session_id, message)
    values (p_session_id, v_event_message);
  end if;

  return jsonb_build_object('session_state', to_jsonb(v_updated));
end;
$$;

revoke all on function public.update_session_state_atomic_core(uuid, jsonb) from public;
comment on function public.update_session_state_atomic_core is 'Internal worker for update_session_state_atomic RPC overloads.';

create or replace function public.update_session_state_atomic(
  p_session_id uuid,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.update_session_state_atomic_core(
    p_session_id => p_session_id,
    p_patch => coalesce(p_patch, '{}'::jsonb)
  );
$$;

create or replace function public.update_session_state_atomic(
  p_patch jsonb,
  p_session_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.update_session_state_atomic_core(
    p_session_id => p_session_id,
    p_patch => coalesce(p_patch, '{}'::jsonb)
  );
$$;

revoke all on function public.update_session_state_atomic(uuid, jsonb) from public;
revoke all on function public.update_session_state_atomic(jsonb, uuid) from public;
grant execute on function public.update_session_state_atomic(uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_session_state_atomic(jsonb, uuid) to authenticated, service_role;
comment on function public.update_session_state_atomic(uuid, jsonb) is 'Atomic session_state mutation for race control (session-first signature).';
comment on function public.update_session_state_atomic(jsonb, uuid) is 'Atomic session_state mutation for race control (patch-first overload for Supabase rpc).';

-- Ensure a profile exists for the authenticated user without needing direct INSERTs
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

  if found then
    return v_profile;
  end if;

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

  return v_profile;
end;
$$;

grant execute on function public.ensure_profile_for_current_user(text, text) to authenticated;

-- Ensure session_state rows remain unique per session
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'session_state'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'session_state_session_id_key'
    ) THEN
      ALTER TABLE public.session_state
        ADD CONSTRAINT session_state_session_id_key UNIQUE (session_id);
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;
