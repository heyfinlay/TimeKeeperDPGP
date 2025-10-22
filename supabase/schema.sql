-- Supabase schema for TimeKeeperDPGP
create table if not exists public.drivers (
  id uuid primary key,
  number integer not null,
  name text not null,
  team text,
  marshal_id text,
  laps integer default 0,
  last_lap_ms bigint,
  best_lap_ms bigint,
  pits integer default 0,
  status text default 'ready',
  driver_flag text default 'none',
  pit_complete boolean default false,
  total_time_ms bigint default 0,
  updated_at timestamptz default timezone('utc', now())
);

create table if not exists public.laps (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.drivers(id) on delete cascade,
  lap_number integer not null,
  lap_time_ms bigint not null,
  source text,
  recorded_at timestamptz default timezone('utc', now())
);

create table if not exists public.session_state (
  id text primary key,
  event_type text,
  total_laps integer,
  total_duration integer,
  procedure_phase text,
  flag_status text,
  track_status text,
  announcement text,
  is_timing boolean,
  is_paused boolean,
  race_time_ms bigint,
  updated_at timestamptz default timezone('utc', now())
);

create table if not exists public.race_events (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  marshal_id text,
  created_at timestamptz default timezone('utc', now())
);

alter publication supabase_realtime add table public.drivers;
alter publication supabase_realtime add table public.laps;
alter publication supabase_realtime add table public.session_state;
alter publication supabase_realtime add table public.race_events;
