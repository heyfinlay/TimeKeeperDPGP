import { format } from 'date-fns';

const formatTime = (timestamp) => {
  if (!timestamp) return '—';
  try {
    return format(new Date(timestamp), 'HH:mm:ss');
  } catch {
    return timestamp;
  }
};

const PENALTY_LABELS = {
  warning: 'Warning',
  time: 'Time Penalty',
  drive_through: 'Drive Through',
  disqualification: 'DSQ',
};

export default function PenaltyPanel({ penalties = [], resolveDriver }) {
  return (
    <section className="rounded-3xl border border-white/5 bg-[#050915]/80 p-5 text-white">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-neutral-400">Penalties</p>
          <h2 className="text-lg font-semibold text-white">Steward Actions</h2>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-400">
          {penalties.length}
        </span>
      </header>
      <ul className="mt-4 space-y-3 text-sm">
        {penalties.length === 0 ? (
          <li className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-neutral-400">No penalties issued.</li>
        ) : (
          penalties.map((penalty) => (
            <li
              key={penalty.id}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-200"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">
                  {resolveDriver?.(penalty.driver_id) ?? penalty.driver_id}
                </span>
                <span className="text-xs uppercase tracking-[0.3em] text-neutral-400">
                  {formatTime(penalty.created_at)}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold text-amber-200">
                {PENALTY_LABELS[penalty.category] ?? penalty.category}
                {penalty.value_ms ? ` • +${(penalty.value_ms / 1000).toFixed(1)}s` : ''}
              </p>
              {penalty.reason ? (
                <p className="mt-1 text-xs text-neutral-400">{penalty.reason}</p>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
