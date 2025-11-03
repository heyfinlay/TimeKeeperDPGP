import { useMemo } from 'react';

const formatMarshalLabel = (marshal) => {
  if (!marshal) return 'Unassigned';
  const name = marshal.displayName || marshal.name || marshal.id;
  return name;
};

export default function SessionMarshalAssignments({
  session,
  marshals,
  pendingAssignments = {},
  onAssign,
}) {
  const marshalOptions = useMemo(() => {
    const options = marshals.map((marshal) => ({
      value: marshal.id,
      label: formatMarshalLabel(marshal),
    }));
    return [{ value: '', label: 'Unassigned' }, ...options];
  }, [marshals]);

  if (!session?.drivers?.length) {
    return (
      <div className="rounded-2xl border border-white/5 bg-[#060910]/70 px-4 py-3 text-sm text-neutral-400">
        No drivers found for this session.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {session.drivers.map((driver) => {
        const isPending = Boolean(pendingAssignments[driver.id]);
        const currentMarshal = marshalOptions.find(
          (option) => option.value === (driver.marshal_user_id ?? ''),
        );
        return (
          <div
            key={driver.id}
            className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-[#05070F]/80 p-4 text-sm text-neutral-200 md:flex-row md:items-center md:justify-between"
          >
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white">
                {driver.number ? `#${driver.number} ${driver.name ?? 'Driver'}` : driver.name ?? 'Driver'}
              </span>
              <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                {currentMarshal ? currentMarshal.label : 'Unassigned'}
              </span>
            </div>
            <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.3em] text-neutral-400 md:w-64">
              <span>Marshal</span>
              <select
                value={driver.marshal_user_id ?? ''}
                onChange={(event) => onAssign?.(session.id, driver.id, event.target.value)}
                disabled={isPending}
                className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {marshalOptions.map((option) => (
                  <option key={option.value || 'unassigned'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        );
      })}
    </div>
  );
}
