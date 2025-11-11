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
  status text not null default 'open',
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
create index if not exists events_session_id_idx on public.events (session_id);
create index if not exists outcomes_driver_id_idx on public.outcomes (driver_id);
create index if not exists wagers_user_id_idx on public.wagers (user_id);
create index if not exists wagers_market_id_idx on public.wagers (market_id);
create index if not exists wallet_transactions_user_id_idx on public.wallet_transactions (user_id);

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

-- Admin market creation helper
create or replace function public.admin_create_market(
  p_session_id uuid,
  p_market_name text,
  p_rake_bps int default 500,
  p_closes_at timestamptz default null,
  p_outcomes jsonb,
  p_market_type text default 'parimutuel'
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

  insert into public.markets (event_id, name, type, rake_bps, status, closes_at)
  values (v_event_id, p_market_name, coalesce(nullif(trim(p_market_type), ''), 'parimutuel'), p_rake_bps, 'open', p_closes_at)
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

grant execute on function public.admin_create_market(uuid, text, int, timestamptz, jsonb, text) to authenticated;
