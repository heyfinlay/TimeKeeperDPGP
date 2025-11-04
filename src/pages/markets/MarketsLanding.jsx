import { Link } from 'react-router-dom';
import { ArrowRight, Layers, TrendingUp } from 'lucide-react';

const highlights = [
  {
    icon: Layers,
    title: 'Event-driven pools',
    copy: 'Group wagers by race, rumble, or vendor showdown to follow tote movement at a glance.',
  },
  {
    icon: TrendingUp,
    title: 'Realtime odds pulses',
    copy: 'Watch estimated payouts shift every few seconds as Diamonds land across each outcome.',
  },
];

export default function MarketsLanding() {
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-5 rounded-3xl border border-white/5 bg-[#060910]/80 p-8 shadow-[0_0_40px_rgba(15,23,42,0.45)]">
        <span className="text-xs uppercase tracking-[0.35em] text-[#9FF7D3]">Diamond Sports Book</span>
        <h1 className="text-4xl font-semibold text-white sm:text-5xl">Markets and tote boards</h1>
        <p className="max-w-2xl text-sm text-neutral-300 sm:text-base">
          Gamble on everything - from podiums to power plays. Pick an event to see live pools, wager breakdowns, and
          realtime odds fed directly from race control telemetry.
        </p>
        <p className="text-[0.7rem] uppercase tracking-[0.3em] text-neutral-500">
          All wagers settled in Diamonds (in-game currency). Parody product; no real-world stakes.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        {highlights.map(({ icon: Icon, title, copy }) => (
          <div
            key={title}
            className="flex flex-col gap-3 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6"
          >
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white">
              <Icon className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            <p className="text-sm text-neutral-400">{copy}</p>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-dashed border-white/10 bg-[#05070F]/40 p-8 text-sm text-neutral-400">
        <div className="flex-1">
          <p className="font-semibold text-white">Live market board coming online</p>
          <p>Admin tools will seed the first tote shortly. Check back once the next event opens betting.</p>
        </div>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/40 px-4 py-2 uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white"
        >
          Return to dashboard
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}