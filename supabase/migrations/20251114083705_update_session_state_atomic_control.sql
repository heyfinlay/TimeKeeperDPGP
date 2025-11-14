-- Atomic session state updates (phase, flags, clock controls)

create or replace function public.update_session_state_atomic(
  p_session_id uuid,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
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
begin
  if p_session_id is null then
    raise exception 'Session id is required';
  end if;

  if not public.session_has_access(p_session_id) then
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

grant execute on function public.update_session_state_atomic(uuid, jsonb) to authenticated, service_role;
comment on function public.update_session_state_atomic is 'Atomic session_state mutation for race control (phase, flags, timing).';
