import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

const ProtectedRoute = ({ children, redirectTo = '/' }) => {
  const { status, user, profile, isSupabaseConfigured } = useAuth();

  if (isSupabaseConfigured && status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-400">
        Checking permissions…
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return children;
  }

  const allowedRoles = new Set(['admin', 'marshal', 'race_control']);
  const hasAccess =
    status === 'authenticated' &&
    !!user &&
    (!profile?.role || allowedRoles.has(String(profile.role).toLowerCase()));

  if (!hasAccess) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
};

export default ProtectedRoute;
