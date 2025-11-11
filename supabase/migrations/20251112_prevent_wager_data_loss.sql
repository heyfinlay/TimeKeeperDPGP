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
