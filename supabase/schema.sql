-- Supabase schema for TimeKeeperDPGP
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now())
);

create table if not exists public.session_members (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'marshal',
  inserted_at timestamptz default timezone('utc', now()),
  primary key (session_id, user_id)
);

create table if not exists public.session_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  object_path text not null,
  object_url text,
  format text not null default 'json',
  created_by uuid default auth.uid(),
  created_at timestamptz default timezone('utc', now())
);

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
  session_id uuid not null references public.sessions(id),
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
  session_id uuid not null references public.sessions(id) on delete cascade,
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
  session_id uuid not null references public.sessions(id),
  updated_at timestamptz default timezone('utc', now())
);

create table if not exists public.race_events (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  marshal_id text,
  session_id uuid not null references public.sessions(id) on delete cascade,
  created_at timestamptz default timezone('utc', now())
);

alter table public.drivers
  add column if not exists session_id uuid references public.sessions(id);

alter table public.laps
  add column if not exists session_id uuid references public.sessions(id);

alter table public.session_state
  add column if not exists session_id uuid references public.sessions(id);

alter table public.race_events
  add column if not exists session_id uuid references public.sessions(id);

alter table public.session_logs
  add column if not exists object_url text;

do $$
declare
  default_session_id constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into public.sessions (id, name, status)
  values (default_session_id, 'Legacy Session', 'active')
  on conflict (id) do nothing;

  update public.sessions
  set name = coalesce(name, 'Legacy Session'),
      status = coalesce(status, 'active')
  where id = default_session_id;

  update public.drivers
  set session_id = default_session_id
  where session_id is null;

  update public.laps
  set session_id = default_session_id
  where session_id is null;

  update public.session_state
  set session_id = default_session_id
  where session_id is null;

  update public.race_events
  set session_id = default_session_id
  where session_id is null;
end $$;

alter table public.drivers
  alter column session_id set default '00000000-0000-0000-0000-000000000000',
  alter column session_id set not null;

alter table public.laps
  alter column session_id set default '00000000-0000-0000-0000-000000000000',
  alter column session_id set not null;

alter table public.session_state
  alter column session_id set default '00000000-0000-0000-0000-000000000000',
  alter column session_id set not null;

alter table public.race_events
  alter column session_id set default '00000000-0000-0000-0000-000000000000',
  alter column session_id set not null;

create unique index if not exists session_state_session_unique_idx
  on public.session_state (session_id);

create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(auth.jwt()->>'role', '');
begin
  if jwt_role = 'admin' then
    return true;
  end if;

  return exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
end;
$$;

grant execute on function public.is_admin() to authenticated, anon;

create or replace function public.session_has_access(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or (
      target_session_id is not null
      and (
        exists (
          select 1
          from public.sessions s
          where s.id = target_session_id
            and (s.created_by = auth.uid() or s.created_by is null)
        )
        or exists (
          select 1
          from public.session_members sm
          where sm.session_id = target_session_id
            and sm.user_id = auth.uid()
        )
      )
    );
$$;

grant execute on function public.session_has_access(uuid) to authenticated, anon;

alter table public.sessions enable row level security;
alter table public.session_members enable row level security;
alter table public.session_logs enable row level security;
alter table public.drivers enable row level security;
alter table public.laps enable row level security;
alter table public.session_state enable row level security;
alter table public.race_events enable row level security;

create policy if not exists "Admins manage all sessions"
on public.sessions
for all
using (public.is_admin())
with check (public.is_admin());

create policy if not exists "Owners manage their sessions"
on public.sessions
for all
using (auth.uid() = created_by or created_by is null)
with check (auth.uid() = created_by or created_by is null);

create policy if not exists "Members view shared sessions"
on public.sessions
for select
using (
  exists (
    select 1
    from public.session_members sm
    where sm.session_id = public.sessions.id
      and sm.user_id = auth.uid()
  )
);

create policy if not exists "Admins manage session members"
on public.session_members
for all
using (public.is_admin())
with check (public.is_admin());

create policy if not exists "Owners manage membership"
on public.session_members
for all
using (
  exists (
    select 1
    from public.sessions s
    where s.id = public.session_members.session_id
      and s.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.sessions s
    where s.id = public.session_members.session_id
      and s.created_by = auth.uid()
  )
);

drop policy if exists "Members view membership" on public.session_members;

create policy "Members view membership"
on public.session_members
for select
using (auth.uid() = public.session_members.user_id);

create policy if not exists "Admins manage session logs"
on public.session_logs
for all
using (public.is_admin())
with check (public.is_admin());

create policy if not exists "Owners record session logs"
on public.session_logs
for insert
with check (public.session_has_access(public.session_logs.session_id));

create policy if not exists "Members view session logs"
on public.session_logs
for select
using (public.session_has_access(public.session_logs.session_id));

create policy if not exists "Session scoped access for drivers"
on public.drivers
for all
using (public.session_has_access(public.drivers.session_id))
with check (public.session_has_access(public.drivers.session_id));

create policy if not exists "Session scoped access for laps"
on public.laps
for all
using (public.session_has_access(public.laps.session_id))
with check (public.session_has_access(public.laps.session_id));

create policy if not exists "Session scoped access for session state"
on public.session_state
for all
using (public.session_has_access(public.session_state.session_id))
with check (public.session_has_access(public.session_state.session_id));

create policy if not exists "Session scoped access for race events"
on public.race_events
for all
using (public.session_has_access(public.race_events.session_id))
with check (public.session_has_access(public.race_events.session_id));

insert into storage.buckets (id, name, public)
values ('session-logs', 'session-logs', false)
on conflict (id) do nothing;

create policy if not exists "Admins manage session log bucket"
on storage.objects
for all
using (
  bucket_id = 'session-logs' and public.is_admin()
)
with check (
  bucket_id = 'session-logs' and public.is_admin()
);

create policy if not exists "Session members manage session log bucket"
on storage.objects
for all
using (
  bucket_id = 'session-logs'
  and public.session_has_access(nullif(split_part(name, '/', 1), '')::uuid)
)
with check (
  bucket_id = 'session-logs'
  and public.session_has_access(nullif(split_part(name, '/', 1), '')::uuid)
);

alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.session_members;
alter publication supabase_realtime add table public.session_logs;
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
    or public.is_admin()
  );

create policy "Profiles are manageable by owner or admins" on public.profiles
  for all
  using (
    auth.uid() = id
    or public.is_admin()
  )
  with check (
    auth.uid() = id
    or public.is_admin()
  );

create policy "Drivers admin full access" on public.drivers
  for all
  using (public.is_admin())
  with check (public.is_admin());

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
