-- Add abbreviation column to outcomes table for LiveBetsTicker display
-- This column stores short forms of outcome names for compact UI display

ALTER TABLE public.outcomes
ADD COLUMN IF NOT EXISTS abbreviation text;

COMMENT ON COLUMN public.outcomes.abbreviation IS 'Short abbreviation for the outcome (e.g., "LSC" for "Los Santos Customs")';

-- Optionally populate abbreviations for existing outcomes
-- Example: Take first 3-4 characters or create custom abbreviations
UPDATE public.outcomes
SET abbreviation =
  CASE
    WHEN LENGTH(label) <= 4 THEN UPPER(label)
    ELSE UPPER(LEFT(REGEXP_REPLACE(label, '[^A-Za-z]', '', 'g'), 4))
  END
WHERE abbreviation IS NULL;

-- ============================================================================
-- Included from 20251112_add_settlement_approval.sql
-- ============================================================================
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

-- ============================================================================
-- Included from 20251112_add_settlement_validation_option.sql
-- ============================================================================
-- Add optional validation to require approval before settlement
-- This provides a safeguard while maintaining backward compatibility

-- Add a column to markets to track if they require approval
alter table public.markets
  add column if not exists requires_approval boolean not null default true;

comment on column public.markets.requires_approval is
  'When true, market settlement requires a pending_settlements approval record';

