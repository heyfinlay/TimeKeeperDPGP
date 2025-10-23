-- Supabase schema for TimeKeeperDPGP
create table if not exists public.drivers (
  id uuid primary key,
  number integer not null,
  name text not null,
  team text,
  marshal_user_id uuid references auth.users(id),
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

alter table public.drivers
  add column if not exists marshal_user_id uuid references auth.users(id);

alter table public.drivers
  drop column if exists marshal_id;

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

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'marshal',
  display_name text,
  assigned_driver_ids uuid[] default '{}'::uuid[],
  team_id uuid,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now())
);

alter publication supabase_realtime add table public.drivers;
alter publication supabase_realtime add table public.laps;
alter publication supabase_realtime add table public.session_state;
alter publication supabase_realtime add table public.race_events;
alter publication supabase_realtime add table public.profiles;

alter table public.drivers enable row level security;
alter table public.laps enable row level security;
alter table public.race_events enable row level security;
alter table public.session_state enable row level security;
alter table public.profiles enable row level security;

create policy "Profiles are readable by owner or admins" on public.profiles
  for select
  using (
    auth.uid() = id
    or exists (
      select 1
      from public.profiles as p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Profiles are manageable by owner or admins" on public.profiles
  for all
  using (
    auth.uid() = id
    or exists (
      select 1
      from public.profiles as p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    auth.uid() = id
    or exists (
      select 1
      from public.profiles as p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Drivers admin full access" on public.drivers
  for all
  using (
    exists (
      select 1 from public.profiles as p where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles as p where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Drivers marshal access" on public.drivers
  for select
  using (
    auth.uid() = marshal_user_id
    or id = any(
      coalesce(
        (
          select assigned_driver_ids
          from public.profiles as p
          where p.id = auth.uid()
        ),
        '{}'
      )
    )
  );

create policy "Drivers marshal updates" on public.drivers
  for update
  using (
    auth.uid() = marshal_user_id
    or id = any(
      coalesce(
        (
          select assigned_driver_ids
          from public.profiles as p
          where p.id = auth.uid()
        ),
        '{}'
      )
    )
  )
  with check (
    auth.uid() = marshal_user_id
    or id = any(
      coalesce(
        (
          select assigned_driver_ids
          from public.profiles as p
          where p.id = auth.uid()
        ),
        '{}'
      )
    )
  );

create policy "Laps admin full access" on public.laps
  for all
  using (
    exists (
      select 1 from public.profiles as p where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles as p where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Laps marshal access" on public.laps
  for all
  using (
    exists (
      select 1
      from public.drivers as d
      where d.id = public.laps.driver_id
        and (
          d.marshal_user_id = auth.uid()
          or d.id = any(
            coalesce(
              (
                select assigned_driver_ids
                from public.profiles as p
                where p.id = auth.uid()
              ),
              '{}'
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.drivers as d
      where d.id = public.laps.driver_id
        and (
          d.marshal_user_id = auth.uid()
          or d.id = any(
            coalesce(
              (
                select assigned_driver_ids
                from public.profiles as p
                where p.id = auth.uid()
              ),
              '{}'
            )
          )
        )
    )
  );

create policy "Race events readable" on public.race_events
  for select
  using (auth.uid() is not null);

create policy "Race events writeable" on public.race_events
  for insert
  with check (auth.uid() is not null);

create policy "Session state readable" on public.session_state
  for select
  using (auth.uid() is not null);

create policy "Session state admin updates" on public.session_state
  for all
  using (
    exists (
      select 1 from public.profiles as p where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles as p where p.id = auth.uid() and p.role = 'admin'
    )
  );
