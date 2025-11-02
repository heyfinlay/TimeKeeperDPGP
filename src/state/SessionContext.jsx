import { createContext, useContext, useMemo } from 'react';
import { useAdminAccess } from '@/components/auth/AuthGuard.jsx';

const SessionContext = createContext(null);

export function SessionProvider({ sessionId, children }) {
  if (!sessionId) {
    throw new Error('SessionProvider requires a sessionId prop.');
  }

  const { isAdmin } = useAdminAccess();

  const value = useMemo(
    () => ({ sessionId, isAdmin: Boolean(isAdmin) }),
    [sessionId, isAdmin],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionId() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessionId must be used within a SessionProvider.');
  }
  return context.sessionId;
}

export function useSessionContext() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessionContext must be used within a SessionProvider.');
  }
  return context;
}
