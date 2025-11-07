import { createContext, useContext, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

const AdminAccessContext = createContext(null);

export const useAdminAccess = () => {
  const context = useContext(AdminAccessContext);
  const { profile, isSupabaseConfigured } = useAuth();
  if (context) {
    return context;
  }
  const role = String(profile?.role ?? '').toLowerCase();
  const isAdmin = !isSupabaseConfigured || role === 'admin';
  const canControl = !isSupabaseConfigured || isAdmin || role === 'race_control';
  return { isAdmin, canControl };
};

const AuthGuard = ({ children, redirectTo = '/', requireAdmin = false }) => {
  const { status, user, profile, isSupabaseConfigured } = useAuth();
  const role = String(profile?.role ?? '').toLowerCase();
  const { isAdmin, canControl } = useMemo(() => {
    if (!isSupabaseConfigured) {
      return { isAdmin: true, canControl: true };
    }
    const resolvedIsAdmin = role === 'admin';
    // Race control operators retain control privileges without full admin status.
    const resolvedCanControl = resolvedIsAdmin || role === 'race_control';
    return { isAdmin: resolvedIsAdmin, canControl: resolvedCanControl };
  }, [isSupabaseConfigured, role]);

  if (isSupabaseConfigured && status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-400">
        Verifying access…
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <AdminAccessContext.Provider value={{ isAdmin: true, canControl: true }}>
        {children}
      </AdminAccessContext.Provider>
    );
  }

  if (status !== 'authenticated' || !user) {
    return <Navigate to={redirectTo} replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to={redirectTo} replace />;
  }

  const contextValue = useMemo(
    () => ({ isAdmin, canControl }),
    [isAdmin, canControl],
  );

  return <AdminAccessContext.Provider value={contextValue}>{children}</AdminAccessContext.Provider>;
};

export default AuthGuard;
