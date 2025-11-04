import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '@/context/AuthContext.jsx';
import {
  isSupabaseConfigured,
  supabaseSelect,
  subscribeToTable,
  isTableMissingError,
} from '@/lib/supabaseClient.js';

const DEFAULT_VALUE = {
  balance: 0,
  isLoading: false,
  lastUpdated: null,
  supportsWallets: false,
  refresh: async () => {},
};

const WalletContext = createContext(DEFAULT_VALUE);

export function WalletProvider({ children }) {
  const { status, user } = useAuth();
  const [state, setState] = useState(DEFAULT_VALUE);
  const supportsWalletsRef = useRef(false);

  const userId = user?.id ?? null;
  const readyForWallet = isSupabaseConfigured && status === 'authenticated' && Boolean(userId);

  const refresh = useCallback(async () => {
    if (!readyForWallet) {
      supportsWalletsRef.current = false;
      setState({
        balance: 0,
        isLoading: false,
        lastUpdated: null,
        supportsWallets: !isSupabaseConfigured,
        refresh,
      });
      return;
    }

    setState((prev) => ({
      ...prev,
      isLoading: true,
    }));

    try {
      const rows = await supabaseSelect('wallet_accounts', {
        filters: { user_id: `eq.${userId}` },
        limit: 1,
      });
      const balanceValue = Array.isArray(rows) && rows[0]?.balance ? Number(rows[0].balance) : 0;
      const nextBalance = Number.isFinite(balanceValue) ? balanceValue : 0;
      supportsWalletsRef.current = true;
      setState({
        balance: nextBalance,
        isLoading: false,
        lastUpdated: new Date().toISOString(),
        supportsWallets: true,
        refresh,
      });
    } catch (error) {
      if (isTableMissingError(error, 'wallet_accounts')) {
        supportsWalletsRef.current = false;
        setState({
          ...DEFAULT_VALUE,
          isLoading: false,
          supportsWallets: false,
          refresh,
        });
        return;
      }
      console.error('Failed to load wallet balance', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        lastUpdated: prev.lastUpdated,
        refresh,
      }));
    }
  }, [readyForWallet, userId]);

  useEffect(() => {
    supportsWalletsRef.current = false;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!readyForWallet || !supportsWalletsRef.current) {
      return;
    }

    const unsubscribe = subscribeToTable(
      {
        schema: 'public',
        table: 'wallet_accounts',
        event: '*',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const eventType = payload?.eventType;
        let nextBalance = 0;
        if (eventType === 'DELETE') {
          nextBalance = 0;
        } else if (payload?.new && Number.isFinite(Number(payload.new.balance))) {
          nextBalance = Number(payload.new.balance);
        } else if (payload?.old && Number.isFinite(Number(payload.old.balance))) {
          nextBalance = Number(payload.old.balance);
        } else {
          return;
        }
        setState((prev) => ({
          ...prev,
          balance: nextBalance,
          lastUpdated: new Date().toISOString(),
        }));
      },
      { maxRetries: 6 },
    );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [readyForWallet, userId]);

  const contextValue = useMemo(
    () => ({
      balance: state.balance,
      isLoading: state.isLoading,
      lastUpdated: state.lastUpdated,
      supportsWallets: state.supportsWallets,
      refresh,
    }),
    [state.balance, state.isLoading, state.lastUpdated, state.supportsWallets, refresh],
  );

  return <WalletContext.Provider value={contextValue}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  return useContext(WalletContext);
}


