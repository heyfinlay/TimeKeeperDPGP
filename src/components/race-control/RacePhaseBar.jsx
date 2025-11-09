const PHASE_LABELS = {
  warmup: 'Warm-Up',
  final_call: 'Final Call',
  countdown: 'Countdown',
  green: 'Green Flag',
  vsc: 'Virtual Safety Car',
  sc: 'Safety Car',
  red: 'Red Flag',
  suspended: 'Suspended',
  finish: 'Finish',
  complete: 'Complete',
};

const FLAG_COLORS = {
  green: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
  yellow: 'bg-amber-500/20 text-amber-100 border-amber-400/50',
  red: 'bg-rose-500/20 text-rose-100 border-rose-400/50',
  sc: 'bg-amber-500/20 text-amber-100 border-amber-400/60',
  vsc: 'bg-sky-500/20 text-sky-100 border-sky-400/50',
  suspended: 'bg-purple-500/20 text-purple-100 border-purple-400/50',
  finish: 'bg-slate-500/20 text-slate-100 border-slate-400/50',
};

export default function RacePhaseBar({ phase, bannerState, sessionName }) {
  const phaseLabel = PHASE_LABELS[phase] ?? phase ?? 'Warm-Up';
  const bannerClass = FLAG_COLORS[bannerState] ?? 'bg-slate-700/40 text-slate-100 border-slate-500/50';

  return (
    <header className="flex flex-col gap-3 rounded-3xl border border-white/5 bg-[#0A0E1A]/80 p-6 shadow-xl shadow-black/40">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Director Panel</p>
          <h1 className="text-2xl font-semibold text-white">{sessionName ?? 'Race Session'}</h1>
        </div>
        <div className={`flex items-center gap-3 rounded-2xl border px-4 py-2 text-sm font-semibold ${bannerClass}`}>
          <span className="text-xs uppercase tracking-[0.35em] text-white/70">Flag</span>
          <span className="text-lg font-semibold">{bannerState?.toUpperCase?.() ?? 'GREEN'}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs uppercase tracking-[0.45em] text-neutral-300">
          {phaseLabel}
        </span>
        <span className="text-sm text-neutral-400">Persistent session authority with realtime distribution.</span>
      </div>
    </header>
  );
}
