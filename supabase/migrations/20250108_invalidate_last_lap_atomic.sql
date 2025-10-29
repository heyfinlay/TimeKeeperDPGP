alter table public.laps
  add column if not exists checkpoint_missed boolean default false;

create or replace function public.invalidate_last_lap_atomic(
  p_session_id uuid,
  p_driver_id uuid,
  p_mode text default 'time_only'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_lap_id uuid;
begin
  perform 1
    from public.drivers d
   where d.id = p_driver_id
     and d.session_id = p_session_id
   for update;

  select l.id
    into v_last_lap_id
  from public.laps l
  where l.session_id = p_session_id
    and l.driver_id = p_driver_id
  order by l.recorded_at desc
  limit 1;

  if v_last_lap_id is null then
    raise exception 'no laps exist for driver % in session %', p_driver_id, p_session_id;
  end if;

  update public.laps
     set invalidated = true,
         checkpoint_missed = (p_mode = 'remove_lap')
   where id = v_last_lap_id;

  update public.drivers d
     set last_lap_ms = (
           select lap_time_ms
             from public.laps
            where session_id = p_session_id
              and driver_id = p_driver_id
              and invalidated = false
            order by recorded_at desc
            limit 1
         ),
         best_lap_ms = (
           select min(lap_time_ms)
             from public.laps
            where session_id = p_session_id
              and driver_id = p_driver_id
              and invalidated = false
         ),
         total_time_ms = (
           select coalesce(sum(lap_time_ms), 0)
             from public.laps
            where session_id = p_session_id
              and driver_id = p_driver_id
              and invalidated = false
         ),
         laps = case when p_mode = 'remove_lap'
                     then greatest(coalesce(d.laps, 0) - 1, 0)
                     else d.laps end,
         updated_at = timezone('utc', now())
   where d.id = p_driver_id
     and d.session_id = p_session_id;

end;
$$;

grant execute on function public.invalidate_last_lap_atomic(uuid, uuid, text) to authenticated;
grant execute on function public.invalidate_last_lap_atomic(uuid, uuid, text) to service_role;
