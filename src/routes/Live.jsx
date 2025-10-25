import { useParams } from 'react-router-dom';
import LiveTimingPage from '@/pages/LiveTimingPage.jsx';

export default function Live() {
  const { sessionId } = useParams();

  return <LiveTimingPage sessionId={sessionId} />;
}
