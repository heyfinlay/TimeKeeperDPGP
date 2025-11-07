import { useMemo, useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { useEventSession } from '@/context/SessionContext.jsx';
import { useAdminAccess } from '@/components/auth/AuthGuard.jsx';
import { useWallet } from '@/context/WalletContext.jsx';
import { ChevronDown } from 'lucide-react';

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
    buildPath: (activeSessionId) => (activeSessionId ? `/live/${activeSessionId}` : '/sessions'),
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
  const { isAdmin, canControl } = useAdminAccess();
  const hasControlAccess = typeof canControl === 'boolean' ? canControl : isAdmin;
  const { balance, isLoading: isWalletLoading, supportsWallets } = useWallet();
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
  const walletMenuRef = useRef(null);

  const showWallet = isAuthenticated || !isSupabaseConfigured;
  const balanceFormatter = useMemo(() => new Intl.NumberFormat('en-US'), []);
  const formattedBalance = balanceFormatter.format(Number.isFinite(balance) ? balance : 0);
  const walletLabel = isWalletLoading ? 'Loading' : supportsWallets ? formattedBalance : 'Unavailable';

  // Close wallet menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (walletMenuRef.current && !walletMenuRef.current.contains(event.target)) {
        setIsWalletMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navItems = NAV_ITEMS.map((item) => ({
    ...item,
    to: item.buildPath ? item.buildPath(activeSessionId) : item.to,
  }));

  const visibleNavItems = navItems.filter((item) => {
    if (item.requiresAdmin && !hasControlAccess) {
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
          <div className="flex items-center gap-4">
            <NavLink
              to="/"
              className="text-sm font-semibold uppercase tracking-[0.4em] text-[#9FF7D3] transition hover:text-[#7de6c0]"
            >
              DBGP
            </NavLink>
          </div>
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
          {showWallet ? (
            <div className="relative" ref={walletMenuRef}>
              <button
                onClick={() => setIsWalletMenuOpen(!isWalletMenuOpen)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/50 hover:bg-white/10"
              >
                <span>$</span>
                {walletLabel}
                <ChevronDown className={`h-3 w-3 transition-transform ${isWalletMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isWalletMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-white/10 bg-[#05070F]/95 p-3 shadow-[0_0_50px_rgba(15,23,42,0.6)] backdrop-blur">
                  <div className="flex flex-col gap-2">
                    <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-3">
                      <p className="text-[0.6rem] uppercase tracking-[0.35em] text-neutral-500">Balance</p>
                      <p className="mt-1 text-xl font-semibold text-white">${formattedBalance}</p>
                    </div>
                    <Link
                      to="/account/setup"
                      onClick={() => setIsWalletMenuOpen(false)}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-[#F5A97F]/30 bg-[#F5A97F]/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-[#F5A97F] transition hover:border-[#F5A97F]/60 hover:text-white"
                    >
                      Request Top-Up
                    </Link>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </nav>
      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-16 pt-28 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}