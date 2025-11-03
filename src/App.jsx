import { BrowserRouter } from 'react-router-dom';
import { EventSessionProvider } from '@/context/SessionContext.jsx';
import AppRoutes from '@/routes/index.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <EventSessionProvider>
        <AppRoutes />
      </EventSessionProvider>
    </BrowserRouter>
  );
}
