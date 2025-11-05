-- Fix ambiguous column references in invalidate_last_lap_atomic
-- Issue: "column reference \"session_id\" is ambiguous" (PostgreSQL error 42702)
-- Caused by unqualified column names in subquery WHERE clauses

drop function if exists public.invalidate_last_lap_atomic(uuid, uuid, text);

create or replace function public.invalidate_last_lap_atomic(
  p_session_id uuid,
  p_driver_id uuid,
  p_mode text default 'time_only'
)
returns table (
  invalidated_lap_id uuid,
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
  v_lap_id uuid;
  v_lap_time bigint;
begin
  -- Lock driver row for update
  perform 1 from public.drivers d
   where d.id = p_driver_id and d.session_id = p_session_id
   for update;
  if not found then
    raise exception 'driver % not in session %', p_driver_id, p_session_id;
  end if;

  -- Find most recent non-invalidated lap
  select l.id, l.lap_time_ms
    into v_lap_id, v_lap_time
  from public.laps l
  where l.session_id = p_session_id
    and l.driver_id = p_driver_id
    and coalesce(l.invalidated, false) = false
  order by l.recorded_at desc
  limit 1
  for update;

  if v_lap_id is null then
    return;
  end if;

  -- Mark lap as invalidated
  update public.laps l
     set invalidated = true,
         checkpoint_missed = (p_mode = 'remove_lap')
   where l.id = v_lap_id;

  -- Recalculate driver stats from remaining valid laps
  update public.drivers d
     set last_lap_ms = (
            select l.lap_time_ms
            from public.laps l  -- FIX: Use table alias
            where l.session_id = p_session_id  -- FIX: Qualify column
              and l.driver_id = p_driver_id    -- FIX: Qualify column
              and coalesce(l.invalidated, false) = false
            order by l.recorded_at desc
            limit 1
         ),
         best_lap_ms = (
            select min(l.lap_time_ms)
            from public.laps l  -- FIX: Use table alias
            where l.session_id = p_session_id  -- FIX: Qualify column
              and l.driver_id = p_driver_id    -- FIX: Qualify column
              and coalesce(l.invalidated, false) = false
         ),
         total_time_ms = coalesce((
            select sum(l.lap_time_ms)
            from public.laps l  -- FIX: Use table alias
            where l.session_id = p_session_id  -- FIX: Qualify column
              and l.driver_id = p_driver_id    -- FIX: Qualify column
              and coalesce(l.invalidated, false) = false
         ), 0),
         laps = case when p_mode = 'remove_lap'
                     then greatest(coalesce(d.laps, 0) - 1, 0)
                     else d.laps end,
         updated_at = timezone('utc', now())
   where d.id = p_driver_id and d.session_id = p_session_id;

  -- Return updated driver stats
  return query
  select v_lap_id,
         p_session_id,
         p_driver_id,
         d.laps,
         d.last_lap_ms,
         d.best_lap_ms,
         d.total_time_ms
  from public.drivers d
  where d.id = p_driver_id and d.session_id = p_session_id;
end;
$$;

-- Grant execute permissions
grant execute on function public.invalidate_last_lap_atomic(uuid, uuid, text) to authenticated;
grant execute on function public.invalidate_last_lap_atomic(uuid, uuid, text) to service_role;

comment on function public.invalidate_last_lap_atomic is 'Atomically invalidate the last lap and recalculate driver stats. Fixed ambiguous column references.';
