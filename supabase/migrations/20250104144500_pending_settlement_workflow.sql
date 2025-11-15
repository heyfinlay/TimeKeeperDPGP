-- Align betting schema with settlement approval workflow and market metadata requirements

alter table public.markets
  add column if not exists requires_approval boolean not null default true;

alter table public.wagers
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists settled_at timestamptz,
  add column if not exists payout_amount bigint not null default 0;

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

drop policy if exists "Admins view pending settlements" on public.pending_settlements;
create policy "Admins view pending settlements"
  on public.pending_settlements
  for select
  using (public.is_admin());

drop policy if exists "Admins insert pending settlements" on public.pending_settlements;
create policy "Admins insert pending settlements"
  on public.pending_settlements
  for insert
  with check (public.is_admin());

drop policy if exists "Admins update pending settlements" on public.pending_settlements;
create policy "Admins update pending settlements"
  on public.pending_settlements
  for update
  using (public.is_admin());

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
