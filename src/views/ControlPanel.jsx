import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import DriverTimingPanel from '@/components/DriverTimingPanel.jsx';
import { useSessionContext, useSessionId } from '@/state/SessionContext.jsx';
import { useSessionDrivers } from '@/hooks/useSessionDrivers.js';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { TRACK_STATUS_OPTIONS, TRACK_STATUS_MAP } from '@/constants/trackStatus.js';
import { DEFAULT_SESSION_STATE, sessionRowToState } from '@/utils/raceData.js';
import { formatRaceClock } from '@/utils/time.js';
import { logLapAtomic, invalidateLastLap } from '@/services/laps.js';

const roleLabels = {
  admin: 'Admin',
  marshal: 'Marshal',
  spectator: 'Spectator',
};

const PROCEDURE_PHASE_LABELS = {
  setup: 'Pre-Session',
  warmup: 'Warm-Up',
  grid: 'Grid',
  race: 'Race',
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
  const [gridReadyConfirmed, setGridReadyConfirmed] = useState(false);
  const [isPhaseMutating, setIsPhaseMutating] = useState(false);

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

  const procedurePhase = sessionState.procedurePhase ?? 'setup';
  const procedurePhaseLabel = PROCEDURE_PHASE_LABELS[procedurePhase] ?? PROCEDURE_PHASE_LABELS.setup;
  const isGridPhase = procedurePhase === 'grid';
  const isRacePhase = procedurePhase === 'race';

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

  useEffect(() => {
    if (sessionState.procedurePhase !== 'grid') {
      setGridReadyConfirmed(false);
    }
  }, [sessionState.procedurePhase]);

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

  const setProcedurePhase = useCallback(
    async (phase) => {
      if (!canWrite) return;
      if (sessionState.procedurePhase === phase) return;
      setIsPhaseMutating(true);
      try {
        await persistSessionPatch({ procedure_phase: phase });
      } catch (error) {
        console.error('Failed to update procedure phase', error);
        setSessionError('Unable to update procedure phase.');
      } finally {
        setIsPhaseMutating(false);
      }
    },
    [canWrite, persistSessionPatch, sessionState.procedurePhase],
  );

  const startTimer = useCallback(async () => {
    if (!canWrite) return;
    if (sessionState.procedurePhase !== 'grid' || !gridReadyConfirmed) {
      return;
    }
    baseTimeRef.current = sessionState.raceTime ?? 0;
    startEpochRef.current = Date.now();
    tickingRef.current = true;
    try {
      await persistSessionPatch({ is_timing: true, is_paused: false, procedure_phase: 'race' });
    } catch (error) {
      console.error('Failed to start race timer', error);
      tickingRef.current = false;
      startEpochRef.current = null;
      setSessionError('Unable to start race timer.');
    }
  }, [canWrite, gridReadyConfirmed, persistSessionPatch, sessionState.procedurePhase, sessionState.raceTime]);

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
    await persistSessionPatch({ is_timing: false, is_paused: false, race_time_ms: 0, procedure_phase: 'setup' });
  }, [canWrite, persistSessionPatch]);

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

  // ---------------- Keyboard Hotkeys -----------------
  const HOTKEYS_STORAGE_KEY = `timekeeper.hotkeys.v1`;
  const defaultHotkeys = useMemo(
    () => ({
      keys: ['1','2','3','4','5','6','7','8','9','0'],
      pitModifier: 'Shift',
      invalidateModifier: 'Alt',
    }),
    [],
  );
  const [hotkeys, setHotkeys] = useState(defaultHotkeys);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HOTKEYS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.keys) && parsed.keys.length === 10) {
          setHotkeys({
            keys: parsed.keys.map((k) => String(k || '').trim() || ''),
            pitModifier: parsed.pitModifier || 'Shift',
            invalidateModifier: parsed.invalidateModifier || 'Alt',
          });
        }
      }
    } catch {
      // ignore storage read errors
    }
  }, []);
  const saveHotkeys = useCallback((next) => {
    setHotkeys(next);
    try {
      window.localStorage.setItem(HOTKEYS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage write errors
    }
  }, []);

  const hotkeyArmsKey = useCallback((driverId) => `timekeeper.currentLapStart.${sessionId}.${driverId}`, [sessionId]);
  const getArmedStart = useCallback(
    (driverId) => {
      try {
        const raw = window.localStorage.getItem(hotkeyArmsKey(driverId));
        const n = raw ? Number.parseInt(raw, 10) : NaN;
        return Number.isNaN(n) ? null : n;
      } catch {
        return null;
      }
    },
    [hotkeyArmsKey],
  );
  const setArmedStart = useCallback(
    (driverId, when) => {
      try {
        if (when === null) {
          window.localStorage.removeItem(hotkeyArmsKey(driverId));
        } else {
          window.localStorage.setItem(hotkeyArmsKey(driverId), String(when));
        }
      } catch {
        // ignore storage errors
      }
    },
    [hotkeyArmsKey],
  );

  const [displayTime, setDisplayTime] = useState(0);
  const [currentLapTimes, setCurrentLapTimes] = useState({});
  const pauseEpochRef = useRef(null);
  const wasPausedRef = useRef(sessionState.isPaused);

  const computeCurrentLapMap = useCallback(() => {
    const now = sessionState.isPaused && pauseEpochRef.current ? pauseEpochRef.current : Date.now();
    const map = {};
    let hasActive = false;
    drivers.forEach((driver) => {
      const start = getArmedStart(driver.id);
      if (typeof start === 'number' && Number.isFinite(start)) {
        map[driver.id] = Math.max(0, now - start);
        hasActive = true;
      } else {
        map[driver.id] = null;
      }
    });
    return { map, hasActive };
  }, [drivers, getArmedStart, sessionState.isPaused]);

  useEffect(() => {
    const { map } = computeCurrentLapMap();
    setCurrentLapTimes(map);
  }, [computeCurrentLapMap]);

  useEffect(() => {
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    tickTimerRef.current = setInterval(() => {
      setDisplayTime((prev) => {
        const next = computeDisplayTime();
        return next !== prev ? next : prev;
      });
      setCurrentLapTimes((prev) => {
        const { map: nextMap } = computeCurrentLapMap();
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(nextMap);
        if (
          prevKeys.length === nextKeys.length &&
          nextKeys.every((key) => (prev[key] ?? null) === (nextMap[key] ?? null))
        ) {
          return prev;
        }
        return nextMap;
      });
    }, 250);
    return () => clearInterval(tickTimerRef.current);
  }, [computeDisplayTime, computeCurrentLapMap, sessionState.isPaused]);

  useEffect(() => {
    const wasPaused = wasPausedRef.current;
    if (sessionState.isPaused) {
      if (!wasPaused) {
        pauseEpochRef.current = Date.now();
      }
    } else if (wasPaused) {
      const resumeNow = Date.now();
      const pausedFor =
        typeof pauseEpochRef.current === 'number' && Number.isFinite(pauseEpochRef.current)
          ? resumeNow - pauseEpochRef.current
          : 0;
      pauseEpochRef.current = null;
      if (pausedFor > 0) {
        drivers.forEach((driver) => {
          const start = getArmedStart(driver.id);
          if (typeof start === 'number' && Number.isFinite(start)) {
            setArmedStart(driver.id, start + pausedFor);
          }
        });
      }
    }
    wasPausedRef.current = sessionState.isPaused;
  }, [sessionState.isPaused, drivers, getArmedStart, setArmedStart]);

  const handleDriverPanelLogLap = async (driverId) => {
    if (!canWrite || !driverId) return;
    const now = Date.now();
    const armed = getArmedStart(driverId);
    if (!armed) {
      setArmedStart(driverId, now);
      return;
    }
    try {
      const lapTime = Math.max(1, now - armed);
      await logLapAtomic({ sessionId, driverId, lapTimeMs: lapTime });
      setArmedStart(driverId, now);
    } catch (err) {
      console.error('Panel log lap failed', err);
      setSessionError('Lap logging failed.');
    }
  };

  const togglePitComplete = useCallback(
    async (driver) => {
      if (!canWrite || !isSupabaseConfigured || !supabase || !driver?.id) return;
      try {
        const { data: current, error: selectError } = await supabase
          .from('drivers')
          .select('pit_complete')
          .eq('session_id', sessionId)
          .eq('id', driver.id)
          .maybeSingle();
        if (selectError) throw selectError;
        const next = !(current?.pit_complete ?? false);
        const { error } = await supabase
          .from('drivers')
          .update({ pit_complete: next })
          .eq('session_id', sessionId)
          .eq('id', driver.id);
        if (error) throw error;
      } catch (err) {
        console.error('Failed to toggle pit_complete', err);
        setSessionError('Unable to toggle pit status.');
      }
    },
    [canWrite, sessionId],
  );

  const normalizeKey = (k) => (typeof k === 'string' ? k.toLowerCase() : '');
  const normalizeCode = (c) => (typeof c === 'string' ? c.toLowerCase() : '');

  const symbolToDigit = {
    '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
    '¡': '1', // common Alt+1 on some layouts
  };

  const resolveIndexFromEvent = (event) => {
    const code = normalizeCode(event.code);
    const m = /^(digit|numpad)([0-9])$/.exec(code);
    if (m) {
      const d = m[2];
      const idx = d === '0' ? 9 : Number.parseInt(d, 10) - 1;
      return idx;
    }

    // Fallback to key matching (with symbol → digit normalization)
    const rawKey = event.key;
    const baseKey = symbolToDigit[rawKey] ?? rawKey;
    const key = normalizeKey(baseKey);

    // Also allow matching by configured code names (e.g., 'KeyA')
    const byCode = hotkeys.keys.findIndex((k) => normalizeCode(k) === code);
    if (byCode !== -1) return byCode;

    return hotkeys.keys.findIndex((k) => normalizeKey(k) === key);
  };

  const checkModifier = (event, required) => {
    switch ((required || '').toLowerCase()) {
      case 'alt':
        return event.altKey;
      case 'shift':
        return event.shiftKey;
      case 'control':
      case 'ctrl':
        return event.ctrlKey;
      case 'none':
        return !event.altKey && !event.shiftKey && !event.ctrlKey;
      default:
        return false;
    }
  };

  const handleHotkey = useCallback(
    async (event) => {
      if (!canWrite) return;
      // ignore typing in inputs
      const tag = (event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || event.isComposing) return;
      if (event.type !== 'keyup') return;
      const index = resolveIndexFromEvent(event);
      const driver = drivers[index];
      if (!driver) return;

      event.preventDefault();
      try {
        if (checkModifier(event, hotkeys.invalidateModifier)) {
          // Invalidate last lap (time only)
          await invalidateLastLap({ sessionId, driverId: driver.id, mode: 'time_only' });
          return;
        }
        if (checkModifier(event, hotkeys.pitModifier)) {
          await togglePitComplete(driver);
          return;
        }
        // Log a lap using armed start time per driver. First press arms, second press logs.
        const armed = getArmedStart(driver.id);
        const now = Date.now();
        if (!armed) {
          setArmedStart(driver.id, now);
          return;
        }
        const lapTime = Math.max(1, now - armed);
        await logLapAtomic({ sessionId, driverId: driver.id, lapTimeMs: lapTime });
        setArmedStart(driver.id, now);
      } catch (err) {
        console.error('Hotkey action failed', err);
        setSessionError('Hotkey action failed.');
      }
    },
    [canWrite, drivers, sessionId, togglePitComplete, hotkeys, getArmedStart, setArmedStart],
  );

  useEffect(() => {
    window.addEventListener('keyup', handleHotkey);
    return () => window.removeEventListener('keyup', handleHotkey);
  }, [handleHotkey]);

  // ------- Hotkey settings UI -------
  const [isEditingHotkeys, setIsEditingHotkeys] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState(hotkeys);
  useEffect(() => setHotkeyDraft(hotkeys), [hotkeys]);
  const updateKeyDraft = (idx, value) => {
    setHotkeyDraft((prev) => {
      const next = { ...prev, keys: [...prev.keys] };
      next.keys[idx] = value.slice(0, 10);
      return next;
    });
  };
  const saveHotkeyDraft = () => {
    const sanitized = {
      keys: Array.isArray(hotkeyDraft.keys) && hotkeyDraft.keys.length === 10
        ? hotkeyDraft.keys.map((k) => String(k || '').trim())
        : defaultHotkeys.keys,
      pitModifier: hotkeyDraft.pitModifier || 'Shift',
      invalidateModifier: hotkeyDraft.invalidateModifier || 'Alt',
    };
    saveHotkeys(sanitized);
    setIsEditingHotkeys(false);
  };

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
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span className="text-[10px] uppercase tracking-[0.35em]">Procedure</span>
              <span className="text-sm font-semibold text-white">{procedurePhaseLabel}</span>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <button
              type="button"
              disabled={!canWrite || isPhaseMutating || isRacePhase || procedurePhase === 'warmup'}
              onClick={() => setProcedurePhase('warmup')}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-60 ${
                procedurePhase === 'warmup'
                  ? 'border-amber-400/40 bg-amber-500/20 text-amber-100'
                  : 'border-white/10 bg-black/30 text-white/80 hover:bg-white/10'
              }`}
            >
              Begin Warm-Up
            </button>
            <button
              type="button"
              disabled={!canWrite || isPhaseMutating || isRacePhase || procedurePhase === 'grid'}
              onClick={() => setProcedurePhase('grid')}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-60 ${
                procedurePhase === 'grid'
                  ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-100'
                  : 'border-white/10 bg-black/30 text-white/80 hover:bg-white/10'
              }`}
            >
              Move to Grid
            </button>
          </div>
          <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={gridReadyConfirmed}
              onChange={(event) => {
                if (!isGridPhase) return;
                setGridReadyConfirmed(event.target.checked);
              }}
              disabled={!canWrite || !isGridPhase || isPhaseMutating || isRacePhase}
              className="h-4 w-4 rounded border border-white/20 bg-black/40 text-emerald-400 focus:ring-emerald-400"
            />
            <span className="text-[11px] font-semibold text-neutral-100">Grid ready for race start</span>
          </label>

          <button
            type="button"
            disabled={!canWrite || sessionState.isTiming || !isGridPhase || !gridReadyConfirmed}
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

          <div className="h-6 w-px bg-white/10" />
          <button
            type="button"
            onClick={() => setIsEditingHotkeys((v) => !v)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
          >
            {isEditingHotkeys ? 'Close Hotkeys' : 'Hotkey Settings'}
          </button>
        </div>
        <p className="mt-3 text-[10px] uppercase tracking-[0.35em] text-neutral-500">Keyboard hotkeys 1-0 log laps, shift toggles pit, and Alt invalidates the last lap.</p>

        {isEditingHotkeys ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs uppercase tracking-[0.35em] text-neutral-400">Configure Hotkeys</p>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              {hotkeyDraft.keys.map((val, idx) => (
                <label key={idx} className="flex items-center gap-2 text-xs text-neutral-300">
                  <span className="w-16 text-neutral-500">Slot {idx + 1}</span>
                  <input
                    value={val}
                    onChange={(e) => updateKeyDraft(idx, e.target.value)}
                    placeholder={String(idx + 1)}
                    className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/20"
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 text-xs text-neutral-300">
                <span className="w-40 text-neutral-500">Pit modifier</span>
                <select
                  value={hotkeyDraft.pitModifier}
                  onChange={(e) => setHotkeyDraft((prev) => ({ ...prev, pitModifier: e.target.value }))}
                  className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                  <option>Shift</option>
                  <option>Alt</option>
                  <option>Control</option>
                  <option>None</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-neutral-300">
                <span className="w-40 text-neutral-500">Invalidate modifier</span>
                <select
                  value={hotkeyDraft.invalidateModifier}
                  onChange={(e) => setHotkeyDraft((prev) => ({ ...prev, invalidateModifier: e.target.value }))}
                  className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                  <option>Alt</option>
                  <option>Shift</option>
                  <option>Control</option>
                  <option>None</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setHotkeyDraft(defaultHotkeys)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
              >
                Reset Defaults
              </button>
              <button
                type="button"
                onClick={saveHotkeyDraft}
                className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
              >
                Save Hotkeys
              </button>
            </div>
          </div>
        ) : null}
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
            <DriverTimingPanel
              key={driver.id}
              driver={toPanelDriver(driver)}
              canWrite={canWrite}
              currentLapMs={currentLapTimes[driver.id] ?? null}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
