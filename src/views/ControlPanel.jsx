/**
 * ControlPanel.jsx
 *
 * TIMING ARCHITECTURE:
 * - Session Clock: Global race time tracked in sessionState.raceTime (persisted to DB)
 * - Driver Lap Clocks: Per-driver current lap time tracked server-side in drivers.current_lap_started_at
 *
 * RACE START SYNCHRONIZATION:
 * When procedure_phase transitions from 'grid' → 'race', ALL driver lap timers are initialized
 * server-side at the exact race start moment via initialize_lap_timers_for_session RPC. This ensures:
 *   1. Session clock and all driver lap clocks start simultaneously
 *   2. Live timing displays accurate timing from race start
 *   3. First lap times are calculated from race start, not first manual log
 *   4. Timing persists across page reloads and crashes (server-side storage)
 *
 * LAP LOGGING BEHAVIOR:
 * - Hotkey/click press: Logs the lap (calculates time from server timestamp, resets timer server-side)
 * - All drivers get timers initialized on race start (grid → race phase transition)
 * - Server automatically sets current_lap_started_at when logging a lap (via log_lap_atomic)
 * - Timing survives page crashes and reloads (no localStorage dependency)
 *
 * TIMING PERSISTENCE:
 * - Lap start times stored in database (drivers.current_lap_started_at)
 * - Pause/resume handled server-side in session_state
 * - Reset clears all timers and returns to setup phase
 * - Marshals can safely reload page without losing live lap timing data
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import SingleMarshalBoard from '@/components/SingleMarshalBoard.jsx';
import { useSessionContext, useSessionId } from '@/state/SessionContext.jsx';
import { SessionActionsProvider } from '@/context/SessionActionsContext.jsx';
import { useSessionDrivers } from '@/hooks/useSessionDrivers.js';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { TRACK_STATUS_OPTIONS, TRACK_STATUS_MAP } from '@/constants/trackStatus.js';
import { DEFAULT_SESSION_STATE, sessionRowToState } from '@/utils/raceData.js';
import { formatRaceClock, formatLapTime } from '@/utils/time.js';
import { logLapAtomic, invalidateLastLap } from '@/services/laps.js';
import { finalizeAndExport } from '@/services/results.js';
import { logPitEvent } from '@/services/pitEvents.js';

const createFeedId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

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
  finished: 'Finished',
};

const PROCEDURE_SEQUENCE = ['setup', 'warmup', 'grid', 'race', 'finished'];

const DRIVER_STATUS_META = {
  ready: { label: 'Running', tone: 'text-emerald-200', bg: 'bg-emerald-500/10', border: 'border border-emerald-400/30' },
  active: { label: 'Running', tone: 'text-emerald-200', bg: 'bg-emerald-500/10', border: 'border border-emerald-400/30' },
  finished: { label: 'Finished', tone: 'text-violet-200', bg: 'bg-violet-500/15', border: 'border border-violet-400/30' },
  retired: { label: 'Retired', tone: 'text-amber-200', bg: 'bg-amber-500/15', border: 'border border-amber-400/30' },
  dnf: { label: 'DNF', tone: 'text-rose-200', bg: 'bg-rose-500/15', border: 'border border-rose-400/30' },
  dns: { label: 'DNS', tone: 'text-slate-300', bg: 'bg-slate-500/15', border: 'border border-slate-500/30' },
};

const DRIVER_FLAG_META = {
  none: { label: '—', tone: 'text-slate-400', dot: 'bg-slate-500/40' },
  blue: { label: 'Blue', tone: 'text-sky-200', dot: 'bg-sky-400' },
  black: { label: 'Black', tone: 'text-slate-100', dot: 'bg-slate-50' },
  white: { label: 'White', tone: 'text-slate-100', dot: 'bg-white' },
  yellow: { label: 'Yellow', tone: 'text-amber-200', dot: 'bg-amber-300' },
  red: { label: 'Red', tone: 'text-rose-200', dot: 'bg-rose-300' },
};

const FLAG_HOTKEYS = {
  KeyG: 'green',
  KeyY: 'yellow',
  KeyV: 'vsc',
  KeyS: 'sc',
  KeyR: 'red',
  KeyC: 'checkered',
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
  status: driver.status ?? 'ready',
  driver_flag: driver.driver_flag ?? 'none',
  pit_complete: driver.pit_complete ?? false,
});

export default function ControlPanel() {
  let routerSearchParams;
  let routerSetSearchParams;
  try {
    [routerSearchParams, routerSetSearchParams] = useSearchParams();
  } catch {
    routerSearchParams = null;
    routerSetSearchParams = null;
  }
  const [fallbackLayoutMode, setFallbackLayoutMode] = useState('control');
  const sessionId = useSessionId();
  const { isAdmin: hasAdminAccess } = useSessionContext();
  const { status, user } = useAuth();
  const [userId, setUserId] = useState(null);
  const [role, setRole] = useState(null);
  const [roleError, setRoleError] = useState(null);
  const [isRoleLoading, setIsRoleLoading] = useState(isSupabaseConfigured);

  const layoutParam = routerSearchParams?.get('view');
  const layoutMode = layoutParam === 'marshal' ? 'marshal' : layoutParam === 'control' ? 'control' : fallbackLayoutMode;
  const isMarshalLayout = layoutMode === 'marshal';

  const setLayoutMode = useCallback(
    (mode) => {
      if (routerSetSearchParams) {
        routerSetSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            if (mode === 'control') {
              next.delete('view');
            } else {
              next.set('view', mode);
            }
            return next;
          },
          { replace: true },
        );
      } else {
        setFallbackLayoutMode(mode === 'marshal' ? 'marshal' : 'control');
      }
    },
    [routerSetSearchParams],
  );

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
  useEffect(() => {
    setDriverHeartbeatAt(Date.now());
  }, [drivers]);

  const panelDrivers = useMemo(() => drivers.map(toPanelDriver), [drivers]);
  const driverLookupRef = useRef({});
  useEffect(() => {
    const nextLookup = {};
    panelDrivers.forEach((driver) => {
      nextLookup[driver.id] = driver;
    });
    driverLookupRef.current = nextLookup;
  }, [panelDrivers]);
  const describeDriver = useCallback((driverId) => driverLookupRef.current[driverId] ?? null, []);

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
  const [sessionHeartbeatAt, setSessionHeartbeatAt] = useState(Date.now());
  const [driverHeartbeatAt, setDriverHeartbeatAt] = useState(Date.now());
  const [eventFeed, setEventFeed] = useState([]);
  const [controlFeed, setControlFeed] = useState([]);
  const pushEventEntry = useCallback((entry) => {
    setEventFeed((prev) => [{ id: createFeedId(), timestamp: new Date().toISOString(), ...entry }, ...prev].slice(0, 40));
  }, []);
  const pushControlEntry = useCallback((entry) => {
    setControlFeed((prev) => [{ id: createFeedId(), timestamp: new Date().toISOString(), ...entry }, ...prev].slice(0, 40));
  }, []);
  const [announcementDraft, setAnnouncementDraft] = useState('');
  const [isEditingAnnouncement, setIsEditingAnnouncement] = useState(false);
  const [sessionError, setSessionError] = useState(null);
  const [isActionLocked, setIsActionLocked] = useState(false);
  const [lockWarning, setLockWarning] = useState(false);
  const [gridReadyConfirmed, setGridReadyConfirmed] = useState(false);
  const [isPhaseMutating, setIsPhaseMutating] = useState(false);

  const tickingRef = useRef(false);
  const tickTimerRef = useRef(null);
  const persistTimerRef = useRef(null);

  // Authoritative clock calculation using database fields
  const computeDisplayTime = useCallback(() => {
    if (!sessionState.isTiming) {
      return sessionState.raceTime;
    }

    if (!sessionState.raceStartedAt) {
      return sessionState.raceTime;
    }

    const now = Date.now();
    const raceStartMs = new Date(sessionState.raceStartedAt).getTime();
    const elapsed = now - raceStartMs;
    const accumulatedPause = sessionState.accumulatedPauseMs || 0;

    if (sessionState.isPaused && sessionState.pauseStartedAt) {
      const pauseStartMs = new Date(sessionState.pauseStartedAt).getTime();
      const currentPauseDuration = now - pauseStartMs;
      return elapsed - accumulatedPause - currentPauseDuration;
    }

    return elapsed - accumulatedPause;
  }, [sessionState.isTiming, sessionState.isPaused, sessionState.raceTime, sessionState.raceStartedAt, sessionState.accumulatedPauseMs, sessionState.pauseStartedAt]);

  const procedurePhase = sessionState.procedurePhase ?? 'setup';
  const procedurePhaseLabel = PROCEDURE_PHASE_LABELS[procedurePhase] ?? PROCEDURE_PHASE_LABELS.setup;
  const isGridPhase = procedurePhase === 'grid';
  const isRacePhase = procedurePhase === 'race';

  const applySessionStateRow = useCallback((row) => {
    const next = sessionRowToState(row);
    setSessionState(next);
    setSessionHeartbeatAt(Date.now());
    // Only update announcementDraft if user is not actively editing
    setAnnouncementDraft(prev => isEditingAnnouncement ? prev : (next.announcement ?? ''));
    tickingRef.current = next.isTiming && !next.isPaused;
  }, [isEditingAnnouncement]);

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

  const handleManualRefresh = useCallback(() => {
    setLockWarning(false);
    setSessionError(null);
    void loadSessionState();
  }, [loadSessionState]);

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

  const persistSessionPatch = useCallback(
    async (patch = {}) => {
      if (!isSupabaseConfigured || !supabase) {
        return false;
      }
      if (isActionLocked) {
        setLockWarning(true);
        return false;
      }
      setIsActionLocked(true);
      try {
        const { data, error } = await supabase.rpc('update_session_state_atomic', {
          p_session_id: sessionId,
          p_patch: patch,
        });
        if (error) throw error;
        if (data?.session_state) {
          applySessionStateRow(data.session_state);
          setLockWarning(false);
        }
        return true;
      } finally {
        // Reduce lock timeout from 750ms to 300ms for more responsive UI
        setTimeout(() => setIsActionLocked(false), 300);
      }
    },
    [applySessionStateRow, isActionLocked, isSupabaseConfigured, sessionId, supabase],
  );

  const setProcedurePhase = useCallback(
    async (phase) => {
      if (!canWrite) return;
      if (sessionState.procedurePhase === phase) return;
      setIsPhaseMutating(true);
      try {
        await persistSessionPatch({ procedure_phase: phase });
        const phaseLabel = PROCEDURE_PHASE_LABELS[phase] ?? phase;
        pushControlEntry({
          kind: 'phase',
          title: `Procedure → ${phaseLabel}`,
          subtitle: `Updated by ${roleLabel}`,
          accent: 'text-sky-200',
        });
      } catch (error) {
        console.error('Failed to update procedure phase', error);
        setSessionError('Unable to update procedure phase.');
      } finally {
        setIsPhaseMutating(false);
      }
    },
    [canWrite, persistSessionPatch, pushControlEntry, roleLabel, sessionState.procedurePhase],
  );

  const startTimer = useCallback(async () => {
    if (!canWrite) return;
    if (sessionState.procedurePhase !== 'grid' || !gridReadyConfirmed) {
      return;
    }
    tickingRef.current = true;

    try {
      // Start race clock and initialize all lap timers server-side
      await persistSessionPatch({ command: 'start_clock' });

      // Initialize lap timers for all drivers in the database
      if (isSupabaseConfigured && supabase) {
        await supabase.rpc('initialize_lap_timers_for_session', {
          p_session_id: sessionId,
        });
      }

      pushControlEntry({
        kind: 'timer',
        title: 'Race timer started',
        subtitle: 'Grid → Race',
        accent: 'text-emerald-300',
      });
    } catch (error) {
      console.error('Failed to start race timer', error);
      tickingRef.current = false;
      setSessionError('Unable to start race timer.');
    }
  }, [canWrite, gridReadyConfirmed, persistSessionPatch, pushControlEntry, sessionState.procedurePhase, sessionId]);

  // Server-side lap timing now handled via current_lap_started_at column in database
  // No need for localStorage manipulation or safety net effects

  const pauseTimer = useCallback(async () => {
    if (!canWrite) return;
    tickingRef.current = false;
    try {
      const current = computeDisplayTime();
      await persistSessionPatch({ command: 'pause_clock', race_time_ms: current });
      pushControlEntry({
        kind: 'timer',
        title: 'Race paused',
        subtitle: 'Timer held',
        accent: 'text-amber-200',
      });
    } catch (error) {
      console.error('Failed to pause race timer', error);
      setSessionError('Unable to pause race timer.');
    }
  }, [canWrite, computeDisplayTime, persistSessionPatch, pushControlEntry]);

  const resumeTimer = useCallback(async () => {
    if (!canWrite) return;
    tickingRef.current = true;
    try {
      await persistSessionPatch({ command: 'resume_clock' });
      pushControlEntry({
        kind: 'timer',
        title: 'Race resumed',
        subtitle: 'Green flag',
        accent: 'text-emerald-200',
      });
    } catch (error) {
      console.error('Failed to resume race timer', error);
      setSessionError('Unable to resume race timer.');
    }
  }, [canWrite, persistSessionPatch, pushControlEntry]);

  const resetTimer = useCallback(async () => {
    if (!canWrite) return;
    tickingRef.current = false;

    // Clear all driver lap timers SYNCHRONOUSLY before network round-trip
    // Ensures local operator sees immediate reset
    drivers.forEach((driver) => {
      try {
        const key = `timekeeper.currentLapStart.${sessionId}.${driver.id}`;
        window.localStorage.removeItem(key);
      } catch {
        // ignore localStorage errors
      }
    });

    await persistSessionPatch({ command: 'reset_session', race_time_ms: 0 });
    pushControlEntry({
      kind: 'timer',
      title: 'Session reset',
      subtitle: 'Clock cleared',
      accent: 'text-neutral-300',
    });
  }, [canWrite, persistSessionPatch, pushControlEntry, drivers, sessionId]);

  const finishRace = useCallback(async () => {
    if (!canWrite) return;

    const shouldExport = window.confirm(
      'Finish session and export results?\n\nThis will:\n- Stop timing\n- Calculate final positions\n- Apply penalties\n- Download results as CSV\n\nClick OK to proceed, or Cancel to finish without export.'
    );

    const current = computeDisplayTime();
    tickingRef.current = false;

    // Clear all driver lap timers
    drivers.forEach((driver) => {
      try {
        const key = `timekeeper.currentLapStart.${sessionId}.${driver.id}`;
        window.localStorage.removeItem(key);
      } catch {
        // ignore localStorage errors
      }
    });

    try {
      await persistSessionPatch({ command: 'finish_session', race_time_ms: current });
      if (shouldExport && isSupabaseConfigured && supabase) {
        const sessionName = sessionState.eventType || 'Session';
        await finalizeAndExport(sessionId, sessionName);
        setSessionError(null);
        alert('Results finalized and downloaded successfully!');
      }
      pushControlEntry({
        kind: 'timer',
        title: 'Race finished',
        subtitle: shouldExport ? 'Results exported' : 'Timing stopped',
        accent: 'text-emerald-200',
      });
    } catch (error) {
      console.error('Failed to finish race', error);
      setSessionError(error.message || 'Unable to finish race.');
    }
  }, [canWrite, computeDisplayTime, isSupabaseConfigured, persistSessionPatch, pushControlEntry, drivers, sessionId, sessionState.eventType, supabase]);

  // SAFETY NET: Clear driver lap timers for REMOTE clients/observers
  // When remote clients see procedurePhase change to 'setup' via realtime,
  // they need their timers cleared. Local operator already cleared synchronously
  // in resetTimer callback above.
  useEffect(() => {
    if (sessionState.procedurePhase === 'setup' && !sessionState.isTiming) {
      drivers.forEach((driver) => {
        try {
          const key = `timekeeper.currentLapStart.${sessionId}.${driver.id}`;
          window.localStorage.removeItem(key);
        } catch {
          // ignore localStorage errors
        }
      });
    }
  }, [sessionState.procedurePhase, sessionState.isTiming, drivers, sessionId]);

  // Periodic clock persistence for backward compatibility with LiveTimingBoard
  // The clock is now calculated from race_started_at and accumulated_pause_ms,
  // but we still update race_time_ms for components that haven't been updated yet
  useEffect(() => {
    if (persistTimerRef.current) clearInterval(persistTimerRef.current);
    if (sessionState.isTiming && !sessionState.isPaused && !isSupabaseConfigured) {
      // Only persist for non-Supabase setups (Supabase uses authoritative RPC clock)
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
      const statusLabel = TRACK_STATUS_MAP[normalized]?.label ?? normalized;
      pushControlEntry({
        kind: 'flag',
        title: `Track status → ${statusLabel}`,
        subtitle: TRACK_STATUS_MAP[normalized]?.description ?? '',
        accent: 'text-cyan-200',
      });
    } catch (error) {
      console.error('Failed to update track status', error);
      setSessionError('Unable to update track status.');
    }
  }, [canWrite, persistSessionPatch, pushControlEntry]);

  const handleTrackStatusClick = useCallback(
    async (statusId) => {
      if ((statusId === 'red' || statusId === 'checkered') && !window.confirm(`Confirm ${TRACK_STATUS_MAP[statusId]?.label ?? statusId}?`)) {
        return;
      }
      await setTrackStatus(statusId);
    },
    [setTrackStatus],
  );

  const updateAnnouncement = useCallback(async () => {
    if (!canWrite) return;
    try {
      const text = (announcementDraft ?? '').slice(0, 500);
      await persistSessionPatch({ announcement: text });
      setIsEditingAnnouncement(false); // Stop editing after successful update
      pushControlEntry({
        kind: 'announcement',
        title: text ? 'Announcement updated' : 'Announcement cleared',
        subtitle: text || 'No active announcements',
        accent: 'text-purple-200',
      });
    } catch (error) {
      console.error('Failed to update announcement', error);
      setSessionError('Unable to update announcement.');
    }
  }, [announcementDraft, canWrite, persistSessionPatch, pushControlEntry]);

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

  // Lap timing now handled server-side via drivers.current_lap_started_at
  // No localStorage dependency required

  const [displayTime, setDisplayTime] = useState(0);
  const [currentLapTimes, setCurrentLapTimes] = useState({});
  const computeGapLabel = useCallback((leader, target) => {
    if (!leader || !target || leader.id === target.id) {
      return 'Leader';
    }
    const leaderLaps = leader.laps ?? 0;
    const targetLaps = target.laps ?? 0;
    const lapDiff = leaderLaps - targetLaps;
    if (lapDiff > 0) {
      return `+${lapDiff} lap${lapDiff > 1 ? 's' : ''}`;
    }
    const leaderTime = Number.isFinite(leader.total_time_ms) ? leader.total_time_ms : null;
    const targetTime = Number.isFinite(target.total_time_ms) ? target.total_time_ms : null;
    if (leaderTime !== null && targetTime !== null) {
      const diff = targetTime - leaderTime;
      if (diff > 0) {
        return `+${formatLapTime(diff)}`;
      }
    }
    return '—';
  }, []);
  const driverRows = useMemo(() => {
    const sorted = [...panelDrivers].sort((a, b) => {
      const lapsA = a.laps ?? 0;
      const lapsB = b.laps ?? 0;
      if (lapsA !== lapsB) {
        return lapsB - lapsA;
      }
      const timeA = Number.isFinite(a.total_time_ms) ? a.total_time_ms : Number.POSITIVE_INFINITY;
      const timeB = Number.isFinite(b.total_time_ms) ? b.total_time_ms : Number.POSITIVE_INFINITY;
      return timeA - timeB;
    });
    const leader = sorted[0] ?? null;
    return sorted.map((driver, index) => {
      const prev = index > 0 ? sorted[index - 1] : null;
      return {
        ...driver,
        position: index + 1,
        gap: index === 0 ? 'Leader' : computeGapLabel(leader, driver),
        interval: prev ? computeGapLabel(prev, driver) : '—',
        liveLap: currentLapTimes[driver.id] ?? null,
        lastLapDelta:
          prev && Number.isFinite(driver.last_lap_ms) && Number.isFinite(prev.last_lap_ms)
            ? driver.last_lap_ms - prev.last_lap_ms
            : null,
      };
    });
  }, [panelDrivers, computeGapLabel, currentLapTimes]);
  const bestLapRanks = useMemo(() => {
    const ranking = new Map();
    const valid = panelDrivers
      .filter((driver) => Number.isFinite(driver.best_lap_ms) && driver.best_lap_ms > 0)
      .sort((a, b) => a.best_lap_ms - b.best_lap_ms);
    valid.forEach((driver, index) => {
      ranking.set(driver.id, index + 1);
    });
    return ranking;
  }, [panelDrivers]);
  const resolveHealthState = useCallback((ageMs) => {
    if (ageMs <= 6000) {
      return { label: 'Live', tone: 'text-emerald-200', dot: 'bg-emerald-400' };
    }
    if (ageMs <= 15000) {
      return { label: 'Lagging', tone: 'text-amber-200', dot: 'bg-amber-400' };
    }
    return { label: 'Offline', tone: 'text-rose-200', dot: 'bg-rose-400' };
  }, []);
  const pauseEpochRef = useRef(null);
  const wasPausedRef = useRef(sessionState.isPaused);

  const computeCurrentLapMap = useCallback(() => {
    const now = sessionState.isPaused && pauseEpochRef.current ? pauseEpochRef.current : Date.now();
    const map = {};
    let hasActive = false;
    drivers.forEach((driver) => {
      // Use server-side current_lap_started_at instead of localStorage
      if (driver.current_lap_started_at) {
        const startMs = new Date(driver.current_lap_started_at).getTime();
        if (Number.isFinite(startMs)) {
          map[driver.id] = Math.max(0, now - startMs);
          hasActive = true;
        } else {
          map[driver.id] = null;
        }
      } else {
        map[driver.id] = null;
      }
    });
    return { map, hasActive };
  }, [drivers, sessionState.isPaused]);

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
      pauseEpochRef.current = null;
    }
    wasPausedRef.current = sessionState.isPaused;
  }, [sessionState.isPaused]);

  const handleDriverPanelLogLap = useCallback(
    async (driverId) => {
      if (!canWrite || !driverId) return;

      // Get driver's current lap start time from database
      const driver = panelDrivers.find(d => d.id === driverId);
      if (!driver || !driver.current_lap_started_at) {
        const currentPhase = sessionState.procedurePhase ?? 'unknown';
        const isTiming = sessionState.isTiming;
        console.warn(
          `Cannot log lap: timer not started. Phase: ${currentPhase}, isTiming: ${isTiming}`
        );
        setSessionError(
          `Cannot log lap - timer not started. Current phase: ${currentPhase}. ${currentPhase !== 'race' ? 'Start the race first (Grid → Grid Ready → Start Race).' : 'Race is running but timer not started - check database.'}`
        );
        return;
      }

      try {
        const now = Date.now();
        const startMs = new Date(driver.current_lap_started_at).getTime();
        const lapTime = Math.max(1, now - startMs);
        await logLapAtomic({ sessionId, driverId, lapTimeMs: lapTime });
        // Server automatically sets current_lap_started_at for next lap
        const driverInfo = describeDriver(driverId);
        pushEventEntry({
          kind: 'lap',
          title: `${driverInfo?.name ?? 'Driver'} lap logged`,
          subtitle: driverInfo?.number ? `Car #${driverInfo.number}` : null,
          accent: 'text-emerald-300',
        });
      } catch (err) {
        console.error('Panel log lap failed', err);
        setSessionError(`Lap logging failed: ${err.message || 'Unknown error'}`);
      }
    },
    [canWrite, describeDriver, panelDrivers, pushEventEntry, sessionId, setSessionError, sessionState.procedurePhase, sessionState.isTiming],
  );

  const handlePitIn = useCallback(
    async (driverId) => {
      if (!canWrite || !driverId) return;
      try {
        await logPitEvent({ sessionId, driverId, eventType: 'in' });
        const driverInfo = describeDriver(driverId);
        pushEventEntry({
          kind: 'pit',
          title: `${driverInfo?.name ?? 'Driver'} entered pit`,
          subtitle: driverInfo?.number ? `Car #${driverInfo.number}` : null,
          accent: 'text-amber-300',
        });
      } catch (err) {
        console.error('Pit in failed', err);
        setSessionError(`Pit in failed: ${err.message || 'Unknown error'}`);
      }
    },
    [canWrite, describeDriver, pushEventEntry, sessionId]
  );

  const handlePitOut = useCallback(
    async (driverId) => {
      if (!canWrite || !driverId) return;
      try {
        await logPitEvent({ sessionId, driverId, eventType: 'out' });
        const driverInfo = describeDriver(driverId);
        pushEventEntry({
          kind: 'pit',
          title: `${driverInfo?.name ?? 'Driver'} exited pit`,
          subtitle: driverInfo?.number ? `Car #${driverInfo.number}` : null,
          accent: 'text-cyan-300',
        });
      } catch (err) {
        console.error('Pit out failed', err);
        setSessionError(`Pit out failed: ${err.message || 'Unknown error'}`);
      }
    },
    [canWrite, describeDriver, pushEventEntry, sessionId]
  );

  const handleInvalidateLap = useCallback(
    async ({ driverId, mode = 'time_only' }) => {
      if (!canWrite || !driverId) return false;
      try {
        await invalidateLastLap({ sessionId, driverId, mode });
        const driverInfo = describeDriver(driverId);
        pushEventEntry({
          kind: 'lap',
          title:
            mode === 'remove_lap'
              ? `${driverInfo?.name ?? 'Driver'} lap removed`
              : `${driverInfo?.name ?? 'Driver'} lap invalidated`,
          subtitle: driverInfo?.number ? `Car #${driverInfo.number}` : null,
          accent: mode === 'remove_lap' ? 'text-rose-300' : 'text-amber-200',
        });
        return true;
      } catch (err) {
        console.error('Lap invalidation failed', err);
        setSessionError('Lap invalidation failed.');
        return false;
      }
    },
    [canWrite, describeDriver, pushEventEntry, sessionId, setSessionError],
  );

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
    [canWrite, isSupabaseConfigured, sessionId, setSessionError, supabase],
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
      const tag = (event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || event.isComposing) return;
      if (event.type !== 'keyup') return;
      const code = event.code || '';

      if (code === 'Space') {
        event.preventDefault();
        if (sessionState.isTiming && !sessionState.isPaused) {
          await pauseTimer();
          return;
        }
        if (sessionState.isTiming && sessionState.isPaused) {
          await resumeTimer();
          return;
        }
        if (!sessionState.isTiming && sessionState.procedurePhase === 'grid' && gridReadyConfirmed) {
          await startTimer();
        }
        return;
      }

      if (code === 'KeyF' && sessionState.procedurePhase === 'race') {
        event.preventDefault();
        await finishRace();
        return;
      }

      const flagTarget = FLAG_HOTKEYS[code];
      if (flagTarget) {
        event.preventDefault();
        if ((flagTarget === 'red' || flagTarget === 'checkered') && !window.confirm(`Confirm ${flagTarget} flag?`)) {
          return;
        }
        await setTrackStatus(flagTarget);
        return;
      }

      const index = resolveIndexFromEvent(event);
      if (index === -1) return;
      const driver = drivers[index];
      if (!driver) return;

      event.preventDefault();
      try {
        if (checkModifier(event, hotkeys.invalidateModifier)) {
          const invalidated = await handleInvalidateLap({ driverId: driver.id, mode: 'time_only' });
          if (invalidated) return;
        }
        if (checkModifier(event, hotkeys.pitModifier)) {
          await togglePitComplete(driver);
          return;
        }
        // Check if driver has server-side lap timer started
        if (!driver.current_lap_started_at) {
          const currentPhase = sessionState.procedurePhase ?? 'unknown';
          const isTiming = sessionState.isTiming;
          console.warn(
            `Cannot log lap via hotkey: timer not started. Driver: ${driver.name}, Phase: ${currentPhase}, isTiming: ${isTiming}`
          );
          setSessionError(
            `Cannot log lap for ${driver.name} - timer not started. Current phase: ${currentPhase}. ${
              currentPhase !== 'race'
                ? 'Start the race first (Grid → Grid Ready → Start Race).'
                : 'Race is running but timer not started - check database.'
            }`
          );
          return;
        }
        const now = Date.now();
        const startMs = new Date(driver.current_lap_started_at).getTime();
        const lapTime = Math.max(1, now - startMs);
        await logLapAtomic({ sessionId, driverId: driver.id, lapTimeMs: lapTime });
        // Server automatically sets current_lap_started_at for next lap
      } catch (err) {
        console.error('Hotkey action failed', err);
        setSessionError(`Hotkey failed: ${err.message || 'Unknown error'}`);
      }
    },
    [
      canWrite,
      drivers,
      finishRace,
      gridReadyConfirmed,
      handleInvalidateLap,
      hotkeys,
      pauseTimer,
      resumeTimer,
      setSessionError,
      sessionId,
      sessionState.isPaused,
      sessionState.isTiming,
      sessionState.procedurePhase,
      setTrackStatus,
      startTimer,
      togglePitComplete,
    ],
  );

  useEffect(() => {
    window.addEventListener('keyup', handleHotkey);
    return () => window.removeEventListener('keyup', handleHotkey);
  }, [handleHotkey]);

  // ------- Hotkey settings UI -------
  const [isEditingHotkeys, setIsEditingHotkeys] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState(hotkeys);
  useEffect(() => setHotkeyDraft(hotkeys), [hotkeys]);
  useEffect(() => {
    if (isMarshalLayout) {
      setIsEditingHotkeys(false);
    }
  }, [isMarshalLayout]);
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

  const sessionActionsValue = useMemo(
    () => ({
      onLogLap: handleDriverPanelLogLap,
      invalidateLastLap: handleInvalidateLap,
      canWrite,
    }),
    [handleDriverPanelLogLap, handleInvalidateLap, canWrite],
  );

  const invalidateLapTimeOnly = useCallback(
    async (driverId) => handleInvalidateLap({ driverId, mode: 'time_only' }),
    [handleInvalidateLap],
  );
  const removeLap = useCallback(
    async (driverId) => handleInvalidateLap({ driverId, mode: 'remove_lap' }),
    [handleInvalidateLap],
  );

  const sessionStatusLabel = useMemo(() => {
    if (procedurePhase === 'finished') return 'Completed';
    if (procedurePhase === 'race' || procedurePhase === 'grid') return 'Active';
    if (procedurePhase === 'warmup') return 'Warm-Up';
    return 'Scheduled';
  }, [procedurePhase]);
  const phaseChipClass = useMemo(() => {
    switch (procedurePhase) {
      case 'grid':
        return 'border-cyan-400/40 bg-cyan-500/20 text-cyan-100';
      case 'race':
        return 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100';
      case 'finished':
        return 'border-violet-400/40 bg-violet-500/20 text-violet-100';
      case 'warmup':
        return 'border-amber-400/40 bg-amber-500/20 text-amber-100';
      default:
        return 'border-white/10 bg-white/5 text-white/80';
    }
  }, [procedurePhase]);
  const now = Date.now();
  const realtimeHealth = resolveHealthState(Math.max(0, now - sessionHeartbeatAt));
  const lapFeedHealth = resolveHealthState(Math.max(0, now - driverHeartbeatAt));
  const dbHealth = sessionError
    ? { label: 'Error', tone: 'text-rose-200', dot: 'bg-rose-500' }
    : { label: 'OK', tone: 'text-emerald-200', dot: 'bg-emerald-400' };
  const trackStatusMeta = TRACK_STATUS_MAP[sessionState.trackStatus] ?? TRACK_STATUS_OPTIONS[0];
  const leaderLaps = Number.isFinite(driverRows[0]?.laps) ? driverRows[0].laps : 0;
  const lapProgressLabel = sessionState.totalLaps
    ? `${Math.max(leaderLaps || 0, 0)} / ${sessionState.totalLaps}`
    : leaderLaps || '—';
  const eventFeedItems = eventFeed.slice(0, 10);
  const controlFeedItems = controlFeed.slice(0, 10);
  const driverTableEmpty = !drivers.length && !isDriversLoading;

  const layoutButtonClass = (mode) =>
    mode === layoutMode
      ? 'border-white/40 bg-white/15 text-white'
      : 'border-white/10 text-white/70 hover:border-white/30 hover:text-white';

  return (
    <SessionActionsProvider value={sessionActionsValue}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="rounded-3xl border border-white/5 bg-[#04060C]/95 p-6 text-white shadow-2xl shadow-black/60">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.45em] text-sky-300/80">DayBreak Grand Prix</p>
              <h1 className="text-3xl font-semibold">Race Control</h1>
              <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.35em] text-neutral-400">
                <span className="rounded-full border border-white/10 px-3 py-1 text-white/80">Session {sessionId.slice(0, 8)}…</span>
                <span className="rounded-full border border-white/10 px-3 py-1 text-white/90">{roleLabel}</span>
                <span className="rounded-full border border-white/10 px-3 py-1 text-white/90">{sessionStatusLabel}</span>
                <span className={`rounded-full px-3 py-1 font-semibold ${phaseChipClass}`}>
                  {procedurePhaseLabel}
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="font-mono text-5xl tracking-tight">{formatRaceClock(displayTime)}</p>
              <p className="text-sm text-neutral-400">Laps {lapProgressLabel}</p>
            </div>
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.4em] text-neutral-500">Track</p>
                <p className="text-lg font-semibold">
                  {trackStatusMeta?.label ?? 'Green Flag'}
                </p>
                <p className="text-xs text-neutral-400">
                  {trackStatusMeta?.description ?? 'Track clear. Full racing speed permitted.'}
                </p>
              </div>
              <div className="space-y-2 text-xs text-neutral-400">
                {[ 
                  { label: 'Realtime', health: realtimeHealth },
                  { label: 'Lap Feed', health: lapFeedHealth },
                  { label: 'DB', health: dbHealth },
                ].map((indicator) => (
                  <div key={indicator.label} className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${indicator.health.dot}`} />
                    <span className="text-[10px] uppercase tracking-[0.35em]">{indicator.label}</span>
                    <span className={`text-sm font-semibold ${indicator.health.tone}`}>
                      {indicator.health.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => refresh?.()}
                disabled={isDriversLoading}
                className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-white/80 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDriversLoading ? 'Refreshing…' : 'Refresh Data'}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLayoutMode('control')}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] transition ${layoutButtonClass('control')}`}
                >
                  Control Layout
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode('marshal')}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] transition ${layoutButtonClass('marshal')}`}
                >
                  Marshal Layout
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.35em] text-neutral-400">
              <span className="rounded-full border border-white/10 px-3 py-1">{sessionState.eventType}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">{sessionState.totalLaps} laps</span>
              <span className="rounded-full border border-white/10 px-3 py-1">{sessionState.totalDuration} min</span>
            </div>
          </div>
        </section>

        {roleError ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">{roleError}</div>
        ) : null}
        {driversError ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">{driversError}</div>
        ) : null}
        {sessionError ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">{sessionError}</div>
        ) : null}
        {lockWarning ? (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-6 py-4 text-sm text-amber-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>Previous action is still processing to prevent duplicate logs. Wait a moment or refresh the session state.</p>
              <button
                type="button"
                onClick={handleManualRefresh}
                className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-white transition hover:border-white/40"
              >
                Refresh session state
              </button>
            </div>
          </div>
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

        {isMarshalLayout ? (
          <SingleMarshalBoard
            sessionId={sessionId}
            drivers={panelDrivers}
            currentLapTimes={currentLapTimes}
            sessionState={sessionState}
            displayTime={displayTime}
            canWrite={canWrite}
            onLogLap={handleDriverPanelLogLap}
            onInvalidateLap={invalidateLapTimeOnly}
            onRemoveLap={removeLap}
            onPitIn={handlePitIn}
            onPitOut={handlePitOut}
          />
        ) : (
          <>
            <section className="rounded-3xl border border-white/5 bg-[#05070F]/85 p-6">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.35em] text-neutral-500">Phase</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PROCEDURE_SEQUENCE.map((phaseKey) => {
                      const label = PROCEDURE_PHASE_LABELS[phaseKey] ?? phaseKey;
                      const isActive = procedurePhase === phaseKey;
                      const blockChange = phaseKey === 'race' || phaseKey === 'finished';
                      const disabled =
                        !canWrite || isPhaseMutating || blockChange || procedurePhase === phaseKey;
                      return (
                        <button
                          key={phaseKey}
                          type="button"
                          disabled={disabled}
                          onClick={() => setProcedurePhase(phaseKey)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            isActive
                              ? 'border-white/40 bg-white/15 text-white'
                              : 'border-white/10 text-white/70 hover:border-white/30 hover:text-white'
                          } disabled:cursor-not-allowed disabled:opacity-40`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-neutral-300">
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
                  Grid ready
                </label>
              </div>

              <div className="mt-6 flex flex-wrap gap-4">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={startTimer}
                    disabled={!canWrite || sessionState.isTiming || !isGridPhase || !gridReadyConfirmed}
                    className="flex flex-col rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-3 text-left text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="text-sm font-semibold">Start Clock</span>
                    <span className="text-[10px] uppercase tracking-[0.35em] text-emerald-100/80">Space</span>
                  </button>
                  <button
                    type="button"
                    onClick={pauseTimer}
                    disabled={!canWrite || !sessionState.isTiming || sessionState.isPaused}
                    className="flex flex-col rounded-2xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-left text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="text-sm font-semibold">Pause</span>
                    <span className="text-[10px] uppercase tracking-[0.35em] text-amber-100/80">Space</span>
                  </button>
                  <button
                    type="button"
                    onClick={resumeTimer}
                    disabled={!canWrite || !sessionState.isPaused}
                    className="flex flex-col rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-left text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="text-sm font-semibold">Resume</span>
                    <span className="text-[10px] uppercase tracking-[0.35em] text-emerald-100/80">Space</span>
                  </button>
                  <button
                    type="button"
                    onClick={finishRace}
                    disabled={!canWrite || procedurePhase === 'finished'}
                    className="flex flex-col rounded-2xl border border-violet-400/40 bg-violet-500/15 px-4 py-3 text-left text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="text-sm font-semibold">Finish Session</span>
                    <span className="text-[10px] uppercase tracking-[0.35em] text-violet-100/80">F</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {TRACK_STATUS_OPTIONS.map((status) => {
                    const active = sessionState.trackStatus === status.id;
                    return (
                      <button
                        key={status.id}
                        type="button"
                        onClick={() => handleTrackStatusClick(status.id)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.35em] ${
                          active ? status.controlClass : 'border border-white/10 text-white/70 hover:border-white/30'
                        }`}
                        disabled={!canWrite}
                      >
                        {status.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-3xl border border-white/5 bg-[#05070F]/85">
                <div className="flex items-center justify-between border-b border-white/5 px-4 py-3 text-xs uppercase tracking-[0.35em] text-neutral-400">
                  <span>Driver Timing Grid</span>
                  <span>{drivers.length} entries</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-white/5 text-sm text-white">
                    <thead className="bg-white/5 text-xs uppercase tracking-[0.3em] text-neutral-400">
                      <tr>
                        <th className="px-4 py-3 text-left">Pos</th>
                        <th className="px-4 py-3 text-left">Car / Driver</th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-4 py-3 text-left">Laps</th>
                        <th className="px-4 py-3 text-left">Last Lap</th>
                        <th className="px-4 py-3 text-left">Best</th>
                        <th className="px-4 py-3 text-left">Gap</th>
                        <th className="px-4 py-3 text-left">Interval</th>
                        <th className="px-4 py-3 text-left">Live</th>
                        <th className="px-4 py-3 text-left">Pits</th>
                        <th className="px-4 py-3 text-left">Flag</th>
                        <th className="px-4 py-3 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {isDriversLoading ? (
                        <tr>
                          <td colSpan={12} className="px-4 py-6 text-center text-sm text-neutral-400">
                            Loading drivers…
                          </td>
                        </tr>
                      ) : null}
                      {driverTableEmpty ? (
                        <tr>
                          <td colSpan={12} className="px-4 py-6 text-center text-sm text-neutral-400">
                            No drivers are configured for this session.
                          </td>
                        </tr>
                      ) : null}
                      {driverRows.map((driver) => {
                        const statusMeta =
                          DRIVER_STATUS_META[(driver.status ?? 'ready').toLowerCase()] ??
                          {
                            label: driver.status ?? '—',
                            tone: 'text-neutral-200',
                            bg: 'bg-white/10',
                            border: 'border border-white/10',
                          };
                        const flagMeta =
                          DRIVER_FLAG_META[(driver.driver_flag ?? 'none').toLowerCase()] ??
                          DRIVER_FLAG_META.none;
                        const lastLapLabel = Number.isFinite(driver.last_lap_ms)
                          ? formatLapTime(driver.last_lap_ms)
                          : '—';
                        const lastLapDelta = Number.isFinite(driver.lastLapDelta)
                          ? `${driver.lastLapDelta > 0 ? '+' : '−'}${formatLapTime(
                              Math.abs(driver.lastLapDelta),
                            )}`
                          : null;
                        const bestLapLabel = Number.isFinite(driver.best_lap_ms)
                          ? formatLapTime(driver.best_lap_ms)
                          : '—';
                        const bestRank = bestLapRanks.get(driver.id);
                        const liveLapLabel = Number.isFinite(driver.liveLap)
                          ? formatLapTime(driver.liveLap)
                          : '—';
                        const lapCountLabel = sessionState.totalLaps
                          ? `${driver.laps ?? 0} / ${sessionState.totalLaps}`
                          : driver.laps ?? '—';
                        return (
                          <tr key={driver.id} className="hover:bg-white/5">
                            <td className="px-4 py-3 font-mono text-xs text-neutral-400">{driver.position}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="text-2xl font-semibold text-neutral-200">
                                  {driver.number ?? '—'}
                                </div>
                                <div>
                                  <p className="font-semibold">{driver.name}</p>
                                  <p className="text-xs text-neutral-400">{driver.team ?? '—'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.bg} ${statusMeta.tone} ${statusMeta.border}`}>
                                {statusMeta.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-sm">{lapCountLabel}</td>
                            <td className="px-4 py-3 font-mono text-sm">
                              <div className="flex flex-col">
                                <span>{lastLapLabel}</span>
                                {lastLapDelta ? (
                                  <span className="text-xs text-neutral-400">{lastLapDelta}</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono text-sm">
                              <div className="flex flex-col">
                                <span>{bestLapLabel}</span>
                                {bestRank ? (
                                  <span className="text-xs text-neutral-400">P{bestRank}</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono text-sm text-neutral-100">{driver.gap}</td>
                            <td className="px-4 py-3 font-mono text-sm text-neutral-100">{driver.interval}</td>
                            <td className="px-4 py-3 font-mono text-sm">{liveLapLabel}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="font-mono text-sm">
                                {driver.pits ?? 0}
                                {driver.pit_complete ? ' ✓' : ''}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-xs ${flagMeta.tone}`}>
                                <span className={`h-2 w-2 rounded-full ${flagMeta.dot}`} />
                                {flagMeta.label}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleDriverPanelLogLap(driver.id)}
                                  disabled={!canWrite || !sessionState.isTiming}
                                  className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/80 hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Lap
                                </button>
                                <button
                                  type="button"
                                  onClick={() => invalidateLapTimeOnly(driver.id)}
                                  disabled={!canWrite}
                                  className="rounded-full border border-amber-400/40 px-3 py-1 text-xs text-amber-100 hover:border-amber-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Invalidate
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeLap(driver.id)}
                                  disabled={!canWrite}
                                  className="rounded-full border border-rose-400/40 px-3 py-1 text-xs text-rose-100 hover:border-rose-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Remove
                                </button>
                                <button
                                  type="button"
                                  onClick={() => togglePitComplete(driver)}
                                  disabled={!canWrite}
                                  className="rounded-full border border-cyan-400/40 px-3 py-1 text-xs text-cyan-100 hover:border-cyan-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Pit
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="rounded-3xl border border-white/5 bg-[#070A14]/85 p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm uppercase tracking-[0.35em] text-neutral-400">Race Events</h3>
                    <span className="text-xs text-neutral-500">{eventFeedItems.length} entries</span>
                  </div>
                  {eventFeedItems.length === 0 ? (
                    <p className="text-sm text-neutral-400">Events will appear once laps, pits, or penalties are logged.</p>
                  ) : (
                    <div className="space-y-3">
                      {eventFeedItems.map((entry) => (
                        <div key={entry.id} className="rounded-2xl border border-white/5 bg-black/30 px-3 py-2">
                          <div className="flex items-center justify-between text-[11px] text-neutral-500">
                            <span className="uppercase tracking-[0.35em]">{entry.kind ?? 'Event'}</span>
                            <span>{formatFeedTimestamp(entry.timestamp)}</span>
                          </div>
                          <p className={`text-sm font-semibold ${entry.accent ?? 'text-white'}`}>{entry.title}</p>
                          {entry.subtitle ? (
                            <p className="text-xs text-neutral-400">{entry.subtitle}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-white/5 bg-[#070A14]/85 p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm uppercase tracking-[0.35em] text-neutral-400">Control Feed</h3>
                    <span className="text-xs text-neutral-500">{controlFeedItems.length} entries</span>
                  </div>
                  {controlFeedItems.length === 0 ? (
                    <p className="text-sm text-neutral-400">Clock, flag, and announcement changes will appear here.</p>
                  ) : (
                    <div className="space-y-3">
                      {controlFeedItems.map((entry) => (
                        <div key={entry.id} className="rounded-2xl border border-white/5 bg-black/30 px-3 py-2">
                          <div className="flex items-center justify-between text-[11px] text-neutral-500">
                            <span className="uppercase tracking-[0.35em]">{entry.kind ?? 'Control'}</span>
                            <span>{formatFeedTimestamp(entry.timestamp)}</span>
                          </div>
                          <p className={`text-sm font-semibold ${entry.accent ?? 'text-white'}`}>{entry.title}</p>
                          {entry.subtitle ? (
                            <p className="text-xs text-neutral-400">{entry.subtitle}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-white/5 bg-[#070A14]/85 p-5">
                  <h3 className="text-sm uppercase tracking-[0.35em] text-neutral-400">Live Announcement</h3>
                  <p className="mt-2 text-sm text-neutral-300">
                    {sessionState.announcement?.trim() ? sessionState.announcement : 'No active announcements.'}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      value={announcementDraft}
                      onChange={(e) => {
                        setAnnouncementDraft(e.target.value);
                        setIsEditingAnnouncement(true);
                      }}
                      onFocus={() => setIsEditingAnnouncement(true)}
                      onBlur={() => setIsEditingAnnouncement(false)}
                      placeholder="Enter live message…"
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

                <div className="rounded-3xl border border-white/5 bg-[#070A14]/85 p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm uppercase tracking-[0.35em] text-neutral-400">Hotkeys</h3>
                    <button
                      type="button"
                      onClick={() => setIsEditingHotkeys((prev) => !prev)}
                      className="text-xs text-[#9FF7D3] transition hover:text-white"
                    >
                      {isEditingHotkeys ? 'Close' : 'Edit'}
                    </button>
                  </div>
                  <div className="space-y-2 text-sm text-neutral-300">
                    <div className="flex items-center justify-between">
                      <span>Digits 1–0</span>
                      <span className="text-xs uppercase tracking-[0.35em] text-neutral-500">Log lap</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>{hotkeys.pitModifier || 'Shift'} + Digit</span>
                      <span className="text-xs uppercase tracking-[0.35em] text-neutral-500">Toggle pit</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>{hotkeys.invalidateModifier || 'Alt'} + Digit</span>
                      <span className="text-xs uppercase tracking-[0.35em] text-neutral-500">Invalidate lap</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Space</span>
                      <span className="text-xs uppercase tracking-[0.35em] text-neutral-500">Start / Pause / Resume</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>G / V / S / R / C</span>
                      <span className="text-xs uppercase tracking-[0.35em] text-neutral-500">Flag presets</span>
                    </div>
                  </div>

                  {isEditingHotkeys ? (
                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-5 gap-2">
                        {hotkeyDraft.keys.map((key, index) => (
                          <input
                            key={`${index}-${hotkeys.keys[index]}`}
                            type="text"
                            value={key}
                            onChange={(event) => updateKeyDraft(index, event.target.value)}
                            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-center text-xs text-white focus:border-white/40 focus:outline-none"
                          />
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs text-neutral-300">
                        <label className="flex flex-col gap-1">
                          <span>Pit modifier</span>
                          <select
                            value={hotkeyDraft.pitModifier}
                            onChange={(event) =>
                              setHotkeyDraft((prev) => ({ ...prev, pitModifier: event.target.value }))
                            }
                            className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-white focus:border-white/40 focus:outline-none"
                          >
                            {['Shift', 'Alt', 'Ctrl', 'None'].map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span>Invalidate modifier</span>
                          <select
                            value={hotkeyDraft.invalidateModifier}
                            onChange={(event) =>
                              setHotkeyDraft((prev) => ({ ...prev, invalidateModifier: event.target.value }))
                            }
                            className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-white focus:border-white/40 focus:outline-none"
                          >
                            {['Alt', 'Shift', 'Ctrl', 'None'].map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setHotkeyDraft(defaultHotkeys)}
                          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:border-white/30 hover:text-white"
                        >
                          Reset Defaults
                        </button>
                        <button
                          type="button"
                          onClick={saveHotkeyDraft}
                          className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
                        >
                          Save Hotkeys
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </SessionActionsProvider>
  );
}
