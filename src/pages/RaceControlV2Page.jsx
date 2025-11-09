import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RacePhaseBar from '@/components/race-control/RacePhaseBar.jsx';
import RaceClockDisplay from '@/components/race-control/RaceClockDisplay.jsx';
import DirectorToolbar from '@/components/race-control/DirectorToolbar.jsx';
import FlagToolbar from '@/components/race-control/FlagToolbar.jsx';
import DriverCommandCard from '@/components/race-control/DriverCommandCard.jsx';
import ControlLogPanel from '@/components/race-control/ControlLogPanel.jsx';
import PenaltyPanel from '@/components/race-control/PenaltyPanel.jsx';
import LiveTimingTable from '@/components/race-control/LiveTimingTable.jsx';
import { useRaceSession, useRaceClock } from '@/hooks/useRaceSession.js';
import { useSessionDrivers } from '@/hooks/useSessionDrivers.js';
import { useControlLogs } from '@/hooks/useControlLogs.js';
import { usePenalties } from '@/hooks/usePenalties.js';
import { useSessionId } from '@/state/SessionContext.jsx';
import { logLapAtomic } from '@/services/laps.js';
import { finalizeResults, logControlAction, pauseSession, resumeSession, setFlag, startSession } from '@/services/raceControl.js';

const buildDriverSlots = (drivers, limit = 8) => {
  const padded = [...drivers];
  while (padded.length < limit) {
    padded.push(null);
  }
  return padded.slice(0, limit);
};

