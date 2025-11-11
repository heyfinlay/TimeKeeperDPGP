import { useMemo, useState, useRef, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { useEventSession } from '@/context/SessionContext.jsx';
import { useAdminAccess } from '@/components/auth/AuthGuard.jsx';
import { useWallet } from '@/context/WalletContext.jsx';
import { ChevronDown } from 'lucide-react';
import TopUpModal from '@/components/dashboard/TopUpModal.jsx';
import WithdrawModal from '@/components/dashboard/WithdrawModal.jsx';
import { formatCurrency } from '@/utils/betting.js';

const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    buildPath: () => '/dashboard',
    activeClass: 'border-accent-emerald/40 bg-accent-emerald/15 text-accent-emerald shadow-accent-glow',
    hoverClass: 'motion-safe:hover:border-accent-emerald/30 hover:text-accent-emerald',
    requiresAuth: true,
  },
  {
    id: 'live',
    label: 'Live Timing',
    buildPath: (activeSessionId) => (activeSessionId ? `/live/${activeSessionId}` : '/sessions'),
    activeClass: 'border-accent-blue/40 bg-accent-blue/15 text-accent-blue shadow-accent-glow',
    hoverClass: 'motion-safe:hover:border-accent-blue/30 hover:text-accent-blue',
  },
  {
    id: 'sessions',
    label: 'Sessions',
    buildPath: () => '/sessions',
    activeClass: 'border-accent-emerald/40 bg-accent-emerald/15 text-accent-emerald shadow-accent-glow',
    hoverClass: 'motion-safe:hover:border-accent-emerald/30 hover:text-accent-emerald',
    requiresAuth: true,
  },
  {
    id: 'markets',
    label: 'Markets',
    buildPath: () => '/admin/markets',
    activeClass: 'border-accent-ocean/40 bg-accent-ocean/15 text-accent-ocean shadow-accent-glow',
    hoverClass: 'motion-safe:hover:border-accent-ocean/30 hover:text-accent-ocean',
    requiresAuth: true,
    requiresAdmin: true,
  },
  {
    id: 'admin',
    label: 'Admin',
    buildPath: () => '/dashboard/admin',
    activeClass: 'border-accent-ocean/40 bg-accent-ocean/15 text-accent-ocean shadow-accent-glow',
    hoverClass: 'motion-safe:hover:border-accent-ocean/30 hover:text-accent-ocean',
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
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const walletMenuRef = useRef(null);

  const showWallet = isAuthenticated || !isSupabaseConfigured;
  const formattedBalanceCompact = useMemo(
    () => formatCurrency(balance, { compact: true, maximumFractionDigits: 1, symbol: '' }),
    [balance],
  );
  const formattedBalanceFull = useMemo(
    () => formatCurrency(balance, { compact: false, maximumFractionDigits: 0 }),
    [balance],
  );
  const walletLabel = isWalletLoading
    ? 'Loading…'
    : supportsWallets
    ? formattedBalanceCompact
    : 'Unavailable';

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
    <div className="min-h-screen bg-shell-900 text-slate-100">
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-accent-emerald/10 bg-shell-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4">
          <div className="flex items-center gap-4">
            <NavLink
              to="/"
              className="focus-ring text-sm font-semibold uppercase tracking-[0.4em] text-accent-emerald transition-colors duration-200 ease-out-back hover:text-accent-blue"
            >
              DBGP
            </NavLink>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
            {visibleNavItems.map(({ id, to, label, activeClass, hoverClass }) => (
              <NavLink
                key={id}
                to={to}
                className={({ isActive }) =>
                  `focus-ring inline-flex items-center justify-center rounded-full border border-transparent px-4 py-2 text-[0.65rem] font-semibold tracking-[0.3em] transition-all duration-200 ease-out-back motion-safe:hover:-translate-y-0.5 motion-safe:hover:scale-102 motion-safe:active:scale-100 ${
                    isActive ? activeClass : 'text-slate-300'
                  } ${hoverClass}`
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
                className="interactive-cta inline-flex items-center gap-2 rounded-full border border-accent-emerald/30 bg-shell-800/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.35em] text-accent-emerald hover:border-accent-emerald/60 hover:text-white"
              >
                <span role="img" aria-hidden="true">
                  💎
                </span>
                {walletLabel}
                <ChevronDown className={`h-3 w-3 transition-transform ${isWalletMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isWalletMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-accent-emerald/15 bg-shell-900/95 p-3 shadow-shell-card backdrop-blur">
                  <div className="flex flex-col gap-2">
                    <div className="rounded-xl border border-accent-emerald/15 bg-shell-800/70 px-4 py-3">
                      <p className="text-[0.6rem] uppercase tracking-[0.35em] text-slate-400">Balance</p>
                      <p className="mt-1 text-xl font-semibold text-white">{formattedBalanceFull}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsWalletMenuOpen(false);
                        setIsTopUpOpen(true);
                      }}
                      className="interactive-cta inline-flex items-center justify-center gap-2 rounded-full border border-accent-blue/40 bg-accent-blue/15 px-4 py-2 text-xs uppercase tracking-[0.35em] text-accent-blue hover:text-white"
                    >
                      Request Deposit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsWalletMenuOpen(false);
                        setIsWithdrawOpen(true);
                      }}
                      className="interactive-cta inline-flex items-center justify-center gap-2 rounded-full border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-rose-300 hover:text-white"
                    >
                      Request Withdrawal
                    </button>
                    <p className="mt-1 text-[0.55rem] leading-relaxed text-slate-500">
                      Finance stewards will reach out after each request with handoff details.
                    </p>
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
      <TopUpModal isOpen={isTopUpOpen} onClose={() => setIsTopUpOpen(false)} />
      <WithdrawModal isOpen={isWithdrawOpen} onClose={() => setIsWithdrawOpen(false)} />
    </div>
  );
}