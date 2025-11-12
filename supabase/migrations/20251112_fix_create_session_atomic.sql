-- Fix create_session_atomic to properly handle drivers and session state
-- This migration updates the function to accept and process drivers and session_state fields

begin;

drop function if exists public.create_session_atomic(jsonb);

create or replace function public.create_session_atomic(p_session jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_creator_id uuid := auth.uid();
  v_driver record;
  v_event_type text;
  v_total_laps integer;
  v_total_duration integer;
begin
  if v_creator_id is null then
    raise exception 'auth.uid() is required to create a session';
  end if;

  -- Create the session record
  insert into public.sessions (name, status, starts_at, created_by)
  values (
    coalesce(nullif(trim(p_session->>'name'), ''), 'Session'),
    coalesce(nullif(trim(p_session->>'status'), ''), 'draft'),
    nullif(p_session->>'starts_at', '')::timestamptz,
    v_creator_id
  )
  returning id into v_session_id;

  -- Insert the creator as owner
  insert into public.session_members (session_id, user_id, role)
  values (v_session_id, v_creator_id, 'owner')
  on conflict (session_id, user_id)
  do update set role = excluded.role, inserted_at = timezone('utc', now());

  -- Insert other members (marshals)
  insert into public.session_members (session_id, user_id, role)
  select v_session_id,
         (member->>'user_id')::uuid,
         coalesce(nullif(member->>'role', ''), 'marshal')
  from jsonb_array_elements(coalesce(p_session->'members', '[]'::jsonb)) as member
  where nullif(member->>'user_id', '') is not null
  on conflict (session_id, user_id)
  do update set role = excluded.role, inserted_at = timezone('utc', now());

  -- Handle session_state if provided (event_type, total_laps, total_duration)
  v_event_type := coalesce(nullif(trim(p_session->>'event_type'), ''), 'Race');
  v_total_laps := coalesce((p_session->>'total_laps')::integer, 50);
  v_total_duration := coalesce((p_session->>'total_duration')::integer, 60);

  -- Insert session_state if the table exists
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'session_state') then
    insert into public.session_state (id, session_id, event_type, total_laps, total_duration)
    values (v_session_id, v_session_id, v_event_type, v_total_laps, v_total_duration)
    on conflict (session_id)
    do update set
      event_type = excluded.event_type,
      total_laps = excluded.total_laps,
      total_duration = excluded.total_duration;
  end if;

  -- Handle drivers if provided
  if jsonb_typeof(p_session->'drivers') = 'array' then
    for v_driver in
      select
        coalesce((driver->>'id')::uuid, gen_random_uuid()) as id,
        (driver->>'number')::integer as number,
        coalesce(nullif(trim(driver->>'name'), ''), 'Driver') as name,
        nullif(trim(driver->>'team'), '') as team
      from jsonb_array_elements(p_session->'drivers') as driver
    loop
      -- Insert drivers if the table exists
      if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'drivers') then
        insert into public.drivers (
          id, session_id, number, name, team,
          laps, last_lap_ms, best_lap_ms, pits,
          status, driver_flag, pit_complete, total_time_ms
        )
        values (
          v_driver.id, v_session_id, v_driver.number, v_driver.name, v_driver.team,
          0, null, null, 0,
          'ready', 'none', false, 0
        )
        on conflict (id)
        do update set
          session_id = excluded.session_id,
          number = excluded.number,
          name = excluded.name,
          team = excluded.team;
      end if;
    end loop;
  end if;

  return v_session_id;
exception
  when others then
    raise;
end;
$$;

grant execute on function public.create_session_atomic(jsonb) to authenticated, service_role;

commit;
