-- Restore missing RPCs required by DBGPV2 timing and betting guides

-- admin_list_pending_wagers: secure admin-only listing of unapproved wagers
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
comment on function public.admin_list_pending_wagers(uuid) is 'Admin RPC returning pending wagers (optional market filter).';
