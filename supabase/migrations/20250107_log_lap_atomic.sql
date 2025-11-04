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
        add column if not exists invalidated boolean default false
    $ddl$;
  end if;

  execute $drop$
    drop function if exists public.log_lap_atomic(uuid, uuid, bigint, text)
  $drop$;

  execute $fn$
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
    begin
      perform 1 from public.drivers d
       where d.id = p_driver_id and d.session_id = p_session_id
       for update;
      if not found then
        raise exception 'driver % not in session %', p_driver_id, p_session_id;
      end if;

      insert into public.laps (session_id, driver_id, lap_number, lap_time_ms, source)
      values (
        p_session_id,
        p_driver_id,
        coalesce((
          select max(lap_number)
          from public.laps
          where session_id = p_session_id
            and driver_id = p_driver_id
        ), 0) + 1,
        p_lap_time_ms,
        p_source
      )
      returning id into v_new_lap_id;

      select best_lap_ms into v_best from public.drivers where id = p_driver_id;

      update public.drivers
         set laps          = coalesce(laps, 0) + 1,
             last_lap_ms   = p_lap_time_ms,
             best_lap_ms   = case when v_best is null then p_lap_time_ms else least(v_best, p_lap_time_ms) end,
             total_time_ms = coalesce(total_time_ms, 0) + p_lap_time_ms,
             updated_at    = timezone('utc', now())
       where id = p_driver_id and session_id = p_session_id;

      return query
      select v_new_lap_id,
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
    grant execute on function public.log_lap_atomic(uuid, uuid, bigint, text) to authenticated
  $grant_authenticated$;

  execute $grant_service$
    grant execute on function public.log_lap_atomic(uuid, uuid, bigint, text) to service_role
  $grant_service$;
end;
$$;
