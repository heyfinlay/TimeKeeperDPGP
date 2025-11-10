import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Car,
  Clock,
  Flag,
  Gauge,
  Megaphone,
  StopCircle,
  Trophy,
} from 'lucide-react';
import { formatLapTime, formatRaceClock } from '../utils/time';
import { TRACK_STATUS_MAP, TRACK_STATUS_OPTIONS } from '../constants/trackStatus';
import {
  DEFAULT_SESSION_STATE,
  LEGACY_SESSION_ID,
  groupLapRows,
  hydrateDriverState,
  sessionRowToState,
} from '../utils/raceData';
import { isColumnMissingError, isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';
import { useEventSession } from '../context/SessionContext.jsx';

const PROCEDURE_PHASE_DETAILS = {
  setup: {
    label: 'Pre-Session',
    badgeClass: 'border-white/10 bg-white/5 text-white/80',
  },
  warmup: {
    label: 'Warm-Up',
    badgeClass: 'border-amber-400/40 bg-amber-500/20 text-amber-100',
  },
  grid: {
    label: 'Grid',
    badgeClass: 'border-sky-400/40 bg-sky-500/20 text-sky-100',
  },
  race: {
    label: 'Race',
    badgeClass: 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100',
  },
};

const STATUS_ICON_MAP = {
  flag: Flag,
  alert: AlertTriangle,
  gauge: Gauge,
  car: Car,
  stop: StopCircle,
};

const LiveTimingBoard = ({ sessionId: sessionIdProp = null }) => {
  const {
    activeSessionId: contextActiveSessionId,
    sessions,
    supportsSessions,
    fallbackToLegacySchema,
    selectSession,
  } = useEventSession();
  const activeSessionId = sessionIdProp ?? contextActiveSessionId;
  const [drivers, setDrivers] = useState([]);
  const [sessionState, setSessionState] = useState(DEFAULT_SESSION_STATE);
  const [displayTime, setDisplayTime] = useState(0);
  const [laps, setLaps] = useState([]);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState(null);
  const raceClockRef = useRef({ base: 0, capturedAt: Date.now() });

  // Authoritative clock calculation using database timestamps
  const deriveDisplayTime = useCallback((state) => {
    if (!state) {
      return 0;
    }

    // If not timing, return the stored race time
    if (!state.isTiming) {
      return state.raceTime || 0;
    }

    // If no race start timestamp, fall back to race_time_ms
    if (!state.raceStartedAt) {
      return state.raceTime || 0;
    }

    const now = Date.now();
    const raceStartMs = new Date(state.raceStartedAt).getTime();
    const elapsed = now - raceStartMs;
    const accumulatedPause = state.accumulatedPauseMs || 0;

    // If paused, subtract current pause duration
    if (state.isPaused && state.pauseStartedAt) {
      const pauseStartMs = new Date(state.pauseStartedAt).getTime();
      const currentPauseDuration = now - pauseStartMs;
      return elapsed - accumulatedPause - currentPauseDuration;
    }

    return elapsed - accumulatedPause;
  }, []);

  const computeDisplayTime = useCallback(
    () => deriveDisplayTime(sessionState),
    [deriveDisplayTime, sessionState],
  );

  const sessionId = activeSessionId ?? LEGACY_SESSION_ID;

  useEffect(() => {
    if (sessionIdProp && sessionIdProp !== contextActiveSessionId) {
      selectSession(sessionIdProp);
    }
  }, [contextActiveSessionId, selectSession, sessionIdProp]);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const supabaseClient = supabase;
  const supabaseReady = isSupabaseConfigured && Boolean(supabaseClient);

  const trackStatusDetails =
    TRACK_STATUS_MAP[sessionState.trackStatus] ?? TRACK_STATUS_OPTIONS[0];
  const TrackStatusIcon =
    STATUS_ICON_MAP[trackStatusDetails?.icon ?? 'flag'] ?? STATUS_ICON_MAP.flag;
  const procedurePhase = sessionState.procedurePhase ?? 'setup';
  const procedurePhaseDetails =
    PROCEDURE_PHASE_DETAILS[procedurePhase] ?? PROCEDURE_PHASE_DETAILS.setup;

  const applySessionFilter = useCallback(
    (query, sessionOverride = sessionId) =>
      supportsSessions && sessionOverride
        ? query.eq('session_id', sessionOverride)
        : query,
    [supportsSessions, sessionId],
  );

  const handleSchemaMismatch = useCallback(
    (schemaError) => {
      if (isColumnMissingError(schemaError, 'session_id')) {
        console.warn('Supabase schema missing session_id column. Falling back to legacy mode.');
        fallbackToLegacySchema();
        return true;
      }
      return false;
    },
    [fallbackToLegacySchema],
  );

  const refreshDriverData = useCallback(async () => {
    if (!supabaseReady) return;
    try {
      const driverQuery = applySessionFilter(
        supabaseClient.from('drivers').select('*').order('number', { ascending: true }),
      );
      const lapQuery = applySessionFilter(
        supabaseClient.from('laps').select('*').order('lap_number', { ascending: true }),
      );

      const [driverResult, lapResult] = await Promise.all([driverQuery, lapQuery]);
      if (driverResult.error) {
        throw driverResult.error;
      }
      if (lapResult.error) {
        throw lapResult.error;
      }

      const normalizedLapRows = (lapResult.data ?? []).map((lap) => ({
        ...lap,
        lap_number:
          typeof lap.lap_number === 'string' ? Number.parseInt(lap.lap_number, 10) : lap.lap_number,
        lap_time_ms:
          typeof lap.lap_time_ms === 'string'
            ? Number.parseInt(lap.lap_time_ms, 10)
            : lap.lap_time_ms,
      }));
      const lapMap = groupLapRows(normalizedLapRows);
      if (Array.isArray(driverResult.data)) {
        setDrivers(driverResult.data.map((row) => hydrateDriverState(row, lapMap)));
      } else {
        setDrivers([]);
      }
      setLaps(normalizedLapRows);
      setError(null);
    } catch (refreshError) {
      if (handleSchemaMismatch(refreshError)) {
        setError(null);
        return;
      }
      console.error('Failed to refresh timing data', refreshError);
      setError('Unable to refresh timing data from Supabase.');
    }
  }, [applySessionFilter, handleSchemaMismatch, supabaseClient, supabaseReady]);

  const applySessionStateRow = useCallback(
    (row) => {
      const next = sessionRowToState(row);
      // Keep raceClockRef for backwards compatibility but don't rely on it
      raceClockRef.current = {
        base: Number.isFinite(next.raceTime) ? next.raceTime : 0,
        capturedAt: Date.now(),
      };
      setSessionState(next);
      setDisplayTime(deriveDisplayTime(next));
    },
    [deriveDisplayTime],
  );

  const refreshSessionState = useCallback(async () => {
    if (!supabaseReady) return;
    try {
      let query = supabaseClient.from('session_state').select('*');
      const shouldFilterBySession = supportsSessions && sessionId;
      if (shouldFilterBySession) {
        query = applySessionFilter(query);
        const { data, error } = await query.maybeSingle();
        if (error) {
          throw error;
        }
        if (data) {
          applySessionStateRow(data);
        }
      } else {
        const { data, error } = await query.limit(1);
        if (error) {
          throw error;
        }
        const [firstRow] = Array.isArray(data) ? data : [];
        if (firstRow) {
          applySessionStateRow(firstRow);
        }
      }
    } catch (sessionError) {
      if (handleSchemaMismatch(sessionError)) {
        setError(null);
        return;
      }
      console.error('Failed to refresh session state', sessionError);
      setError('Unable to refresh session details from Supabase.');
    }
  }, [
    applySessionFilter,
    applySessionStateRow,
    handleSchemaMismatch,
    sessionId,
    supabaseClient,
    supabaseReady,
    supportsSessions,
  ]);

  const bootstrap = useCallback(async () => {
    if (!supabaseReady) {
      setIsLoading(false);
      setError('Supabase is not configured. Live timing requires Supabase credentials.');
      return;
    }
    setIsLoading(true);
    await Promise.all([refreshDriverData(), refreshSessionState()]);
    setIsLoading(false);
  }, [refreshDriverData, refreshSessionState, supabaseReady]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!supabaseReady) {
      return () => {};
    }
    const filter = supportsSessions ? `session_id=eq.${sessionId}` : undefined;

    const driverChannel = supabaseClient
      .channel(`live-timing-board-drivers-${supportsSessions ? sessionId : 'legacy'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drivers', ...(filter ? { filter } : {}) },
        () => {
          void refreshDriverData();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'laps', ...(filter ? { filter } : {}) },
        () => {
          void refreshDriverData();
        },
      )
      .subscribe();

    const sessionChannel = supabaseClient
      .channel(`live-timing-board-session-${supportsSessions ? sessionId : 'legacy'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_state', ...(filter ? { filter } : {}) },
        (payload) => {
          if (payload?.new) {
            applySessionStateRow(payload.new);
          }
        },
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(driverChannel);
      supabaseClient.removeChannel(sessionChannel);
    };
  }, [refreshDriverData, sessionId, supabaseClient, supabaseReady, supportsSessions, applySessionStateRow]);

  const leaderboard = useMemo(() => {
    const sorted = [...drivers]
      .map((driver) => ({ driver }))
      .sort((a, b) => {
        if (sessionState.eventType === 'Race') {
          if (a.driver.laps !== b.driver.laps) {
            return b.driver.laps - a.driver.laps;
          }
          return a.driver.totalTime - b.driver.totalTime;
        }
        const aBest = a.driver.bestLap ?? Number.POSITIVE_INFINITY;
        const bBest = b.driver.bestLap ?? Number.POSITIVE_INFINITY;
        return aBest - bBest;
      })
      .map((entry, index, array) => {
        const driver = entry.driver;
        let gap = '--';
        let interval = '--';
        if (index > 0) {
          if (sessionState.eventType === 'Race') {
            const leader = array[0].driver;
            const lapDiff = leader.laps - driver.laps;
            if (lapDiff === 0) {
              gap = `+${formatLapTime(driver.totalTime - leader.totalTime)}`;
            } else {
              gap = `-${lapDiff}L`;
            }
            const ahead = array[index - 1].driver;
            const aheadLapDiff = ahead.laps - driver.laps;
            if (aheadLapDiff === 0) {
              interval = `+${formatLapTime(driver.totalTime - ahead.totalTime)}`;
            } else {
              interval = `-${aheadLapDiff}L`;
            }
          } else {
            const leaderBest = array[0].driver.bestLap;
            if (leaderBest && driver.bestLap) {
              gap = `+${formatLapTime(driver.bestLap - leaderBest)}`;
            }
            const aheadBest = array[index - 1].driver.bestLap;
            if (aheadBest && driver.bestLap) {
              interval = `+${formatLapTime(driver.bestLap - aheadBest)}`;
            }
          }
        }
        return {
          ...driver,
          position: index + 1,
          gap,
          interval,
        };
      });
    return sorted;
  }, [drivers, sessionState.eventType]);

  const fastestLap = useMemo(() => {
    return drivers.reduce((best, driver) => {
      if (driver.bestLap === null) return best;
      if (!best || driver.bestLap < best.bestLap) {
        return driver;
      }
      return best;
    }, null);
  }, [drivers]);

  const driverMap = useMemo(() => {
    const map = new Map();
    drivers.forEach((driver) => {
      map.set(driver.id, driver);
    });
    return map;
  }, [drivers]);

  const recentLaps = useMemo(() => {
    if (!laps?.length) return [];
    return [...laps]
      .sort((a, b) => {
        const aTime = a.recorded_at ? new Date(a.recorded_at).getTime() : 0;
        const bTime = b.recorded_at ? new Date(b.recorded_at).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 12);
  }, [laps]);

  useEffect(() => {
    setDisplayTime(computeDisplayTime());
    const timer = setInterval(() => {
      setDisplayTime(computeDisplayTime());
    }, 250);
    return () => clearInterval(timer);
  }, [computeDisplayTime]);

  return (
    <div className="min-h-screen bg-[#05070F] text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        <header className="rounded-3xl border border-neutral-800 bg-gradient-to-br from-[#0C1020] via-[#101731] to-[#0B1224] p-6 shadow-[0_25px_80px_-60px_rgba(124,107,255,0.75)]">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className={`flex flex-1 flex-col gap-4 rounded-2xl p-5 ${trackStatusDetails.bannerClass}`}>
              <div className="flex items-center gap-4">
                <div className="rounded-full bg-neutral-950/60 p-3">
                  <TrackStatusIcon className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-neutral-300">Track Status</p>
                  <h1 className="text-2xl font-semibold text-white">
                    {trackStatusDetails.label}
                  </h1>
                  <p className="text-sm text-neutral-200/80">
                    {trackStatusDetails.description}
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-neutral-800/60 bg-neutral-950/40 px-4 py-3">
                <div className="flex items-center gap-3 text-neutral-200">
                  <Megaphone className="h-5 w-5 text-[#9FF7D3]" />
                  <p className="text-sm whitespace-pre-line">
                    {sessionState.announcement
                      ? sessionState.announcement
                      : 'Race control will post announcements here in real time.'}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex w-full max-w-sm flex-col items-end justify-between gap-4 text-right">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-neutral-400">Session</p>
                <p className="text-sm font-semibold text-neutral-200">
                  {activeSession?.name ?? 'Session'}
                </p>
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                  {sessionState.eventType} • {sessionState.totalLaps} laps • {sessionState.totalDuration} min
                </p>
                <div
                  className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold ${procedurePhaseDetails.badgeClass}`}
                >
                  <span className="text-[10px] uppercase tracking-[0.35em] text-neutral-300">Phase</span>
                  <span>{procedurePhaseDetails.label}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[#9FF7D3]">
                <Clock className="h-6 w-6" />
                <span className="font-mono text-4xl">{formatRaceClock(displayTime)}</span>
              </div>
            </div>
          </div>
        </header>

        {isLoading && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-4 py-3 text-sm text-neutral-300">
            Loading live timing…
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <section className="rounded-3xl border border-neutral-800 bg-[#0D1324]/80 p-4 shadow-[0_25px_80px_-60px_rgba(159,247,211,0.45)]">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.35em] text-neutral-400">
              Live Standings
            </h2>
            {fastestLap && (
              <div className="flex items-center gap-2 rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-3 py-1 text-xs text-[#9FF7D3]">
                <Trophy className="h-4 w-4" />
                <span>
                  Fastest Lap {formatLapTime(fastestLap.bestLap)} • #{fastestLap.number} {fastestLap.name}
                </span>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                  <th className="px-3 py-2 text-left">Pos</th>
                  <th className="px-3 py-2 text-left">Car</th>
                  <th className="px-3 py-2 text-left">Driver</th>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-3 py-2 text-center">Laps</th>
                  <th className="px-3 py-2 text-right">Last Lap</th>
                  <th className="px-3 py-2 text-right">Best Lap</th>
                  <th className="px-3 py-2 text-right">Gap</th>
                  <th className="px-3 py-2 text-right">Interval</th>
                  <th className="px-3 py-2 text-center">Pits</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((driver) => (
                  <tr
                    key={driver.id}
                    className={`border-t border-neutral-800/60 text-neutral-200 transition hover:bg-white/5 ${
                      fastestLap?.id === driver.id ? 'bg-[#9FF7D3]/5' : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-semibold text-[#9FF7D3]">{driver.position}</td>
                    <td className="px-3 py-2">#{driver.number}</td>
                    <td className="px-3 py-2">{driver.name}</td>
                    <td className="px-3 py-2 text-neutral-400">{driver.team}</td>
                    <td className="px-3 py-2 text-center font-mono">{driver.laps}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatLapTime(driver.lastLap)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatLapTime(driver.bestLap)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{driver.gap}</td>
                    <td className="px-3 py-2 text-right font-mono">{driver.interval}</td>
                    <td className="px-3 py-2 text-center font-mono">{driver.pits}</td>
                    <td className="px-3 py-2 text-right uppercase tracking-wide text-neutral-400">
                      {driver.status}
                    </td>
                  </tr>
                ))}
                {!leaderboard.length && !isLoading && (
                  <tr>
                    <td className="px-3 py-6 text-center text-neutral-500" colSpan={11}>
                      Waiting for timing data…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-neutral-800 bg-[#0D1324]/80 p-4 shadow-[0_25px_80px_-60px_rgba(124,107,255,0.35)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.35em] text-neutral-400">
              Recent Laps
            </h2>
            <span className="text-xs text-neutral-500">Showing last {recentLaps.length} laps</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {recentLaps.length === 0 && (
              <div className="rounded-xl border border-dashed border-neutral-800/70 bg-neutral-950/40 px-4 py-3 text-sm text-neutral-500">
                Lap data will appear here once the session is underway.
              </div>
            )}
            {recentLaps.map((lap) => {
              const driver = driverMap.get(lap.driver_id);
              const recorded = lap.recorded_at
                ? new Date(lap.recorded_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: 'Australia/Melbourne',
                  })
                : '—';
              return (
                <div
                  key={`${lap.driver_id}-${lap.lap_number}-${lap.recorded_at ?? Math.random()}`}
                  className="flex items-center justify-between rounded-xl border border-neutral-800/60 bg-neutral-950/50 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-neutral-100">
                      #{driver?.number ?? '--'} {driver?.name ?? 'Unknown'}
                    </p>
                    <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                      Lap {lap.lap_number}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-lg text-[#9FF7D3]">
                      {formatLapTime(lap.lap_time_ms)}
                    </p>
                    <p className="text-xs text-neutral-500">{recorded}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

export default LiveTimingBoard;
