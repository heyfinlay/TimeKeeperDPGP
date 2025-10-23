import { useCallback, useEffect, useMemo, useState } from 'react';
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
  SESSION_ROW_ID,
  SESSION_UUID,
  groupLapRows,
  hydrateDriverState,
  sessionRowToState,
} from '../utils/raceData';
import {
  isSupabaseConfigured,
  subscribeToTable,
  supabaseSelect,
} from '../lib/supabaseClient';

const STATUS_ICON_MAP = {
  flag: Flag,
  alert: AlertTriangle,
  gauge: Gauge,
  car: Car,
  stop: StopCircle,
};

const LiveTimingBoard = () => {
  const [drivers, setDrivers] = useState([]);
  const [sessionState, setSessionState] = useState(DEFAULT_SESSION_STATE);
  const [laps, setLaps] = useState([]);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState(null);

  const trackStatusDetails =
    TRACK_STATUS_MAP[sessionState.trackStatus] ?? TRACK_STATUS_OPTIONS[0];
  const TrackStatusIcon =
    STATUS_ICON_MAP[trackStatusDetails?.icon ?? 'flag'] ?? STATUS_ICON_MAP.flag;

  const refreshDriverData = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const [driverRows, lapRows] = await Promise.all([
        supabaseSelect('drivers', { order: { column: 'number', ascending: true } }),
        supabaseSelect('laps', {
          filters: { session_id: `eq.${SESSION_UUID}` },
          order: { column: 'lap_number', ascending: true },
        }),
        supabaseSelect('laps', { order: { column: 'lap_number', ascending: true } }),
      ]);
      const lapMap = groupLapRows(lapRows ?? []);
      if (Array.isArray(driverRows)) {
        setDrivers(driverRows.map((row) => hydrateDriverState(row, lapMap)));
      }
      setLaps(lapRows ?? []);
      setError(null);
    } catch (refreshError) {
      console.error('Failed to refresh timing data', refreshError);
      setError('Unable to refresh timing data from Supabase.');
    }
  }, []);

  const refreshSessionState = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const rows = await supabaseSelect('session_state', {
        filters: { id: `eq.${SESSION_ROW_ID}` },
      });
      if (rows?.[0]) {
        setSessionState(sessionRowToState(rows[0]));
      }
    } catch (sessionError) {
      console.error('Failed to refresh session state', sessionError);
      setError('Unable to refresh session details from Supabase.');
    }
  }, []);

  const bootstrap = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      setError('Supabase is not configured. Live timing requires Supabase credentials.');
      return;
    }
    setIsLoading(true);
    await Promise.all([refreshDriverData(), refreshSessionState()]);
    setIsLoading(false);
  }, [refreshDriverData, refreshSessionState]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return () => {};
    }
    const driverUnsub = subscribeToTable({ table: 'drivers' }, () => {
      refreshDriverData();
    });
    const lapUnsub = subscribeToTable({
      table: 'laps',
      filter: `session_id=eq.${SESSION_UUID}`,
    }, () => {
    const lapUnsub = subscribeToTable({ table: 'laps' }, () => {
      refreshDriverData();
    });
    const sessionUnsub = subscribeToTable(
      { table: 'session_state', filter: `id=eq.${SESSION_ROW_ID}` },
      (payload) => {
        if (payload?.new) {
          setSessionState(sessionRowToState(payload.new));
        }
      },
    );
    return () => {
      driverUnsub();
      lapUnsub();
      sessionUnsub();
    };
  }, [refreshDriverData]);

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
      .filter((lap) => lap.duration_ms !== null && lap.invalidated === false)
      .sort((a, b) => {
        const aTime = a.ended_at
          ? new Date(a.ended_at).getTime()
          : a.started_at
            ? new Date(a.started_at).getTime()
            : 0;
        const bTime = b.ended_at
          ? new Date(b.ended_at).getTime()
          : b.started_at
            ? new Date(b.started_at).getTime()
            : 0;
      .sort((a, b) => {
        const aTime = a.recorded_at ? new Date(a.recorded_at).getTime() : 0;
        const bTime = b.recorded_at ? new Date(b.recorded_at).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 12);
  }, [laps]);

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
                <p className="text-sm text-neutral-300">
                  {sessionState.eventType} • {sessionState.totalLaps} laps • {sessionState.totalDuration} min
                </p>
              </div>
              <div className="flex items-center gap-3 text-[#9FF7D3]">
                <Clock className="h-6 w-6" />
                <span className="font-mono text-4xl">{formatRaceClock(sessionState.raceTime)}</span>
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
              const recordedSource = lap.ended_at ?? lap.started_at ?? lap.created_at;
              const recorded = recordedSource
                ? new Date(recordedSource).toLocaleTimeString([], {
              const recorded = lap.recorded_at
                ? new Date(lap.recorded_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                : '—';
              return (
                <div
                  key={`${lap.driver_id}-${lap.lap_number}-${recordedSource ?? Math.random()}`}
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
                      {formatLapTime(lap.duration_ms)}
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
