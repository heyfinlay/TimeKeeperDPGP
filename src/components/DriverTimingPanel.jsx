import { useMemo } from 'react';
import { useSessionActions } from '@/context/SessionActionsContext.jsx';
import { formatLapTime } from '@/utils/time.js';

export const parseLapInput = (input) => {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (raw.length === 0) return null;

  const minuteMatch = raw.match(/^(-?\d+):(\d{1,2}(?:\.\d{1,3})?)$/);
  if (minuteMatch) {
    const minutes = Number.parseInt(minuteMatch[1], 10);
    const seconds = Number.parseFloat(minuteMatch[2]);
    if (Number.isNaN(minutes) || Number.isNaN(seconds)) {
      return null;
    }
    return Math.round((minutes * 60 + seconds) * 1000);
  }

  const numeric = Number.parseFloat(raw);
  if (Number.isNaN(numeric)) {
    return null;
  }

  if (raw.includes('.') || raw.includes(':')) {
    return Math.round(numeric * 1000);
  }

  if (numeric >= 1000) {
    return Math.round(numeric);
  }

  return Math.round(numeric * 1000);
};

export default function DriverTimingPanel({ driver, canWrite = false, currentLapMs = null }) {
  const { onLogLap: contextOnLogLap } = useSessionActions();

  const metrics = useMemo(
    () => [
      { label: 'Last lap', value: formatLapTime(driver.last_lap_ms) },
      { label: 'Best lap', value: formatLapTime(driver.best_lap_ms) },
      { label: 'Laps', value: driver.laps ?? 0 },
      { label: 'Pits', value: driver.pits ?? 0 },
      {
        label: 'Total time',
        value:
          driver.total_time_ms === null || driver.total_time_ms === undefined
            ? '--:--.---'
            : formatLapTime(driver.total_time_ms),
      },
    ],
    [driver],
  );

  const handlePanelLogLap = () => {
    if (!canWrite || typeof contextOnLogLap !== 'function') return;
    contextOnLogLap(driver.id);
  };

  const isLogInteractive = Boolean(canWrite && typeof contextOnLogLap === 'function');

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-[#060910]/80 p-5 text-white">
      <div
        role="button"
        tabIndex={isLogInteractive ? 0 : -1}
        aria-disabled={!isLogInteractive}
        aria-label={`Log lap for ${driver.name}`}
        onClick={handlePanelLogLap}
        className="flex w-full cursor-pointer flex-col gap-4 rounded-xl bg-transparent text-left transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9FF7D3] aria-disabled:cursor-default aria-disabled:bg-transparent aria-disabled:pointer-events-none"
      >
        <header className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-sm uppercase tracking-[0.35em] text-neutral-500">Driver #{driver.number ?? '—'}</span>
            <span className="text-lg font-semibold text-white">{driver.name}</span>
            {driver.team ? <span className="text-xs text-neutral-400">{driver.team}</span> : null}
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-[#0B1120]/70 text-lg font-bold">
            {driver.laps ?? 0}
          </div>
        </header>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="flex flex-col gap-1 rounded-xl border border-white/5 bg-[#0B1120]/50 px-3 py-2"
            >
              <dt className="text-[0.65rem] uppercase tracking-[0.35em] text-neutral-500">{metric.label}</dt>
              <dd className="text-base font-semibold text-white">{metric.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}
