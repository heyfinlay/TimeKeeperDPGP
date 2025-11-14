-- Betting V2 schema foundation: enums, constraints, ledger hardening, settlement tables.

----------------------------
-- Enum definitions
----------------------------
do $$
begin
  create type public.market_status as enum (
    'draft',
    'open',
    'suspended',
    'closing',
    'closed',
    'settled',
    'cancelled'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.wager_status as enum (
    'pending',
    'accepted',
    'rejected',
    'settled_win',
    'settled_loss',
    'cancelled'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.wallet_transaction_direction as enum ('debit', 'credit');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.wallet_transaction_reference as enum (
    'wager',
    'payout',
    'deposit',
    'withdrawal'
  );
exception
  when duplicate_object then null;
end
$$;

----------------------------
-- Markets hardening
----------------------------
update public.markets
set status = lower(status);

update public.markets
set status = 'cancelled'
where status in ('void', 'cancelled');

update public.markets
set status = 'open'
where status in ('active', 'opening');

alter table public.markets
  alter column status type public.market_status
  using status::public.market_status;

alter table public.markets
  alter column status set default 'open';

alter table public.markets
  add column if not exists requires_approval boolean not null default false;

alter table public.markets
  add column if not exists settles_at timestamptz;

alter table public.markets
  add constraint if not exists markets_rake_bps_range
    check (rake_bps between 0 and 2500);

alter table public.markets
  add constraint if not exists markets_takeout_range
    check (takeout >= 0 and takeout <= 0.25);

----------------------------
-- Outcomes soft delete + abbreviations
----------------------------
alter table public.outcomes
  add column if not exists abbreviation text;

alter table public.outcomes
  add column if not exists deleted_at timestamptz;

update public.outcomes
set abbreviation = upper(
      case
        when coalesce(length(trim(label)), 0) <= 4 then trim(label)
        else left(regexp_replace(label, '[^A-Za-z0-9]', '', 'g'), 4)
      end
    )
where abbreviation is null;

alter table public.outcomes
  add constraint if not exists outcomes_abbreviation_not_blank
    check (abbreviation is null or length(trim(abbreviation)) > 0);

----------------------------
-- Wallet accounts & transactions
----------------------------
alter table public.wallet_accounts
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.wallet_transactions
set direction = lower(direction);

alter table public.wallet_transactions
  alter column direction type public.wallet_transaction_direction
  using direction::public.wallet_transaction_direction;

alter table public.wallet_transactions
  add column if not exists reference_type public.wallet_transaction_reference;

alter table public.wallet_transactions
  add column if not exists reference_id uuid;

update public.wallet_transactions
set reference_type = 'wager'
where reference_type is null and kind in ('wager');

update public.wallet_transactions
set reference_type = 'payout'
where reference_type is null and kind in ('payout', 'refund');

update public.wallet_transactions
set reference_type = 'deposit'
where reference_type is null and kind in ('deposit');

update public.wallet_transactions
set reference_type = 'withdrawal'
where reference_type is null and kind in ('withdrawal');

update public.wallet_transactions
set reference_type = 'wager'
where reference_type is null;

alter table public.wallet_transactions
  alter column reference_type set not null;

create index if not exists wallet_transactions_reference_idx
  on public.wallet_transactions (reference_type, reference_id);

----------------------------
-- Wagers lifecycle upgrades
----------------------------
update public.wagers
set status = lower(status);

update public.wagers set status = 'settled_win' where status in ('won', 'paid');
update public.wagers set status = 'settled_loss' where status in ('lost');
update public.wagers set status = 'cancelled' where status in ('refunded', 'void', 'cancelled');

alter table public.wagers
  alter column status type public.wager_status
  using status::public.wager_status;

alter table public.wagers
  alter column status set default 'pending';

alter table public.wagers
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

alter table public.wagers
  add column if not exists approved_at timestamptz;

alter table public.wagers
  add column if not exists rejected_reason text;

alter table public.wagers
  add column if not exists settled_at timestamptz;

alter table public.wagers
  add column if not exists payout_amount bigint not null default 0;

alter table public.wagers
  add column if not exists price_impact_pp numeric(10,4);

alter table public.wagers
  add column if not exists odds_before numeric(12,6);

alter table public.wagers
  add column if not exists odds_after numeric(12,6);

create index if not exists wagers_status_market_idx
  on public.wagers (market_id, status, placed_at);

create index if not exists wagers_user_status_idx
  on public.wagers (user_id, status, placed_at desc);

----------------------------
-- Settlement tables
----------------------------
create table if not exists public.market_settlements (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  winning_outcome_id uuid references public.outcomes(id) on delete set null,
  total_pool numeric(20,4) not null,
  winning_pool numeric(20,4) not null default 0,
  rake_amount numeric(20,4) not null default 0,
  net_pool numeric(20,4) not null default 0,
  total_paid numeric(20,4) not null default 0,
  dust numeric(20,4) not null default 0,
  winners_count integer not null default 0,
  losers_count integer not null default 0,
  payout_policy text not null default 'proportional',
  settled_by uuid references auth.users(id) on delete set null,
  settled_at timestamptz not null default timezone('utc', now()),
  metadata jsonb
);

create unique index if not exists market_settlements_market_unique
  on public.market_settlements (market_id);

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

comment on table public.market_settlements is 'Authoritative settlement records for DBGP tote markets.';
comment on table public.pending_settlements is 'Tracks settlement proposals awaiting admin approval.';