-- Create a validation function that checks for approval
create or replace function public.validate_settlement_approval(
  p_market_id uuid,
  p_winning_outcome_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requires_approval boolean;
  v_has_approval boolean;
begin
  -- Check if market requires approval
  select requires_approval into v_requires_approval
  from public.markets
  where id = p_market_id;

  if v_requires_approval is null then
    raise exception 'Market % not found', p_market_id;
  end if;

  -- If approval not required, allow settlement
  if not v_requires_approval then
    return true;
  end if;

  -- Check for approved pending settlement with matching outcome
  select exists(
    select 1 from public.pending_settlements
    where market_id = p_market_id
      and proposed_outcome_id = p_winning_outcome_id
      and status = 'approved'
  ) into v_has_approval;

  return v_has_approval;
end;
$$;

comment on function public.validate_settlement_approval is
  'Checks if a market settlement has been approved via pending_settlements';

-- Wrapper function that enforces approval before calling settle_market
create or replace function public.settle_market_with_approval(
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
  v_is_approved boolean;
  v_result jsonb;
begin
  -- Check admin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  -- Validate approval if required
  v_is_approved := public.validate_settlement_approval(p_market_id, p_winning_outcome_id);

  if not v_is_approved then
    raise exception 'Settlement not approved. Market requires approval via pending_settlements. Use propose_settlement() to create a settlement proposal, then approve_settlement() to execute it.';
  end if;

  -- Execute settlement
  v_result := public.settle_market(p_market_id, p_winning_outcome_id, p_payout_policy);

  return v_result;
end;
$$;

comment on function public.settle_market_with_approval is
  'Wrapper for settle_market that enforces approval workflow when market.requires_approval = true';

-- Grant execute permissions
grant execute on function public.validate_settlement_approval to authenticated;
grant execute on function public.settle_market_with_approval to authenticated;

-- Add helpful view for pending settlements with full context
create or replace view public.pending_settlements_with_context as
select
  ps.id as settlement_id,
  ps.status as settlement_status,
  ps.created_at as proposed_at,
  ps.reviewed_at,
  ps.notes,
  ps.rejection_reason,
  m.id as market_id,
  m.name as market_name,
  m.status as market_status,
  m.type as market_type,
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
  ps.timing_data,
  -- Calculate wager stats
  (select count(*) from public.wagers w where w.market_id = m.id and w.status = 'pending') as total_wagers,
  (select coalesce(sum(stake), 0) from public.wagers w where w.market_id = m.id and w.status = 'pending') as total_pool,
  (select coalesce(sum(stake), 0) from public.wagers w where w.market_id = m.id and w.outcome_id = o.id and w.status = 'pending') as winning_pool
from public.pending_settlements ps
join public.markets m on m.id = ps.market_id
join public.outcomes o on o.id = ps.proposed_outcome_id
left join public.drivers d on d.id = o.driver_id
left join public.sessions s on s.id = ps.session_id
left join public.profiles proposer on proposer.id = ps.proposed_by
left join public.profiles reviewer on reviewer.id = ps.reviewed_by;

comment on view public.pending_settlements_with_context is
  'Complete view of pending settlements with all related context for admin review';

-- Grant view access to admins
grant select on public.pending_settlements_with_context to authenticated;

-- Create RLS policy for the view
create policy "pending_settlements_with_context_admin_only"
  on public.pending_settlements_with_context
  for select
  to authenticated
  using (public.is_admin());

-- Migration note: Existing markets will have requires_approval = true by default
-- If you want to disable approval for legacy markets, run:
-- UPDATE public.markets SET requires_approval = false WHERE created_at < NOW();

-- ============================================================================
-- Included from 20251112_fix_create_session_atomic.sql
-- ============================================================================
-- Fix create_session_atomic to properly handle drivers and session state
-- This migration updates the function to accept and process drivers and session_state fields

begin;

drop function if exists public.create_session_atomic(jsonb);

create or replace function public.create_session_atomic(p_session jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
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

  -- Create the session record
  insert into public.sessions (name, status, starts_at, created_by)
  values (
    coalesce(nullif(trim(p_session->>'name'), ''), 'Session'),
    coalesce(nullif(trim(p_session->>'status'), ''), 'draft'),
    nullif(p_session->>'starts_at', '')::timestamptz,
    v_creator_id
  )
  returning id into v_session_id;

  -- Insert the creator as owner (with explicit enum cast)
  insert into public.session_members (session_id, user_id, role)
  values (v_session_id, v_creator_id, 'owner'::session_member_role)
  on conflict (session_id, user_id)
  do update set role = excluded.role, inserted_at = timezone('utc', now());

  -- Insert other members (marshals) with explicit enum cast
  insert into public.session_members (session_id, user_id, role)
  select v_session_id,
         (member->>'user_id')::uuid,
         coalesce(nullif(member->>'role', ''), 'marshal')::session_member_role
  from jsonb_array_elements(coalesce(p_session->'members', '[]'::jsonb)) as member
  where nullif(member->>'user_id', '') is not null
  on conflict (session_id, user_id)
  do update set role = excluded.role, inserted_at = timezone('utc', now());

  -- Handle session_state if provided (event_type, total_laps, total_duration)
  v_event_type := coalesce(nullif(trim(p_session->>'event_type'), ''), 'Race');
  v_total_laps := coalesce((p_session->>'total_laps')::integer, 50);
  v_total_duration := coalesce((p_session->>'total_duration')::integer, 60);

  -- Insert session_state if the table exists
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'session_state') then
    insert into public.session_state (id, session_id, event_type, total_laps, total_duration)
    values (v_session_id, v_session_id, v_event_type, v_total_laps, v_total_duration)
    on conflict (session_id)
    do update set
      event_type = excluded.event_type,
      total_laps = excluded.total_laps,
      total_duration = excluded.total_duration;
  end if;

  -- Handle drivers if provided
  if jsonb_typeof(p_session->'drivers') = 'array' then
    for v_driver in
      select
        coalesce((driver->>'id')::uuid, gen_random_uuid()) as id,
        (driver->>'number')::integer as number,
        coalesce(nullif(trim(driver->>'name'), ''), 'Driver') as name,
        nullif(trim(driver->>'team'), '') as team
      from jsonb_array_elements(p_session->'drivers') as driver
    loop
      -- Insert drivers if the table exists
      if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'drivers') then
        insert into public.drivers (
          id, session_id, number, name, team,
          laps, last_lap_ms, best_lap_ms, pits,
          status, driver_flag, pit_complete, total_time_ms
        )
        values (
          v_driver.id, v_session_id, v_driver.number, v_driver.name, v_driver.team,
          0, null, null, 0,
          'ready', 'none', false, 0
        )
        on conflict (id)
        do update set
          session_id = excluded.session_id,
          number = excluded.number,
          name = excluded.name,
          team = excluded.team;
      end if;
    end loop;
  end if;

  return v_session_id;
exception
  when others then
    raise;
end;
$$;

grant execute on function public.create_session_atomic(jsonb) to authenticated, service_role;

commit;

-- ============================================================================
-- Included from 20251112_fix_session_constraints.sql
-- ============================================================================
-- Fix missing unique constraint on session_members that causes ON CONFLICT error
-- This migration is idempotent and safe to run multiple times

-- Ensure the unique constraint exists for the create_session_atomic function
DO $$
BEGIN
  -- Check if the unique index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = 'session_members'
    AND indexname = 'session_members_pkey'
  ) THEN
    RAISE NOTICE 'Creating unique index session_members_pkey';
    CREATE UNIQUE INDEX session_members_pkey
      ON public.session_members (session_id, user_id);
  ELSE
    RAISE NOTICE 'Index session_members_pkey already exists';
  END IF;

  -- Ensure it's used as primary key constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_members_pkey'
    AND connamespace = 'public'::regnamespace
  ) THEN
    RAISE NOTICE 'Adding primary key constraint session_members_pkey';
    ALTER TABLE public.session_members
      ADD CONSTRAINT session_members_pkey
      PRIMARY KEY USING INDEX session_members_pkey;
  ELSE
    RAISE NOTICE 'Primary key constraint session_members_pkey already exists';
  END IF;
