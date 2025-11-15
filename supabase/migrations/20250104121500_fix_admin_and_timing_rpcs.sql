-- Provide overloads for admin_list_pending_wagers and restore update_session_state_atomic with the
-- membership-based access control described in DBGPV2 guides.

create or replace function public.admin_list_pending_wagers(
  p_market_id uuid default null
)
returns table (
  wager_id uuid,
  market_id uuid,
  market_name text,
  outcome_id uuid,
  outcome_label text,
  user_id uuid,
  bettor_name text,
  stake bigint,
  placed_at timestamptz,
  price_impact_pp numeric,
  odds_before numeric,
  odds_after numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  return query
  select
    w.id as wager_id,
    w.market_id,
    m.name as market_name,
    w.outcome_id,
    o.label as outcome_label,
    w.user_id,
    p.display_name as bettor_name,
    w.stake,
    w.placed_at,
    w.price_impact_pp,
    w.odds_before,
    w.odds_after
  from public.wagers w
  join public.markets m on m.id = w.market_id
  join public.outcomes o on o.id = w.outcome_id
  left join public.profiles p on p.id = w.user_id
  where w.status = 'pending'
    and (p_market_id is null or w.market_id = p_market_id)
  order by w.placed_at asc;
end;
$$;

revoke all on function public.admin_list_pending_wagers(uuid) from public;
grant execute on function public.admin_list_pending_wagers(uuid) to authenticated, service_role;
comment on function public.admin_list_pending_wagers(uuid) is 'Admin RPC returning pending wagers (optional market filter).';

create or replace function public.admin_list_pending_wagers()
returns table (
  wager_id uuid,
  market_id uuid,
  market_name text,
  outcome_id uuid,
  outcome_label text,
  user_id uuid,
  bettor_name text,
  stake bigint,
  placed_at timestamptz,
  price_impact_pp numeric,
  odds_before numeric,
  odds_after numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select *
  from public.admin_list_pending_wagers(null::uuid);
$$;

revoke all on function public.admin_list_pending_wagers() from public;
grant execute on function public.admin_list_pending_wagers() to authenticated, service_role;
comment on function public.admin_list_pending_wagers() is 'Admin RPC returning pending wagers (no-arg overload).';

drop function if exists public.update_session_state_atomic(jsonb, uuid);
drop function if exists public.update_session_state_atomic(uuid, jsonb);

create or replace function public.update_session_state_atomic_core(
  p_session_id uuid,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_state public.session_state%rowtype;
  v_updated public.session_state%rowtype;
  v_actor uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_allowed_phases text[] := array['setup','warmup','grid','race','finished'];
  v_current_idx int;
  v_next_idx int;
  v_next_phase text := null;
  v_track_status text := null;
  v_flag_status text := null;
  v_total_laps integer := null;
  v_total_duration integer := null;
  v_race_time bigint := null;
  v_is_timing boolean := null;
  v_is_paused boolean := null;
  v_race_started_at timestamptz := null;
  v_pause_started_at timestamptz := null;
  v_accumulated_pause_ms bigint := null;
  v_pause_delta bigint := 0;
  v_command text := lower(coalesce(v_patch->>'command', ''));
  v_event_message text := null;
  v_session_owner uuid;
  v_is_member boolean := false;
begin
  if p_session_id is null then
    raise exception 'Session id is required';
  end if;

  select s.created_by
    into v_session_owner
  from public.sessions s
  where s.id = p_session_id;

  if not found then
    raise exception 'Session not found for %', p_session_id;
  end if;

  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  select true
    into v_is_member
  from public.session_members sm
  where sm.session_id = p_session_id
    and sm.user_id = v_actor
  limit 1;

  if not (public.is_admin() or v_session_owner = v_actor or coalesce(v_is_member, false)) then
    raise exception 'no access';
  end if;

  select * into v_state
  from public.session_state
  where session_id = p_session_id
  for update;

  if not found then
    raise exception 'Session state not found for %', p_session_id;
  end if;

  v_current_idx := coalesce(array_position(v_allowed_phases, coalesce(v_state.procedure_phase, 'setup')), 1);

  if v_patch ? 'procedure_phase' then
    v_next_phase := lower(nullif(v_patch->>'procedure_phase', ''));
    if v_next_phase is not null then
      v_next_idx := array_position(v_allowed_phases, v_next_phase);
      if v_next_idx is null then
        raise exception 'Invalid procedure phase %', v_next_phase;
      end if;
      if abs(v_next_idx - v_current_idx) > 1 then
        raise exception 'Invalid phase transition from % to %', v_state.procedure_phase, v_next_phase;
      end if;
    end if;
  end if;

  if v_patch ? 'track_status' then
    v_track_status := lower(nullif(v_patch->>'track_status', ''));
    if v_track_status not in ('green','yellow','vsc','sc','red','checkered') then
      raise exception 'Invalid track status %', v_track_status;
    end if;
  end if;

  if v_patch ? 'flag_status' then
    v_flag_status := lower(nullif(v_patch->>'flag_status', ''));
  end if;

  if v_track_status is not null and v_flag_status is null then
    v_flag_status := v_track_status;
  end if;

  v_total_laps := nullif(v_patch->>'total_laps', '')::int;
  v_total_duration := nullif(v_patch->>'total_duration', '')::int;
  v_race_time := nullif(v_patch->>'race_time_ms', '')::bigint;

  if v_command = 'start_clock' then
    if v_state.is_timing then
      raise exception 'Race clock already running';
    end if;
    v_is_timing := true;
    v_is_paused := false;
    v_race_started_at := v_now;
    v_pause_started_at := null;
    v_accumulated_pause_ms := 0;
    if v_next_phase is null then
      v_next_phase := 'race';
    end if;
    if v_track_status is null then
      v_track_status := 'green';
      v_flag_status := 'green';
    end if;
    v_event_message := 'Race timer started';
  elsif v_command = 'pause_clock' then
    if not v_state.is_timing or v_state.is_paused then
      raise exception 'Race clock is not running';
    end if;
    v_is_paused := true;
    v_pause_started_at := v_now;
    v_event_message := 'Race paused';
  elsif v_command = 'resume_clock' then
    if not v_state.is_timing or not v_state.is_paused then
      raise exception 'Race clock is not paused';
    end if;
    if v_state.pause_started_at is not null then
      v_pause_delta := greatest(0, (extract(epoch from (v_now - v_state.pause_started_at)) * 1000)::bigint);
    end if;
    v_accumulated_pause_ms := coalesce(v_state.accumulated_pause_ms, 0) + v_pause_delta;
    v_is_paused := false;
    v_pause_started_at := null;
    v_event_message := 'Race resumed';
  elsif v_command = 'finish_session' then
    v_is_timing := false;
    v_is_paused := false;
    v_pause_started_at := null;
    v_accumulated_pause_ms := coalesce(v_state.accumulated_pause_ms, 0);
    v_next_phase := coalesce(v_next_phase, 'finished');
    v_track_status := coalesce(v_track_status, 'checkered');
    v_flag_status := coalesce(v_flag_status, 'checkered');
    v_event_message := 'Session finished';
  elsif v_command = 'reset_session' then
    v_is_timing := false;
    v_is_paused := false;
    v_pause_started_at := null;
    v_accumulated_pause_ms := 0;
    v_race_started_at := null;
    v_next_phase := coalesce(v_next_phase, 'setup');
    v_track_status := coalesce(v_track_status, 'green');
    v_flag_status := coalesce(v_flag_status, 'green');
    v_event_message := 'Session reset';
  end if;

  update public.session_state
     set procedure_phase = coalesce(v_next_phase, procedure_phase),
         track_status = coalesce(v_track_status, track_status),
         flag_status = coalesce(v_flag_status, flag_status),
         announcement = coalesce(v_patch->>'announcement', announcement),
         total_laps = coalesce(v_total_laps, total_laps),
         total_duration = coalesce(v_total_duration, total_duration),
         race_time_ms = coalesce(v_race_time, race_time_ms),
         is_timing = coalesce(v_is_timing, is_timing),
         is_paused = coalesce(v_is_paused, is_paused),
         race_started_at = coalesce(v_race_started_at, race_started_at),
         pause_started_at = coalesce(v_pause_started_at, pause_started_at),
         accumulated_pause_ms = coalesce(v_accumulated_pause_ms, accumulated_pause_ms)
   where session_id = p_session_id
   returning * into v_updated;

  if v_updated.procedure_phase is distinct from v_state.procedure_phase then
    insert into public.control_logs (session_id, action, payload, actor)
    values (
      p_session_id,
      'phase_changed',
      jsonb_build_object('from', v_state.procedure_phase, 'to', v_updated.procedure_phase),
      v_actor
    );
    insert into public.race_events (session_id, message)
    values (
      p_session_id,
      format('Phase → %s', upper(coalesce(v_updated.procedure_phase, 'unknown')))
    );
  end if;

  if v_updated.track_status is distinct from v_state.track_status then
    insert into public.control_logs (session_id, action, payload, actor)
    values (
      p_session_id,
      'track_status',
      jsonb_build_object('from', v_state.track_status, 'to', v_updated.track_status),
      v_actor
    );
    insert into public.race_events (session_id, message)
    values (
      p_session_id,
      format('Track status → %s', upper(coalesce(v_updated.track_status, 'unknown')))
    );
  end if;

  if coalesce(v_state.announcement, '') <> coalesce(v_updated.announcement, '') then
    insert into public.control_logs (session_id, action, payload, actor)
    values (
      p_session_id,
      'announcement_updated',
      jsonb_build_object('announcement', coalesce(v_updated.announcement, '')),
      v_actor
    );
  end if;

  if v_event_message is not null then
    insert into public.control_logs (session_id, action, payload, actor)
    values (
      p_session_id,
      'clock_command',
      jsonb_build_object('command', v_command, 'message', v_event_message),
      v_actor
    );
    insert into public.race_events (session_id, message)
    values (p_session_id, v_event_message);
  end if;

  return jsonb_build_object('session_state', to_jsonb(v_updated));
end;
$$;

revoke all on function public.update_session_state_atomic_core(uuid, jsonb) from public;
comment on function public.update_session_state_atomic_core is 'Internal worker for update_session_state_atomic RPC overloads.';

create or replace function public.update_session_state_atomic(
  p_session_id uuid,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.update_session_state_atomic_core(
    p_session_id => p_session_id,
    p_patch => coalesce(p_patch, '{}'::jsonb)
  );
$$;

create or replace function public.update_session_state_atomic(
  p_patch jsonb,
  p_session_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.update_session_state_atomic_core(
    p_session_id => p_session_id,
    p_patch => coalesce(p_patch, '{}'::jsonb)
  );
$$;

revoke all on function public.update_session_state_atomic(uuid, jsonb) from public;
revoke all on function public.update_session_state_atomic(jsonb, uuid) from public;
grant execute on function public.update_session_state_atomic(uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_session_state_atomic(jsonb, uuid) to authenticated, service_role;
comment on function public.update_session_state_atomic(uuid, jsonb) is 'Atomic session_state mutation for race control (session-first signature).';
comment on function public.update_session_state_atomic(jsonb, uuid) is 'Atomic session_state mutation for race control (patch-first overload for Supabase rpc).';
