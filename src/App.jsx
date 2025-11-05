import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EventSessionProvider } from '@/context/SessionContext.jsx';
import { WalletProvider } from '@/context/WalletContext.jsx';
import AuthGuard from '@/components/auth/AuthGuard.jsx';
import ProtectedRoute from '@/components/auth/ProtectedRoute.jsx';
import SessionAccessGuard from '@/components/auth/SessionAccessGuard.jsx';
import AppLayout from '@/components/layout/AppLayout.jsx';
import Welcome from '@/routes/Welcome.jsx';
import Dashboard from '@/routes/Dashboard.jsx';
import AdminDashboardPage from '@/pages/dashboard/AdminDashboardPage.jsx';
import AdminMarketsPage from '@/pages/admin/AdminMarketsPage.jsx';
import Markets from '@/routes/Markets.jsx';
import AccountSetup from '@/routes/AccountSetup.jsx';
import AuthCallback from '@/routes/AuthCallback.jsx';
import Control from '@/routes/Control.jsx';
import LiveTiming from '@/routes/LiveTiming.jsx';
import LiveSessions from '@/routes/LiveSessions.jsx';
import NewSession from '@/routes/NewSession.jsx';
import AdminSessions from '@/routes/AdminSessions.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
        <EventSessionProvider>
          <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Welcome />} />
            <Route path="/markets" element={<Markets />} />
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
              path="/dashboard/admin"
              element={
                <AuthGuard requireAdmin>
                  <AdminDashboardPage />
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
            <Route
              path="/admin/markets"
              element={
                <AuthGuard requireAdmin>
                  <AdminMarketsPage />
                </AuthGuard>
              }
            />
          </Route>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </EventSessionProvider>
      </WalletProvider>
    </BrowserRouter>
  );
}