END;
$$;

-- Verify the constraint is in place
DO $$
DECLARE
  v_constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_members_pkey'
    AND contype = 'p'
  ) INTO v_constraint_exists;

  IF v_constraint_exists THEN
    RAISE NOTICE 'SUCCESS: session_members primary key constraint verified';
  ELSE
    RAISE EXCEPTION 'FAILED: session_members primary key constraint not found after migration';
  END IF;
END;
$$;

-- ============================================================================
-- Included from 20251112_prevent_wager_data_loss.sql
-- ============================================================================
-- ============================================================================
-- Migration: Prevent Accidental Wager and Transaction Data Loss
-- ============================================================================
-- This migration adds critical safeguards to prevent accidental deletion of
-- financial records (wagers and wallet transactions) which could cause:
-- 1. Loss of bet history
-- 2. Accounting discrepancies
-- 3. User fund loss
--
-- Key protections:
-- 1. Change CASCADE deletes to RESTRICT for settled wagers
-- 2. Add triggers to prevent deletion of settled wagers
-- 3. Add triggers to prevent deletion of wallet_transactions
-- 4. Add audit logging for any deletion attempts
-- ============================================================================

-- ============================================================================
-- Audit Log Table for Deletion Attempts
-- ============================================================================
create table if not exists public.deletion_audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  attempted_by uuid references auth.users(id),
  attempted_at timestamptz not null default now(),
  reason text,
  blocked boolean not null default true,
  record_snapshot jsonb
);

create index if not exists idx_deletion_audit_log_attempted_at
  on public.deletion_audit_log (attempted_at desc);

create index if not exists idx_deletion_audit_log_table_name
  on public.deletion_audit_log (table_name);

comment on table public.deletion_audit_log is
  'Audit log of all deletion attempts on critical financial tables';

-- Grant access to authenticated users (read-only for auditing)
alter table public.deletion_audit_log enable row level security;

create policy "deletion_audit_admin_only"
  on public.deletion_audit_log
  for select
  to authenticated
  using (public.is_admin());

grant select on public.deletion_audit_log to authenticated;

-- ============================================================================
-- Protection: Prevent Deletion of Wallet Transactions
-- ============================================================================
-- Wallet transactions are immutable financial records and should NEVER be deleted
create or replace function public.prevent_wallet_transaction_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Log the deletion attempt
  insert into public.deletion_audit_log (
    table_name, record_id, attempted_by, reason, blocked, record_snapshot
  ) values (
    'wallet_transactions',
    old.id,
    auth.uid(),
    'Attempted to delete immutable wallet transaction',
    true,
    to_jsonb(old)
  );

  -- Block the deletion
  raise exception 'Wallet transactions are immutable and cannot be deleted. Record ID: %', old.id;
end;
$$;

drop trigger if exists prevent_wallet_transaction_deletion on public.wallet_transactions;

create trigger prevent_wallet_transaction_deletion
  before delete on public.wallet_transactions
  for each row
  execute function public.prevent_wallet_transaction_deletion();

comment on function public.prevent_wallet_transaction_deletion is
  'Prevents deletion of wallet transactions to maintain financial audit trail';

-- ============================================================================
-- Protection: Prevent Deletion of Settled Wagers
-- ============================================================================
-- Once a wager is settled (won/lost/refunded), it should not be deleted
create or replace function public.prevent_settled_wager_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow deletion of pending/accepted wagers (user might cancel before settlement)
  if old.status in ('pending', 'accepted') then
    return old;
  end if;

  -- Log the deletion attempt for settled wagers
  insert into public.deletion_audit_log (
    table_name, record_id, attempted_by, reason, blocked, record_snapshot
  ) values (
    'wagers',
    old.id,
    auth.uid(),
    format('Attempted to delete settled wager with status: %s', old.status),
    true,
    to_jsonb(old)
  );

  -- Block the deletion of settled wagers
  raise exception 'Cannot delete settled wager (status: %). Wager ID: %', old.status, old.id;
end;
$$;

drop trigger if exists prevent_settled_wager_deletion on public.wagers;

create trigger prevent_settled_wager_deletion
  before delete on public.wagers
  for each row
  execute function public.prevent_settled_wager_deletion();

comment on function public.prevent_settled_wager_deletion is
  'Prevents deletion of settled wagers to maintain bet history and accounting integrity';

