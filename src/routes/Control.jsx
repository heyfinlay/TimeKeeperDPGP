import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import ControlPanel from '@/views/ControlPanel.jsx';
import { SessionProvider } from '@/state/SessionContext.jsx';

export default function Control() {
  const { sessionId } = useParams();
  const safeSessionId = useMemo(() => (typeof sessionId === 'string' ? sessionId : null), [sessionId]);

  if (!safeSessionId) {
    return <Navigate to="/sessions" replace />;
  }

  return (
    <SessionProvider sessionId={safeSessionId}>
      <ControlPanel />
    </SessionProvider>
  );
}
