import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import DriverTimingPanel from '@/components/DriverTimingPanel.jsx';
import { useSessionContext, useSessionId } from '@/state/SessionContext.jsx';
import { useSessionDrivers } from '@/hooks/useSessionDrivers.js';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { TRACK_STATUS_OPTIONS, TRACK_STATUS_MAP } from '@/constants/trackStatus.js';
import { DEFAULT_SESSION_STATE, sessionRowToState } from '@/utils/raceData.js';
import { formatRaceClock } from '@/utils/time.js';

const roleLabels = {
  admin: 'Admin',
  marshal: 'Marshal',
  spectator: 'Spectator',
};

const toPanelDriver = (driver) => ({
  id: driver.id,
  number: driver.number ?? null,
  name: driver.name ?? 'Driver',
  team: driver.team ?? null,
  laps: Number.isFinite(driver.laps) ? driver.laps : Number.parseInt(driver.laps, 10) || 0,
  last_lap_ms:
    driver.last_lap_ms === null || driver.last_lap_ms === undefined
      ? null
      : Number.isFinite(driver.last_lap_ms)
        ? driver.last_lap_ms
        : Number.parseInt(driver.last_lap_ms, 10) || null,
  best_lap_ms:
    driver.best_lap_ms === null || driver.best_lap_ms === undefined
      ? null
      : Number.isFinite(driver.best_lap_ms)
        ? driver.best_lap_ms
        : Number.parseInt(driver.best_lap_ms, 10) || null,
  pits: Number.isFinite(driver.pits) ? driver.pits : Number.parseInt(driver.pits, 10) || 0,
  total_time_ms:
    driver.total_time_ms === null || driver.total_time_ms === undefined
      ? null
      : Number.isFinite(driver.total_time_ms)
        ? driver.total_time_ms
        : Number.parseInt(driver.total_time_ms, 10) || null,
});

