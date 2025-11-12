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
