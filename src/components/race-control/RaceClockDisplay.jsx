import { formatRaceClock } from '@/utils/time.js';

export default function RaceClockDisplay({ clockMs, lapLimit, currentLap }) {
  return (
    <section className="grid gap-4 rounded-3xl border border-white/5 bg-[#040711]/90 p-6 text-white shadow-inner shadow-black/30 md:grid-cols-3">
      <div className="rounded-2xl border border-white/10 bg-black/40 px-6 py-4">
        <p className="text-xs uppercase tracking-[0.4em] text-neutral-400">Race Clock</p>
        <p className="mt-2 text-4xl font-semibold text-emerald-200">{formatRaceClock(clockMs)}</p>
        <p className="mt-1 text-xs text-neutral-500">Synced from session start timestamp.</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-black/40 px-6 py-4">
        <p className="text-xs uppercase tracking-[0.4em] text-neutral-400">Lap Counter</p>
        <p className="mt-2 text-3xl font-semibold">{currentLap ?? 0}{lapLimit ? ` / ${lapLimit}` : ''}</p>
        <p className="mt-1 text-xs text-neutral-500">Highest completed lap across the field.</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-black/40 px-6 py-4">
        <p className="text-xs uppercase tracking-[0.4em] text-neutral-400">Session Integrity</p>
        <p className="mt-2 text-base text-neutral-200">
          Manual edits are journaled in control logs. Pause/resume keeps the authoritative timer intact.
        </p>
      </div>
    </section>
  );
}
