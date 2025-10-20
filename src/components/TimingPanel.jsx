import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Flag,
  ListChecks,
  PauseCircle,
  Play,
  PlayCircle,
  Save,
  Settings,
  ShieldAlert,
  TimerReset,
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
  { id: 'green', label: 'Green', color: 'bg-green-600 hover:bg-green-700' },
  { id: 'yellow', label: 'Yellow', color: 'bg-yellow-500 hover:bg-yellow-600' },
  { id: 'vsc', label: 'VSC', color: 'bg-emerald-600 hover:bg-emerald-700' },
  { id: 'sc', label: 'SC', color: 'bg-amber-500 hover:bg-amber-600' },
  { id: 'red', label: 'Red', color: 'bg-red-600 hover:bg-red-700' },
  { id: 'green-check', label: 'Resume', color: 'bg-blue-600 hover:bg-blue-700' },
];

const DRIVER_FLAG_OPTIONS = [
  { id: 'none', label: 'No Flag' },
  { id: 'blue', label: 'Blue Flag' },
  { id: 'blackwhite', label: 'Black & White' },
];

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

  const raceStartRef = useRef(null);
  const pauseStartRef = useRef(null);
  const pausedDurationRef = useRef(0);

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
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-blue-400">DayBreak Grand Prix</h1>
            <p className="text-gray-400">Timing &amp; Scoring Control Panel</p>
            <p className="text-xs text-gray-500">
              Every action is logged with marshal accountability.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 bg-gray-800 rounded px-4 py-2">
              <Clock className="w-5 h-5" />
              <span className="text-2xl font-mono">{formatRaceClock(raceTime)}</span>
              {isPaused && (
                <span className="ml-2 rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-black">
                  PAUSED
                </span>
              )}
            </div>
            <div
              className={`flex items-center gap-2 rounded px-4 py-2 capitalize ${
                flagStatus === 'green'
                  ? 'bg-green-600'
                  : flagStatus === 'yellow'
                    ? 'bg-yellow-500 text-black'
                    : flagStatus === 'red'
                      ? 'bg-red-600'
                      : flagStatus === 'sc'
                        ? 'bg-amber-600'
                        : flagStatus === 'vsc'
                          ? 'bg-emerald-600'
                          : 'bg-blue-600'
              }`}
            >
              <Flag className="w-5 h-5" />
              <span className="font-semibold">{flagStatus}</span>
            </div>
            <div className="bg-gray-800 px-4 py-2 rounded text-sm">
              <span className="text-gray-400 mr-2">Session</span>
              <span className="font-semibold capitalize">{procedurePhase.replace('-', ' ')}</span>
            </div>
            <button
              onClick={openSetup}
              className="flex items-center gap-2 rounded bg-gray-800 px-4 py-2 hover:bg-gray-700"
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="bg-gray-800 rounded-lg p-4 space-y-4 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">
                  Event Configuration
                </p>
                <p className="text-lg font-semibold">
                  {eventConfig.eventType} • Target {eventConfig.totalLaps} Laps • {eventConfig.totalDuration} min
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {procedurePhase === 'setup' && (
                  <button
                    onClick={startWarmup}
                    className="flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm hover:bg-blue-700"
                  >
                    <Play className="w-4 h-4" /> Warm Up
                  </button>
                )}
                {procedurePhase === 'warmup' && (
                  <button
                    onClick={callFinalCall}
                    className="flex items-center gap-2 rounded bg-amber-600 px-3 py-2 text-sm hover:bg-amber-700"
                  >
                    <AlertTriangle className="w-4 h-4" /> Final Call
                  </button>
                )}
                {procedurePhase === 'final-call' && (
                  <button
                    onClick={initiateCountdown}
                    className="flex items-center gap-2 rounded bg-orange-600 px-3 py-2 text-sm hover:bg-orange-700"
                  >
                    <TimerReset className="w-4 h-4" /> Start Countdown
                  </button>
                )}
                {procedurePhase === 'countdown' && (
                  <button
                    disabled
                    className="flex items-center gap-2 rounded bg-gray-700 px-3 py-2 text-sm"
                  >
                    <Clock className="w-4 h-4" /> Starting in {countdown}s
                  </button>
                )}
                {procedurePhase === 'green' && (
                  <button
                    onClick={finishSession}
                    className="flex items-center gap-2 rounded bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600"
                  >
                    <Flag className="w-4 h-4" /> Finish Session
                  </button>
                )}
                {procedurePhase === 'complete' && (
                  <span className="flex items-center gap-2 rounded bg-green-600 px-3 py-2 text-sm">
                    <CheckCircle2 className="w-4 h-4" /> Completed
                  </span>
                )}
                <button
                  onClick={exportResults}
                  className="flex items-center gap-2 rounded bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600"
                >
                  <Download className="w-4 h-4" /> Export
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={confirmPause}
                disabled={!isTiming || isPaused}
                className="flex items-center gap-2 rounded bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PauseCircle className="w-4 h-4" /> Pause Timer
              </button>
              <button
                onClick={resumeTiming}
                disabled={!isPaused}
                className="flex items-center gap-2 rounded bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlayCircle className="w-4 h-4" /> Resume Timer
              </button>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
                Flag Control
              </p>
              <div className="flex flex-wrap gap-2">
                {FLAG_OPTIONS.map((flag) => (
                  <button
                    key={flag.id}
                    onClick={() => handleFlagChange(flag.id)}
                    className={`rounded px-3 py-2 text-sm font-semibold ${flag.color}`}
                  >
                    {flag.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                Marshal Assignments
              </h3>
              <Users className="w-4 h-4 text-gray-500" />
            </div>
            <ul className="space-y-2 text-sm">
              {eventConfig.marshals.map((marshal) => {
                const assignedDrivers = drivers.filter(
                  (driver) => driver.marshalId === marshal.id,
                );
                return (
                  <li
                    key={marshal.id}
                    className="rounded border border-gray-700 p-3 text-gray-300"
                  >
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide text-gray-400">
                      <span>{marshal.name}</span>
                      <span>{assignedDrivers.length} Drivers</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {assignedDrivers.map((driver) => (
                        <span
                          key={driver.id}
                          className="rounded bg-gray-700 px-2 py-1 text-xs"
                        >
                          #{driver.number} {driver.name}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          {drivers.map((driver) => (
            <div
              key={driver.id}
              className={`rounded-lg border-2 bg-gray-800 p-4 ${
                driver.status === 'finished'
                  ? 'border-green-500'
                  : driver.status === 'retired'
                    ? 'border-red-500'
                    : 'border-gray-700'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => recordLap(driver.id, { source: 'control-panel' })}
                    disabled={!isTiming || isPaused || driver.status !== 'ontrack'}
                    className={`flex h-12 w-12 items-center justify-center rounded-lg text-xl font-bold ${
                      !isTiming || isPaused || driver.status !== 'ontrack'
                        ? 'bg-gray-700 text-gray-500'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {driver.number}
                  </button>
                  <div>
                    <p className="text-xl font-bold">{driver.name}</p>
                    <p className="text-sm text-gray-400">{driver.team}</p>
                    <p className="text-xs text-gray-500">Marshal: {getMarshalName(driver.marshalId)}</p>
                    {driver.driverFlag !== 'none' && (
                      <span className="mt-1 inline-block rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-black">
                        {driver.driverFlag.replace('blackwhite', 'Black & White')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <button
                    onClick={() => retireDriver(driver.id)}
                    disabled={driver.status === 'retired'}
                    className="rounded bg-red-600 px-3 py-1 text-xs font-semibold hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    RETIRE
                  </button>
                  <button
                    onClick={() => togglePitStop(driver.id)}
                    className={`rounded px-3 py-1 text-xs font-semibold ${
                      driver.pitComplete
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    {driver.pitComplete ? 'PIT COMPLETE' : 'MARK PIT'}
                  </button>
                  <select
                    value={driver.driverFlag}
                    onChange={(event) => setDriverFlag(driver.id, event.target.value)}
                    className="rounded bg-gray-800 px-2 py-1 text-xs"
                  >
                    {DRIVER_FLAG_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-400">Laps</p>
                  <p className="text-xl font-bold">
                    {driver.laps}/{eventConfig.totalLaps}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">Status</p>
                  <p className="text-lg font-semibold capitalize">{driver.status}</p>
                </div>
                <div>
                  <p className="text-gray-400">Last Lap</p>
                  <p className="font-mono text-lg">{formatLapTime(driver.lastLap)}</p>
                </div>
                <div>
                  <p className="text-gray-400">Best Lap</p>
                  <p className="font-mono text-lg text-green-400">
                    {formatLapTime(driver.bestLap)}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={manualLapInputs[driver.id] ?? ''}
                    onChange={(event) =>
                      setManualLapInputs((prev) => ({
                        ...prev,
                        [driver.id]: event.target.value,
                      }))
                    }
                    placeholder="Manual lap (m:ss.mmm)"
                    className="flex-1 rounded bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => {
                      const manualTime = parseManualLap(manualLapInputs[driver.id] ?? '');
                      if (manualTime !== null) {
                        recordLap(driver.id, { manualTime, source: 'manual-entry' });
                      }
                    }}
                    className="rounded bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600"
                  >
                    Log Lap
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Keyboard shortcuts: 1-9,0 trigger lap capture for assigned drivers when the session is live.
                </p>
              </div>
            </div>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg bg-gray-800 p-4 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Live Timing</h2>
              <ListChecks className="w-5 h-5 text-gray-500" />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-800 text-xs uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Pos</th>
                    <th className="px-3 py-2">No.</th>
                    <th className="px-3 py-2">Driver</th>
                    <th className="px-3 py-2">Team</th>
                    <th className="px-3 py-2 text-right">Laps</th>
                    <th className="px-3 py-2 text-right">Best</th>
                    <th className="px-3 py-2 text-right">Last</th>
                    <th className="px-3 py-2 text-right">Interval</th>
                    <th className="px-3 py-2 text-right">Gap</th>
                    <th className="px-3 py-2 text-center">Pits</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {driverTiming.map((driver) => {
                    const total = driver.lapTimes.reduce(
                      (sum, time) => sum + time,
                      0,
                    );
                    return (
                      <tr key={driver.id} className="border-b border-gray-800 text-sm">
                        <td className="px-3 py-3 font-semibold">{driver.position}</td>
                        <td className="px-3 py-3">{driver.number}</td>
                        <td className="px-3 py-3">
                          <div className="font-semibold">{driver.name}</div>
                          <div className="text-xs text-gray-500">{getMarshalName(driver.marshalId)}</div>
                        </td>
                        <td className="px-3 py-3 text-gray-400">{driver.team}</td>
                        <td className="px-3 py-3 text-right font-semibold">{driver.laps}</td>
                        <td className="px-3 py-3 text-right font-mono text-green-400">
                          {formatLapTime(driver.bestLap)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono">
                          {formatLapTime(driver.lastLap)}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-300">{driver.interval}</td>
                        <td className="px-3 py-3 text-right text-gray-300">{driver.gap}</td>
                        <td className="px-3 py-3 text-center">{driver.pits}</td>
                        <td className="px-3 py-3 text-center capitalize">
                          {driver.status}
                          <div className="text-xs text-gray-500">
                            {formatLapTime(total)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg bg-gray-800 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Control Log</h2>
              <ShieldAlert className="w-5 h-5 text-gray-500" />
            </div>
            <ul className="mt-4 space-y-3 text-xs">
              {logs.length === 0 && (
                <li className="text-gray-500">No race control actions recorded yet.</li>
              )}
              {logs.map((log) => (
                <li key={log.id} className="rounded border border-gray-700 p-3">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500">
                    <span>{log.marshalId}</span>
                    <span>{log.timestamp.toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-200">{log.action}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

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
