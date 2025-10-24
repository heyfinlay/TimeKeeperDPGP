import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import WelcomePage from './pages/WelcomePage.jsx';
import LiveTimingPage from './pages/LiveTimingPage.jsx';
import RaceControlPage from './pages/RaceControlPage.jsx';
import AuthCallback from './pages/auth/AuthCallback.jsx';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './index.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <WelcomePage />,
      },
      {
        path: 'live',
        element: <LiveTimingPage />,
      },
      {
        path: 'control',
        element: (
          <ProtectedRoute>
            <RaceControlPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'auth/callback',
        element: <AuthCallback />,
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);
