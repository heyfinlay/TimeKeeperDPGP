-- Wallet and markets foundation for Diamond Sports Book
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  venue text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'upcoming'
);

create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  type text not null,
  rake_bps int not null default 500,
  status text not null default 'open',
  closes_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.outcomes (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  label text not null,
  sort_order int not null default 0
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
  meta jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.wagers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  market_id uuid not null references public.markets(id) on delete cascade,
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  stake bigint not null check (stake > 0),
  placed_at timestamptz not null default now(),
  status text not null default 'pending'
);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount > 0),
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

create index if not exists markets_event_id_idx on public.markets (event_id);
create index if not exists outcomes_market_id_idx on public.outcomes (market_id);
create index if not exists wagers_user_id_idx on public.wagers (user_id);
create index if not exists wagers_market_id_idx on public.wagers (market_id);
create index if not exists wallet_transactions_user_id_idx on public.wallet_transactions (user_id);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.markets;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.outcomes;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_accounts;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.wagers;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;