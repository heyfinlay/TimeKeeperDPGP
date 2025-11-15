-- Authoritative race clock + atomic session creation + control RPCs
-- Idempotent: safe to re-run

-- 1) Session clock fields
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='session_state') then
    execute $ddl$
      alter table public.session_state
        add column if not exists race_started_at timestamptz,
        add column if not exists accumulated_pause_ms bigint not null default 0,
        add column if not exists pause_started_at timestamptz
    $ddl$;
  end if;
end $$;

-- 2) Unique lap number per driver per session
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_laps_session_driver_number'
  ) then
    alter table public.laps
      add constraint uq_laps_session_driver_number unique(session_id, driver_id, lap_number);
  end if;
end $$;

-- 3) Touch trigger for updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sessions' and column_name='updated_at'
  ) then
    execute $ddl$drop trigger if exists trg_touch_sessions on public.sessions$ddl$;
    execute $ddl$create trigger trg_touch_sessions before update on public.sessions
             for each row execute function public.touch_updated_at()$ddl$;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='drivers' and column_name='updated_at'
  ) then
    execute $ddl$drop trigger if exists trg_touch_drivers on public.drivers$ddl$;
    execute $ddl$create trigger trg_touch_drivers before update on public.drivers
             for each row execute function public.touch_updated_at()$ddl$;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='session_state' and column_name='updated_at'
  ) then
    execute $ddl$drop trigger if exists trg_touch_session_state on public.session_state$ddl$;
    execute $ddl$create trigger trg_touch_session_state before update on public.session_state
             for each row execute function public.touch_updated_at()$ddl$;
  end if;
end $$;

-- 4) Helper functions (ensure stable + security definer)
do $$
begin
  if not exists (select 1 from pg_proc where proname='is_admin' and pronamespace = 'public'::regnamespace) then
    perform 1;
  end if;
end $$;