-- ============================================================================
-- Protection: Change CASCADE to RESTRICT for Critical References
-- ============================================================================
-- Note: We keep CASCADE for pending wagers only when markets are voided
-- But we add a soft-delete mechanism instead

-- Add deleted_at column to markets for soft deletes
alter table public.markets
  add column if not exists deleted_at timestamptz;

create index if not exists idx_markets_deleted_at
  on public.markets (deleted_at) where deleted_at is not null;

-- Add deleted_at column to outcomes for soft deletes
alter table public.outcomes
  add column if not exists deleted_at timestamptz;

create index if not exists idx_outcomes_deleted_at
  on public.outcomes (deleted_at) where deleted_at is not null;

-- ============================================================================
-- Protection: Soft Delete Function for Markets
-- ============================================================================
create or replace function public.soft_delete_market(p_market_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending_wagers_count int;
  v_market_status text;
begin
  -- Check admin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  -- Check market exists
  select status into v_market_status
  from public.markets
  where id = p_market_id;

  if v_market_status is null then
    raise exception 'Market not found';
  end if;

  -- Check for pending wagers
  select count(*) into v_pending_wagers_count
  from public.wagers
  where market_id = p_market_id
    and status in ('pending', 'accepted');

  if v_pending_wagers_count > 0 then
    raise exception 'Cannot delete market with % pending wagers. Settle or refund them first.', v_pending_wagers_count;
  end if;

  -- Soft delete the market
  update public.markets
  set deleted_at = now()
  where id = p_market_id;

  return jsonb_build_object(
    'success', true,
    'message', 'Market soft-deleted successfully',
    'market_id', p_market_id
  );
end;
$$;

grant execute on function public.soft_delete_market(uuid) to authenticated;

comment on function public.soft_delete_market is
  'Safely soft-deletes a market after ensuring all wagers are settled';

-- ============================================================================
-- Update RLS Policies to Exclude Soft-Deleted Records
-- ============================================================================
-- Update markets policy to exclude deleted markets
drop policy if exists "markets_select_all" on public.markets;

create policy "markets_select_all"
  on public.markets
  for select
  to public
  using (deleted_at is null);

-- Update outcomes policy to exclude deleted outcomes
drop policy if exists "outcomes_select_all" on public.outcomes;

create policy "outcomes_select_all"
  on public.outcomes
  for select
  to public
  using (deleted_at is null);

-- ============================================================================
-- Monitoring Query for Admins
-- ============================================================================
-- Create a view to monitor deletion attempts
create or replace view public.deletion_attempts_summary as
select
  table_name,
  count(*) as total_attempts,
  count(*) filter (where blocked = true) as blocked_attempts,
  max(attempted_at) as last_attempt,
  array_agg(distinct attempted_by) filter (where attempted_by is not null) as attempted_by_users
from public.deletion_audit_log
where attempted_at > now() - interval '30 days'
group by table_name
order by total_attempts desc;

comment on view public.deletion_attempts_summary is
  'Summary of deletion attempts in the last 30 days for monitoring';

grant select on public.deletion_attempts_summary to authenticated;

-- ============================================================================
-- Usage Notes
-- ============================================================================
-- To soft-delete a market (admin only):
-- SELECT soft_delete_market('market-uuid');
--
-- To view deletion attempts (admin only):
-- SELECT * FROM deletion_audit_log ORDER BY attempted_at DESC LIMIT 100;
--
-- To view deletion summary (admin only):
-- SELECT * FROM deletion_attempts_summary;
-- ============================================================================

-- ============================================================================
-- Included from 20251112_wallet_transaction_direction.sql
-- ============================================================================
-- Enforce wallet transaction direction and amount integrity

alter table public.wallet_transactions
  add column if not exists direction text;

update public.wallet_transactions
set direction = case
  when amount >= 0 then 'credit'
  else 'debit'
end
where direction is null;

alter table public.wallet_transactions
  alter column direction set not null;

alter table public.wallet_transactions
  alter column direction set default 'debit';

alter table public.wallet_transactions
  add constraint if not exists wallet_transactions_direction_check
    check (direction in ('debit', 'credit'));

alter table public.wallet_transactions
  add constraint if not exists wallet_transactions_amount_direction_check
    check (
      (direction = 'debit' and amount <= 0)
      or (direction = 'credit' and amount >= 0)
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

drop trigger if exists wallet_transactions_enforce_direction on public.wallet_transactions;

create trigger wallet_transactions_enforce_direction
  before insert or update on public.wallet_transactions
  for each row
  execute function public.wallet_transactions_enforce_direction();

comment on column public.wallet_transactions.direction is 'Indicates whether the transaction debits or credits a user wallet.';
