import { NavLink, Outlet } from 'react-router-dom';

const App = () => {
  return (
    <div className="min-h-screen bg-[#05070F]">
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-neutral-900/80 bg-[#05070F]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-3 text-sm uppercase tracking-[0.25em] text-neutral-400">
          <NavLink
            to="/control"
            className={({ isActive }) =>
              `rounded-full px-4 py-2 transition ${
                isActive
                  ? 'bg-[#9FF7D3]/20 text-[#9FF7D3]'
                  : 'border border-transparent hover:border-[#9FF7D3]/40 hover:text-[#9FF7D3]'
              }`
            }
          >
            Race Control
          </NavLink>
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `rounded-full px-4 py-2 transition ${
                isActive
                  ? 'bg-[#7C6BFF]/20 text-[#beb4ff]'
                  : 'border border-transparent hover:border-[#7C6BFF]/40 hover:text-[#beb4ff]'
              }`
            }
          >
            Live Timing Board
          </NavLink>
        </div>
      </nav>
      <main className="pt-16">
        <Outlet />
      </main>
    </div>
  );
};

export default App;
