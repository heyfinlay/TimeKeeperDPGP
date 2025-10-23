import DriverCard from './DriverCard';

const DriverGrid = ({ drivers, hotkeys, onLogLap, onInvalidate, onResolveInvalid, onTogglePit }) => {
  if (!drivers.length) {
    return (
      <div className="rounded-2xl border border-white/5 bg-[#0b1022]/80 p-6 text-center text-sm text-white/60">
        No drivers configured. Add drivers in setup to begin timing.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {drivers.map((driver, index) => (
        <DriverCard
          key={driver.id}
          state={driver}
          hotkey={hotkeys[index] ?? null}
          onLogLap={() => onLogLap(driver.id)}
          onInvalidateLast={() => onInvalidate(driver.id)}
          onResolveInvalid={() => onResolveInvalid(driver.id)}
          onTogglePit={() => onTogglePit(driver.id)}
        />
      ))}
    </div>
  );
};

export default DriverGrid;
