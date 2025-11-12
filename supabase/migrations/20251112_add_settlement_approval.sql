-- Add manual settlement approval workflow to prevent premature market settlements
-- This ensures that results are verified against timing data before releasing payouts

-- Table to track pending settlements awaiting approval
create table if not exists public.pending_settlements (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  proposed_outcome_id uuid not null references public.outcomes(id) on delete cascade,
  proposed_by uuid references auth.users(id) on delete set null,
  timing_data jsonb, -- Store relevant timing data for verification
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  rejection_reason text,
  constraint unique_pending_settlement_per_market unique (market_id, status)
    deferrable initially deferred
);

create index if not exists idx_pending_settlements_status on public.pending_settlements(status);
create index if not exists idx_pending_settlements_market_id on public.pending_settlements(market_id);
create index if not exists idx_pending_settlements_session_id on public.pending_settlements(session_id);

comment on table public.pending_settlements is 'Tracks proposed market settlements awaiting admin approval';
comment on column public.pending_settlements.timing_data is 'Snapshot of driver lap times and positions at time of proposal';

-- Function to propose a settlement (called by admin after reviewing timing data)
create or replace function public.propose_settlement(
  p_market_id uuid,
  p_proposed_outcome_id uuid,
  p_timing_data jsonb default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement_id uuid;
  v_market_status text;
  v_session_id uuid;
  v_outcome_exists boolean;
  v_existing_pending uuid;
begin
  -- Verify caller is admin (implement your own auth check)
  -- For now, we just check they're authenticated
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- Check market exists and is closed (ready for settlement)
  select status into v_market_status from public.markets where id = p_market_id;
  if v_market_status is null then
    raise exception 'Market % not found', p_market_id;
  end if;

  if v_market_status = 'settled' then
    raise exception 'Market % is already settled', p_market_id;
  end if;

  -- Get session_id from market
  select e.session_id into v_session_id
  from public.markets m
  join public.events e on e.id = m.event_id
  where m.id = p_market_id;

  -- Verify proposed outcome belongs to this market
  select exists(
    select 1 from public.outcomes
    where id = p_proposed_outcome_id and market_id = p_market_id
  ) into v_outcome_exists;

  if not v_outcome_exists then
    raise exception 'Outcome % does not belong to market %', p_proposed_outcome_id, p_market_id;
  end if;

  -- Check for existing pending settlement
  select id into v_existing_pending
  from public.pending_settlements
  where market_id = p_market_id and status = 'pending';

  if v_existing_pending is not null then
    raise exception 'Market % already has a pending settlement (ID: %)', p_market_id, v_existing_pending;
  end if;

  -- Create the pending settlement
  insert into public.pending_settlements (
    market_id,
    session_id,
    proposed_outcome_id,
    proposed_by,
    timing_data,
    notes,
    status
  ) values (
    p_market_id,
    v_session_id,
    p_proposed_outcome_id,
    auth.uid(),
    p_timing_data,
    p_notes,
    'pending'
  )
  returning id into v_settlement_id;

  raise notice 'Settlement % proposed for market % with outcome %', v_settlement_id, p_market_id, p_proposed_outcome_id;

  return v_settlement_id;
end;
$$;

-- Function to approve a settlement and execute it
create or replace function public.approve_settlement(
  p_settlement_id uuid,
  p_payout_policy text default 'refund_if_empty'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement record;
  v_market_status text;
  v_result jsonb;
begin
  -- Verify caller is admin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- Get the pending settlement
  select * into v_settlement
  from public.pending_settlements
  where id = p_settlement_id
  for update; -- Lock the row

  if v_settlement.id is null then
    raise exception 'Settlement % not found', p_settlement_id;
  end if;

  if v_settlement.status != 'pending' then
    raise exception 'Settlement % is not pending (status: %)', p_settlement_id, v_settlement.status;
  end if;

  -- Verify market is still in valid state
  select status into v_market_status from public.markets where id = v_settlement.market_id;
  if v_market_status = 'settled' then
    raise exception 'Market % is already settled', v_settlement.market_id;
  end if;

  -- Close market if still open
  if v_market_status = 'open' then
    update public.markets set status = 'closed' where id = v_settlement.market_id;
  end if;

  -- Execute the settlement using the existing settle_market function
  perform public.settle_market(
    v_settlement.market_id,
    v_settlement.proposed_outcome_id,
    p_payout_policy
  );

  -- Mark settlement as approved
  update public.pending_settlements
  set
    status = 'approved',
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where id = p_settlement_id;

  v_result := jsonb_build_object(
    'settlement_id', p_settlement_id,
    'market_id', v_settlement.market_id,
    'outcome_id', v_settlement.proposed_outcome_id,
    'approved_by', auth.uid(),
    'approved_at', now()
  );

  raise notice 'Settlement % approved and executed for market %', p_settlement_id, v_settlement.market_id;

  return v_result;
end;
$$;

-- Function to reject a settlement
create or replace function public.reject_settlement(
  p_settlement_id uuid,
  p_rejection_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  -- Verify caller is admin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- Get current status
  select status into v_status
  from public.pending_settlements
  where id = p_settlement_id
  for update;

  if v_status is null then
    raise exception 'Settlement % not found', p_settlement_id;
  end if;

  if v_status != 'pending' then
    raise exception 'Settlement % is not pending (status: %)', p_settlement_id, v_status;
  end if;

  -- Mark as rejected
  update public.pending_settlements
  set
    status = 'rejected',
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    rejection_reason = p_rejection_reason
  where id = p_settlement_id;

  raise notice 'Settlement % rejected: %', p_settlement_id, p_rejection_reason;
end;
$$;

-- Function to automatically propose settlement when session completes
-- This creates a pending settlement based on timing data, but requires manual approval
create or replace function public.auto_propose_settlement_on_session_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market record;
  v_winning_driver_id uuid;
  v_winning_outcome_id uuid;
  v_timing_data jsonb;
  v_settlement_id uuid;
begin
  -- Only process when session status changes to 'completed'
  if NEW.status = 'completed' and (OLD.status is null or OLD.status != 'completed') then

    -- Find race outcome markets for this session that are open
    for v_market in
      select m.id as market_id, m.name, m.type
      from public.markets m
      join public.events e on e.id = m.event_id
      where e.session_id = NEW.id
        and m.status = 'open'
        and m.type = 'race_outcome'
    loop
      -- Find winning driver (most laps, then best time)
      select d.id into v_winning_driver_id
      from public.drivers d
      where d.session_id = NEW.id
      order by
        d.laps desc nulls last,
        d.total_time_ms asc nulls last
      limit 1;

      if v_winning_driver_id is not null then
        -- Find the outcome that matches this driver
        select o.id into v_winning_outcome_id
        from public.outcomes o
        where o.market_id = v_market.market_id
          and o.driver_id = v_winning_driver_id;

        if v_winning_outcome_id is not null then
          -- Build timing data snapshot
          select jsonb_agg(
            jsonb_build_object(
              'driver_id', d.id,
              'driver_name', d.name,
              'driver_number', d.number,
              'laps', d.laps,
              'total_time_ms', d.total_time_ms,
              'best_lap_ms', d.best_lap_ms
            )
            order by d.laps desc, d.total_time_ms asc
          ) into v_timing_data
          from public.drivers d
          where d.session_id = NEW.id;

          -- Propose the settlement for admin review
          begin
            select public.propose_settlement(
              v_market.market_id,
              v_winning_outcome_id,
              v_timing_data,
              'Auto-proposed based on session completion'
            ) into v_settlement_id;

            raise notice 'Auto-proposed settlement % for market % (session %)',
              v_settlement_id, v_market.market_id, NEW.id;
          exception
            when others then
              raise warning 'Failed to auto-propose settlement for market %: %',
                v_market.market_id, SQLERRM;
          end;
        else
          raise notice 'No outcome found for winning driver % in market %',
            v_winning_driver_id, v_market.market_id;
        end if;
      else
        raise notice 'No winning driver found for session %', NEW.id;
      end if;
    end loop;
  end if;

  return NEW;
end;
$$;

-- Create trigger for auto-proposing settlements
drop trigger if exists auto_propose_settlement_trigger on public.sessions;

create trigger auto_propose_settlement_trigger
  after update of status on public.sessions
  for each row
  execute function public.auto_propose_settlement_on_session_complete();

-- RLS Policies (adjust based on your auth setup)
alter table public.pending_settlements enable row level security;

-- Allow admins to view all pending settlements
create policy "Admins can view pending settlements"
  on public.pending_settlements
  for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Allow admins to propose settlements
create policy "Admins can propose settlements"
  on public.pending_settlements
  for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Allow admins to update settlements (for approval/rejection)
create policy "Admins can update settlements"
  on public.pending_settlements
  for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Grant execute permissions on functions
grant execute on function public.propose_settlement to authenticated;
grant execute on function public.approve_settlement to authenticated;
grant execute on function public.reject_settlement to authenticated;

comment on function public.propose_settlement is 'Propose a market settlement for admin review and approval';
comment on function public.approve_settlement is 'Approve and execute a pending settlement';
comment on function public.reject_settlement is 'Reject a pending settlement with a reason';
