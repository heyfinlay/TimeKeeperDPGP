import LiveTimingBoard from '../components/LiveTimingBoard.jsx';

const LiveTimingPage = ({ sessionId = null }) => {
  return <LiveTimingBoard sessionId={sessionId} />;
};

export default LiveTimingPage;
