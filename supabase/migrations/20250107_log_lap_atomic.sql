alter table public.laps
  add column if not exists invalidated boolean default false;

create or replace function public.log_lap_atomic(
  p_session_id uuid,
  p_driver_id uuid,
  p_lap_time_ms bigint,
  p_source text default 'manual'
)
returns table (lap_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  curr_best bigint;
begin
  if not exists (
    select 1
    from public.drivers d
    where d.id = p_driver_id
      and d.session_id = p_session_id
  ) then
    raise exception 'driver does not belong to session';
  end if;

  insert into public.laps (session_id, driver_id, lap_number, lap_time_ms, source, invalidated)
  values (
    p_session_id,
    p_driver_id,
    (
      select coalesce(max(lap_number), 0) + 1
      from public.laps
      where driver_id = p_driver_id
        and session_id = p_session_id
    ),
    p_lap_time_ms,
    p_source,
    false
  )
  returning id into lap_id;

  select best_lap_ms into curr_best
  from public.drivers
  where id = p_driver_id
    and session_id = p_session_id;

  update public.drivers
     set last_lap_ms = p_lap_time_ms,
         best_lap_ms = case
           when curr_best is null then p_lap_time_ms
           else least(curr_best, p_lap_time_ms)
         end,
         laps = laps + 1,
         total_time_ms = coalesce(total_time_ms, 0) + p_lap_time_ms,
         updated_at = timezone('utc', now())
   where id = p_driver_id
     and session_id = p_session_id;

  return;
end;
$$;
