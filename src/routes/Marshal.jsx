import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { SessionProvider } from '@/state/SessionContext.jsx';
import MarshalPanelPage from '@/pages/MarshalPanelPage.jsx';

export default function MarshalRoute() {
  const { sessionId } = useParams();
  const safeSessionId = useMemo(() => (typeof sessionId === 'string' ? sessionId : null), [sessionId]);

  if (!safeSessionId) {
    return <Navigate to="/sessions" replace />;
  }

  return (
    <SessionProvider sessionId={safeSessionId}>
      <MarshalPanelPage />
    </SessionProvider>
  );
}
