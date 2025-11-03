import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import AuthGuard from '@/components/auth/AuthGuard.jsx';
import ProtectedRoute from '@/components/auth/ProtectedRoute.jsx';
import SessionAccessGuard from '@/components/auth/SessionAccessGuard.jsx';
import AppLayout from '@/components/layout/AppLayout.jsx';
import Welcome from '@/routes/Welcome.jsx';
import Dashboard from '@/routes/Dashboard.jsx';
import AccountSetup from '@/routes/AccountSetup.jsx';
import AuthCallback from '@/routes/AuthCallback.jsx';
import Control from '@/routes/Control.jsx';
import LiveTiming from '@/routes/LiveTiming.jsx';
import LiveSessions from '@/routes/LiveSessions.jsx';
import NewSession from '@/routes/NewSession.jsx';
import AdminSessions from '@/routes/AdminSessions.jsx';
import AdminLoginPage from '@/pages/auth/AdminLoginPage.jsx';

const AdminLoginRoute = () => {
  const { status, profile, user, isSupabaseConfigured } = useAuth();

  if (!isSupabaseConfigured) {
    return <AdminLoginPage />;
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-400">
        Checking admin access…
      </div>
    );
  }

  const resolvedRole = profile?.role ?? user?.app_metadata?.role ?? null;

  if (status === 'authenticated' && resolvedRole === 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  if (status === 'authenticated' && user) {
    return <Navigate to="/" replace />;
  }

  return <AdminLoginPage />;
};

const AppRoutes = () => (
  <Routes>
    <Route element={<AppLayout />}>
      <Route path="/" element={<Welcome />} />
      <Route
        path="/account/setup"
        element={
          <AuthGuard>
            <AccountSetup />
          </AuthGuard>
        }
      />
      <Route
        path="/dashboard"
        element={
          <AuthGuard>
            <Dashboard />
          </AuthGuard>
        }
      />
      <Route
        path="/sessions"
        element={
          <ProtectedRoute>
            <LiveSessions />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sessions/new"
        element={
          <ProtectedRoute>
            <NewSession />
          </ProtectedRoute>
        }
      />
      <Route
        path="/control/:sessionId"
        element={
          <ProtectedRoute>
            <SessionAccessGuard>
              <Control />
            </SessionAccessGuard>
          </ProtectedRoute>
        }
      />
      <Route path="/live/:sessionId" element={<LiveTiming />} />
      <Route
        path="/admin/sessions"
        element={
          <ProtectedRoute>
            <AdminSessions />
          </ProtectedRoute>
        }
      />
      <Route path="/admin/login" element={<AdminLoginRoute />} />
    </Route>
    <Route path="/auth/callback" element={<AuthCallback />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

export default AppRoutes;
