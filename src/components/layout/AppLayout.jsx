import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { useEventSession } from '@/context/SessionContext.jsx';

const NAV_ITEMS = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    activeClass: 'bg-[#F5A97F]/20 text-[#F5A97F]',
    hoverClass: 'hover:border-[#F5A97F]/50 hover:text-[#F5A97F]',
    requiresAuth: true,
  },
  {
    to: '/live',
    label: 'Live Timing',
    activeClass: 'bg-[#7C6BFF]/20 text-[#dcd7ff]',
    hoverClass: 'hover:border-[#7C6BFF]/50 hover:text-[#7C6BFF]',
  },
  {
    to: '/control',
    label: 'Race Control',
    activeClass: 'bg-[#9FF7D3]/20 text-[#9FF7D3]',
    hoverClass: 'hover:border-[#9FF7D3]/50 hover:text-[#9FF7D3]',
    requiresAuth: true,
  },
];

export default function AppLayout() {
  const { status, isSupabaseConfigured } = useAuth();
  const isAuthenticated = status === 'authenticated';
  const { activeSessionId } = useEventSession();
  const controlPath = activeSessionId ? `/control/${activeSessionId}` : '/sessions';

  const navItems = NAV_ITEMS.map((item) =>
    item.to === '/control' ? { ...item, to: controlPath } : item,
  );

  const visibleNavItems = navItems.filter((item) => {
    if (!item.requiresAuth) return true;
    if (!isSupabaseConfigured) return true;
    return isAuthenticated;
  });

  return (
    <div className="min-h-screen bg-[#05070F] text-gray-100">
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-[#05070F]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4">
          <NavLink
            to="/"
            className="text-sm font-semibold uppercase tracking-[0.4em] text-[#9FF7D3] transition hover:text-[#7de6c0]"
          >
            TimeKeeper
          </NavLink>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs uppercase tracking-[0.3em] text-neutral-400">
            {visibleNavItems.map(({ to, label, activeClass, hoverClass }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `rounded-full border border-transparent px-4 py-2 transition ${hoverClass} ${
                    isActive ? activeClass : ''
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>
      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-16 pt-28 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
