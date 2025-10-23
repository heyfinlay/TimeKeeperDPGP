import { Car, RotateCcw, TimerReset } from 'lucide-react';
import { formatLapTime } from '../../utils/time';

const Stat = ({ label, value, highlight = false }) => (
  <div
    className={`rounded-xl px-3 py-2 transition-colors ${
      highlight ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-white'
    }`}
  >
    <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/50">{label}</div>
    <div className="text-sm font-medium tabular-nums">
      {typeof value === 'string' || typeof value === 'number' ? value : '—'}
    </div>
  </div>
);

const formatLap = (lapMs) => {
  if (lapMs === null || lapMs === undefined) return '—';
  return formatLapTime(lapMs);
};

const DriverCard = ({
  state,
  hotkey,
  onLogLap,
  onInvalidateLast,
  onTogglePit,
  onResolveInvalid,
}) => {
  const lapsValue = state.targetLaps
    ? `${Math.max(state.completedLaps, 0)}/${state.targetLaps}`
    : `${Math.max(state.completedLaps, 0)}`;
  const statusStyle =
    {
      ontrack: 'bg-emerald-500/15 text-emerald-200',
      retired: 'bg-red-500/20 text-red-200',
      finished: 'bg-sky-500/20 text-sky-200',
    }[state.status] ?? 'bg-white/10 text-white/60';

  return (
    <div
      className={`flex h-full flex-col rounded-2xl border border-white/5 bg-[#11182c]/80 p-4 shadow-sm transition ${
        state.canLogLap ? 'hover:border-white/15' : ''
      } ${state.isInPit ? 'ring-1 ring-amber-400/60' : ''} ${
        state.isRecent ? 'border-emerald-300/60 shadow-[0_0_18px_rgba(159,247,211,0.35)]' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.4em] text-white/40">
            #{state.number}
          </div>
          <div className="text-lg font-semibold text-white">{state.name}</div>
          <div className="text-[11px] text-white/50">{state.team}</div>
          {state.marshalName && (
            <div className="text-[10px] text-white/40">Marshal: {state.marshalName}</div>
          )}
          <span
            className={`mt-2 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyle}`}
          >
            {state.status ? state.status : 'ready'}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onTogglePit}
            className={`rounded-lg p-2 text-white/70 transition hover:bg-white/10 ${
              state.isInPit ? 'bg-amber-400/20 text-amber-200' : 'bg-white/5'
            }`}
            title="Toggle pit status"
          >
            <Car className="h-4 w-4" />
          </button>
          <button
            onClick={onInvalidateLast}
            disabled={state.completedLaps === 0}
            className="rounded-lg bg-white/5 p-2 text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            title="Invalidate last lap"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 text-sm text-white/80">
        <Stat label="Laps" value={lapsValue} />
        <Stat label="Last Lap" value={formatLap(state.lastLapMs)} />
        <Stat label="Best Lap" value={formatLap(state.bestLapMs)} highlight={Boolean(state.bestLapMs)} />
      </div>
      <button
        onClick={onLogLap}
        disabled={!state.canLogLap}
        className={`mt-4 w-full rounded-xl py-2 text-sm font-semibold uppercase tracking-[0.2em] transition ${
          state.canLogLap
            ? 'bg-white/10 text-white hover:bg-white/20'
            : 'bg-white/5 text-white/40 disabled:cursor-not-allowed'
        }`}
      >
        Log Lap ({state.lapNumber}){hotkey ? ` [${hotkey}]` : ''}
      </button>
      {state.hasInvalidToResolve && (
        <div className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] text-amber-200">
          <div className="flex items-center gap-2">
            <TimerReset className="h-4 w-4" />
            <span>Invalidated. Next crossing = START ONLY.</span>
          </div>
          <button
            onClick={onResolveInvalid}
            className="mt-3 w-full rounded-lg bg-amber-400/20 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100 transition hover:bg-amber-400/30"
          >
            Start Lap (after invalid)
          </button>
        </div>
      )}
    </div>
  );
};

export default DriverCard;
