import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import LiveTimingPage from './pages/LiveTimingPage.jsx';
import RaceControlPage from './pages/RaceControlPage.jsx';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import { AuthProvider } from './components/auth/AuthContext.jsx';
import './index.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
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
    ],
  },
]);

const defaultAuthValue = {
  user: null,
  isLoading: false,
  permissions: {
    isAdmin: false,
    isMarshal: false,
  },
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider value={defaultAuthValue}>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);
