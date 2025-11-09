import { format } from 'date-fns';

const formatTimestamp = (isoString) => {
  if (!isoString) return '—';
  try {
    return format(new Date(isoString), 'HH:mm:ss.SSS');
  } catch (error) {
    console.warn('Failed to format log timestamp', error);
    return isoString;
  }
};

export default function ControlLogPanel({ logs = [] }) {
  return (
    <section className="flex h-full flex-col rounded-3xl border border-white/5 bg-[#050915]/80 p-5 text-white">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-neutral-400">Control Log</p>
          <h2 className="text-lg font-semibold text-white">Authoritative Actions</h2>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-400">
          {logs.length} entries
        </span>
      </header>
      <ol className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1 text-sm">
        {logs.length === 0 ? (
          <li className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-neutral-400">
            Awaiting first action.
          </li>
        ) : (
          logs.map((log) => (
            <li
              key={log.id}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition hover:border-white/20 hover:bg-white/10"
            >
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>{formatTimestamp(log.created_at)}</span>
                <span>{log.actor ?? 'system'}</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-white">{log.action}</p>
              {log.payload ? (
                <pre className="mt-2 rounded-xl bg-black/40 p-3 text-xs text-neutral-300">
                  {JSON.stringify(log.payload, null, 2)}
                </pre>
              ) : null}
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
