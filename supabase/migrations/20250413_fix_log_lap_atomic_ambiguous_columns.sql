-- Fix ambiguous column references in log_lap_atomic
-- Issue: "column reference \"session_id\" is ambiguous" (PostgreSQL error 42702)
-- Caused by unqualified column names in WHERE clauses that match parameter names

drop function if exists public.log_lap_atomic(uuid, uuid, bigint, text);

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
as $$
declare
  v_new_lap_id uuid;
  v_best bigint;
begin
  -- Lock driver row for update
  perform 1 from public.drivers d
   where d.id = p_driver_id and d.session_id = p_session_id
   for update;
  if not found then
    raise exception 'driver % not in session %', p_driver_id, p_session_id;
  end if;

  -- Insert new lap with next lap number
  insert into public.laps (session_id, driver_id, lap_number, lap_time_ms, source)
  values (
    p_session_id,
    p_driver_id,
    coalesce((
      select max(l.lap_number)  -- FIX: Qualify with table alias
      from public.laps l
      where l.session_id = p_session_id    -- FIX: Qualify column
        and l.driver_id = p_driver_id      -- FIX: Qualify column
    ), 0) + 1,
    p_lap_time_ms,
    p_source
  )
  returning id into v_new_lap_id;

  -- Get current best lap for comparison
  select d.best_lap_ms into v_best
  from public.drivers d
  where d.id = p_driver_id;  -- FIX: Qualify column

  -- Update driver stats atomically
  update public.drivers d  -- FIX: Use table alias
     set laps          = coalesce(d.laps, 0) + 1,
         last_lap_ms   = p_lap_time_ms,
         best_lap_ms   = case when v_best is null then p_lap_time_ms else least(v_best, p_lap_time_ms) end,
         total_time_ms = coalesce(d.total_time_ms, 0) + p_lap_time_ms,
         updated_at    = timezone('utc', now())
   where d.id = p_driver_id and d.session_id = p_session_id;  -- FIX: Qualify columns

  -- Return updated driver stats
  return query
  select v_new_lap_id,
         p_session_id,
         p_driver_id,
         d.laps,
         d.last_lap_ms,
         d.best_lap_ms,
         d.total_time_ms
  from public.drivers d
  where d.id = p_driver_id and d.session_id = p_session_id;  -- FIX: Qualify columns
end;
$$;

-- Grant execute permissions
grant execute on function public.log_lap_atomic(uuid, uuid, bigint, text) to authenticated;
grant execute on function public.log_lap_atomic(uuid, uuid, bigint, text) to service_role;

comment on function public.log_lap_atomic is 'Atomically log a lap time and update driver stats. Fixed ambiguous column references.';