-- 5) Atomic session seeding
create or replace function public.seed_session_rpc(p_session jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  insert into public.sessions(name, status, starts_at, created_by)
  values (
    p_session->>'name',
    coalesce(p_session->>'status','draft'),
    nullif(p_session->>'starts_at','')::timestamptz,
    auth.uid()
  ) returning id into sid;

  insert into public.session_state(
    id, session_id, event_type, total_laps, total_duration,
    procedure_phase, flag_status, track_status, announcement,
    is_timing, is_paused, race_time_ms, race_started_at, accumulated_pause_ms, pause_started_at
  ) values (
    sid, sid,
    coalesce(p_session->>'event_type','Race'),
    nullif(p_session->>'total_laps','')::int,
    nullif(p_session->>'total_duration','')::int,
    coalesce(p_session->>'procedure_phase','setup'),
    coalesce(p_session->>'flag_status','green'),
    coalesce(p_session->>'track_status','green'),
    p_session->>'announcement',
    false, false, 0, null, 0, null
  );

  insert into public.session_members(session_id, user_id, role)
  select sid, (m->>'user_id')::uuid, coalesce(m->>'role','marshal')
  from jsonb_array_elements(coalesce(p_session->'members','[]'::jsonb)) m;

  insert into public.drivers(id, session_id, number, name, team)
  select coalesce(nullif(d->>'id','')::uuid, gen_random_uuid()), sid,
         nullif(d->>'number','')::int,
         d->>'name',
         d->>'team'
  from jsonb_array_elements(coalesce(p_session->'drivers','[]'::jsonb)) d;

  return sid;
exception when others then
  raise; -- propagate and rollback
end
$$;
grant execute on function public.seed_session_rpc(jsonb) to authenticated, service_role;

-- 6) Race control RPCs
create or replace function public.start_race_rpc(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.session_has_access(p_session_id) then
    raise exception 'no access';
  end if;
  update public.session_state
     set race_started_at = now(),
         accumulated_pause_ms = 0,
         is_timing = true,
         is_paused = false,
         pause_started_at = null,
         procedure_phase = 'race'
   where session_id = p_session_id;
end
$$;
grant execute on function public.start_race_rpc(uuid) to authenticated, service_role;

create or replace function public.pause_race_rpc(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.session_has_access(p_session_id) then
    raise exception 'no access';
  end if;
  update public.session_state
     set is_paused = true,
         pause_started_at = coalesce(pause_started_at, now())
   where session_id = p_session_id
     and is_timing = true
     and is_paused = false;
end
$$;
grant execute on function public.pause_race_rpc(uuid) to authenticated, service_role;

create or replace function public.resume_race_rpc(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.session_has_access(p_session_id) then
    raise exception 'no access';
  end if;
  update public.session_state
     set accumulated_pause_ms = accumulated_pause_ms + coalesce((extract(epoch from (now() - pause_started_at)) * 1000)::bigint,0),
         is_paused = false,
         pause_started_at = null
   where session_id = p_session_id
     and is_timing = true
     and is_paused = true;
end
$$;
grant execute on function public.resume_race_rpc(uuid) to authenticated, service_role;

create or replace function public.finish_race_rpc(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.session_has_access(p_session_id) then
    raise exception 'no access';
  end if;
  update public.session_state
     set is_timing = false,
         is_paused = false,
         pause_started_at = null,
         procedure_phase = 'setup'
   where session_id = p_session_id;
end
$$;
grant execute on function public.finish_race_rpc(uuid) to authenticated, service_role;

-- 7) Harden log_lap_atomic: ensure running and retry on unique conflict
do $create_log_lap$
begin
  execute $func$
create or replace function public.log_lap_atomic(
  p_session_id uuid,
  p_driver_id uuid,
  p_lap_time_ms bigint,
  p_source text default 'manual'
)
returns table (
  lap_id uuid,
  session_id uuid,
  driver_id uuid,
  laps integer,
  last_lap_ms bigint,
  best_lap_ms bigint,
  total_time_ms bigint
)
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_new_lap_id uuid;
  v_best bigint;
  attempt int;
begin
  if p_lap_time_ms is null or p_lap_time_ms <= 0 then
    raise exception 'invalid lap time';
  end if;

  if not public.session_has_access(p_session_id) then
    raise exception 'no access';
  end if;

  if exists (
    select 1 from public.session_state ss
    where ss.session_id = p_session_id and (coalesce(ss.is_timing,false) = false or coalesce(ss.is_paused,false) = true)
  ) then
    raise exception 'race not running';
  end if;

  for attempt in 1..2 loop
    begin
      perform 1 from public.drivers d
       where d.id = p_driver_id and d.session_id = p_session_id
       for update;
      if not found then
        raise exception 'driver not in session';
      end if;

      insert into public.laps (session_id, driver_id, lap_number, lap_time_ms, source)
      values (
        p_session_id,
        p_driver_id,
        coalesce((select max(lap_number) from public.laps where session_id=p_session_id and driver_id=p_driver_id),0) + 1,
        p_lap_time_ms,
        p_source
      )
      returning id into v_new_lap_id;

      select best_lap_ms into v_best from public.drivers where id = p_driver_id;

      update public.drivers
         set laps = coalesce(laps,0)+1,
             last_lap_ms = p_lap_time_ms,
             best_lap_ms = case when v_best is null then p_lap_time_ms else least(v_best, p_lap_time_ms) end,
             total_time_ms = coalesce(total_time_ms,0)+p_lap_time_ms,
             updated_at = timezone('utc', now())
       where id = p_driver_id and session_id = p_session_id;

      return query
        select v_new_lap_id, p_session_id, p_driver_id, d.laps, d.last_lap_ms, d.best_lap_ms, d.total_time_ms
        from public.drivers d
        where d.id = p_driver_id and d.session_id = p_session_id;

    exception when unique_violation then
      if attempt >= 2 then
        raise;
      end if;
      perform pg_sleep(0.02);
    end;
  end loop;

  raise exception 'retry limit exceeded for log_lap_atomic';
end
$body$;
$func$;
end
$create_log_lap$;
grant execute on function public.log_lap_atomic(uuid, uuid, bigint, text) to authenticated, service_role;
