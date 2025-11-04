import { createContext, useContext, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext.jsx';

const WalletContext = createContext({
  balance: 0,
  isLoading: true,
  lastUpdated: null,
});

export function WalletProvider({ children }) {
  const { status } = useAuth();
  const [balance] = useState(0);

  const isAuthenticated = status === 'authenticated';

  const value = useMemo(
    () => ({
      balance: isAuthenticated ? balance : 0,
      isLoading: false,
      lastUpdated: null,
    }),
    [balance, isAuthenticated],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  return useContext(WalletContext);
}
