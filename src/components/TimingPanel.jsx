import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  Flag,
  ListChecks,
  Play,
  Save,
  Settings,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';

const DEFAULT_MARSHALS = [
  { id: 'm1', name: 'Marshal 1' },
  { id: 'm2', name: 'Marshal 2' },
];

const DEFAULT_DRIVERS = [
  {
    id: 'd1',
    number: 1,
    name: 'Driver 1',
    team: 'Team EMS',
    marshalId: 'm1',
  },
  {
    id: 'd2',
    number: 2,
    name: 'Driver 2',
    team: 'Team Underground Club',
    marshalId: 'm1',
  },
  {
    id: 'd3',
    number: 3,
    name: 'Driver 3',
    team: 'Team Flywheels',
    marshalId: 'm1',
  },
  {
    id: 'd4',
    number: 4,
    name: 'Driver 4',
    team: 'Team LSC',
    marshalId: 'm1',
  },
  {
    id: 'd5',
    number: 5,
    name: 'Driver 5',
    team: 'Team Mosleys',
    marshalId: 'm1',
  },
  {
    id: 'd6',
    number: 6,
    name: 'Driver 6',
    team: 'Team Benefactor',
    marshalId: 'm2',
  },
  {
    id: 'd7',
    number: 7,
    name: 'Driver 7',
    team: 'Team Blend & Barrel',
    marshalId: 'm2',
  },
  {
    id: 'd8',
    number: 8,
    name: 'Driver 8',
    team: 'Team PD',
    marshalId: 'm2',
  },
  {
    id: 'd9',
    number: 9,
    name: 'Driver 9',
    team: 'Team Bahama Mamas',
    marshalId: 'm2',
  },
  {
    id: 'd10',
    number: 10,
    name: 'Driver 10',
    team: 'Team Pitlane',
    marshalId: 'm2',
  },
];

const EVENT_TYPES = ['Practice', 'Qualifying', 'Race'];

