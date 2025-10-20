import { useState, useEffect, useRef } from 'react';
import {
  Play,
  Flag,
  AlertTriangle,
  Clock,
  Settings,
  Download,
  X,
  LayoutGrid,
  Rows,
  Ban,
  Car,
  TimerReset,
} from 'lucide-react';

const TimingPanel = () => {
  const [racePhase, setRacePhase] = useState('setup');
  const [countdown, setCountdown] = useState(5);
  const [raceTime, setRaceTime] = useState(0);
  const [totalLaps, setTotalLaps] = useState(10);
  const [flagStatus, setFlagStatus] = useState('green');

  const [drivers, setDrivers] = useState([
    {
      id: 1,
      number: 1,
      name: 'Driver 1',
      team: 'Team Alpha',
      laps: 0,
      lapTimes: [],
      currentLapStart: null,
      status: 'active',
      bestLap: null,
      inPit: false,
    },
    {
      id: 2,
      number: 2,
      name: 'Driver 2',
      team: 'Team Alpha',
      laps: 0,
      lapTimes: [],
      currentLapStart: null,
      status: 'active',
      bestLap: null,
      inPit: false,
    },
    {
      id: 3,
      number: 3,
      name: 'Driver 3',
      team: 'Team Bravo',
      laps: 0,
      lapTimes: [],
      currentLapStart: null,
      status: 'active',
      bestLap: null,
      inPit: false,
    },
    {
      id: 4,
      number: 4,
      name: 'Driver 4',
      team: 'Team Bravo',
      laps: 0,
      lapTimes: [],
      currentLapStart: null,
      status: 'active',
      bestLap: null,
      inPit: false,
    },
    {
      id: 5,
      number: 5,
      name: 'Driver 5',
      team: 'Team Charlie',
      laps: 0,
      lapTimes: [],
      currentLapStart: null,
      status: 'active',
      bestLap: null,
      inPit: false,
    },
    {
      id: 6,
      number: 6,
      name: 'Driver 6',
      team: 'Team Charlie',
      laps: 0,
      lapTimes: [],
      currentLapStart: null,
      status: 'active',
      bestLap: null,
      inPit: false,
    },
    {
      id: 7,
      number: 7,
      name: 'Driver 7',
      team: 'Team Delta',
      laps: 0,
      lapTimes: [],
      currentLapStart: null,
      status: 'active',
      bestLap: null,
      inPit: false,
    },
    {
      id: 8,
      number: 8,
      name: 'Driver 8',
      team: 'Team Delta',
      laps: 0,
      lapTimes: [],
      currentLapStart: null,
      status: 'active',
      bestLap: null,
      inPit: false,
    },
    {
      id: 9,
      number: 9,
      name: 'Driver 9',
      team: 'Team Echo',
      laps: 0,
      lapTimes: [],
      currentLapStart: null,
      status: 'active',
      bestLap: null,
      inPit: false,
    },
    {
      id: 10,
      number: 10,
      name: 'Driver 10',
      team: 'Team Echo',
      laps: 0,
      lapTimes: [],
      currentLapStart: null,
      status: 'active',
      bestLap: null,
      inPit: false,
    },
  ]);

  const [compactView, setCompactView] = useState(false);

  const [showSetup, setShowSetup] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const raceStartTime = useRef(null);

  useEffect(() => {
    let interval;
    if (racePhase === 'racing') {
      interval = setInterval(() => {
        setRaceTime(Date.now() - raceStartTime.current);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [racePhase]);

  useEffect(() => {
    if (racePhase === 'countdown' && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (racePhase === 'countdown' && countdown === 0) {
      startRace();
    }
  }, [racePhase, countdown]);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (racePhase !== 'racing') return;

      const key = e.key;
      let driverNumber;

      if (key >= '1' && key <= '9') {
        driverNumber = parseInt(key, 10);
      } else if (key === '0') {
        driverNumber = 10;
      } else {
        return;
      }

      const driver = drivers.find((d) => d.number === driverNumber);
      if (driver) {
        recordLap(driver.id);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [racePhase, drivers]);

  const startWarmup = () => {
    setRacePhase('warmup');
  };

  const callFinalCall = () => {
    setRacePhase('finalcall');
  };

  const initiateCountdown = () => {
    setCountdown(5);
    setRacePhase('countdown');
  };

  const startRace = () => {
    raceStartTime.current = Date.now();
    setRacePhase('racing');
    setRaceTime(0);

    setDrivers((prev) =>
      prev.map((d) => ({
        ...d,
        currentLapStart: Date.now(),
        status: 'active',
        inPit: false,
      })),
    );
  };

  const recordLap = (driverId) => {
    const now = Date.now();

    setDrivers((prev) =>
      prev.map((driver) => {
        if (
          driver.id !== driverId ||
          driver.status === 'dnf' ||
          driver.status === 'finished'
        ) {
          return driver;
        }

        const lapTime = now - driver.currentLapStart;
        const newLapTimes = [...driver.lapTimes, lapTime];
        const newLaps = driver.laps + 1;
        const newBestLap =
          driver.bestLap === null ? lapTime : Math.min(driver.bestLap, lapTime);
        const newStatus = newLaps >= totalLaps ? 'finished' : 'active';

        return {
          ...driver,
          laps: newLaps,
          lapTimes: newLapTimes,
          currentLapStart: now,
          bestLap: newBestLap,
          status: newStatus,
        };
      }),
    );
  };

  const markDNF = (driverId) => {
    setDrivers((prev) =>
      prev.map((driver) =>
        driver.id === driverId
          ? {
              ...driver,
              status: 'dnf',
              inPit: false,
            }
          : driver,
      ),
    );
  };

  const togglePitStatus = (driverId) => {
    setDrivers((prev) =>
      prev.map((driver) =>
        driver.id === driverId
          ? {
              ...driver,
              inPit: !driver.inPit,
            }
          : driver,
      ),
    );
  };

  const finishRace = () => {
    setRacePhase('finished');
    setShowResults(true);
  };

  const formatTime = (ms) => {
    if (!ms) return '--:--.---';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds
      .toString()
      .padStart(3, '0')}`;
  };

  const formatRaceTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  };

  const getFlagColor = () => {
    switch (flagStatus) {
      case 'green':
        return 'bg-green-500';
      case 'yellow':
        return 'bg-yellow-400';
      case 'red':
        return 'bg-red-500';
      default:
        return 'bg-green-500';
    }
  };

  const generateResults = () => {
    const sortedDrivers = [...drivers].sort((a, b) => {
      if (a.status === 'finished' && b.status !== 'finished') return -1;
      if (a.status !== 'finished' && b.status === 'finished') return 1;
      if (a.status === 'finished' && b.status === 'finished') {
        const aTotal = a.lapTimes.reduce((sum, t) => sum + t, 0);
        const bTotal = b.lapTimes.reduce((sum, t) => sum + t, 0);
        return aTotal - bTotal;
      }
      return b.laps - a.laps;
    });

    return sortedDrivers;
  };

  const exportResults = () => {
    const results = generateResults();
    let csv = 'Position,Number,Name,Team,Laps,Total Time,Best Lap,Status\n';

    results.forEach((driver, idx) => {
      const totalTime = driver.lapTimes.reduce((sum, t) => sum + t, 0);
      csv += `${idx + 1},${driver.number},${driver.name},${driver.team},${
        driver.laps
      },${formatTime(totalTime)},${formatTime(driver.bestLap)},${driver.status.toUpperCase()}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daybreak-gp-results-${new Date().toISOString()}.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 pb-6 space-y-4">
        <header className="sticky top-0 z-40 -mx-4 px-4 py-4 bg-gray-900/95 backdrop-blur border-b border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-blue-400">DayBreak Grand Prix</h1>
              <p className="text-gray-400 text-sm">Timing &amp; Scoring Panel</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded border border-gray-700 px-3 py-2">
                <Clock className="w-4 h-4" />
                <span className="text-xl font-mono">{formatRaceTime(raceTime)}</span>
              </div>

              <div
                className={`flex items-center gap-2 px-3 py-2 rounded border border-gray-700 ${getFlagColor()}`}
              >
                <Flag className="w-4 h-4" />
                <span className="text-sm font-bold uppercase">{flagStatus}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCompactView((prev) => !prev)}
                  className="flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-sm hover:bg-gray-700"
                >
                  {compactView ? (
                    <Rows className="w-4 h-4" />
                  ) : (
                    <LayoutGrid className="w-4 h-4" />
                  )}
                  <span>{compactView ? 'Expanded View' : 'Compact View'}</span>
                </button>

                <button
                  onClick={() => setShowSetup(true)}
                  className="p-2 rounded bg-gray-800 hover:bg-gray-700"
                >
                  <Settings className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="bg-gray-800/80 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-lg font-bold">Race Control:</span>
              <span
                className={`px-3 py-1 rounded ${
                  racePhase === 'setup'
                    ? 'bg-gray-700'
                    : racePhase === 'warmup'
                      ? 'bg-blue-600'
                      : racePhase === 'finalcall'
                        ? 'bg-yellow-600'
                        : racePhase === 'countdown'
                          ? 'bg-orange-600'
                          : racePhase === 'racing'
                            ? 'bg-green-600'
                            : 'bg-gray-700'
                }`}
              >
                {racePhase === 'setup'
                  ? 'Setup'
                  : racePhase === 'warmup'
                    ? 'Warm Up Lap'
                    : racePhase === 'finalcall'
                      ? 'Final Call'
                      : racePhase === 'countdown'
                        ? `Starting in ${countdown}s`
                        : racePhase === 'racing'
                          ? 'Racing'
                          : 'Finished'}
              </span>
            </div>

            <div className="flex gap-2 text-sm">
              {racePhase === 'setup' && (
                <button
                  onClick={startWarmup}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded flex items-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  Start Warm Up
                </button>
              )}

              {racePhase === 'warmup' && (
                <button
                  onClick={callFinalCall}
                  className="px-3 py-2 bg-yellow-600 hover:bg-yellow-700 rounded flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4" />
                  Final Call
                </button>
              )}

              {racePhase === 'finalcall' && (
                <button
                  onClick={initiateCountdown}
                  className="px-3 py-2 bg-orange-600 hover:bg-orange-700 rounded flex items-center gap-2"
                >
                  <Clock className="w-4 h-4" />
                  Initiate Start (5s)
                </button>
              )}

              {racePhase === 'racing' && (
                <>
                  <button
                    onClick={() => setFlagStatus('green')}
                    className="px-3 py-2 bg-green-600 hover:bg-green-700 rounded"
                  >
                    Green
                  </button>
                  <button
                    onClick={() => setFlagStatus('yellow')}
                    className="px-3 py-2 bg-yellow-500 hover:bg-yellow-600 rounded"
                  >
                    Yellow
                  </button>
                  <button
                    onClick={() => setFlagStatus('red')}
                    className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded"
                  >
                    Red
                  </button>
                  <button
                    onClick={finishRace}
                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded flex items-center gap-2"
                  >
                    <Flag className="w-4 h-4" />
                    Finish Race
                  </button>
                </>
              )}

              {racePhase === 'finished' && (
                <button
                  onClick={() => setShowResults(true)}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded"
                >
                  View Results
                </button>
              )}
            </div>
          </div>
        </div>

        <div
          className={`grid gap-3 ${
            compactView
              ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
          }`}
        >
          {drivers.map((driver) => (
            <div
              key={driver.id}
              className={`rounded-lg border ${
                driver.status === 'finished'
                  ? 'border-green-500/80'
                  : driver.status === 'dnf'
                    ? 'border-red-500/80'
                    : driver.inPit
                      ? 'border-yellow-400/80'
                      : 'border-gray-700'
              } bg-gray-800/80 ${compactView ? 'p-3 space-y-2' : 'p-4 space-y-3'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => recordLap(driver.id)}
                    disabled={racePhase !== 'racing' || driver.status !== 'active'}
                    className={`flex h-14 w-14 items-center justify-center rounded-lg text-xl font-bold transition ${
                      racePhase === 'racing' && driver.status === 'active'
                        ? 'bg-blue-600 hover:bg-blue-700'
                        : 'bg-gray-700 text-gray-400'
                    }`}
                    title="Log Lap"
                  >
                    {driver.number}
                  </button>

                  <div className="space-y-1">
                    <div
                      className={`font-semibold ${compactView ? 'text-sm' : 'text-lg'}`}
                    >
                      {driver.name}
                    </div>
                    {!compactView && (
                      <div className="text-xs text-gray-400">{driver.team}</div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide">
                      {driver.status !== 'active' && (
                        <span
                          className={`font-semibold ${
                            driver.status === 'finished'
                              ? 'text-green-400'
                              : 'text-red-400'
                          }`}
                        >
                          {driver.status}
                        </span>
                      )}
                      {driver.inPit && (
                        <span className="flex items-center gap-1 text-amber-300">
                          <Car className="h-3 w-3" /> Pit
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-1 text-gray-400">
                  <button
                    onClick={() => togglePitStatus(driver.id)}
                    className={`rounded bg-gray-700/80 p-2 hover:bg-gray-600 ${
                      driver.inPit ? 'text-amber-300' : ''
                    }`}
                    title={driver.inPit ? 'Release from Pit' : 'Mark in Pit'}
                  >
                    <Car className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => recordLap(driver.id)}
                    disabled={racePhase !== 'racing' || driver.status !== 'active'}
                    className={`rounded bg-gray-700/80 p-2 hover:bg-gray-600 ${
                      racePhase === 'racing' && driver.status === 'active'
                        ? ''
                        : 'cursor-not-allowed opacity-50'
                    }`}
                    title="Log Lap"
                  >
                    <TimerReset className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => markDNF(driver.id)}
                    disabled={driver.status !== 'active'}
                    className={`rounded bg-gray-700/80 p-2 hover:bg-red-600/80 ${
                      driver.status === 'active' ? '' : 'cursor-not-allowed opacity-50'
                    }`}
                    title="Mark DNF"
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className={`grid gap-2 text-xs sm:text-sm ${compactView ? 'grid-cols-3' : 'grid-cols-3'}`}>
                <div className="rounded bg-gray-900/40 p-2">
                  <div className="text-gray-400 text-[11px] uppercase">Laps</div>
                  <div className={`font-bold ${compactView ? 'text-base' : 'text-lg'}`}>
                    {driver.laps}/{totalLaps}
                  </div>
                </div>
                <div className="rounded bg-gray-900/40 p-2">
                  <div className="text-gray-400 text-[11px] uppercase">Last Lap</div>
                  <div className={`font-mono ${compactView ? 'text-sm' : 'text-base'}`}>
                    {driver.lapTimes.length > 0
                      ? formatTime(driver.lapTimes[driver.lapTimes.length - 1])
                      : '--:--.---'}
                  </div>
                </div>
                <div className="rounded bg-gray-900/40 p-2">
                  <div className="text-gray-400 text-[11px] uppercase">Best Lap</div>
                  <div className={`font-mono text-green-400 ${compactView ? 'text-sm' : 'text-base'}`}>
                    {formatTime(driver.bestLap)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showSetup && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">Race Setup</h2>
              <button
                onClick={() => setShowSetup(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Total Laps</label>
              <input
                type="number"
                value={totalLaps}
                onChange={(e) => setTotalLaps(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                min="1"
              />
            </div>

            <button
              onClick={() => setShowSetup(false)}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
            >
              Save Settings
            </button>
          </div>
        </div>
      )}

      {showResults && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Race Results</h2>
              <div className="flex gap-2">
                <button
                  onClick={exportResults}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
                <button
                  onClick={() => setShowResults(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="px-4 py-2 text-left">Pos</th>
                    <th className="px-4 py-2 text-left">No.</th>
                    <th className="px-4 py-2 text-left">Driver</th>
                    <th className="px-4 py-2 text-left">Team</th>
                    <th className="px-4 py-2 text-right">Laps</th>
                    <th className="px-4 py-2 text-right">Total Time</th>
                    <th className="px-4 py-2 text-right">Best Lap</th>
                    <th className="px-4 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {generateResults().map((driver, idx) => (
                    <tr key={driver.id} className="border-b border-gray-700">
                      <td className="px-4 py-3 font-bold">{idx + 1}</td>
                      <td className="px-4 py-3">{driver.number}</td>
                      <td className="px-4 py-3">{driver.name}</td>
                      <td className="px-4 py-3 text-gray-400">{driver.team}</td>
                      <td className="px-4 py-3 text-right">{driver.laps}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatTime(driver.lapTimes.reduce((sum, t) => sum + t, 0))}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-green-400">
                        {formatTime(driver.bestLap)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-2 py-1 rounded text-xs font-bold ${
                            driver.status === 'finished'
                              ? 'bg-green-600'
                              : 'bg-red-600'
                          }`}
                        >
                          {driver.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimingPanel;
