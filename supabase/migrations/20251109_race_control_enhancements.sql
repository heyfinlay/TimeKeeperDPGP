-- Race Control Enhancements: Control logs, penalties, results, pit events, single marshal mode
-- Date: 2025-11-09

-- =============================================================================
-- 1. CONTROL LOGS TABLE - Audit trail for all race control actions
-- =============================================================================
create table if not exists public.control_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  action text not null,
  payload jsonb,
  actor uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_control_logs_session on public.control_logs(session_id, created_at desc);
create index if not exists idx_control_logs_actor on public.control_logs(actor);

comment on table public.control_logs is 'Audit trail of all race control actions';
comment on column public.control_logs.action is 'Action type: lap_logged, lap_invalidated, flag_changed, penalty_applied, etc.';
comment on column public.control_logs.payload is 'Additional data about the action in JSON format';
comment on column public.control_logs.actor is 'User who performed the action';

-- =============================================================================
-- 2. PENALTIES TABLE - Track time penalties applied to drivers
-- =============================================================================
create table if not exists public.penalties (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  category text not null,
  time_penalty_ms bigint not null default 0,
  reason text,
  issued_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_penalties_session on public.penalties(session_id);
create index if not exists idx_penalties_driver on public.penalties(driver_id);
create index if not exists idx_penalties_issued_by on public.penalties(issued_by);

comment on table public.penalties is 'Time penalties applied to drivers during or after session';
comment on column public.penalties.category is 'Penalty category: track_limits, false_start, causing_collision, etc.';
comment on column public.penalties.time_penalty_ms is 'Time penalty in milliseconds';

-- =============================================================================
-- 3. RESULTS FINAL TABLE - Published final results after session completion
-- =============================================================================
create table if not exists public.results_final (
  session_id uuid not null references public.sessions(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  final_position integer not null,
  classification text not null default 'FIN',
  total_laps integer not null default 0,
  total_time_ms bigint,
  best_lap_ms bigint,
  total_penalty_ms bigint not null default 0,
  final_time_ms bigint,
  validated boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (session_id, driver_id)
);

create index if not exists idx_results_final_session_position on public.results_final(session_id, final_position);

comment on table public.results_final is 'Final published results after session completion';
comment on column public.results_final.classification is 'FIN (finished), DNF (did not finish), DSQ (disqualified), DNS (did not start)';
comment on column public.results_final.total_penalty_ms is 'Sum of all time penalties applied';
comment on column public.results_final.final_time_ms is 'Total time plus penalties';
comment on column public.results_final.validated is 'Whether results have been validated by stewards';

-- =============================================================================
-- 4. PIT EVENTS TABLE - Track pit in/out events with timestamps
-- =============================================================================
create table if not exists public.pit_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  event_type text not null check (event_type in ('in', 'out')),
  timestamp timestamptz not null default now(),
  duration_ms bigint,
  recorded_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_pit_events_session on public.pit_events(session_id, timestamp desc);
create index if not exists idx_pit_events_driver on public.pit_events(driver_id, timestamp desc);

comment on table public.pit_events is 'Pit lane in/out events with timestamps';
comment on column public.pit_events.event_type is 'Type: in (pit lane entry) or out (pit lane exit)';
comment on column public.pit_events.duration_ms is 'Pit stop duration calculated on pit out (null for pit in events)';

-- =============================================================================
-- 5. SINGLE MARSHAL MODE - Add columns to sessions table
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sessions' and column_name='single_marshal_mode'
  ) then
    alter table public.sessions add column single_marshal_mode boolean not null default false;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sessions' and column_name='locked_marshal_uuid'
  ) then
    alter table public.sessions add column locked_marshal_uuid uuid references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sessions' and column_name='session_mode'
  ) then
    alter table public.sessions add column session_mode text not null default 'race' check (session_mode in ('race', 'qualifying'));
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sessions' and column_name='is_final'
  ) then
    alter table public.sessions add column is_final boolean not null default false;
  end if;
end $$;

comment on column public.sessions.single_marshal_mode is 'When true, only locked_marshal_uuid can log laps';
comment on column public.sessions.locked_marshal_uuid is 'UUID of the marshal authorized to log laps in single marshal mode';
comment on column public.sessions.session_mode is 'Session type: race (wheel-to-wheel) or qualifying (time trial)';
comment on column public.sessions.is_final is 'Whether results have been finalized and published';

