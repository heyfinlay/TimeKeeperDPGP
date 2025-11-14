-- Core timing tables required for sessions, members, drivers, and lap logging.

create extension if not exists "uuid-ossp";

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft',
  session_mode text default 'race',
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists sessions_status_idx on public.sessions (status);
create index if not exists sessions_created_by_idx on public.sessions (created_by);

create or replace function public.touch_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_touch_sessions on public.sessions;
create trigger trg_touch_sessions
  before update on public.sessions
  for each row
  execute function public.touch_sessions_updated_at();

create table if not exists public.session_state (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  event_type text,
  total_laps int,
  total_duration int,
  procedure_phase text,
  flag_status text,
  track_status text,
  announcement text,
  is_timing boolean default false,
  is_paused boolean default false,
  race_time_ms bigint default 0,
  race_started_at timestamptz,
  pause_started_at timestamptz,
  accumulated_pause_ms bigint default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'session_state_session_id_key'
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.session_state
      add constraint session_state_session_id_key unique (session_id);
  end if;
end;
$$;

create or replace function public.touch_session_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_touch_session_state on public.session_state;
create trigger trg_touch_session_state
  before update on public.session_state
  for each row
  execute function public.touch_session_state_updated_at();

create table if not exists public.session_members (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'marshal',
  inserted_at timestamptz not null default timezone('utc', now()),
  primary key (session_id, user_id)
);

create index if not exists session_members_user_idx on public.session_members (user_id);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  number int not null,
  name text not null,
  team text,
  laps int not null default 0,
  last_lap_ms bigint,
  best_lap_ms bigint,
  total_time_ms bigint not null default 0,
  pits int not null default 0,
  status text not null default 'ready',
  driver_flag text not null default 'none',
  pit_complete boolean not null default false,
  marshal_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists drivers_session_idx on public.drivers (session_id);

create or replace function public.touch_drivers_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_touch_drivers on public.drivers;
create trigger trg_touch_drivers
  before update on public.drivers
  for each row
  execute function public.touch_drivers_updated_at();

create table if not exists public.laps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  lap_number int not null,
  lap_time_ms bigint not null,
  source text default 'manual',
  invalidated boolean not null default false,
  checkpoint_missed boolean not null default false,
  recorded_at timestamptz not null default timezone('utc', now())
);

create index if not exists laps_session_driver_idx on public.laps (session_id, driver_id, lap_number);

create table if not exists public.race_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  message text not null,
  marshal_id text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists race_events_session_idx on public.race_events (session_id, created_at desc);

create table if not exists public.session_entries (
  session_id uuid not null references public.sessions(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (session_id, driver_id)
);

create table if not exists public.session_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  object_path text not null,
  object_url text,
  format text not null default 'json',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);
