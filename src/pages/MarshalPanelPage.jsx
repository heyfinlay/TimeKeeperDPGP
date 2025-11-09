import { useCallback, useMemo, useState } from 'react';
import SingleMarshalBoard from '@/components/SingleMarshalBoard.jsx';
import { useRaceSession, useRaceClock } from '@/hooks/useRaceSession.js';
import { useSessionDrivers } from '@/hooks/useSessionDrivers.js';
import { useSessionId } from '@/state/SessionContext.jsx';
import { logLapAtomic } from '@/services/laps.js';
import { logControlAction } from '@/services/raceControl.js';

export default function MarshalPanelPage() {
  const sessionId = useSessionId();
  const { session, sessionPhase, bannerState } = useRaceSession();
  const { drivers } = useSessionDrivers();
  const clockMs = useRaceClock(session);
  const [isMutating, setIsMutating] = useState(false);

  const sessionState = useMemo(
    () => ({
      procedurePhase: sessionPhase,
      trackStatus: bannerState,
      announcement: '',
      isTiming: sessionPhase === 'green' || sessionPhase === 'countdown',
      isPaused: sessionPhase === 'suspended' || sessionPhase === 'red',
    }),
    [sessionPhase, bannerState],
  );

  const handleLogLap = useCallback(
    async (driver) => {
      if (!sessionId || !driver?.id) return;
      setIsMutating(true);
      try {
        const suggested = driver.last_lap_ms ? String(driver.last_lap_ms) : '90000';
        const lapTime = window.prompt(`Lap time for ${driver.name}`, suggested);
        if (!lapTime) {
          setIsMutating(false);
          return;
        }
        const lapTimeMs = Number.parseInt(lapTime, 10);
        if (!Number.isFinite(lapTimeMs)) {
          throw new Error('Lap time must be numeric milliseconds');
        }
        await logLapAtomic({ sessionId, driverId: driver.id, lapTimeMs });
        await logControlAction(sessionId, 'LAP_LOG', { driverId: driver.id, lapTimeMs, source: 'marshal_panel' });
      } catch (error) {
        console.error('Marshal failed to log lap', error);
        window.alert(error.message ?? 'Unable to log lap');
      } finally {
        setIsMutating(false);
      }
    },
    [sessionId],
  );

  return (
    <div className="min-h-screen bg-[#02040A] pb-10">
      <div className="mx-auto w-full max-w-5xl px-6 pt-8">
        <SingleMarshalBoard
          sessionId={session?.id ?? 'session'}
          drivers={drivers}
          currentLapTimes={{}}
          sessionState={sessionState}
          displayTime={clockMs}
          canWrite={!isMutating}
          onLogLap={(driverId) => {
            const driver = drivers.find((entry) => entry.id === driverId);
            void handleLogLap(driver);
          }}
          onInvalidateLap={() => {
            window.alert('Marshal invalidation is locked to stewards.');
          }}
          onRemoveLap={() => {
            window.alert('Marshal removal is locked to stewards.');
          }}
        />
      </div>
    </div>
  );
}
