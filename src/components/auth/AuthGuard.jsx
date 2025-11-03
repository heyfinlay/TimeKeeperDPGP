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
  const isAdmin = !isSupabaseConfigured || role === 'admin' || role === 'race_control';
  return { isAdmin };
};

const AuthGuard = ({ children, redirectTo = '/', requireAdmin = false }) => {
  const { status, user, profile, isSupabaseConfigured } = useAuth();
  const isAdmin = useMemo(() => {
    if (!isSupabaseConfigured) return true;
    const role = String(profile?.role ?? '').toLowerCase();
    return role === 'admin' || role === 'race_control';
  }, [isSupabaseConfigured, profile?.role]);

  if (isSupabaseConfigured && status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-400">
        Verifying access…
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <AdminAccessContext.Provider value={{ isAdmin: true }}>
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
    () => ({ isAdmin }),
    [isAdmin],
  );

  return <AdminAccessContext.Provider value={contextValue}>{children}</AdminAccessContext.Provider>;
};

export default AuthGuard;
