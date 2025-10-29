import { createContext, useContext, useMemo } from 'react';

const SessionContext = createContext(null);

export function SessionProvider({ sessionId, children }) {
  if (!sessionId) {
    throw new Error('SessionProvider requires a sessionId prop.');
  }

  const value = useMemo(
    () => ({ sessionId }),
    [sessionId],
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