export default function ControlPanel() {
  const sessionId = useSessionId();
  const { isAdmin: hasAdminAccess } = useSessionContext();
  const { status, user } = useAuth();
  const [userId, setUserId] = useState(null);
  const [role, setRole] = useState(null);
  const [roleError, setRoleError] = useState(null);
  const [isRoleLoading, setIsRoleLoading] = useState(isSupabaseConfigured);

  // Resolve role for this session
  useEffect(() => {
    let isMounted = true;
    if (!isSupabaseConfigured || !supabase) {
      setUserId(user?.id ?? null);
      setRole('admin');
      setRoleError(null);
      setIsRoleLoading(false);
      return () => {
        isMounted = false;
      };
    }

    if (hasAdminAccess) {
      setUserId(user?.id ?? null);
      setRole('admin');
      setRoleError(null);
      setIsRoleLoading(false);
      return () => {
        isMounted = false;
      };
    }

    if (status !== 'authenticated' || !user) {
      setUserId(null);
      setRole('spectator');
      setRoleError(null);
      setIsRoleLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setIsRoleLoading(true);
    setRoleError(null);
    setUserId(user.id);

    const loadRole = async () => {
      try {
        const { data: membership, error: membershipError } = await supabase
          .from('session_members')
          .select('role')
          .eq('session_id', sessionId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (membershipError && membershipError.code !== 'PGRST116' && membershipError.code !== 'PGRST123') {
          throw membershipError;
        }
        if (!isMounted) return;
        const membershipRole = typeof membership?.role === 'string' ? membership.role.toLowerCase() : null;
        setRole(membershipRole ?? 'spectator');
        setIsRoleLoading(false);
      } catch (error) {
        console.error('Failed to resolve session role', error);
        if (!isMounted) return;
        const rawMessage = error?.message ?? error?.supabaseMessage ?? '';
        const normalizedMessage = typeof rawMessage === 'string' ? rawMessage.toLowerCase() : '';
        if (normalizedMessage.includes('infinite recursion')) {
          setRoleError(
            'Session access is temporarily unavailable due to a Supabase policy issue. Please contact an administrator to restore marshal permissions.',
          );
        } else {
          setRoleError(rawMessage || 'Unable to determine session role.');
        }
        setRole('spectator');
        setIsRoleLoading(false);
      }
    };

    void loadRole();

    return () => {
      isMounted = false;
    };
  }, [sessionId, hasAdminAccess, user?.id, status]);

  const driverScope = useMemo(() => {
    const isAdmin = hasAdminAccess || role === 'admin';
    const restrictToMarshal = role === 'marshal';
    if (!isSupabaseConfigured) {
      return { onlyMine: false, userId: null, isAdmin: true };
    }
    if (isAdmin) {
      return { onlyMine: false, userId: userId ?? null, isAdmin: true };
    }
    if (restrictToMarshal) {
      return { onlyMine: true, userId: userId ?? null, isAdmin: false };
    }
    return { onlyMine: true, userId: userId ?? null, isAdmin: false };
  }, [role, userId]);

  const {
    drivers,
    isLoading: isDriversLoading,
    error: driversError,
    refresh,
  } = useSessionDrivers({
    onlyMine: driverScope.onlyMine && !!driverScope.userId,
    userId: driverScope.onlyMine ? driverScope.userId ?? undefined : undefined,
  });

  const canWrite = !isSupabaseConfigured || hasAdminAccess || role === 'admin' || role === 'marshal';
  const resolvedRole = !isSupabaseConfigured || hasAdminAccess ? 'admin' : role ?? 'spectator';
  const roleLabel = roleLabels[resolvedRole] ?? 'Spectator';

  const lastRoleRef = useRef(resolvedRole);

  useEffect(() => {
    const hasRoleChanged = lastRoleRef.current !== resolvedRole;
    lastRoleRef.current = resolvedRole;
    if (
      !isSupabaseConfigured ||
      isRoleLoading ||
      !refresh ||
      !hasRoleChanged ||
      (resolvedRole !== 'marshal' && resolvedRole !== 'admin')
    ) {
      return;
    }
    void refresh();
  }, [isRoleLoading, refresh, resolvedRole]);

  // -------- Session state (track status, announcements, race timer) ---------
  const [sessionState, setSessionState] = useState(DEFAULT_SESSION_STATE);
  const [announcementDraft, setAnnouncementDraft] = useState('');
  const [sessionError, setSessionError] = useState(null);

  const tickingRef = useRef(false);
  const startEpochRef = useRef(null);
  const baseTimeRef = useRef(0);
  const tickTimerRef = useRef(null);
  const persistTimerRef = useRef(null);
  const computeDisplayTime = useCallback(() => {
    if (!sessionState.isTiming || sessionState.isPaused || !tickingRef.current || !startEpochRef.current) {
      return sessionState.raceTime;
    }
    const now = Date.now();
    return baseTimeRef.current + (now - startEpochRef.current);
  }, [sessionState.isPaused, sessionState.isTiming, sessionState.raceTime]);

  const applySessionStateRow = useCallback((row) => {
    const next = sessionRowToState(row);
    setSessionState(next);
    setAnnouncementDraft(next.announcement ?? '');
    baseTimeRef.current = next.raceTime ?? 0;
    if (next.isTiming && !next.isPaused) {
      startEpochRef.current = Date.now();
      tickingRef.current = true;
    } else {
      startEpochRef.current = null;
      tickingRef.current = false;
    }
  }, []);

  const loadSessionState = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setSessionState(DEFAULT_SESSION_STATE);
      setAnnouncementDraft('');
      setSessionError(null);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('session_state')
        .select('*')
        .eq('session_id', sessionId)
        .maybeSingle();
      if (error) throw error;
      if (data) applySessionStateRow(data);
    } catch (err) {
      console.error('Failed to load session state', err);
      setSessionError('Unable to load session state.');
    }
  }, [applySessionStateRow, sessionId]);

  useEffect(() => {
    void loadSessionState();
  }, [loadSessionState]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return () => {};
    const channel = supabase
      .channel(`control-panel-session-${sessionId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'session_state', filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        if (payload?.new) applySessionStateRow(payload.new);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [applySessionStateRow, sessionId]);

  const persistSessionPatch = useCallback(async (patch) => {
    if (!isSupabaseConfigured || !supabase) return;
    const rows = [{ id: sessionId, session_id: sessionId, updated_at: new Date().toISOString(), ...patch }];
    const { data, error } = await supabase
      .from('session_state')
      .upsert(rows, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (data) applySessionStateRow(data);
  }, [applySessionStateRow, sessionId]);

  const startTimer = useCallback(async () => {
    if (!canWrite) return;
    baseTimeRef.current = sessionState.raceTime ?? 0;
    startEpochRef.current = Date.now();
    tickingRef.current = true;
    await persistSessionPatch({ is_timing: true, is_paused: false });
  }, [canWrite, persistSessionPatch, sessionState.raceTime]);

  const pauseTimer = useCallback(async () => {
    if (!canWrite) return;
    const current = computeDisplayTime();
    tickingRef.current = false;
    startEpochRef.current = null;
    baseTimeRef.current = current;
    await persistSessionPatch({ is_timing: true, is_paused: true, race_time_ms: current });
  }, [canWrite, computeDisplayTime, persistSessionPatch]);

  const resumeTimer = useCallback(async () => {
    if (!canWrite) return;
    baseTimeRef.current = sessionState.raceTime ?? 0;
    startEpochRef.current = Date.now();
    tickingRef.current = true;
    await persistSessionPatch({ is_paused: false, is_timing: true });
  }, [canWrite, persistSessionPatch, sessionState.raceTime]);

  const resetTimer = useCallback(async () => {
    if (!canWrite) return;
    tickingRef.current = false;
    startEpochRef.current = null;
    baseTimeRef.current = 0;
    await persistSessionPatch({ is_timing: false, is_paused: false, race_time_ms: 0 });
  }, [canWrite, persistSessionPatch]);

  const [displayTime, setDisplayTime] = useState(0);
  useEffect(() => {
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    tickTimerRef.current = setInterval(() => {
      setDisplayTime((prev) => {
        const next = computeDisplayTime();
        return next !== prev ? next : prev;
      });
    }, 250);
    return () => clearInterval(tickTimerRef.current);
  }, [computeDisplayTime]);

  useEffect(() => {
    if (persistTimerRef.current) clearInterval(persistTimerRef.current);
    if (sessionState.isTiming && !sessionState.isPaused) {
      persistTimerRef.current = setInterval(() => {
        const current = computeDisplayTime();
        void persistSessionPatch({ race_time_ms: current });
      }, 5000);
    }
    return () => { if (persistTimerRef.current) clearInterval(persistTimerRef.current); };
  }, [computeDisplayTime, persistSessionPatch, sessionState.isPaused, sessionState.isTiming]);

  const setTrackStatus = useCallback(async (statusId) => {
    if (!canWrite) return;
    const normalized = TRACK_STATUS_MAP[statusId] ? statusId : 'green';
    try {
      await persistSessionPatch({ track_status: normalized, flag_status: normalized });
    } catch (error) {
      console.error('Failed to update track status', error);
      setSessionError('Unable to update track status.');
    }
  }, [canWrite, persistSessionPatch]);

  const updateAnnouncement = useCallback(async () => {
    if (!canWrite) return;
    try {
      const text = (announcementDraft ?? '').slice(0, 500);
      await persistSessionPatch({ announcement: text });
    } catch (error) {
      console.error('Failed to update announcement', error);
      setSessionError('Unable to update announcement.');
    }
  }, [announcementDraft, canWrite, persistSessionPatch]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold text-white">Race control</h1>
        <p className="text-sm text-neutral-400">Manage lap timing and marshal operations for the active session.</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs uppercase tracking-[0.35em] text-neutral-400">
          <span className="rounded-full border border-white/10 px-4 py-2 text-white/80">Session {sessionId.slice(0, 8)}…</span>
          <span className="rounded-full border border-white/5 bg-white/5 px-4 py-2 text-white/90">{roleLabel}</span>
          <button
            type="button"
            onClick={() => refresh?.()}
            disabled={isDriversLoading}
            className="rounded-full border border-white/10 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDriversLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {roleError ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">{roleError}</div>
      ) : null}
      {driversError ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">
          {driversError}
        </div>
      ) : null}
      {sessionError ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">{sessionError}</div>
      ) : null}

      {isRoleLoading ? (
        <div className="flex min-h-[20vh] items-center justify-center text-sm text-neutral-400">Resolving access…</div>
      ) : null}
      {!isRoleLoading && resolvedRole === 'spectator' && isSupabaseConfigured ? (
        <div className="rounded-3xl border border-white/5 bg-[#060910]/80 px-6 py-5 text-center text-sm text-neutral-300">
          <p className="text-base font-semibold text-white">Spectator access</p>
          <p className="mt-2 text-neutral-400">
            You do not have marshal permissions for this session. Timing data will appear once a marshal assigns you to drivers.
          </p>
        </div>
      ) : null}

      {/* Track status + announcements */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-3xl border border-white/5 bg-[#060910]/80 p-6">
          <div>
            <p className="text-xs uppercase tracking-widest text-neutral-400">Track Status</p>
            <p className="mt-1 text-xl font-semibold text-white">{TRACK_STATUS_MAP[sessionState.trackStatus]?.label ?? 'Green Flag'}</p>
            <p className="mt-1 text-sm text-neutral-400">{TRACK_STATUS_MAP[sessionState.trackStatus]?.description ?? 'Track clear. Full racing speed permitted.'}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {TRACK_STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={!canWrite}
                onClick={() => setTrackStatus(opt.id)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold text-white/90 focus:outline-none focus-visible:ring-2 ${opt.controlClass} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {opt.shortLabel}
              </button>
            ))}
          </div>
          <p className="mt-4 text-[10px] uppercase tracking-[0.35em] text-neutral-500">Track status is controlled from the race control panel below.</p>
        </div>
        <div className="rounded-3xl border border-white/5 bg-[#060910]/80 p-6">
          <p className="text-xs uppercase tracking-widest text-neutral-400">Live Announcements</p>
          <p className="mt-1 text-sm text-neutral-300">{sessionState.announcement?.trim() ? sessionState.announcement : 'No active announcements.'}</p>
          <div className="mt-4 flex gap-3">
            <input
              type="text"
              value={announcementDraft}
              onChange={(e) => setAnnouncementDraft(e.target.value)}
              placeholder="Enter live message..."
              disabled={!canWrite}
              className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={updateAnnouncement}
              disabled={!canWrite}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Update
            </button>
          </div>
        </div>
      </section>

      {/* Session control bar */}
      <section className="rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="text-white">
              <span className="font-semibold">{sessionState.eventType}</span>
              <span className="mx-2 text-neutral-500">•</span>
              <span className="text-neutral-300">{sessionState.totalLaps} laps target</span>
              <span className="mx-2 text-neutral-500">•</span>
              <span className="text-neutral-300">{sessionState.totalDuration} min duration</span>
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-1 text-sm text-white/90">
            {formatRaceClock(displayTime)}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canWrite || sessionState.isTiming}
            onClick={startTimer}
            className="rounded-xl border border-emerald-500/40 bg-emerald-600/20 px-3 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-600/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Start Timer
          </button>
          <button
            type="button"
            disabled={!canWrite || !sessionState.isTiming || sessionState.isPaused}
            onClick={pauseTimer}
            className="rounded-xl border border-amber-400/40 bg-amber-500/20 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Pause Timer
          </button>
          <button
            type="button"
            disabled={!canWrite || !sessionState.isTiming || !sessionState.isPaused}
            onClick={resumeTimer}
            className="rounded-xl border border-cyan-400/40 bg-cyan-500/20 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Resume Timer
          </button>
          <button
            type="button"
            disabled={!canWrite}
            onClick={resetTimer}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reset Timer
          </button>

          <div className="h-6 w-px bg-white/10" />

          {TRACK_STATUS_OPTIONS.map((opt) => (
            <button
              key={`control-${opt.id}`}
              type="button"
              disabled={!canWrite}
              onClick={() => setTrackStatus(opt.id)}
              className={`rounded-xl px-3 py-2 text-sm font-semibold text-white/90 focus:outline-none focus-visible:ring-2 ${opt.controlClass} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {opt.shortLabel}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[10px] uppercase tracking-[0.35em] text-neutral-500">Keyboard hotkeys 1-0 log laps, shift toggles pit, and Alt invalidates the last lap.</p>
      </section>

      <section className="rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
        {isDriversLoading && !drivers.length ? (
          <p className="text-sm text-neutral-400">Loading drivers…</p>
        ) : null}
        {!isDriversLoading && drivers.length === 0 ? (
          <p className="text-sm text-neutral-400">No drivers are available for this session.</p>
        ) : null}
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {drivers.map((driver) => (
            <DriverTimingPanel key={driver.id} driver={toPanelDriver(driver)} canWrite={canWrite} />
          ))}
        </div>
      </section>
    </div>
  );
}

