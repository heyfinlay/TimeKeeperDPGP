import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EventSessionProvider } from '@/context/SessionContext.jsx';
import AuthGuard from '@/components/auth/AuthGuard.jsx';
import ProtectedRoute from '@/components/auth/ProtectedRoute.jsx';
import AppLayout from '@/components/layout/AppLayout.jsx';
import Welcome from '@/routes/Welcome.jsx';
import Dashboard from '@/routes/Dashboard.jsx';
import AccountSetup from '@/routes/AccountSetup.jsx';
import AuthCallback from '@/routes/AuthCallback.jsx';
import Control from '@/routes/Control.jsx';
import Live from '@/routes/Live.jsx';
import Sessions from '@/routes/Sessions.jsx';
import AdminSessions from '@/routes/AdminSessions.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <EventSessionProvider>
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
                  <Sessions />
                </ProtectedRoute>
              }
            />
            <Route path="/control" element={<Navigate to="/sessions" replace />} />
            <Route
              path="/control/:sessionId"
              element={
                <ProtectedRoute>
                  <Control />
                </ProtectedRoute>
              }
            />
            <Route path="/live" element={<Live />} />
            <Route path="/live/:sessionId" element={<Live />} />
            <Route
              path="/admin/sessions"
              element={
                <ProtectedRoute>
                  <AdminSessions />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </EventSessionProvider>
    </BrowserRouter>
  );
}
