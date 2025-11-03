do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'laps'
  ) then
    execute $ddl$
      alter table public.laps
        add column if not exists checkpoint_missed boolean default false
    $ddl$;
  end if;

  execute $drop$
    drop function if exists public.invalidate_last_lap_atomic(uuid, uuid, text)
  $drop$;

  execute $fn$
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
    as $body$
    declare
      v_lap_id uuid;
      v_lap_time bigint;
    begin
      perform 1 from public.drivers d
       where d.id = p_driver_id and d.session_id = p_session_id
       for update;
      if not found then
        raise exception 'driver % not in session %', p_driver_id, p_session_id;
      end if;

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

      update public.laps
         set invalidated = true,
             checkpoint_missed = (p_mode = 'remove_lap')
       where id = v_lap_id;

      update public.drivers d
         set last_lap_ms = (
                select lap_time_ms
                from public.laps
                where session_id = p_session_id
                  and driver_id = p_driver_id
                  and coalesce(invalidated, false) = false
                order by recorded_at desc
                limit 1
             ),
             best_lap_ms = (
                select min(lap_time_ms)
                from public.laps
                where session_id = p_session_id
                  and driver_id = p_driver_id
                  and coalesce(invalidated, false) = false
             ),
             total_time_ms = coalesce((
                select sum(lap_time_ms)
                from public.laps
                where session_id = p_session_id
                  and driver_id = p_driver_id
                  and coalesce(invalidated, false) = false
             ), 0),
             laps = case when p_mode = 'remove_lap'
                         then greatest(coalesce(d.laps, 0) - 1, 0)
                         else d.laps end,
             updated_at = timezone('utc', now())
       where d.id = p_driver_id and d.session_id = p_session_id;

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
    $body$;
  $fn$;

  execute $grant_authenticated$
    grant execute on function public.invalidate_last_lap_atomic(uuid, uuid, text) to authenticated
  $grant_authenticated$;

  execute $grant_service$
    grant execute on function public.invalidate_last_lap_atomic(uuid, uuid, text) to service_role
  $grant_service$;
end;
$$;
