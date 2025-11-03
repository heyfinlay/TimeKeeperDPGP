import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { useEventSession } from '@/context/SessionContext.jsx';
import { useAdminAccess } from '@/components/auth/AuthGuard.jsx';

const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    buildPath: () => '/dashboard',
    activeClass: 'bg-[#F5A97F]/20 text-[#F5A97F]',
    hoverClass: 'hover:border-[#F5A97F]/50 hover:text-[#F5A97F]',
    requiresAuth: true,
  },
  {
    id: 'live',
    label: 'Live Timing',
    buildPath: (activeSessionId) =>
      activeSessionId ? `/live/${activeSessionId}` : '/sessions',
    activeClass: 'bg-[#7C6BFF]/20 text-[#dcd7ff]',
    hoverClass: 'hover:border-[#7C6BFF]/50 hover:text-[#7C6BFF]',
  },
  {
    id: 'sessions',
    label: 'Sessions',
    buildPath: () => '/sessions',
    activeClass: 'bg-[#9FF7D3]/20 text-[#9FF7D3]',
    hoverClass: 'hover:border-[#9FF7D3]/50 hover:text-[#9FF7D3]',
    requiresAuth: true,
  },
  {
    id: 'admin',
    label: 'Admin',
    buildPath: () => '/dashboard/admin',
    activeClass: 'bg-[#F7768E]/20 text-[#F7768E]',
    hoverClass: 'hover:border-[#F7768E]/50 hover:text-[#F7768E]',
    requiresAuth: true,
    requiresAdmin: true,
  },
];

export default function AppLayout() {
  const { status, isSupabaseConfigured } = useAuth();
  const isAuthenticated = status === 'authenticated';
  const { activeSessionId } = useEventSession();
  const { isAdmin } = useAdminAccess();

  const navItems = NAV_ITEMS.map((item) => ({
    ...item,
    to: item.buildPath ? item.buildPath(activeSessionId) : item.to,
  }));

  const visibleNavItems = navItems.filter((item) => {
    if (item.requiresAdmin && !isAdmin) {
      return false;
    }
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
            {visibleNavItems.map(({ id, to, label, activeClass, hoverClass }) => (
              <NavLink
                key={id}
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
