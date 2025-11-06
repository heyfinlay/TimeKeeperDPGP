import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAdminAccess } from '@/components/auth/AuthGuard.jsx';
import { useAuth } from '@/context/AuthContext.jsx';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';
export { useSessionActions } from '@/context/SessionActionsContext.jsx';

const SessionContext = createContext(null);

export function SessionProvider({ sessionId, children }) {
  if (!sessionId) {
    throw new Error('SessionProvider requires a sessionId prop.');
  }

  const { isAdmin } = useAdminAccess();
  const { status, user } = useAuth();
  const [assignedDriverIds, setAssignedDriverIds] = useState([]);

  useEffect(() => {
    let active = true;
    const loadAssignedDrivers = async () => {
      if (!isSupabaseConfigured || !supabase || status !== 'authenticated' || !user?.id) {
        if (active) setAssignedDriverIds([]);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('assigned_driver_ids')
          .eq('id', user.id)
          .maybeSingle();
        if (error) throw error;
        const ids = Array.isArray(data?.assigned_driver_ids) ? data.assigned_driver_ids : [];
        if (active) setAssignedDriverIds(ids);
      } catch {
        if (active) setAssignedDriverIds([]);
      }
    };
    void loadAssignedDrivers();
    return () => {
      active = false;
    };
  }, [status, user?.id]);

  const value = useMemo(
    () => ({ sessionId, isAdmin: Boolean(isAdmin), assignedDriverIds }),
    [sessionId, isAdmin, assignedDriverIds],
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
