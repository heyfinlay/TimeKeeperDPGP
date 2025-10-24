import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

const AuthGuard = ({ children, redirectTo = '/' }) => {
  const { status, user, isSupabaseConfigured } = useAuth();

  if (isSupabaseConfigured && status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-400">
        Verifying access…
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return children;
  }

  if (status !== 'authenticated' || !user) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
};

export default AuthGuard;
