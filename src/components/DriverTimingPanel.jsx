import { useMemo, useState } from 'react';
import { useSessionId } from '@/state/SessionContext.jsx';
import { useSessionActions } from '@/context/SessionActionsContext.jsx';
import { formatLapTime } from '@/utils/time.js';
import { invalidateLastLap, logLapAtomic } from '@/services/laps.js';

const parseLapInput = (input) => {
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const asNumber = Number.parseInt(trimmed, 10);
    if (Number.isNaN(asNumber)) return null;
    if (asNumber >= 60000) {
      return asNumber;
    }
    return asNumber * 1000;
  }

  let minutes = 0;
  let remainder = trimmed;
  if (trimmed.includes(':')) {
    const [minutePart, rest] = trimmed.split(':');
    if (minutePart) {
      const parsedMinutes = Number.parseInt(minutePart, 10);
      if (Number.isNaN(parsedMinutes) || parsedMinutes < 0) return null;
      minutes = parsedMinutes;
    }
    remainder = rest ?? '';
  }

  let seconds = 0;
  let milliseconds = 0;
  if (remainder.includes('.')) {
    const [secondsPart, millisPart] = remainder.split('.');
    seconds = Number.parseInt(secondsPart, 10);
    milliseconds = Number.parseInt(millisPart.padEnd(3, '0').slice(0, 3), 10);
  } else if (remainder) {
    seconds = Number.parseInt(remainder, 10);
  }

  if (Number.isNaN(seconds) || seconds < 0) return null;
  if (Number.isNaN(milliseconds) || milliseconds < 0) milliseconds = 0;

  return minutes * 60000 + seconds * 1000 + milliseconds;
};

export default function DriverTimingPanel({ driver, canWrite = false, currentLapMs = null }) {
  const sessionId = useSessionId();
  const { onLogLap: contextOnLogLap } = useSessionActions();
  const [manualTime, setManualTime] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingInvalidation, setPendingInvalidation] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const metrics = useMemo(
    () => [
      { label: 'Last lap', value: formatLapTime(driver.last_lap_ms) },
      {
        label: 'Current lap',
        value: currentLapMs === null || currentLapMs === undefined ? '—' : formatLapTime(currentLapMs),
      },
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
    [currentLapMs, driver],
  );

  const handleLogLap = async (event) => {
    event.preventDefault();
    if (!canWrite || isSaving) return;
    const parsed = parseLapInput(manualTime);
    if (parsed === null || parsed <= 0) {
      setError('Enter lap time as M:SS.mmm or milliseconds.');
      setSuccess(null);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await logLapAtomic({ sessionId, driverId: driver.id, lapTimeMs: parsed });
      setManualTime('');
      setSuccess('Lap logged');
    } catch (logError) {
      console.error('Failed to log lap', logError);
      setError(logError?.message ?? 'Unable to log lap.');
      setSuccess(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleInvalidate = async (mode) => {
    if (!canWrite || pendingInvalidation) return;
    setPendingInvalidation(mode);
    setError(null);
    setSuccess(null);
    try {
      await invalidateLastLap({ sessionId, driverId: driver.id, mode });
      setSuccess(mode === 'remove_lap' ? 'Lap removed' : 'Lap time invalidated');
    } catch (invalidateError) {
      console.error('Failed to invalidate lap', invalidateError);
      setError(invalidateError?.message ?? 'Unable to invalidate lap.');
    } finally {
      setPendingInvalidation(null);
    }
  };

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
      <form className="flex flex-col gap-3" onSubmit={handleLogLap}>
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-400">Manual lap entry</span>
          <input
            value={manualTime}
            onChange={(event) => setManualTime(event.target.value)}
            placeholder="1:05.321"
            disabled={!canWrite}
            className="rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.35em]">
          <button
            type="submit"
            disabled={!canWrite || isSaving}
            className="rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/15 px-4 py-2 font-semibold text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? 'Logging…' : 'Log lap'}
          </button>
          <button
            type="button"
            onClick={() => handleInvalidate('time_only')}
            disabled={!canWrite || Boolean(pendingInvalidation)}
            className="rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-2 font-semibold text-amber-100 transition hover:border-amber-400/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingInvalidation === 'time_only' ? 'Invalidating…' : 'Invalidate time'}
          </button>
          <button
            type="button"
            onClick={() => handleInvalidate('remove_lap')}
            disabled={!canWrite || Boolean(pendingInvalidation)}
            className="rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-2 font-semibold text-rose-200 transition hover:border-rose-500/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingInvalidation === 'remove_lap' ? 'Removing…' : 'Remove lap'}
          </button>
        </div>
      </form>
      {error ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">{error}</p>
      ) : null}
      {success ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs text-emerald-200">{success}</p>
      ) : null}
    </article>
  );
}

export { parseLapInput };
