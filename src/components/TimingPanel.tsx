import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowBigUpDash,
  Ban,
  Clock,
  Download,
  Flag,
  Play,
  Repeat2,
  Shield,
  Undo2,
} from 'lucide-react';

export type Phase = 'PREP' | 'FINAL_CALL' | 'STARTING' | 'GREEN' | 'FINISHED';

export type EventKind =
  | 'FLAG'
  | 'PHASE'
  | 'LAP'
  | 'DNF'
  | 'UNDO'
  | 'START_CLOCK'
  | 'RESET';

type FlagId =
  | 'green'
  | 'yellow'
  | 'sc'
  | 'vsc'
  | 'red'
  | 'checkered'
  | 'green-check';

interface Driver {
  id: string;
  number: number;
  name: string;
  team: string;
}

export interface LapRecord {
  driverId: string;
  lapNo: number;
  ts_clock_ms: number;
  lap_ms?: number;
}

export interface EventRecord {
  id: string;
  ts_clock_ms: number;
  phase: Phase;
  kind: EventKind;
  meta?: Record<string, unknown>;
}

interface UndoLap {
  kind: 'LAP';
  eventId: string;
  lap: LapRecord;
}

interface UndoDNF {
  kind: 'DNF';
  eventId: string;
  driverId: string;
  previous: boolean;
}

interface UndoFlag {
  kind: 'FLAG';
  eventId: string;
  previous: FlagId;
}

interface UndoPhase {
  kind: 'PHASE';
  eventId: string;
  previous: Phase;
  previousClockRunning: boolean;
  previousStartRef: number | null;
  previousRaceTime: number;
  startClockEventId?: string;
}

type UndoEntry = UndoLap | UndoDNF | UndoFlag | UndoPhase;

const DEFAULT_DRIVERS: Driver[] = [
  { id: 'd1', number: 1, name: 'Driver 1', team: 'Team EMS' },
  { id: 'd2', number: 2, name: 'Driver 2', team: 'Team Underground Club' },
  { id: 'd3', number: 3, name: 'Driver 3', team: 'Team Flywheels' },
  { id: 'd4', number: 4, name: 'Driver 4', team: 'Team LSC' },
  { id: 'd5', number: 5, name: 'Driver 5', team: 'Team Mosleys' },
  { id: 'd6', number: 6, name: 'Driver 6', team: 'Team Benefactor' },
  { id: 'd7', number: 7, name: 'Driver 7', team: 'Team Blend & Barrel' },
  { id: 'd8', number: 8, name: 'Driver 8', team: 'Team PD' },
  { id: 'd9', number: 9, name: 'Driver 9', team: 'Team Bahama Mamas' },
  { id: 'd10', number: 10, name: 'Driver 10', team: 'Team Pitlane' },
];

const FLAG_OPTIONS: { id: FlagId; label: string; color: string }[] = [
  { id: 'green', label: 'Green', color: 'bg-green-600 hover:bg-green-500' },
  {
    id: 'yellow',
    label: 'Yellow',
    color: 'bg-yellow-500 text-black hover:bg-yellow-400',
  },
  { id: 'sc', label: 'SC', color: 'bg-amber-500 text-black hover:bg-amber-400' },
  { id: 'vsc', label: 'VSC', color: 'bg-emerald-600 hover:bg-emerald-500' },
  { id: 'red', label: 'Red', color: 'bg-red-600 hover:bg-red-500' },
  { id: 'checkered', label: 'Checkered', color: 'bg-violet-600 hover:bg-violet-500' },
  { id: 'green-check', label: 'Resume', color: 'bg-cyan-500 text-black hover:bg-cyan-400' },
];

const PHASE_FLOW: Phase[] = ['PREP', 'FINAL_CALL', 'STARTING', 'GREEN', 'FINISHED'];

