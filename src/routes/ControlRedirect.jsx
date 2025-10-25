import { Navigate } from 'react-router-dom';
import { useEventSession } from '@/context/SessionContext.jsx';
import { LEGACY_SESSION_ID } from '@/utils/raceData.js';

export default function ControlRedirect() {
  const { supportsSessions, activeSessionId } = useEventSession();
  const fallbackSession = activeSessionId ?? LEGACY_SESSION_ID;
  const target = supportsSessions ? '/sessions' : `/control/${fallbackSession}`;

  return <Navigate to={target} replace />;
}
