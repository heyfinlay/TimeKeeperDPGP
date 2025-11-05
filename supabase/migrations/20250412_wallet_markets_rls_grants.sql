-- RLS policies and grants for wallet and markets tables
-- Enable RLS on all tables
alter table public.events enable row level security;
alter table public.markets enable row level security;
alter table public.outcomes enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.wagers enable row level security;
alter table public.withdrawals enable row level security;

-- Grant column-level access for PostgREST
grant usage on schema public to anon, authenticated;

-- Events: read-only to public; admin mutate
grant select on table public.events to anon, authenticated;
grant insert, update, delete on table public.events to authenticated;

-- Markets: read-only to public; admin mutate
grant select on table public.markets to anon, authenticated;
grant insert, update, delete on table public.markets to authenticated;

-- Outcomes: read-only to public; admin mutate
grant select on table public.outcomes to anon, authenticated;
grant insert, update, delete on table public.outcomes to authenticated;

-- Wallet accounts: users can select ONLY (no insert/update - RPC-only)
-- Inserts handled by SECURITY DEFINER functions (place_wager, admin RPCs)
-- Updates blocked to prevent balance manipulation
grant select on table public.wallet_accounts to authenticated;

-- Wallet transactions: user selects own ONLY (no insert - RPC-only)
-- All transactions created by SECURITY DEFINER functions to maintain audit integrity
grant select on table public.wallet_transactions to authenticated;

-- Wagers: user inserts/selects own
grant select, insert on table public.wagers to authenticated;

-- Withdrawals: user insert/select own
grant select, insert, update on table public.withdrawals to authenticated;

-- RLS Policies

-- Events: anyone can read, only admin can write
create policy "events_select_all"
  on public.events
  for select
  using (true);

create policy "events_admin_all"
  on public.events
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Markets: anyone can read, only admin can write
create policy "markets_select_all"
  on public.markets
  for select
  using (true);

create policy "markets_admin_all"
  on public.markets
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Outcomes: anyone can read, only admin can write
create policy "outcomes_select_all"
  on public.outcomes
  for select
  using (true);

create policy "outcomes_admin_all"
  on public.outcomes
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Wallet accounts: users can only see their own wallet
create policy "wallet_accounts_own_select"
  on public.wallet_accounts
  for select
  using (auth.uid() = user_id);

-- CRITICAL SECURITY: Block all direct inserts by users
-- Wallets must be created ONLY via SECURITY DEFINER RPCs (e.g., place_wager)
-- or service role to prevent users from minting arbitrary starting balances.
-- Without this, a user could POST /wallet_accounts with balance=999999999999
-- and bypass all financial controls.
create policy "wallet_accounts_no_user_insert"
  on public.wallet_accounts
  for insert
  with check (false);

-- Users cannot directly update balance (only via RPCs/service role)
-- This prevents manual balance manipulation
create policy "wallet_accounts_no_user_update"
  on public.wallet_accounts
  for update
  using (false);

-- Admin can see all wallets
create policy "wallet_accounts_admin_select"
  on public.wallet_accounts
  for select
  using (public.is_admin());

-- Wallet transactions: users can only see their own transactions
create policy "wallet_transactions_own_select"
  on public.wallet_transactions
  for select
  using (auth.uid() = user_id);

-- Only service role or RPCs can insert transactions (via SECURITY DEFINER functions)
create policy "wallet_transactions_no_direct_insert"
  on public.wallet_transactions
  for insert
  with check (false);

-- Admin can see all transactions
create policy "wallet_transactions_admin_select"
  on public.wallet_transactions
  for select
  using (public.is_admin());

-- Wagers: users can only see their own wagers
create policy "wagers_own_select"
  on public.wagers
  for select
  using (auth.uid() = user_id);

-- Users can place wagers only on open markets (validation in RPC)
create policy "wagers_own_insert"
  on public.wagers
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.markets m
      where m.id = market_id
        and m.status = 'open'
        and (m.closes_at is null or m.closes_at > now())
    )
  );

-- Admin can see all wagers
create policy "wagers_admin_select"
  on public.wagers
  for select
  using (public.is_admin());

-- Withdrawals: users can only see and create their own withdrawal requests
create policy "withdrawals_own_select"
  on public.withdrawals
  for select
  using (auth.uid() = user_id);

create policy "withdrawals_own_insert"
  on public.withdrawals
  for insert
  with check (auth.uid() = user_id and status = 'queued');

-- Users cannot update withdrawals directly
create policy "withdrawals_no_user_update"
  on public.withdrawals
  for update
  using (false);

-- Admin can see and update all withdrawals
create policy "withdrawals_admin_select"
  on public.withdrawals
  for select
  using (public.is_admin());

create policy "withdrawals_admin_update"
  on public.withdrawals
  for update
  using (public.is_admin())
  with check (public.is_admin());