-- =============================================================================
-- 6. RPC FUNCTION - Finalize session results with penalty calculation
-- =============================================================================
create or replace function public.finalize_session_results(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver record;
  v_position integer := 1;
  v_total_penalties bigint;
begin
  -- Check session access
  if not public.session_has_access(p_session_id) then
    raise exception 'no access';
  end if;

  -- Mark session as final
  update public.sessions
  set is_final = true
  where id = p_session_id;

  -- Stop timing if still running
  update public.session_state
  set is_timing = false, is_paused = false
  where session_id = p_session_id and is_timing = true;

  -- Clear existing results for this session
  delete from public.results_final where session_id = p_session_id;

  -- Calculate final results for each driver, ordered by laps (desc) then total_time_ms (asc)
  for v_driver in
    select
      d.id as driver_id,
      d.laps,
      d.total_time_ms,
      d.best_lap_ms,
      d.status,
      coalesce(sum(p.time_penalty_ms), 0) as total_penalty_ms
    from public.drivers d
    left join public.penalties p on p.driver_id = d.id and p.session_id = p_session_id
    where d.session_id = p_session_id
    group by d.id, d.laps, d.total_time_ms, d.best_lap_ms, d.status
    order by
      d.laps desc nulls last,
      (d.total_time_ms + coalesce(sum(p.time_penalty_ms), 0)) asc nulls last
  loop
    insert into public.results_final (
      session_id,
      driver_id,
      final_position,
      classification,
      total_laps,
      total_time_ms,
      best_lap_ms,
      total_penalty_ms,
      final_time_ms,
      validated
    ) values (
      p_session_id,
      v_driver.driver_id,
      v_position,
      case
        when v_driver.status = 'dsq' then 'DSQ'
        when v_driver.status = 'dns' then 'DNS'
        when v_driver.laps = 0 then 'DNF'
        else 'FIN'
      end,
      v_driver.laps,
      v_driver.total_time_ms,
      v_driver.best_lap_ms,
      v_driver.total_penalty_ms,
      case
        when v_driver.total_time_ms is not null
        then v_driver.total_time_ms + v_driver.total_penalty_ms
        else null
      end,
      false
    );

    v_position := v_position + 1;
  end loop;

  -- Log the finalization
  insert into public.control_logs (session_id, action, payload, actor)
  values (
    p_session_id,
    'results_finalized',
    jsonb_build_object('driver_count', v_position - 1),
    auth.uid()
  );
end
$$;

grant execute on function public.finalize_session_results(uuid) to authenticated, service_role;

comment on function public.finalize_session_results is 'Calculates final positions, applies penalties, and publishes results';

-- =============================================================================
-- 7. RPC FUNCTION - Log pit event (in or out)
-- =============================================================================
create or replace function public.log_pit_event(
  p_session_id uuid,
  p_driver_id uuid,
  p_event_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_last_pit_in timestamptz;
  v_duration_ms bigint;
begin
  -- Check session access
  if not public.session_has_access(p_session_id) then
    raise exception 'no access';
  end if;

  -- Validate event type
  if p_event_type not in ('in', 'out') then
    raise exception 'invalid event type';
  end if;

  -- If this is a pit out, calculate duration from last pit in
  if p_event_type = 'out' then
    select timestamp into v_last_pit_in
    from public.pit_events
    where session_id = p_session_id
      and driver_id = p_driver_id
      and event_type = 'in'
    order by timestamp desc
    limit 1;

    if v_last_pit_in is not null then
      v_duration_ms := extract(epoch from (now() - v_last_pit_in))::bigint * 1000;
    end if;
  end if;

  -- Insert pit event
  insert into public.pit_events (
    session_id,
    driver_id,
    event_type,
    timestamp,
    duration_ms,
    recorded_by
  ) values (
    p_session_id,
    p_driver_id,
    p_event_type,
    now(),
    v_duration_ms,
    auth.uid()
  )
  returning id into v_event_id;

  -- Update driver pits counter on pit out
  if p_event_type = 'out' then
    update public.drivers
    set pits = coalesce(pits, 0) + 1
    where id = p_driver_id;
  end if;

  -- Log the action
  insert into public.control_logs (session_id, action, payload, actor)
  values (
    p_session_id,
    'pit_event',
    jsonb_build_object(
      'driver_id', p_driver_id,
      'event_type', p_event_type,
      'duration_ms', v_duration_ms
    ),
    auth.uid()
  );

  return v_event_id;
end
$$;

grant execute on function public.log_pit_event(uuid, uuid, text) to authenticated, service_role;

comment on function public.log_pit_event is 'Logs pit in/out events with automatic duration calculation';

-- =============================================================================
-- 8. RPC FUNCTION - Apply penalty to driver
-- =============================================================================
create or replace function public.apply_penalty(
  p_session_id uuid,
  p_driver_id uuid,
  p_category text,
  p_time_penalty_ms bigint,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_penalty_id uuid;
begin
  -- Check session access
  if not public.session_has_access(p_session_id) then
    raise exception 'no access';
  end if;

  -- Validate penalty time
  if p_time_penalty_ms < 0 then
    raise exception 'penalty time cannot be negative';
  end if;

  -- Insert penalty
  insert into public.penalties (
    session_id,
    driver_id,
    category,
    time_penalty_ms,
    reason,
    issued_by
  ) values (
    p_session_id,
    p_driver_id,
    p_category,
    p_time_penalty_ms,
    p_reason,
    auth.uid()
  )
  returning id into v_penalty_id;

  -- Log the action
  insert into public.control_logs (session_id, action, payload, actor)
  values (
    p_session_id,
    'penalty_applied',
    jsonb_build_object(
      'penalty_id', v_penalty_id,
      'driver_id', p_driver_id,
      'category', p_category,
      'time_penalty_ms', p_time_penalty_ms,
      'reason', p_reason
    ),
    auth.uid()
  );

  return v_penalty_id;
end
$$;

grant execute on function public.apply_penalty(uuid, uuid, text, bigint, text) to authenticated, service_role;

comment on function public.apply_penalty is 'Applies a time penalty to a driver';

-- =============================================================================
-- 9. RPC FUNCTION - Enhanced log_lap_atomic with single marshal mode check
-- =============================================================================
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
  v_retries int := 0;
  v_single_marshal_mode boolean;
  v_locked_marshal_uuid uuid;
begin
  if p_lap_time_ms is null or p_lap_time_ms <= 0 then
    raise exception 'invalid lap time';
  end if;

  if not public.session_has_access(p_session_id) then
    raise exception 'no access';
  end if;

  -- Check single marshal mode
  select s.single_marshal_mode, s.locked_marshal_uuid
  into v_single_marshal_mode, v_locked_marshal_uuid
  from public.sessions s
  where s.id = p_session_id;

  if v_single_marshal_mode and v_locked_marshal_uuid is not null then
    if auth.uid() != v_locked_marshal_uuid then
      raise exception 'lap logging restricted to assigned marshal in single marshal mode';
    end if;
  end if;

  if exists (
    select 1 from public.session_state ss
    where ss.session_id = p_session_id and (coalesce(ss.is_timing,false) = false or coalesce(ss.is_paused,false) = true)
  ) then
    raise exception 'race not running';
  end if;

  <<retry>>
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

    -- Log the action
    insert into public.control_logs (session_id, action, payload, actor)
    values (
      p_session_id,
      'lap_logged',
      jsonb_build_object(
        'lap_id', v_new_lap_id,
        'driver_id', p_driver_id,
        'lap_time_ms', p_lap_time_ms,
        'source', p_source
      ),
      auth.uid()
    );

    return query
      select v_new_lap_id, p_session_id, p_driver_id, d.laps, d.last_lap_ms, d.best_lap_ms, d.total_time_ms
      from public.drivers d
      where d.id = p_driver_id and d.session_id = p_session_id;

  exception when unique_violation then
    if v_retries < 1 then
      v_retries := v_retries + 1;
      perform pg_sleep(0.02);
      goto retry;
    else
      raise;
    end if;
  end;
end
$$;

grant execute on function public.log_lap_atomic(uuid, uuid, bigint, text) to authenticated, service_role;

-- =============================================================================
-- 10. ROW LEVEL SECURITY POLICIES
-- =============================================================================

-- Control logs: readable by session members, writable via RPC only
alter table public.control_logs enable row level security;

create policy "Users can view control logs for their sessions"
  on public.control_logs for select
  using (public.session_has_access(session_id));

-- Penalties: readable by session members, writable via RPC only
alter table public.penalties enable row level security;

create policy "Users can view penalties for their sessions"
  on public.penalties for select
  using (public.session_has_access(session_id));

-- Results final: readable by anyone, writable via RPC only
alter table public.results_final enable row level security;

create policy "Anyone can view finalized results"
  on public.results_final for select
  using (true);

-- Pit events: readable by session members, writable via RPC only
alter table public.pit_events enable row level security;

create policy "Users can view pit events for their sessions"
  on public.pit_events for select
  using (public.session_has_access(session_id));

-- =============================================================================
-- 11. GRANT PERMISSIONS
-- =============================================================================

grant select on public.control_logs to authenticated, anon;
grant select on public.penalties to authenticated, anon;
grant select on public.results_final to authenticated, anon;
grant select on public.pit_events to authenticated, anon;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