export default function RaceControlV2Page() {
  const sessionId = useSessionId();
  const { session, sessionPhase, bannerState, isLoading: isSessionLoading, error: sessionError, refresh } = useRaceSession();
  const clockMs = useRaceClock(session);
  const { drivers, isLoading: isDriversLoading } = useSessionDrivers();
  const { logs } = useControlLogs();
  const { penalties } = usePenalties();
  const [isMutating, setIsMutating] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const maxLaps = useMemo(() => {
    if (!drivers || drivers.length === 0) return 0;
    return drivers.reduce((max, driver) => Math.max(max, driver?.laps ?? 0), 0);
  }, [drivers]);

  const driverSlots = useMemo(() => buildDriverSlots(drivers ?? [], 8), [drivers]);

  const showToast = useCallback(
    (message, tone = 'info') => {
      setToast({ message, tone });
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, 3500);
    },
    [],
  );

  useEffect(() => () => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const handleStart = useCallback(async () => {
    if (!sessionId) return;
    setIsMutating(true);
    try {
      await startSession(sessionId);
      await logControlAction(sessionId, 'START', { phase: 'green' });
      showToast('Session started');
      await refresh();
    } catch (error) {
      console.error('Failed to start session', error);
      showToast(error.message ?? 'Unable to start session', 'error');
    } finally {
      setIsMutating(false);
    }
  }, [sessionId, refresh, showToast]);

  const handlePause = useCallback(async () => {
    if (!sessionId) return;
    setIsMutating(true);
    try {
      await pauseSession(sessionId);
      await logControlAction(sessionId, 'PAUSE', {});
      showToast('Session paused');
      await refresh();
    } catch (error) {
      console.error('Failed to pause session', error);
      showToast(error.message ?? 'Unable to pause session', 'error');
    } finally {
      setIsMutating(false);
    }
  }, [sessionId, refresh, showToast]);

  const handleResume = useCallback(async () => {
    if (!sessionId) return;
    setIsMutating(true);
    try {
      await resumeSession(sessionId);
      await logControlAction(sessionId, 'RESUME', {});
      showToast('Session resumed');
      await refresh();
    } catch (error) {
      console.error('Failed to resume session', error);
      showToast(error.message ?? 'Unable to resume session', 'error');
    } finally {
      setIsMutating(false);
    }
  }, [sessionId, refresh, showToast]);

  const handleFinalize = useCallback(async () => {
    if (!sessionId) return;
    setIsMutating(true);
    try {
      await finalizeResults(sessionId);
      await logControlAction(sessionId, 'FINALIZE', {});
      showToast('Results marked complete');
      await refresh();
    } catch (error) {
      console.error('Failed to finalize session', error);
      showToast(error.message ?? 'Unable to finalize session', 'error');
    } finally {
      setIsMutating(false);
    }
  }, [sessionId, refresh, showToast]);

  const handleSetFlag = useCallback(
    async (flag) => {
      if (!sessionId) return;
      setIsMutating(true);
      try {
        await setFlag(sessionId, flag);
        await logControlAction(sessionId, 'FLAG_CHANGE', { banner: flag });
        showToast(`Flag set to ${flag}`);
        await refresh();
      } catch (error) {
        console.error('Failed to set flag', error);
        showToast(error.message ?? 'Unable to update flag', 'error');
      } finally {
        setIsMutating(false);
      }
    },
    [sessionId, refresh, showToast],
  );

  const handleLogLap = useCallback(
    async (driverId) => {
      if (!sessionId || !driverId) return;
      setIsMutating(true);
      try {
        const lapTime = window.prompt('Lap time (ms)?', '90000');
        if (!lapTime) {
          setIsMutating(false);
          return;
        }
        const lapTimeMs = Number.parseInt(lapTime, 10);
        if (!Number.isFinite(lapTimeMs)) {
          throw new Error('Lap time must be numeric milliseconds');
        }
        await logLapAtomic({ sessionId, driverId, lapTimeMs });
        await logControlAction(sessionId, 'LAP_LOG', { driverId, lapTimeMs });
        showToast('Lap logged');
      } catch (error) {
        console.error('Failed to log lap', error);
        showToast(error.message ?? 'Unable to log lap', 'error');
      } finally {
        setIsMutating(false);
      }
    },
    [sessionId, showToast],
  );

  const handleInvalidateLap = useCallback(
    async (driverId) => {
      if (!sessionId || !driverId) return;
      showToast('Lap invalidation requires steward flow', 'warning');
    },
    [sessionId, showToast],
  );

  const handlePitToggle = useCallback(
    async (driverId) => {
      if (!sessionId || !driverId) return;
      showToast('Pit toggles are handled via upcoming pit service.', 'warning');
    },
    [sessionId, showToast],
  );

  const handleFlagDriver = useCallback(
    async (driverId) => {
      if (!sessionId || !driverId) return;
      showToast('Driver flag controls will be wired to marshal assignments.', 'warning');
    },
    [sessionId, showToast],
  );

  const resolveDriverName = useCallback(
    (driverId) => drivers.find((driver) => driver?.id === driverId)?.name ?? driverId,
    [drivers],
  );

  const isBusy = isMutating || isSessionLoading || isDriversLoading;

  return (
    <div className="min-h-screen bg-[#02040A] pb-16">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pt-10">
        <RacePhaseBar phase={sessionPhase} bannerState={bannerState} sessionName={session?.name} />
        <RaceClockDisplay clockMs={clockMs} lapLimit={session?.lap_limit} currentLap={maxLaps} />
        <DirectorToolbar
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onFinish={handleFinalize}
          onReset={() => showToast('Clock reset requires Supabase migration', 'warning')}
          isBusy={isBusy}
          phase={sessionPhase}
        />
        <FlagToolbar bannerState={bannerState} onSetFlag={handleSetFlag} disabled={isBusy} />
        {sessionError ? (
          <p className="rounded-2xl border border-rose-400/40 bg-rose-500/20 px-4 py-3 text-sm text-rose-100">{sessionError}</p>
        ) : null}
        <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="grid gap-4 md:grid-cols-2">
            {driverSlots.map((driver, index) => (
              <DriverCommandCard
                key={driver?.id ?? `slot-${index}`}
                driver={driver}
                onLogLap={handleLogLap}
                onInvalidate={handleInvalidateLap}
                onPit={handlePitToggle}
                onFlag={handleFlagDriver}
                disableActions={isBusy}
              />
            ))}
          </div>
          <div className="flex flex-col gap-4">
            <ControlLogPanel logs={logs} />
            <PenaltyPanel penalties={penalties} resolveDriver={resolveDriverName} />
          </div>
        </section>
        <LiveTimingTable drivers={drivers} />
      </div>
      {toast ? (
        <div
          className={`fixed bottom-6 right-6 rounded-2xl border px-4 py-3 text-sm shadow-xl transition ${
            toast.tone === 'error'
              ? 'border-rose-400/40 bg-rose-500/20 text-rose-100'
              : toast.tone === 'warning'
                ? 'border-amber-400/40 bg-amber-500/20 text-amber-100'
                : 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100'
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
