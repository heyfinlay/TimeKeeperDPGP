import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

const ProtectedRoute = ({ children, redirectTo = '/' }) => {
  const { isLoading, permissions } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-400">
        Checking permissions…
      </div>
    );
  }

  const hasAccess = Boolean(permissions?.isAdmin || permissions?.isMarshal);

  if (!hasAccess) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
};

export default ProtectedRoute;