const FLAG_OPTIONS = [
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

const FLAG_SELECT_OPTIONS = [
  { id: 'green', label: 'Green' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'sc', label: 'SC' },
  { id: 'vsc', label: 'VSC' },
  { id: 'red', label: 'Red' },
  { id: 'checkered', label: 'Checkered' },
];

const DRIVER_FLAG_OPTIONS = [
  { id: 'none', label: 'No Flag' },
  { id: 'blue', label: 'Blue Flag' },
  { id: 'blackwhite', label: 'Black & White' },
];

const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const toDriverState = (driver) => ({
  ...driver,
  laps: 0,
  lapTimes: [],
  lastLap: null,
  bestLap: null,
  pits: 0,
  status: 'ready',
  currentLapStart: null,
  driverFlag: 'none',
  pitComplete: false,
});

const formatLapTime = (ms) => {
  if (!Number.isFinite(ms) || ms === null) return '--:--.---';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds
    .toString()
    .padStart(3, '0')}`;
};

const formatRaceClock = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
};

const parseManualLap = (input) => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const colonIdx = trimmed.indexOf(':');
  let minutes = 0;
  let secondsPart = trimmed;
  if (colonIdx !== -1) {
    minutes = Number.parseInt(trimmed.slice(0, colonIdx), 10);
    secondsPart = trimmed.slice(colonIdx + 1);
  }
  if (Number.isNaN(minutes) || minutes < 0) return null;
  let seconds = 0;
  let millis = 0;
  if (secondsPart.includes('.')) {
    const [secStr, msStr] = secondsPart.split('.');
    seconds = Number.parseInt(secStr, 10);
    millis = Number.parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
  } else {
    seconds = Number.parseInt(secondsPart, 10);
  }
  if (Number.isNaN(seconds) || seconds < 0) return null;
  if (Number.isNaN(millis) || millis < 0) millis = 0;
  return minutes * 60000 + seconds * 1000 + millis;
};

const TimingPanel = () => {
  const [eventConfig, setEventConfig] = useState({
    eventType: 'Race',
    totalLaps: 25,
    totalDuration: 45,
    marshals: DEFAULT_MARSHALS,
  });
  const [drivers, setDrivers] = useState(
    DEFAULT_DRIVERS.map((driver) => toDriverState(driver)),
  );
  const [procedurePhase, setProcedurePhase] = useState('setup');
  const [isTiming, setIsTiming] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [flagStatus, setFlagStatus] = useState('green');
  const [manualLapInputs, setManualLapInputs] = useState({});
  const [logs, setLogs] = useState([]);
  const [showSetup, setShowSetup] = useState(false);
  const [setupDraft, setSetupDraft] = useState(null);
  const [countdown, setCountdown] = useState(5);
  const [raceTime, setRaceTime] = useState(0);
  const [recentLapDriverId, setRecentLapDriverId] = useState(null);

  const raceStartRef = useRef(null);
  const pauseStartRef = useRef(null);
  const pausedDurationRef = useRef(0);
  const lapFlashTimeoutRef = useRef(null);

  useEffect(() => {
    let interval;
    if (isTiming && !isPaused) {
      interval = setInterval(() => {
        const now = Date.now();
        if (raceStartRef.current) {
          const elapsed = now - raceStartRef.current - pausedDurationRef.current;
          setRaceTime(elapsed);
        }
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isTiming, isPaused]);

  useEffect(() => {
    if (procedurePhase === 'countdown' && countdown > 0) {
      const timer = setTimeout(() => setCountdown((prev) => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (procedurePhase === 'countdown' && countdown === 0) {
      goGreen();
    }
  }, [procedurePhase, countdown]);

  useEffect(() => {
    const handleKeyPress = (event) => {
      if (!isTiming || isPaused) return;
      const key = event.key;
      let number;
      if (key >= '1' && key <= '9') {
        number = Number.parseInt(key, 10);
      } else if (key === '0') {
        number = 10;
      } else {
        return;
      }
      const driver = drivers.find((d) => d.number === number);
      if (driver) {
        recordLap(driver.id, { source: 'keyboard' });
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [drivers, isTiming, isPaused]);

  useEffect(
    () => () => {
      if (lapFlashTimeoutRef.current) {
        clearTimeout(lapFlashTimeoutRef.current);
      }
    },
    [],
  );

  const logAction = (action, marshalId = 'Race Control') => {
    setLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        action,
        marshalId,
        timestamp: new Date(),
      },
      ...prev.slice(0, 199),
    ]);
  };

  const getMarshalName = (marshalId) =>
    eventConfig.marshals.find((m) => m.id === marshalId)?.name ?? 'Unassigned';

  const startWarmup = () => {
    setProcedurePhase('warmup');
    logAction('Warm up lap started');
  };

  const callFinalCall = () => {
    setProcedurePhase('final-call');
    logAction('Final call issued');
  };

  const initiateCountdown = () => {
    setCountdown(5);
    setProcedurePhase('countdown');
    logAction('Race start countdown initiated');
  };

  const goGreen = () => {
    raceStartRef.current = Date.now();
    pausedDurationRef.current = 0;
    pauseStartRef.current = null;
    setRaceTime(0);
    setIsTiming(true);
    setIsPaused(false);
    setProcedurePhase('green');
    setFlagStatus('green');
    setDrivers((prev) =>
      prev.map((driver) => ({
        ...driver,
        status: 'ontrack',
        currentLapStart: Date.now(),
      })),
    );
    logAction('Session started');
  };

  const confirmPause = () => {
    if (!isTiming || isPaused) return;
    const confirmed = window.confirm('Pause the session timer?');
    if (!confirmed) return;
    pauseStartRef.current = Date.now();
    setIsPaused(true);
    logAction('Session timer paused');
  };

  const resumeTiming = () => {
    if (!isTiming || !isPaused) return;
    const pausedFor = Date.now() - pauseStartRef.current;
    pausedDurationRef.current += pausedFor;
    pauseStartRef.current = null;
    setIsPaused(false);
    logAction('Session timer resumed');
  };

  const finishSession = () => {
    setProcedurePhase('complete');
    setIsTiming(false);
    setDrivers((prev) =>
      prev.map((driver) => ({
        ...driver,
        status: driver.status === 'retired' ? 'retired' : 'finished',
      })),
    );
    logAction('Session completed');
  };

  const handleFlagChange = (flag) => {
    if (flag === 'green-check') {
      setFlagStatus('green');
      if (procedurePhase === 'suspended') {
        setProcedurePhase('green');
      }
      logAction('Session resumed from suspension');
      return;
    }
    setFlagStatus(flag);
    if (flag === 'red') {
      setProcedurePhase('suspended');
    }
    logAction(`Flag set to ${flag.toUpperCase()}`);
  };

  const recordLap = (driverId, { manualTime, source } = {}) => {
    setDrivers((prev) =>
      prev.map((driver) => {
        if (driver.id !== driverId) {
          return driver;
        }
        if (driver.status === 'retired' || driver.status === 'finished') {
          return driver;
        }
        const now = Date.now();
        let lapTime = manualTime ?? null;
        if (lapTime === null && driver.currentLapStart) {
          lapTime = now - driver.currentLapStart;
        }
        if (lapTime === null) {
          return driver;
        }
        const lapTimes = [...driver.lapTimes, lapTime];
        const laps = driver.laps + 1;
        const bestLap =
          driver.bestLap === null ? lapTime : Math.min(driver.bestLap, lapTime);
        const status =
          eventConfig.eventType === 'Race' && laps >= eventConfig.totalLaps
            ? 'finished'
            : driver.status;
        const marshalName = getMarshalName(driver.marshalId);
        logAction(
          `Lap recorded for #${driver.number} (${formatLapTime(
            lapTime,
          )})${source ? ` via ${source}` : ''}`,
          marshalName,
        );
        return {
          ...driver,
          laps,
          lapTimes,
          lastLap: lapTime,
          bestLap,
          status,
          currentLapStart: now,
        };
      }),
    );
    setManualLapInputs((prev) => ({ ...prev, [driverId]: '' }));
    if (lapFlashTimeoutRef.current) {
      clearTimeout(lapFlashTimeoutRef.current);
    }
    setRecentLapDriverId(driverId);
    lapFlashTimeoutRef.current = setTimeout(() => {
      setRecentLapDriverId(null);
    }, 500);
  };

  const retireDriver = (driverId) => {
    setDrivers((prev) =>
      prev.map((driver) =>
        driver.id === driverId
          ? { ...driver, status: 'retired', currentLapStart: null }
          : driver,
      ),
    );
    const driver = drivers.find((d) => d.id === driverId);
    if (driver) {
      logAction(`Driver #${driver.number} retired`, getMarshalName(driver.marshalId));
    }
  };

  const togglePitStop = (driverId) => {
    setDrivers((prev) =>
      prev.map((driver) =>
        driver.id === driverId
          ? {
              ...driver,
              pitComplete: !driver.pitComplete,
              pits: driver.pitComplete ? driver.pits : driver.pits + 1,
            }
          : driver,
      ),
    );
    const driver = drivers.find((d) => d.id === driverId);
    if (driver) {
      logAction(
        `Pit stop ${driver.pitComplete ? 'cleared' : 'completed'} for #${
          driver.number
        }`,
        getMarshalName(driver.marshalId),
      );
    }
  };

  const setDriverFlag = (driverId, driverFlag) => {
    setDrivers((prev) =>
      prev.map((driver) =>
        driver.id === driverId ? { ...driver, driverFlag } : driver,
      ),
    );
    const driver = drivers.find((d) => d.id === driverId);
    if (driver) {
      logAction(
        `Driver alert set to ${driverFlag.toUpperCase()} for #${driver.number}`,
        getMarshalName(driver.marshalId),
      );
    }
  };

  const driverTiming = useMemo(() => {
    const metric = (driver) => {
      if (eventConfig.eventType === 'Race') {
        const totalTime = driver.lapTimes.reduce((sum, time) => sum + time, 0);
        return {
          key: driver.laps,
          secondary: totalTime,
        };
      }
      const best = driver.bestLap ?? Number.POSITIVE_INFINITY;
      return { key: -best, secondary: best };
    };

    const sorted = [...drivers]
      .map((driver) => ({ driver, metric: metric(driver) }))
      .sort((a, b) => {
        if (eventConfig.eventType === 'Race') {
          if (a.metric.key !== b.metric.key) {
            return b.metric.key - a.metric.key;
          }
          return a.metric.secondary - b.metric.secondary;
        }
        if (a.metric.key !== b.metric.key) {
          return b.metric.key - a.metric.key;
        }
        return a.metric.secondary - b.metric.secondary;
      })
      .map((item, index, array) => {
        const { driver } = item;
        let gap = '--';
        let interval = '--';
        if (index > 0) {
          if (eventConfig.eventType === 'Race') {
            const leader = array[0].driver;
            const leaderLaps = leader.laps;
            const leaderTotal = leader.lapTimes.reduce(
              (sum, time) => sum + time,
              0,
            );
            const driverTotal = driver.lapTimes.reduce(
              (sum, time) => sum + time,
              0,
            );
            const lapDiff = leaderLaps - driver.laps;
            if (lapDiff === 0) {
              gap = `+${formatLapTime(driverTotal - leaderTotal)}`;
            } else {
              gap = `-${lapDiff}L`;
            }
            const ahead = array[index - 1].driver;
            const aheadTotal = ahead.lapTimes.reduce(
              (sum, time) => sum + time,
              0,
            );
            const aheadLapDiff = ahead.laps - driver.laps;
            if (aheadLapDiff === 0) {
              interval = `+${formatLapTime(driverTotal - aheadTotal)}`;
            } else {
              interval = `-${aheadLapDiff}L`;
            }
          } else {
            const leaderBest = array[0].driver.bestLap;
            const driverBest = driver.bestLap;
            const aheadBest = array[index - 1].driver.bestLap;
            if (leaderBest && driverBest) {
              gap = `+${formatLapTime(driverBest - leaderBest)}`;
            }
            if (aheadBest && driverBest) {
              interval = `+${formatLapTime(driverBest - aheadBest)}`;
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
  }, [drivers, eventConfig.eventType]);

  const activeFlag = useMemo(
    () => FLAG_OPTIONS.find((flag) => flag.id === flagStatus),
    [flagStatus],
  );

  const flagDropdownValue = flagStatus === 'green-check' ? 'green' : flagStatus;

  const openSetup = () => {
    setSetupDraft({
      eventType: eventConfig.eventType,
      totalLaps: eventConfig.totalLaps,
      totalDuration: eventConfig.totalDuration,
      marshals: eventConfig.marshals.map((marshal) => ({ ...marshal })),
      drivers: drivers.map(({ id, number, name, team, marshalId }) => ({
        id,
        number,
        name,
        team,
        marshalId,
      })),
    });
    setShowSetup(true);
  };

  const updateSetupDriver = (driverId, key, value) => {
    setSetupDraft((prev) => ({
      ...prev,
      drivers: prev.drivers.map((driver) =>
        driver.id === driverId ? { ...driver, [key]: value } : driver,
      ),
    }));
  };

  const addSetupDriver = () => {
    setSetupDraft((prev) => ({
      ...prev,
      drivers: [
        ...prev.drivers,
        {
          id: `d${Date.now()}`,
          number: prev.drivers.length + 1,
          name: 'New Driver',
          team: 'New Team',
          marshalId: prev.marshals[0]?.id ?? '',
        },
      ],
    }));
  };

  const removeSetupDriver = (driverId) => {
    setSetupDraft((prev) => ({
      ...prev,
      drivers: prev.drivers.filter((driver) => driver.id !== driverId),
    }));
  };

  const addMarshal = () => {
    setSetupDraft((prev) => ({
      ...prev,
      marshals: [
        ...prev.marshals,
        { id: `m${Date.now()}`, name: `Marshal ${prev.marshals.length + 1}` },
      ],
    }));
  };

  const updateMarshal = (marshalId, name) => {
    setSetupDraft((prev) => ({
      ...prev,
      marshals: prev.marshals.map((marshal) =>
        marshal.id === marshalId ? { ...marshal, name } : marshal,
      ),
    }));
  };

  const saveSetup = () => {
    if (procedurePhase !== 'setup') {
      const confirmed = window.confirm(
        'Updating the configuration will reset the current session. Continue?',
      );
      if (!confirmed) {
        return;
      }
    }
    setEventConfig(({ marshals: _oldMarshals, ...rest }) => ({
      ...rest,
      eventType: setupDraft.eventType,
      totalLaps: Number.parseInt(setupDraft.totalLaps, 10) || 0,
      totalDuration: Number.parseInt(setupDraft.totalDuration, 10) || 0,
      marshals: setupDraft.marshals,
    }));
    setDrivers(setupDraft.drivers.map((driver) => toDriverState(driver)));
    setProcedurePhase('setup');
    setIsTiming(false);
    setIsPaused(false);
    setFlagStatus('green');
    setRaceTime(0);
    setLogs([]);
    setShowSetup(false);
    logAction('Session configuration updated');
  };

  const exportResults = () => {
    const header = 'Position,Number,Driver,Team,Laps,Best Lap,Last Lap,Total Time,Status\n';
    const rows = driverTiming
      .map((driver) => {
        const total = driver.lapTimes.reduce((sum, time) => sum + time, 0);
        return [
          driver.position,
          driver.number,
          driver.name,
          driver.team,
          driver.laps,
          formatLapTime(driver.bestLap),
          formatLapTime(driver.lastLap),
          formatLapTime(total),
          driver.status.toUpperCase(),
        ].join(',');
      })
      .join('\n');
    const csv = `${header}${rows}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-results-${new Date().toISOString()}.csv`;
    a.click();
    logAction('Results exported to CSV');
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] text-white">
      <header className="sticky top-0 z-30 border-b border-neutral-800 bg-[#0B0F19]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-[#9FF7D3]">DayBreak Grand Prix</h1>
            <p className="text-[11px] uppercase tracking-[0.35em] text-neutral-500">
              Timing Control Panel
            </p>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            <div className="flex items-center gap-2 text-[#9FF7D3]">
              <Clock className="h-5 w-5" />
              <span className="font-mono text-2xl">{formatRaceClock(raceTime)}</span>
            </div>
            <span className="text-[11px] uppercase tracking-[0.3em] text-neutral-400">
              {procedurePhase.replace('-', ' ')}
              {isPaused ? ' • paused' : ''}
            </span>
          </div>
          <div className="flex items-center justify-end gap-3">
            <div className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900/70 px-3 py-1.5 text-[11px] uppercase tracking-wide text-neutral-300">
              <Flag className="h-4 w-4 text-[#9FF7D3]" />
              <span>{activeFlag?.label ?? flagStatus}</span>
            </div>
            <select
              value={flagDropdownValue}
              onChange={(event) => handleFlagChange(event.target.value)}
              className="rounded-full border border-neutral-700 bg-neutral-900/70 px-3 py-1.5 text-xs uppercase tracking-wide text-neutral-200 focus:outline-none focus:ring-2 focus:ring-[#7C6BFF]"
            >
              {FLAG_SELECT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              onClick={openSetup}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/80 text-neutral-300 transition hover:border-[#9FF7D3] hover:text-[#9FF7D3]"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="rounded-2xl border border-neutral-800 bg-[#11182c]/80 p-4 shadow-[0_18px_48px_-30px_rgba(124,107,255,0.45)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-neutral-400">
              <span className="font-semibold text-[#9FF7D3]">{eventConfig.eventType}</span>
              <span className="mx-2 text-neutral-600">•</span>
              <span>{eventConfig.totalLaps} laps target</span>
              <span className="mx-2 text-neutral-600">•</span>
              <span>{eventConfig.totalDuration} min duration</span>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {procedurePhase === 'setup' && (
                <button
                  onClick={startWarmup}
                  className="h-9 rounded-lg border border-neutral-700 bg-[#1a2238] px-3 font-semibold uppercase tracking-wide text-neutral-200 transition hover:border-[#9FF7D3]"
                >
                  Warm Up
                </button>
              )}
              {procedurePhase === 'warmup' && (
                <button
                  onClick={callFinalCall}
                  className="h-9 rounded-lg border border-amber-400/40 bg-amber-500/20 px-3 font-semibold uppercase tracking-wide text-amber-200 transition hover:border-amber-200"
                >
                  Final Call
                </button>
              )}
              {procedurePhase === 'final-call' && (
                <span className="flex h-9 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 font-semibold uppercase tracking-wide text-neutral-300">
                  Grid Ready
                </span>
              )}
              {procedurePhase === 'countdown' && (
                <span className="flex h-9 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 font-semibold uppercase tracking-wide text-neutral-300">
                  Starting in {countdown}s
                </span>
              )}
              {procedurePhase === 'green' && (
                <button
                  onClick={finishSession}
                  className="h-9 rounded-lg border border-[#9FF7D3]/50 bg-[#9FF7D3]/20 px-3 font-semibold uppercase tracking-wide text-[#9FF7D3] transition hover:border-[#9FF7D3]"
                >
                  Complete Session
                </button>
              )}
              {procedurePhase === 'complete' && (
                <span className="flex h-9 items-center justify-center rounded-lg border border-green-400/60 bg-green-500/20 px-3 font-semibold uppercase tracking-wide text-green-200">
                  Completed
                </span>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            <button
              onClick={initiateCountdown}
              disabled={procedurePhase !== 'final-call'}
              className="h-10 rounded-lg border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-3 text-xs font-semibold uppercase tracking-wide text-[#9FF7D3] transition hover:border-[#9FF7D3] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start Timer
            </button>
            <button
              onClick={confirmPause}
              disabled={!isTiming || isPaused}
              className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:border-[#9FF7D3] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Pause Timer
            </button>
            <button
              onClick={resumeTiming}
              disabled={!isPaused}
              className="h-10 rounded-lg border border-[#7C6BFF]/50 bg-[#7C6BFF]/20 px-3 text-xs font-semibold uppercase tracking-wide text-[#beb4ff] transition hover:border-[#9FF7D3] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Resume Timer
            </button>
            <button
              onClick={finishSession}
              disabled={procedurePhase !== 'green'}
              className="h-10 rounded-lg border border-green-400/40 bg-green-500/20 px-3 text-xs font-semibold uppercase tracking-wide text-green-200 transition hover:border-green-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset Timer
            </button>
            <button
              onClick={exportResults}
              className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:border-[#9FF7D3]"
            >
              Export CSV
            </button>
            <button
              onClick={openSetup}
              className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:border-[#9FF7D3]"
            >
              Session Setup
            </button>
            {FLAG_OPTIONS.filter((flag) => flag.id !== 'green-check').map((flag) => (
              <button
                key={flag.id}
                onClick={() => handleFlagChange(flag.id)}
                className={`h-10 rounded-lg text-xs font-semibold uppercase tracking-wide transition ${flag.color} ${
                  flagStatus === flag.id ? 'ring-2 ring-offset-2 ring-offset-[#0B0F19]' : ''
                }`}
              >
                {flag.label}
              </button>
            ))}
            {procedurePhase === 'suspended' && (
              <button
                onClick={() => handleFlagChange('green-check')}
                className={`h-10 rounded-lg text-xs font-semibold uppercase tracking-wide transition ${
                  FLAG_OPTIONS.find((flag) => flag.id === 'green-check')?.color ?? ''
                }`}
              >
                Resume
              </button>
            )}
          </div>
          <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-neutral-500">
            Keyboard hotkeys 1-0 trigger lap capture for assigned drivers while live.
          </p>
        </section>
        <div className="grid gap-6 lg:grid-cols-[3fr_1.15fr]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-neutral-800 bg-[#11182c]/80 p-4 shadow-[0_18px_48px_-30px_rgba(159,247,211,0.35)]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-neutral-400">
                  Driver Capture
                </h2>
                <span className="text-xs text-neutral-500">
                  Click or use hotkeys to log laps instantly.
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {drivers.map((driver, index) => {
                  const canLogLap = isTiming && !isPaused && driver.status === 'ontrack';
                  const cardHotkey = HOTKEYS[index] ?? null;
                  const isFlashing = recentLapDriverId === driver.id;
                  return (
                    <div
                      key={driver.id}
                      className={`flex h-full flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-950/80 p-3 text-left shadow-sm transition hover:border-[#9FF7D3] hover:shadow-md ${
                        driver.status === 'retired'
                          ? 'opacity-60'
                          : driver.status === 'finished'
                            ? 'border-green-400/60'
                            : ''
                      } ${isFlashing ? 'ring-2 ring-[#9FF7D3]/70' : ''}`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-[#9FF7D3]">
                              #{driver.number} {driver.name}
                            </div>
                            <div className="text-[11px] text-neutral-400">{driver.team}</div>
                            <div className="text-[10px] text-neutral-500">
                              Marshal: {getMarshalName(driver.marshalId)}
                            </div>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                              driver.status === 'ontrack'
                                ? 'bg-[#9FF7D3]/15 text-[#9FF7D3]'
                                : driver.status === 'retired'
                                  ? 'bg-red-500/20 text-red-300'
                                  : driver.status === 'finished'
                                    ? 'bg-green-500/20 text-green-200'
                                    : 'bg-neutral-800 text-neutral-400'
                            }`}
                          >
                            {driver.status}
                          </span>
                        </div>
                        {driver.driverFlag !== 'none' && (
                          <span className="inline-flex rounded-full border border-amber-200/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                            {driver.driverFlag === 'blackwhite' ? 'Black & White' : driver.driverFlag}
                          </span>
                        )}
                        <div className="flex items-center justify-between text-[11px] text-neutral-400">
                          <span>
                            Laps:{' '}
                            <span className="font-semibold text-neutral-100">{driver.laps}</span>
                          </span>
                          <span>
                            Best:{' '}
                            <span className="font-mono text-[#9FF7D3]">
                              {formatLapTime(driver.bestLap)}
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-neutral-400">
                          <span>
                            Last:{' '}
                            <span className="font-mono text-neutral-100">
                              {formatLapTime(driver.lastLap)}
                            </span>
                          </span>
                          <span>Pits: {driver.pits}</span>
                        </div>
                      </div>
                        <div className="mt-3 space-y-2">
                          <button
                            onClick={() => recordLap(driver.id, { source: 'control-panel' })}
                            disabled={!canLogLap}
                          className={`w-full rounded-md py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                            canLogLap
                              ? 'bg-[#9FF7D3] text-black hover:bg-[#7eeac3]'
                              : 'bg-neutral-800 text-neutral-500'
                          } ${isFlashing ? 'animate-pulse' : ''}`}
                          >
                          Log Lap
                          {cardHotkey ? ` (${cardHotkey})` : ''}
                        </button>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={manualLapInputs[driver.id] ?? ''}
                            onChange={(event) =>
                              setManualLapInputs((prev) => ({
                                ...prev,
                                [driver.id]: event.target.value,
                              }))
                            }
                            placeholder="mm:ss.mmm"
                            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-500 focus:border-[#9FF7D3] focus:outline-none focus:ring-1 focus:ring-[#9FF7D3]"
                          />
                          <button
                            onClick={() => {
                              const manualTime = parseManualLap(manualLapInputs[driver.id] ?? '');
                              if (manualTime !== null) {
                                recordLap(driver.id, { manualTime, source: 'manual-entry' });
                              }
                            }}
                            className="h-8 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-200 transition hover:border-[#9FF7D3]"
                          >
                            Manual
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            onClick={() => togglePitStop(driver.id)}
                            className={`h-8 rounded-md text-[10px] font-semibold uppercase tracking-wide transition ${
                              driver.pitComplete
                                ? 'border border-[#9FF7D3]/50 bg-[#9FF7D3]/20 text-[#9FF7D3]'
                                : 'border border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-[#9FF7D3]'
                            }`}
                          >
                            {driver.pitComplete ? 'Pit Complete' : 'Mark Pit'}
                          </button>
                          <button
                            onClick={() => retireDriver(driver.id)}
                            disabled={driver.status === 'retired'}
                            className="h-8 rounded-md border border-red-500/60 bg-red-500/15 text-[10px] font-semibold uppercase tracking-wide text-red-200 transition hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Retire
                          </button>
                        </div>
                        <select
                          value={driver.driverFlag}
                          onChange={(event) => setDriverFlag(driver.id, event.target.value)}
                          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-300 focus:border-[#7C6BFF] focus:outline-none focus:ring-1 focus:ring-[#7C6BFF]"
                        >
                          {DRIVER_FLAG_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="rounded-2xl border border-neutral-800 bg-[#11182c]/70 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-neutral-400">
                  Live Timing
                </h2>
                <ListChecks className="h-4 w-4 text-neutral-500" />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full table-fixed border-separate border-spacing-y-1 text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-[0.25em] text-neutral-500">
                    <tr>
                      <th className="px-2 py-1">Pos</th>
                      <th className="px-2 py-1">No.</th>
                      <th className="px-2 py-1">Driver</th>
                      <th className="px-2 py-1">Laps</th>
                      <th className="px-2 py-1">Best</th>
                      <th className="px-2 py-1">Last</th>
                      <th className="px-2 py-1">Gap</th>
                      <th className="px-2 py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverTiming.map((driver) => {
                      const total = driver.lapTimes.reduce((sum, time) => sum + time, 0);
                      return (
                        <tr
                          key={driver.id}
                          className="rounded-lg border border-neutral-800 bg-neutral-900/60 text-[11px] text-neutral-200"
                        >
                          <td className="px-2 py-2 font-semibold text-[#9FF7D3]">{driver.position}</td>
                          <td className="px-2 py-2 text-neutral-400">{driver.number}</td>
                          <td className="px-2 py-2">
                            <div className="font-semibold text-neutral-100">{driver.name}</div>
                            <div className="text-[10px] text-neutral-500">
                              {getMarshalName(driver.marshalId)}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center font-semibold">{driver.laps}</td>
                          <td className="px-2 py-2 font-mono text-[#9FF7D3]">
                            {formatLapTime(driver.bestLap)}
                          </td>
                          <td className="px-2 py-2 font-mono text-neutral-200">
                            {formatLapTime(driver.lastLap)}
                          </td>
                          <td className="px-2 py-2 text-neutral-300">{driver.gap}</td>
                          <td className="px-2 py-2">
                            <div className="capitalize text-neutral-200">{driver.status}</div>
                            <div className="text-[10px] text-neutral-500">
                              {formatLapTime(total)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <aside className="space-y-6">
            <section className="rounded-2xl border border-neutral-800 bg-[#11182c]/80 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-neutral-400">
                  Marshal Assignments
                </h3>
                <Users className="h-4 w-4 text-neutral-500" />
              </div>
              <ul className="mt-3 space-y-2 text-xs text-neutral-300">
                {eventConfig.marshals.map((marshal) => {
                  const assignedDrivers = drivers.filter((driver) => driver.marshalId === marshal.id);
                  return (
                    <li
                      key={marshal.id}
                      className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-500">
                        <span>{marshal.name}</span>
                        <span>{assignedDrivers.length} Drivers</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-neutral-300">
                        {assignedDrivers.map((driver) => (
                          <span
                            key={driver.id}
                            className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5"
                          >
                            #{driver.number} {driver.name}
                          </span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="rounded-2xl border border-neutral-800 bg-[#11182c]/80 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-neutral-400">
                  Control Log
                </h3>
                <ShieldAlert className="h-4 w-4 text-neutral-500" />
              </div>
              <ul className="mt-3 space-y-2 text-[11px] text-neutral-200">
                {logs.length === 0 && (
                  <li className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-neutral-500">
                    No race control actions recorded yet.
                  </li>
                )}
                {logs.map((log) => (
                  <li
                    key={log.id}
                    className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-3 shadow-sm"
                  >
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-500">
                      <span>{log.marshalId}</span>
                      <span>{log.timestamp.toLocaleTimeString()}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-100">{log.action}</p>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </main>
      {showSetup && setupDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-gray-800 p-6">
            <div className="flex items-center justify-between border-b border-gray-700 pb-4">
              <div>
                <h2 className="text-2xl font-bold">Session Configuration</h2>
                <p className="text-sm text-gray-400">
                  Define event type, total laps, and marshal driver assignments.
                </p>
              </div>
              <button
                onClick={() => setShowSetup(false)}
                className="rounded bg-gray-800 p-2 hover:bg-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-6 space-y-6">
              <section className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Event Type
                  </label>
                  <select
                    value={setupDraft.eventType}
                    onChange={(event) =>
                      setSetupDraft((prev) => ({
                        ...prev,
                        eventType: event.target.value,
                      }))
                    }
                    className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
                  >
                    {EVENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Target Laps
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={setupDraft.totalLaps}
                    onChange={(event) =>
                      setSetupDraft((prev) => ({
                        ...prev,
                        totalLaps: event.target.value,
                      }))
                    }
                    className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Session Duration (mins)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={setupDraft.totalDuration}
                    onChange={(event) =>
                      setSetupDraft((prev) => ({
                        ...prev,
                        totalDuration: event.target.value,
                      }))
                    }
                    className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
                  />
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                    Marshals
                  </h3>
                  <button
                    onClick={addMarshal}
                    className="flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-xs uppercase tracking-wide hover:bg-gray-700"
                  >
                    <Users className="w-4 h-4" /> Add Marshal
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {setupDraft.marshals.map((marshal) => (
                    <div key={marshal.id} className="rounded border border-gray-700 p-3">
                      <label className="text-xs uppercase tracking-wide text-gray-400">
                        Marshal Name
                      </label>
                      <input
                        type="text"
                        value={marshal.name}
                        onChange={(event) => updateMarshal(marshal.id, event.target.value)}
                        className="mt-2 w-full rounded bg-gray-800 px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                    Drivers
                  </h3>
                  <button
                    onClick={addSetupDriver}
                    className="flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-xs uppercase tracking-wide hover:bg-gray-700"
                  >
                    <Play className="w-4 h-4" /> Add Driver
                  </button>
                </div>
                <div className="space-y-3">
                  {setupDraft.drivers.map((driver) => (
                    <div
                      key={driver.id}
                      className="grid gap-3 rounded border border-gray-700 p-3 md:grid-cols-5"
                    >
                      <div className="space-y-1">
                        <label className="text-xs uppercase tracking-wide text-gray-500">
                          Number
                        </label>
                        <input
                          type="number"
                          value={driver.number}
                          onChange={(event) =>
                            updateSetupDriver(driver.id, 'number', Number(event.target.value))
                          }
                          className="w-full rounded bg-gray-800 px-2 py-1 text-sm"
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs uppercase tracking-wide text-gray-500">
                          Driver Name
                        </label>
                        <input
                          type="text"
                          value={driver.name}
                          onChange={(event) =>
                            updateSetupDriver(driver.id, 'name', event.target.value)
                          }
                          className="w-full rounded bg-gray-800 px-2 py-1 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs uppercase tracking-wide text-gray-500">
                          Team
                        </label>
                        <input
                          type="text"
                          value={driver.team}
                          onChange={(event) =>
                            updateSetupDriver(driver.id, 'team', event.target.value)
                          }
                          className="w-full rounded bg-gray-800 px-2 py-1 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs uppercase tracking-wide text-gray-500">
                          Marshal
                        </label>
                        <select
                          value={driver.marshalId}
                          onChange={(event) =>
                            updateSetupDriver(driver.id, 'marshalId', event.target.value)
                          }
                          className="w-full rounded bg-gray-800 px-2 py-1 text-sm"
                        >
                          {setupDraft.marshals.map((marshal) => (
                            <option key={marshal.id} value={marshal.id}>
                              {marshal.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-5">
                        <button
                          onClick={() => removeSetupDriver(driver.id)}
                          className="mt-2 w-full rounded bg-red-600 py-1 text-xs uppercase tracking-wide hover:bg-red-700"
                        >
                          Remove Driver
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="mt-6 flex flex-col gap-3 border-t border-gray-700 pt-4 md:flex-row md:justify-end">
              <button
                onClick={() => setShowSetup(false)}
                className="rounded bg-gray-800 px-4 py-2 text-sm hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={saveSetup}
                className="flex items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-700"
              >
                <Save className="w-4 h-4" /> Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimingPanel;
