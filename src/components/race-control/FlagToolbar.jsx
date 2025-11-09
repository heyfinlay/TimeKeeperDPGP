const FLAG_OPTIONS = [
  { key: 'green', label: 'Green' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'vsc', label: 'VSC' },
  { key: 'sc', label: 'Safety Car' },
  { key: 'red', label: 'Red' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'finish', label: 'Finish' },
];

export default function FlagToolbar({ bannerState, onSetFlag, disabled }) {
  return (
    <section className="rounded-3xl border border-white/5 bg-[#050915]/90 p-4 text-white">
      <p className="text-xs uppercase tracking-[0.35em] text-neutral-400">Flag Control</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {FLAG_OPTIONS.map((flag) => (
          <button
            key={flag.key}
            type="button"
            className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] transition ${
              bannerState === flag.key
                ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100'
                : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/15'
            } disabled:cursor-not-allowed disabled:opacity-40`}
            disabled={disabled}
            onClick={() => onSetFlag?.(flag.key)}
          >
            {flag.label}
          </button>
        ))}
      </div>
    </section>
  );
}
