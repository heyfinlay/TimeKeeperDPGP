import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { useEventSession } from '@/context/SessionContext.jsx';
import { useAdminAccess } from '@/components/auth/AuthGuard.jsx';
import { ChevronDown, Loader2 } from 'lucide-react';
import TopUpModal from '@/components/dashboard/TopUpModal.jsx';
import WithdrawModal from '@/components/dashboard/WithdrawModal.jsx';
import { formatWalletBalance, getWalletForUser, subscribeToWallet } from '@/lib/wallet.js';

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
  const { status, isSupabaseConfigured, user } = useAuth();
  const isAuthenticated = status === 'authenticated';
  const { activeSessionId } = useEventSession();
  const { isAdmin, canControl } = useAdminAccess();
  const hasControlAccess = typeof canControl === 'boolean' ? canControl : isAdmin;
  const [walletState, setWalletState] = useState({
    balance: null,
    isLoading: false,
    supportsWallets: !isSupabaseConfigured ? false : true,
  });
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const walletMenuRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    if (!message) return;
    setToast({ id: Date.now(), message, type });
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refreshWallet = useCallback(
    async ({ withLoader = false } = {}) => {
      if (!isMountedRef.current) {
        return null;
      }
      if (!isSupabaseConfigured) {
        setWalletState({
          balance: 0,
          isLoading: false,
          supportsWallets: false,
        });
        return null;
      }
      if (!user?.id) {
        setWalletState((prev) => ({
          ...prev,
          balance: null,
          isLoading: false,
        }));
        return null;
      }
      if (withLoader) {
        setWalletState((prev) => ({ ...prev, isLoading: true }));
      }
      try {
        const wallet = await getWalletForUser(user.id);
        if (!isMountedRef.current) {
          return wallet ?? null;
        }
        if (!wallet) {
          setWalletState({
            balance: 0,
            isLoading: false,
            supportsWallets: false,
          });
          return null;
        }
        setWalletState({
          balance: wallet.balance ?? 0,
          isLoading: false,
          supportsWallets: true,
        });
        return wallet;
      } catch (error) {
        console.error('Failed to load wallet balance', error);
        if (!isMountedRef.current) {
          return null;
        }
        setWalletState({
          balance: 0,
          isLoading: false,
          supportsWallets: false,
        });
        return null;
      }
    },
    [isSupabaseConfigured, user?.id],
  );

  useEffect(() => {
    void refreshWallet({ withLoader: Boolean(isSupabaseConfigured && user?.id) });
  }, [refreshWallet, isSupabaseConfigured, user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id || !walletState.supportsWallets) {
      return;
    }
    const unsubscribe = subscribeToWallet(user.id, (event) => {
      if (!isMountedRef.current) {
        return;
      }
      if (event?.type === 'wallet_accounts' && typeof event.balance === 'number') {
        setWalletState((prev) => ({
          ...prev,
          balance: event.balance,
          isLoading: false,
        }));
      } else if (event?.type === 'wallet_transactions') {
        void refreshWallet();
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [isSupabaseConfigured, user?.id, walletState.supportsWallets, refreshWallet]);

  const showWallet = isAuthenticated || !isSupabaseConfigured;
  const formattedBalanceCompact = useMemo(() => {
    if (walletState.balance === null) {
      return null;
    }
    return formatWalletBalance(walletState.balance, { compact: true });
  }, [walletState.balance]);
  const formattedBalanceFull = useMemo(() => {
    if (walletState.balance === null) {
      return null;
    }
    return formatWalletBalance(walletState.balance, { compact: false });
  }, [walletState.balance]);
  const walletLabel = useMemo(() => {
    if (walletState.balance === null || walletState.isLoading) {
      return (
        <span className="flex items-center justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading balance…</span>
        </span>
      );
    }
    if (!walletState.supportsWallets) {
      return 'Unavailable';
    }
    return formattedBalanceCompact;
  }, [walletState.balance, walletState.isLoading, walletState.supportsWallets, formattedBalanceCompact]);

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
                className="interactive-cta inline-flex min-w-[8rem] items-center justify-center gap-2 rounded-full border border-accent-emerald/30 bg-shell-800/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.35em] text-accent-emerald hover:border-accent-emerald/60 hover:text-white"
              >
                <span aria-hidden="true">💎</span>
                <span className="flex min-w-[3.5rem] justify-center">{walletLabel}</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${isWalletMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isWalletMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-accent-emerald/15 bg-shell-900/95 p-3 shadow-shell-card backdrop-blur">
                  <div className="flex flex-col gap-2">
                    <div className="rounded-xl border border-accent-emerald/15 bg-shell-800/70 px-4 py-3">
                      <p className="text-[0.6rem] uppercase tracking-[0.35em] text-slate-400">Balance</p>
                      <p className="mt-1 text-xl font-semibold text-white">
                        {walletState.balance === null
                          ? '—'
                          : walletState.supportsWallets
                          ? formattedBalanceFull
                          : 'Unavailable'}
                      </p>
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
      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-[70] max-w-sm rounded-xl border px-4 py-3 text-sm shadow-shell-card ${
            toast.type === 'success'
              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-400/40 bg-rose-500/10 text-rose-100'
          }`}
        >
          {toast.message}
        </div>
      ) : null}
      <TopUpModal
        isOpen={isTopUpOpen}
        onClose={() => setIsTopUpOpen(false)}
        onSuccess={(message) => {
          showToast(
            message ??
              'Deposit requested. A steward will contact you shortly with instructions and a drop-off location.',
          );
          void refreshWallet();
        }}
        onError={(message) => showToast(message ?? 'Something went wrong. Please try again.', 'error')}
      />
      <WithdrawModal
        isOpen={isWithdrawOpen}
        onClose={() => setIsWithdrawOpen(false)}
        onSuccess={(message) => {
          showToast(message ?? "Withdrawal submitted. You'll receive pickup details shortly.");
          void refreshWallet();
        }}
        onError={(message) => showToast(message ?? 'Something went wrong. Please try again.', 'error')}
      />
    </div>
  );
}