const HOTKEYS: string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const formatLapTime = (ms?: number): string => {
  if (!Number.isFinite(ms) || ms === undefined) {
    return '--:--.---';
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = Math.floor(ms % 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds
    .toString()
    .padStart(3, '0')}`;
};

const formatClock = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
};

const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const getSearchParam = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get(key);
};

const downloadCsv = (filename: string, rows: string[][]) => {
  const csvContent = rows.map((cols) => cols.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

interface HighlightState {
  active: boolean;
  eventId?: string;
}

type DriverStats = Record<
  string,
  {
    lapsCompleted: number;
    lastLap?: number;
    bestLap?: number;
    finishTs?: number;
  }
>;

const TimingPanel = () => {
  const [drivers] = useState<Driver[]>(DEFAULT_DRIVERS);
  const [phase, setPhase] = useState<Phase>('PREP');
  const [flag, setFlag] = useState<FlagId>('green');
  const [targetLaps, setTargetLaps] = useState<number>(25);
  const [laps, setLaps] = useState<LapRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [dnf, setDnf] = useState<Record<string, boolean>>({});
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [raceTime, setRaceTime] = useState<number>(0);
  const [clockRunning, setClockRunning] = useState<boolean>(false);
  const [singleMarshalMode, setSingleMarshalMode] = useState<boolean>(false);
  const [highlightedDrivers, setHighlightedDrivers] = useState<Record<string, HighlightState>>({});

  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const highlightTimeouts = useRef<Record<string, number>>({});

  const isAuthoritativeConsole = getSearchParam('authoritative') === 'true';
  const hasControl = !singleMarshalMode || isAuthoritativeConsole;

  const getTimestamp = useCallback(() => {
    if (startRef.current !== null) {
      return performance.now() - startRef.current;
    }
    return Date.now();
  }, []);

  const createEvent = useCallback(
    (kind: EventKind, meta?: Record<string, unknown>, tsOverride?: number, phaseOverride?: Phase) => {
      const event: EventRecord = {
        id: createId(),
        ts_clock_ms: tsOverride ?? getTimestamp(),
        phase: phaseOverride ?? phase,
        kind,
        meta,
      };
      setEvents((prev) => [...prev, event]);
      return event;
    },
    [getTimestamp, phase],
  );

  const pushUndo = useCallback((entry: UndoEntry) => {
    setUndoStack((prev) => [...prev, entry]);
  }, []);

  const highlightDriver = useCallback((driverId: string, eventId: string) => {
    setHighlightedDrivers((prev) => ({
      ...prev,
      [driverId]: { active: true, eventId },
    }));
    if (highlightTimeouts.current[driverId]) {
      clearTimeout(highlightTimeouts.current[driverId]);
    }
    highlightTimeouts.current[driverId] = window.setTimeout(() => {
      setHighlightedDrivers((prev) => ({
        ...prev,
        [driverId]: { active: false },
      }));
    }, 2500);
  }, []);

  useEffect(() => {
    if (clockRunning) {
      const tick = () => {
        if (startRef.current !== null) {
          setRaceTime(performance.now() - startRef.current);
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
        }
      };
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    return undefined;
  }, [clockRunning]);

  const captureLap = useCallback(
    (driverId: string) => {
      if (!hasControl) return;
      if (phase !== 'GREEN' || startRef.current === null) return;
      if (dnf[driverId]) return;
      const driverLaps = laps.filter((lap) => lap.driverId === driverId).sort((a, b) => a.lapNo - b.lapNo);
      const prevLap = driverLaps.at(-1) ?? null;
      const lapNo = (prevLap?.lapNo ?? 0) + 1;
      if (lapNo > targetLaps) return;
      const now = performance.now() - startRef.current;
      const lapMs = prevLap ? now - prevLap.ts_clock_ms : now;
      const lap: LapRecord = { driverId, lapNo, ts_clock_ms: now, lap_ms: lapMs };
      setLaps((prev) => [...prev, lap]);
      const event = createEvent('LAP', { driverId, lapNo, lap_ms: lapMs }, now);
      pushUndo({ kind: 'LAP', eventId: event.id, lap });
      highlightDriver(driverId, event.id);
    },
    [createEvent, dnf, hasControl, highlightDriver, laps, phase, pushUndo, targetLaps],
  );

  useEffect(() => {
    const handleHotkey = (event: KeyboardEvent) => {
      if (!hasControl || !clockRunning || phase !== 'GREEN') {
        return;
      }
      const key = event.key;
      const index = HOTKEYS.indexOf(key);
      if (index === -1) return;
      const driver = drivers[index];
      if (!driver) return;
      event.preventDefault();
      captureLap(driver.id);
    };
    window.addEventListener('keydown', handleHotkey);
    return () => window.removeEventListener('keydown', handleHotkey);
  }, [drivers, hasControl, phase, clockRunning, captureLap]);

  const handleUndo = useCallback(() => {
    setUndoStack((prevStack) => {
      const last = prevStack[prevStack.length - 1];
      if (!last) return prevStack;
      if (last.kind === 'LAP') {
        setLaps((prev) =>
          prev.filter(
            (lap) =>
              !(
                lap.driverId === last.lap.driverId &&
                lap.lapNo === last.lap.lapNo &&
                lap.ts_clock_ms === last.lap.ts_clock_ms
              ),
          ),
        );
        setEvents((prev) => prev.filter((event) => event.id !== last.eventId));
        setHighlightedDrivers((prev) => ({
          ...prev,
          [last.lap.driverId]: { active: false },
        }));
        if (highlightTimeouts.current[last.lap.driverId]) {
          clearTimeout(highlightTimeouts.current[last.lap.driverId]);
          delete highlightTimeouts.current[last.lap.driverId];
        }
        createEvent('UNDO', { undoOf: 'LAP', driverId: last.lap.driverId, lapNo: last.lap.lapNo });
      } else if (last.kind === 'DNF') {
        setDnf((prev) => ({ ...prev, [last.driverId]: last.previous }));
        setEvents((prev) => prev.filter((event) => event.id !== last.eventId));
        createEvent('UNDO', { undoOf: 'DNF', driverId: last.driverId, previous: last.previous });
      } else if (last.kind === 'FLAG') {
        setFlag(last.previous);
        setEvents((prev) => prev.filter((event) => event.id !== last.eventId));
        createEvent('UNDO', { undoOf: 'FLAG', previous: last.previous });
      } else if (last.kind === 'PHASE') {
        setPhase(last.previous);
        setEvents((prev) =>
          prev.filter((event) => {
            if (event.id === last.eventId) return false;
            if (last.startClockEventId && event.id === last.startClockEventId) return false;
            return true;
          }),
        );
        startRef.current = last.previousStartRef;
        setClockRunning(last.previousClockRunning);
        setRaceTime(last.previousRaceTime);
        createEvent('UNDO', { undoOf: 'PHASE', previous: last.previous }, undefined, last.previous);
      }
      return prevStack.slice(0, -1);
    });
  }, [createEvent]);

  useEffect(() => {
    const handleUndoKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleUndoKey);
    return () => window.removeEventListener('keydown', handleUndoKey);
  }, [handleUndo]);

  const toggleDnf = useCallback(
    (driverId: string) => {
      if (!hasControl) return;
      setDnf((prev) => {
        const next = !prev[driverId];
        const updated = { ...prev, [driverId]: next };
        const event = createEvent('DNF', { driverId, value: next });
        pushUndo({ kind: 'DNF', eventId: event.id, driverId, previous: prev[driverId] ?? false });
        return updated;
      });
    },
    [createEvent, hasControl, pushUndo],
  );

  const updateFlag = useCallback(
    (next: FlagId) => {
      if (!hasControl) return;
      setFlag((prev) => {
        if (prev === next) return prev;
        const event = createEvent('FLAG', { from: prev, to: next });
        pushUndo({ kind: 'FLAG', eventId: event.id, previous: prev });
        return next;
      });
    },
    [createEvent, hasControl, pushUndo],
  );

  const transitionPhase = useCallback(
    (next: Phase) => {
      if (!hasControl) return;
      setPhase((prev) => {
        if (prev === next) return prev;
        const previousStartRef = startRef.current;
        const previousClockRunning = clockRunning;
        const previousRaceTime = raceTime;
        const phaseEvent = createEvent('PHASE', { from: prev, to: next }, undefined, next);
        let startClockEventId: string | undefined;
        if (next === 'GREEN' && startRef.current === null) {
          startRef.current = performance.now();
          setClockRunning(true);
          setRaceTime(0);
          const startEvent = createEvent('START_CLOCK', undefined, performance.now() - startRef.current, next);
          startClockEventId = startEvent.id;
        }
        if (next === 'FINISHED') {
          setClockRunning(false);
        }
        pushUndo({
          kind: 'PHASE',
          eventId: phaseEvent.id,
          previous: prev,
          previousClockRunning,
          previousStartRef,
          previousRaceTime,
          startClockEventId,
        });
        return next;
      });
    },
    [clockRunning, createEvent, hasControl, pushUndo, raceTime],
  );

  useEffect(() => {
    return () => {
      Object.values(highlightTimeouts.current).forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
    };
  }, []);

  const driverStats: DriverStats = useMemo(() => {
    const grouped: Record<string, LapRecord[]> = {};
    laps.forEach((lap) => {
      if (!grouped[lap.driverId]) grouped[lap.driverId] = [];
      grouped[lap.driverId].push(lap);
    });
    const stats: DriverStats = {};
    Object.entries(grouped).forEach(([driverId, driverLaps]) => {
      const sorted = [...driverLaps].sort((a, b) => a.lapNo - b.lapNo);
      const last = sorted.at(-1);
      const best = sorted.reduce<number | undefined>((acc, lap) => {
        if (lap.lap_ms === undefined) return acc;
        if (acc === undefined) return lap.lap_ms;
        return Math.min(acc, lap.lap_ms);
      }, undefined);
      const finishLap = sorted.find((lap) => lap.lapNo === targetLaps);
      stats[driverId] = {
        lapsCompleted: sorted.length,
        lastLap: last?.lap_ms,
        bestLap: best,
        finishTs: finishLap?.ts_clock_ms,
      };
    });
    return stats;
  }, [laps, targetLaps]);

  const classification = useMemo(() => {
    const finishers = drivers
      .filter((driver) => !dnf[driver.id])
      .map((driver) => ({
        driver,
        finishTs: driverStats[driver.id]?.finishTs,
      }))
      .filter((entry): entry is { driver: Driver; finishTs: number } =>
        Number.isFinite(entry.finishTs),
      )
      .sort((a, b) => a.finishTs - b.finishTs);

    const winnerTime = finishers[0]?.finishTs ?? null;

    return finishers.map((entry, index) => ({
      position: index + 1,
      driver: entry.driver,
      finishTs: entry.finishTs,
      gap: winnerTime !== null ? entry.finishTs - winnerTime : null,
    }));
  }, [dnf, driverStats, drivers]);

  const exportLapsCsv = useCallback(() => {
    const rows: string[][] = [['type', 'driverId', 'lapNo', 'lap_ms', 'ts_clock_ms']];
    laps
      .slice()
      .sort((a, b) => a.ts_clock_ms - b.ts_clock_ms)
      .forEach((lap) => {
        rows.push([
          'LAP',
          lap.driverId,
          lap.lapNo.toString(),
          lap.lap_ms?.toString() ?? '',
          lap.ts_clock_ms.toString(),
        ]);
      });
    downloadCsv('laps.csv', rows);
  }, [laps]);

  const exportEventsCsv = useCallback(() => {
    const rows: string[][] = [['type', 'phase', 'kind', 'flagOrDriver', 'meta_json', 'ts_clock_ms']];
    events.forEach((event) => {
      const flagOrDriver =
        typeof event.meta?.driverId === 'string'
          ? (event.meta.driverId as string)
          : (event.meta?.to as string) ?? '';
      rows.push([
        'EVENT',
        event.phase,
        event.kind,
        flagOrDriver ?? '',
        JSON.stringify(event.meta ?? {}),
        event.ts_clock_ms.toString(),
      ]);
    });
    downloadCsv('events.csv', rows);
  }, [events]);

  const exportClassificationCsv = useCallback(() => {
    const rows: string[][] = [['position', 'driverId', 'finish_ts_ms', 'gap_ms', 'gap_formatted']];
    classification.forEach((entry) => {
      rows.push([
        entry.position.toString(),
        entry.driver.id,
        entry.finishTs.toString(),
        entry.gap?.toString() ?? '',
        entry.gap !== null && entry.gap !== undefined ? formatLapTime(entry.gap) : '',
      ]);
    });
    downloadCsv('classification.csv', rows);
  }, [classification]);

  const nextPhase = PHASE_FLOW[Math.min(PHASE_FLOW.indexOf(phase) + 1, PHASE_FLOW.length - 1)];
  const prevPhase = PHASE_FLOW[Math.max(PHASE_FLOW.indexOf(phase) - 1, 0)];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="border-b border-white/5 bg-slate-950/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm uppercase tracking-[0.3em] text-emerald-300">
              <Clock className="h-4 w-4" />
              <span>{phase === 'GREEN' ? 'On Track' : phase.replace('_', ' ')}</span>
            </div>
            <div className="mt-1 text-4xl font-semibold text-white">{formatClock(raceTime)}</div>
            {singleMarshalMode && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-200">
                <Shield className="h-4 w-4" />
                <span>{isAuthoritativeConsole ? 'Authoritative Console' : 'Read-Only Console'}</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.25em] text-slate-200">
              <Flag className="h-4 w-4 text-emerald-300" />
              <span>{FLAG_OPTIONS.find((option) => option.id === flag)?.label ?? flag}</span>
            </div>
            <select
              value={flag}
              disabled={!hasControl}
              onChange={(event) => updateFlag(event.target.value as FlagId)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.25em] text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {FLAG_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!hasControl || phase === prevPhase}
              onClick={() => transitionPhase(prevPhase)}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.25em] text-slate-200 transition hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowBigUpDash className="h-4 w-4" /> Prev Phase
            </button>
            <button
              type="button"
              disabled={!hasControl || phase === nextPhase}
              onClick={() => transitionPhase(nextPhase)}
              className="flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-100 transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next Phase <Play className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleUndo}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.25em] text-slate-200 transition hover:border-emerald-400"
            >
              <Undo2 className="h-4 w-4" /> Undo
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <section className="grid gap-4 rounded-2xl border border-white/5 bg-white/5 p-6 shadow-2xl lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
              <div className="flex items-center gap-2">
                <Repeat2 className="h-4 w-4 text-emerald-300" />
                <span>Target Laps</span>
              </div>
              <input
                type="number"
                min={1}
                value={targetLaps}
                disabled={!hasControl}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10);
                  if (!Number.isNaN(value) && value > 0) {
                    setTargetLaps(value);
                  }
                }}
                className="w-24 rounded-md border border-white/10 bg-slate-950/70 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              />
              <label className="flex items-center gap-2 text-xs uppercase tracking-[0.25em]">
                <input
                  type="checkbox"
                  checked={singleMarshalMode}
                  onChange={(event) => setSingleMarshalMode(event.target.checked)}
                  className="h-4 w-4 rounded border-white/10 bg-slate-900 text-emerald-400 focus:ring-emerald-400"
                />
                <span>Single Marshal</span>
              </label>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-slate-300">
                <AlertCircle className="h-4 w-4 text-amber-300" />
                <span>Controls {hasControl ? 'Enabled' : 'Locked'}</span>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {drivers.map((driver) => {
                const stats = driverStats[driver.id] ?? { lapsCompleted: 0 };
                const isHighlight = highlightedDrivers[driver.id]?.active;
                const topUndo = undoStack[undoStack.length - 1];
                const highlightEventId = highlightedDrivers[driver.id]?.eventId;
                const canInlineUndo =
                  isHighlight && topUndo?.kind === 'LAP' && topUndo.eventId === highlightEventId;
                const lapsRemaining = Math.max(targetLaps - (stats.lapsCompleted ?? 0), 0);
                const disabled =
                  !hasControl ||
                  phase !== 'GREEN' ||
                  dnf[driver.id] ||
                  stats.lapsCompleted >= targetLaps ||
                  !clockRunning;
                return (
                  <div
                    key={driver.id}
                    className={`group relative overflow-hidden rounded-xl border ${
                      isHighlight ? 'border-emerald-400 bg-emerald-500/10 shadow-[0_0_0_2px_rgba(16,185,129,0.4)]' : 'border-white/10 bg-slate-950/40'
                    } p-4 transition`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-[0.3em] text-slate-400">#{driver.number}</div>
                        <div className="text-lg font-semibold text-white">{driver.name}</div>
                        <div className="text-xs text-slate-400">{driver.team}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleDnf(driver.id)}
                        disabled={!hasControl}
                        className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.3em] transition ${
                          dnf[driver.id]
                            ? 'border-rose-400/50 bg-rose-500/20 text-rose-200'
                            : 'border-white/10 bg-white/5 text-slate-200'
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {dnf[driver.id] ? 'DNF' : 'DNF?'}
                      </button>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="uppercase tracking-[0.3em] text-slate-500">Laps</div>
                        <div className="text-lg font-semibold text-white">{stats.lapsCompleted ?? 0}</div>
                      </div>
                      <div>
                        <div className="uppercase tracking-[0.3em] text-slate-500">Last</div>
                        <div className="text-lg font-semibold text-white">{formatLapTime(stats.lastLap)}</div>
                      </div>
                      <div>
                        <div className="uppercase tracking-[0.3em] text-slate-500">Best</div>
                        <div className="text-lg font-semibold text-white">{formatLapTime(stats.bestLap)}</div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                      <span>{lapsRemaining} lap(s) remaining</span>
                      {stats.finishTs !== undefined && (
                        <span className="text-emerald-300">Finish: {formatLapTime(stats.finishTs)}</span>
                      )}
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => captureLap(driver.id)}
                        className="flex-1 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-emerald-100 transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Mark Lap
                      </button>
                      {canInlineUndo && (
                        <button
                          type="button"
                          onClick={handleUndo}
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-emerald-400"
                        >
                          Undo last
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <aside className="flex flex-col gap-4 rounded-xl border border-white/10 bg-slate-950/60 p-5">
            <div>
              <h3 className="text-xs uppercase tracking-[0.35em] text-slate-500">Classification</h3>
              <div className="mt-3 space-y-2">
                {classification.length === 0 && (
                  <p className="text-sm text-slate-400">No classified finishers yet.</p>
                )}
                {classification.map((entry) => (
                  <div
                    key={entry.driver.id}
                    className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs"
                  >
                    <span className="font-semibold text-emerald-100">
                      {entry.position}. #{entry.driver.number} {entry.driver.name}
                    </span>
                    <span className="text-emerald-200">
                      {formatLapTime(entry.finishTs)}
                      {entry.gap !== null && entry.gap !== undefined && entry.gap > 0 && (
                        <span className="ml-2 text-emerald-300">+{formatLapTime(entry.gap)}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs uppercase tracking-[0.35em] text-slate-500">Exports</h3>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={exportLapsCsv}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-emerald-400"
                >
                  Laps CSV <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={exportEventsCsv}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-emerald-400"
                >
                  Events CSV <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={exportClassificationCsv}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-emerald-400"
                >
                  Classification CSV <Download className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-auto">
              <h3 className="text-xs uppercase tracking-[0.35em] text-slate-500">Events</h3>
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-2 text-xs">
                {events
                  .slice()
                  .reverse()
                  .map((event) => (
                    <div key={event.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-emerald-200">{event.kind}</span>
                        <span className="text-[10px] text-slate-400">{formatLapTime(event.ts_clock_ms)}</span>
                      </div>
                      <pre className="mt-1 whitespace-pre-wrap text-[10px] text-slate-400">{JSON.stringify(event.meta ?? {}, null, 2)}</pre>
                    </div>
                  ))}
              </div>
            </div>
          </aside>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setLaps([]);
              setEvents([]);
              setDnf({});
              setUndoStack([]);
              setRaceTime(0);
              setClockRunning(false);
              startRef.current = null;
              setPhase('PREP');
              setFlag('green');
              Object.values(highlightTimeouts.current).forEach((timeoutId) => {
                clearTimeout(timeoutId);
              });
              highlightTimeouts.current = {};
              setHighlightedDrivers({});
              createEvent('RESET', { reason: 'manual' }, undefined, 'PREP');
            }}
            className="flex items-center gap-2 rounded-lg border border-rose-400/60 bg-rose-500/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-rose-200 transition hover:border-rose-300"
          >
            <Ban className="h-4 w-4" /> Reset Session
          </button>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Total laps captured: {laps.length}
          </div>
        </div>
      </main>
    </div>
  );
};

export default TimingPanel;
