import { useParams } from 'react-router-dom';
import LiveTimingPage from '@/pages/LiveTimingPage.jsx';
import { useEventSession } from '@/context/SessionContext.jsx';
import { LEGACY_SESSION_ID } from '@/utils/raceData.js';

export default function LiveTiming() {
  const { sessionId } = useParams();
  const { supportsSessions, activeSessionId } = useEventSession();

  if (!supportsSessions) {
    return <LiveTimingPage sessionId={LEGACY_SESSION_ID} />;
  }

  const targetSessionId = sessionId ?? activeSessionId ?? null;

  return <LiveTimingPage sessionId={targetSessionId} />;
}
