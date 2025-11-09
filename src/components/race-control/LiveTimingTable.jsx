import { formatRaceClock } from '@/utils/time.js';

export default function LiveTimingTable({ drivers = [] }) {
  const sorted = [...drivers].sort((a, b) => {
    const lapsA = a?.laps ?? 0;
    const lapsB = b?.laps ?? 0;
    if (lapsA !== lapsB) {
      return lapsB - lapsA;
    }
    const totalA = a?.total_time_ms ?? Number.POSITIVE_INFINITY;
    const totalB = b?.total_time_ms ?? Number.POSITIVE_INFINITY;
    return totalA - totalB;
  });

  return (
    <section className="rounded-3xl border border-white/5 bg-[#050915]/80 p-5 text-white">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-neutral-400">Live Timing</p>
          <h2 className="text-lg font-semibold text-white">Leaderboard Projection</h2>
        </div>
      </header>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.35em] text-neutral-400">
              <th className="py-3 pr-4">Pos</th>
              <th className="py-3 pr-4">Driver</th>
              <th className="py-3 pr-4">Laps</th>
              <th className="py-3 pr-4">Last Lap</th>
              <th className="py-3 pr-4">Best Lap</th>
              <th className="py-3 pr-4">Total</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-neutral-500">
                  Waiting for drivers to be assigned.
                </td>
              </tr>
            ) : (
              sorted.map((driver, index) => (
                <tr key={driver.id} className="border-t border-white/5 text-sm">
                  <td className="py-3 pr-4 font-semibold text-neutral-300">{index + 1}</td>
                  <td className="py-3 pr-4 text-white">#{driver.number ?? '—'} {driver.name}</td>
                  <td className="py-3 pr-4 text-neutral-200">{driver.laps ?? 0}</td>
                  <td className="py-3 pr-4 text-neutral-200">
                    {driver.last_lap_ms ? formatRaceClock(driver.last_lap_ms) : '—'}
                  </td>
                  <td className="py-3 pr-4 text-emerald-200">
                    {driver.best_lap_ms ? formatRaceClock(driver.best_lap_ms) : '—'}
                  </td>
                  <td className="py-3 pr-4 text-neutral-200">
                    {driver.total_time_ms ? formatRaceClock(driver.total_time_ms) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
