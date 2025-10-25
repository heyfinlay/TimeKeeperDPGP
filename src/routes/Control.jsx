import { useParams } from 'react-router-dom';
import RaceControlPage from '@/pages/RaceControlPage.jsx';

export default function Control() {
  const { sessionId } = useParams();

  return <RaceControlPage sessionId={sessionId} />;
}
