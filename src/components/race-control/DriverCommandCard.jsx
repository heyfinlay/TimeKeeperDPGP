import { formatRaceClock } from '@/utils/time.js';

const ACTION_BUTTON =
  'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-white/90 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40';

export default function DriverCommandCard({
  driver,
  onLogLap,
  onInvalidate,
  onPit,
  onFlag,
  disableActions,
}) {
  if (!driver) {
    return (
      <article className="flex flex-col gap-3 rounded-3xl border border-white/5 bg-[#050915]/60 p-5 text-neutral-500">
        <p className="text-sm font-semibold uppercase tracking-[0.35em]">Empty Slot</p>
        <p className="text-xs text-neutral-500">Assign a driver to this marshal slot from the control settings.</p>
      </article>
    );
  }

  const { id, number, name, laps, last_lap_ms: lastLap, best_lap_ms: bestLap, pits = 0, team_color: teamColor } = driver;
  const accentStyle = teamColor ? { borderColor: teamColor, boxShadow: `0 0 0 1px ${teamColor}33` } : undefined;

  return (
    <article
      className="flex flex-col gap-4 rounded-3xl border border-white/5 bg-[#080d1c]/80 p-5 text-white shadow-inner shadow-black/30"
      style={accentStyle}
    >
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-neutral-400">Driver #{number ?? '—'}</p>
          <h3 className="text-lg font-semibold text-white">{name ?? 'Unnamed Driver'}</h3>
        </div>
        <div className="text-right text-xs text-neutral-400">
          <p>Laps {laps ?? 0}</p>
          <p>Pits {pits}</p>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <dt className="text-[0.65rem] uppercase tracking-[0.35em] text-neutral-400">Last Lap</dt>
          <dd className="mt-1 text-base font-semibold text-white">{lastLap ? formatRaceClock(lastLap) : '—'}</dd>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <dt className="text-[0.65rem] uppercase tracking-[0.35em] text-neutral-400">Best Lap</dt>
          <dd className="mt-1 text-base font-semibold text-emerald-200">{bestLap ? formatRaceClock(bestLap) : '—'}</dd>
        </div>
      </dl>
      <div className="grid grid-cols-2 gap-2 text-center">
        <button type="button" className={ACTION_BUTTON} disabled={disableActions} onClick={() => onLogLap?.(id)}>
          Log Lap
        </button>
        <button type="button" className={ACTION_BUTTON} disabled={disableActions} onClick={() => onInvalidate?.(id)}>
          Invalidate
        </button>
        <button type="button" className={ACTION_BUTTON} disabled={disableActions} onClick={() => onPit?.(id)}>
          Pit Toggle
        </button>
        <button type="button" className={ACTION_BUTTON} disabled={disableActions} onClick={() => onFlag?.(id)}>
          Flag Driver
        </button>
      </div>
    </article>
  );
}
