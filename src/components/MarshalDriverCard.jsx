import { formatLapTime } from '@/utils/time.js';

export default function MarshalDriverCard({
  slot,
  driver = null,
  currentLapMs = null,
  canWrite = false,
  onLogLap,
  onInvalidateLap,
  onRemoveLap,
}) {
  const hasDriver = Boolean(driver);
  const headerLabel = hasDriver ? `Driver #${driver.number ?? '—'}` : `Slot ${slot}`;
  const name = hasDriver ? driver.name : 'Unassigned';
  const team = hasDriver ? driver.team : null;
  const laps = hasDriver ? driver.laps ?? 0 : 0;
  const lastLap = hasDriver ? formatLapTime(driver.last_lap_ms) : '--:--.---';
  const bestLap = hasDriver ? formatLapTime(driver.best_lap_ms) : '--:--.---';
  const total = hasDriver ? formatLapTime(driver.total_time_ms) : '--:--.---';
  const lapTimer = hasDriver && currentLapMs !== null ? formatLapTime(currentLapMs) : '--:--.---';

  const disableActions = !canWrite || !hasDriver;

  const handleAction = async (callback) => {
    if (disableActions || typeof callback !== 'function') return;
    await callback(driver.id);
  };

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-[#05070F]/80 p-4 text-white shadow-lg shadow-black/30">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-[0.35em] text-neutral-500">{headerLabel}</span>
          <span className="text-lg font-semibold text-white">{name}</span>
          {team ? <span className="text-xs text-neutral-400">{team}</span> : null}
        </div>
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-[#0B1120]/70 text-xl font-bold">
          {laps}
        </div>
      </header>

      <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-center">
        <p className="text-[0.65rem] uppercase tracking-[0.35em] text-emerald-200/80">Current lap</p>
        <p className="mt-1 text-2xl font-semibold text-emerald-100">{lapTimer}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
          <dt className="text-[0.65rem] uppercase tracking-[0.35em] text-neutral-500">Last lap</dt>
          <dd className="text-base font-semibold text-white">{lastLap}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
          <dt className="text-[0.65rem] uppercase tracking-[0.35em] text-neutral-500">Best lap</dt>
          <dd className="text-base font-semibold text-white">{bestLap}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
          <dt className="text-[0.65rem] uppercase tracking-[0.35em] text-neutral-500">Total time</dt>
          <dd className="text-base font-semibold text-white">{total}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
          <dt className="text-[0.65rem] uppercase tracking-[0.35em] text-neutral-500">Status</dt>
          <dd className="text-base font-semibold text-white">
            {hasDriver ? 'Ready' : 'Awaiting Assignment'}
          </dd>
        </div>
      </dl>

      <div className="mt-auto grid grid-cols-1 gap-2 text-sm font-semibold">
        <button
          type="button"
          onClick={() => handleAction(onLogLap)}
          disabled={disableActions}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Log Lap
        </button>
        <button
          type="button"
          onClick={() => handleAction(onInvalidateLap)}
          disabled={disableActions}
          className="rounded-lg bg-amber-500/90 px-4 py-2 text-white transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Invalidate Lap
        </button>
        <button
          type="button"
          onClick={() => handleAction(onRemoveLap)}
          disabled={disableActions}
          className="rounded-lg border border-white/20 px-4 py-2 text-white transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Undo Lap
        </button>
      </div>
    </article>
  );
}
