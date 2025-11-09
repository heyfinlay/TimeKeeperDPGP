const PRIMARY_BUTTON =
  'rounded-full bg-emerald-500/90 text-white px-4 py-2 text-sm font-semibold shadow-lg shadow-emerald-900/40 hover:bg-emerald-400 transition';
const SECONDARY_BUTTON =
  'rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 transition';

export default function DirectorToolbar({
  onStart,
  onPause,
  onResume,
  onFinish,
  onReset,
  isBusy,
  phase,
}) {
  const isGreen = phase === 'green';
  const isCountdown = phase === 'countdown';
  const isComplete = phase === 'complete' || phase === 'finish';

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-white/5 bg-[#050915]/90 p-4">
      <button
        type="button"
        className={`${PRIMARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-40`}
        disabled={isBusy || isGreen || isCountdown || isComplete}
        onClick={onStart}
      >
        Start
      </button>
      <button
        type="button"
        className={`${SECONDARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-40`}
        disabled={isBusy || !isGreen}
        onClick={onPause}
      >
        Pause
      </button>
      <button
        type="button"
        className={`${SECONDARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-40`}
        disabled={isBusy || isGreen || isComplete}
        onClick={onResume}
      >
        Resume
      </button>
      <button
        type="button"
        className={`${SECONDARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-40`}
        disabled={isBusy || isComplete}
        onClick={onFinish}
      >
        Finish
      </button>
      <button
        type="button"
        className={`${SECONDARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-40`}
        disabled={isBusy}
        onClick={onReset}
      >
        Reset Clock
      </button>
    </section>
  );
}
