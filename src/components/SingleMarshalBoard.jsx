import MarshalDriverCard from '@/components/MarshalDriverCard.jsx';
import { formatRaceClock } from '@/utils/time.js';
import { TRACK_STATUS_MAP } from '@/constants/trackStatus.js';

const PROCEDURE_PHASE_LABELS = {
  setup: 'Pre-Session',
  warmup: 'Warm-Up',
  grid: 'Grid',
  race: 'Race',
};

const buildSlots = (drivers, limit = 8) => {
  const slots = Array.from({ length: limit }, (_, idx) => drivers[idx] ?? null);
  return slots;
};

export default function SingleMarshalBoard({
  sessionId,
  drivers = [],
  currentLapTimes = {},
  sessionState,
  displayTime,
  canWrite = false,
  onLogLap,
  onInvalidateLap,
  onRemoveLap,
}) {
  const slots = buildSlots(drivers, 8);
  const trackStatus = TRACK_STATUS_MAP[sessionState.trackStatus] ?? TRACK_STATUS_MAP.green;
  const phaseLabel = PROCEDURE_PHASE_LABELS[sessionState.procedurePhase] ?? PROCEDURE_PHASE_LABELS.setup;

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-3xl border border-white/5 bg-[#04060D]/80 p-6 text-white shadow-inner shadow-black/40">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-neutral-400">Session</p>
            <p className="text-lg font-semibold text-white">{sessionId.slice(0, 8)}…</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-right">
            <p className="text-[0.65rem] uppercase tracking-[0.35em] text-neutral-400">Race Clock</p>
            <p className="text-2xl font-semibold text-white">{formatRaceClock(displayTime)}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[0.65rem] uppercase tracking-[0.35em] text-neutral-400">Track Status</p>
            <p className="mt-1 text-lg font-semibold text-white">{trackStatus.label}</p>
            <p className="text-xs text-neutral-400">{trackStatus.description}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[0.65rem] uppercase tracking-[0.35em] text-neutral-400">Procedure</p>
            <p className="mt-1 text-lg font-semibold text-white">{phaseLabel}</p>
            <p className="text-xs text-neutral-400">
              {sessionState.isTiming ? (sessionState.isPaused ? 'Paused' : 'Timing Active') : 'Standing by'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[0.65rem] uppercase tracking-[0.35em] text-neutral-400">Announcement</p>
            <p className="mt-1 text-sm text-white/90">
              {sessionState.announcement?.trim() ? sessionState.announcement : 'No announcements'}
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-3xl border border-white/5 bg-[#04060D]/80 p-6">
        <h2 className="text-sm uppercase tracking-[0.35em] text-neutral-400">Marshal Control</h2>
        <p className="mt-2 text-base text-neutral-200">
          Log laps, invalidate mistakes, or undo a lap for quick corrections. Hotkeys continue to function in this view.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {slots.map((driver, idx) => (
            <MarshalDriverCard
              key={driver?.id ?? `slot-${idx}`}
              slot={idx + 1}
              driver={driver}
              currentLapMs={driver ? currentLapTimes[driver.id] ?? null : null}
              canWrite={canWrite}
              onLogLap={onLogLap}
              onInvalidateLap={onInvalidateLap}
              onRemoveLap={onRemoveLap}
            />
          ))}
        </div>
        {drivers.length > slots.length ? (
          <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Showing first {slots.length} drivers. Use the standard control layout to manage the remaining field.
          </p>
        ) : null}
      </section>
    </div>
  );
}
