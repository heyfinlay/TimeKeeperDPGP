import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { useEventSession } from '@/context/SessionContext.jsx';
import { supabase } from '@/lib/supabaseClient.js';
import { DEFAULT_SESSION_STATE } from '@/utils/raceData.js';

const EVENT_TYPES = ['Practice', 'Qualifying', 'Race'];

const DEFAULT_DRIVERS = [
  { id: 'driver-1', number: 1, name: 'Driver 1', team: 'Team EMS' },
  { id: 'driver-2', number: 2, name: 'Driver 2', team: 'Team Underground Club' },
  { id: 'driver-3', number: 3, name: 'Driver 3', team: 'Team Flywheels' },
  { id: 'driver-4', number: 4, name: 'Driver 4', team: 'Team LSC' },
  { id: 'driver-5', number: 5, name: 'Driver 5', team: 'Team Mosleys' },
  { id: 'driver-6', number: 6, name: 'Driver 6', team: 'Team Benefactor' },
  { id: 'driver-7', number: 7, name: 'Driver 7', team: 'Team Blend & Barrel' },
  { id: 'driver-8', number: 8, name: 'Driver 8', team: 'Team PD' },
  { id: 'driver-9', number: 9, name: 'Driver 9', team: 'Team Bahama Mamas' },
  { id: 'driver-10', number: 10, name: 'Driver 10', team: 'Team Pitlane' },
];

const createId = (prefix) =>
  globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const steps = [
  { title: 'Session details', description: 'Create the session container and schedule.' },
  { title: 'Session state', description: 'Seed timing defaults for race control and live timing.' },
  { title: 'Drivers', description: 'Select the drivers that will participate in this session.' },
  { title: 'Marshals & teams', description: 'Assign marshals and confirm team information.' },
];

const toDriverDraft = (driver) => ({
  id: driver.id,
  number: String(driver.number ?? ''),
  name: driver.name ?? '',
  team: driver.team ?? '',
  marshalId: '',
  enabled: true,
});

export default function NewSession() {
  const navigate = useNavigate();
  const { isSupabaseConfigured } = useAuth();
  const {
    supportsSessions,
    createSession,
    selectSession,
    refreshSessions,
    seedSessionData,
  } = useEventSession();
  const [step, setStep] = useState(1);
  const [sessionName, setSessionName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [createdSession, setCreatedSession] = useState(null);
  const [sessionStateDraft, setSessionStateDraft] = useState({
    eventType: DEFAULT_SESSION_STATE.eventType,
    totalLaps: String(DEFAULT_SESSION_STATE.totalLaps),
    totalDuration: String(DEFAULT_SESSION_STATE.totalDuration),
  });
  const [marshalDirectory, setMarshalDirectory] = useState([]);
  const [marshalDirectoryError, setMarshalDirectoryError] = useState(null);
  const [isLoadingMarshals, setIsLoadingMarshals] = useState(false);
  const [drivers, setDrivers] = useState(() =>
    DEFAULT_DRIVERS.map((driver) => toDriverDraft(driver)),
  );
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const activeStep = Math.min(Math.max(step, 1), steps.length);

  useEffect(() => {
    if (!createdSession && step > 1) {
      setStep(1);
    }
  }, [createdSession, step]);

  const enabledDrivers = useMemo(
    () => drivers.filter((driver) => driver.enabled),
    [drivers],
  );

  const marshalOptions = useMemo(() => marshalDirectory, [marshalDirectory]);

  const marshalLookup = useMemo(() => {
    const map = new Map();
    marshalDirectory.forEach((marshal) => {
      map.set(marshal.id, marshal);
    });
    return map;
  }, [marshalDirectory]);

  const marshalAssignments = useMemo(() => {
    const groups = new Map();
    enabledDrivers.forEach((driver) => {
      const marshalId = isUuid(driver.marshalId) ? driver.marshalId : null;
      const key = marshalId ?? 'unassigned';
      if (!groups.has(key)) {
        const marshal = marshalId ? marshalLookup.get(marshalId) : null;
        groups.set(key, {
          id: marshalId,
          label: marshalId
            ? marshal?.name ?? `Marshal ${marshalId.slice(0, 8)}`
            : 'Unassigned drivers',
          drivers: [],
          isMissingProfile: Boolean(marshalId && !marshal),
        });
      }
      groups.get(key).drivers.push(driver);
    });
    return Array.from(groups.values());
  }, [enabledDrivers, marshalLookup]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supportsSessions || !supabase) {
      setMarshalDirectory([]);
      return;
    }
    let isMounted = true;
    const loadMarshals = async () => {
      setIsLoadingMarshals(true);
      setMarshalDirectoryError(null);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, display_name, role')
          .eq('role', 'marshal')
          .order('display_name', { ascending: true, nullsFirst: false });
        if (error) {
          throw error;
        }
        const directory = (data ?? []).map((entry) => ({
          id: entry.id,
          name: entry.display_name || entry.id.slice(0, 8),
        }));
        if (isMounted) {
          setMarshalDirectory(directory);
        }
      } catch (loadError) {
        console.error('Failed to load marshals', loadError);
        if (isMounted) {
          setMarshalDirectory([]);
          setMarshalDirectoryError(
            'Unable to load marshals from Supabase. Confirm marshal profiles exist before finishing setup.',
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingMarshals(false);
        }
      }
    };
    void loadMarshals();
    return () => {
      isMounted = false;
    };
  }, [isSupabaseConfigured, supportsSessions]);

  const handleCreateSession = useCallback(
    async (event) => {
      event.preventDefault();
      if (!isSupabaseConfigured || !supportsSessions) {
        setError('Session creation requires Supabase session management.');
        return;
      }
      const trimmed = sessionName.trim();
      if (!trimmed) {
        setError('Enter a session name to continue.');
        return;
      }
      setError(null);
      setIsCreating(true);
      try {
        const scheduledAt = startsAt ? new Date(startsAt) : null;
        const payload = await createSession({
          name: trimmed,
          startsAt: scheduledAt && !Number.isNaN(scheduledAt.getTime())
            ? scheduledAt.toISOString()
            : undefined,
        });
        if (!payload?.id) {
          setError('Unable to create session. Check your Supabase configuration.');
          return;
        }
        setCreatedSession(payload);
        setStep(2);
      } catch (createError) {
        console.error('Failed to create session', createError);
        setError('Unable to create the session in Supabase.');
      } finally {
        setIsCreating(false);
      }
    },
    [createSession, isSupabaseConfigured, sessionName, startsAt, supportsSessions],
  );

  const handleUpdateSessionState = useCallback(
    (field, value) => {
      setSessionStateDraft((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleToggleDriver = useCallback((driverId) => {
    setDrivers((prev) =>
      prev.map((driver) =>
        driver.id === driverId ? { ...driver, enabled: !driver.enabled } : driver,
      ),
    );
  }, []);

  const handleDriverChange = useCallback((driverId, field, value) => {
    setDrivers((prev) =>
      prev.map((driver) =>
        driver.id === driverId ? { ...driver, [field]: value } : driver,
      ),
    );
  }, []);

  const handleAddDriver = useCallback(() => {
    setDrivers((prev) => [
      ...prev,
      {
        id: createId('driver'),
        number: '',
        name: '',
        team: '',
        marshalId: '',
        enabled: true,
      },
    ]);
  }, []);

  const handleNextStep = useCallback(() => {
    setStep((prev) => Math.min(prev + 1, steps.length));
  }, []);

  const handlePreviousStep = useCallback(() => {
    setStep((prev) => Math.max(prev - 1, 1));
  }, []);

  const finalizeSession = useCallback(async () => {
    if (!createdSession?.id) {
      setError('Create the session before finishing setup.');
      return;
    }
    if (!enabledDrivers.length) {
      setError('Select at least one driver to continue.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    const sessionId = createdSession.id;
    try {
      const driversMissingMarshal = enabledDrivers.filter(
        (driver) => !isUuid(driver.marshalId),
      );
      if (driversMissingMarshal.length > 0) {
        setError('Assign each driver to a marshal profile before finishing setup.');
        setIsSubmitting(false);
        return;
      }

      const availableMarshalIds = new Set(marshalDirectory.map((marshal) => marshal.id));
      const missingMarshalProfiles = enabledDrivers.filter(
        (driver) => !availableMarshalIds.has(driver.marshalId),
      );
      if (missingMarshalProfiles.length > 0) {
        setError('One or more marshal assignments reference profiles that are not available in Supabase.');
        setIsSubmitting(false);
        return;
      }

      const totalLaps = Number.parseInt(sessionStateDraft.totalLaps, 10);
      const totalDuration = Number.parseInt(sessionStateDraft.totalDuration, 10);
      const nowIso = new Date().toISOString();

      const sessionStateRow = {
        id: sessionId,
        session_id: sessionId,
        event_type: sessionStateDraft.eventType || DEFAULT_SESSION_STATE.eventType,
        total_laps: Number.isNaN(totalLaps) ? DEFAULT_SESSION_STATE.totalLaps : totalLaps,
        total_duration: Number.isNaN(totalDuration)
          ? DEFAULT_SESSION_STATE.totalDuration
          : totalDuration,
        procedure_phase: DEFAULT_SESSION_STATE.procedurePhase,
        flag_status: DEFAULT_SESSION_STATE.flagStatus,
        track_status: DEFAULT_SESSION_STATE.trackStatus,
        announcement: DEFAULT_SESSION_STATE.announcement,
        is_timing: false,
        is_paused: false,
        race_time_ms: 0,
        updated_at: nowIso,
      };

      const driverRows = enabledDrivers.map((driver) => {
        const parsedNumber = driver.number ? Number.parseInt(driver.number, 10) : null;
        return {
          id: driver.id,
          session_id: sessionId,
          number: Number.isNaN(parsedNumber) ? null : parsedNumber,
          name: driver.name.trim() || 'Driver',
          team: driver.team.trim() || null,
          marshal_user_id: isUuid(driver.marshalId) ? driver.marshalId : null,
          laps: 0,
          last_lap_ms: null,
          best_lap_ms: null,
          pits: 0,
          status: 'ready',
          driver_flag: 'none',
          pit_complete: false,
          total_time_ms: 0,
          updated_at: nowIso,
        };
      });

      const entryRows = enabledDrivers.map((driver, index) => {
        const parsedNumber = driver.number ? Number.parseInt(driver.number, 10) : null;
        return {
          id: createId('entry'),
          session_id: sessionId,
          driver_id: driver.id,
          driver_number: Number.isNaN(parsedNumber) ? null : parsedNumber,
          driver_name: driver.name.trim() || 'Driver',
          team_name: driver.team.trim() || null,
          position: index + 1,
          marshal_user_id: isUuid(driver.marshalId) ? driver.marshalId : null,
          created_at: nowIso,
          updated_at: nowIso,
        };
      });

      const assignedMarshalIds = new Set(
        enabledDrivers
          .map((driver) => driver.marshalId)
          .filter((marshalId) => isUuid(marshalId)),
      );

      const memberRows = Array.from(assignedMarshalIds).map((userId) => ({
        session_id: sessionId,
        user_id: userId,
        role: 'marshal',
        inserted_at: nowIso,
      }));

      await seedSessionData(sessionId, {
        sessionState: sessionStateRow,
        drivers: driverRows,
        entries: entryRows,
        members: memberRows,
      });

      selectSession(sessionId);
      await refreshSessions?.();
      navigate(`/control/${sessionId}`);
    } catch (submitError) {
      console.error('Failed to seed session', submitError);
      setError('Unable to seed session data. Check Supabase permissions and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    createdSession?.id,
    enabledDrivers,
    marshalDirectory,
    navigate,
    refreshSessions,
    seedSessionData,
    selectSession,
    sessionStateDraft.eventType,
    sessionStateDraft.totalDuration,
    sessionStateDraft.totalLaps,
  ]);

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 rounded-3xl border border-white/5 bg-[#060910]/80 px-8 py-12 text-center text-gray-200">
        <h1 className="text-2xl font-semibold text-white">Session setup unavailable</h1>
        <p className="text-sm text-neutral-400">
          Supabase is not configured for this environment. Configure Supabase credentials to create managed sessions.
        </p>
      </div>
    );
  }

  if (!supportsSessions) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 rounded-3xl border border-white/5 bg-[#060910]/80 px-8 py-12 text-center text-gray-200">
        <h1 className="text-2xl font-semibold text-white">Managed sessions disabled</h1>
        <p className="text-sm text-neutral-400">
          This Supabase project is missing the sessions schema required for multi-session control. Migrate the database to enable the new workflow.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold text-white">New session</h1>
        <p className="text-sm text-neutral-400">
          Walk through the setup to seed Supabase with the state race control needs before lights out.
        </p>
      </header>
      <nav className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {steps.map((entry, index) => {
          const isActive = index + 1 === activeStep;
          const isComplete = index + 1 < activeStep;
          return (
            <div
              key={entry.title}
              className={`rounded-2xl border px-4 py-3 text-center text-xs uppercase tracking-[0.3em] transition ${
                isActive
                  ? 'border-[#9FF7D3]/60 bg-[#9FF7D3]/10 text-[#9FF7D3]'
                  : isComplete
                  ? 'border-white/20 bg-white/5 text-white'
                  : 'border-white/10 bg-[#05070F]/80 text-neutral-500'
              }`}
            >
              <div className="text-[11px] font-semibold">Step {index + 1}</div>
              <div className="mt-2 text-[10px] normal-case tracking-[0.15em] text-neutral-300">
                {entry.title}
              </div>
            </div>
          );
        })}
      </nav>
      {error ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">{error}</div>
      ) : null}
      {activeStep === 1 ? (
        <form
          onSubmit={handleCreateSession}
          className="flex flex-col gap-5 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6"
        >
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">
              Session name
            </label>
            <input
              value={sessionName}
              onChange={(event) => setSessionName(event.target.value)}
              placeholder="Night practice"
              className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">
              Scheduled start (optional)
            </label>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-neutral-400">
              Create the Supabase session record before seeding race data.
            </span>
            <button
              type="submit"
              disabled={isCreating}
              className="rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/15 px-5 py-3 font-semibold uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCreating ? 'Creating…' : 'Create session'}
            </button>
          </div>
        </form>
      ) : null}
      {activeStep === 2 ? (
        <div className="flex flex-col gap-5 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">
              Event type
            </label>
            <select
              value={sessionStateDraft.eventType}
              onChange={(event) => handleUpdateSessionState('eventType', event.target.value)}
              className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
            >
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">Total laps</span>
              <input
                type="number"
                min="0"
                value={sessionStateDraft.totalLaps}
                onChange={(event) => handleUpdateSessionState('totalLaps', event.target.value)}
                className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">Total duration (minutes)</span>
              <input
                type="number"
                min="0"
                value={sessionStateDraft.totalDuration}
                onChange={(event) => handleUpdateSessionState('totalDuration', event.target.value)}
                className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-neutral-400">
              These defaults populate the session_state row used by race control and live timing.
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePreviousStep}
                className="rounded-full border border-white/10 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-neutral-400 transition hover:border-white/40 hover:text-white"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleNextStep}
                className="rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/15 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {activeStep === 3 ? (
        <div className="flex flex-col gap-5 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Drivers</h2>
            <button
              type="button"
              onClick={handleAddDriver}
              className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-white transition hover:border-white/40"
            >
              Add driver
            </button>
          </div>
          {isLoadingMarshals ? (
            <div className="rounded-2xl border border-white/10 bg-[#060910]/70 px-4 py-3 text-xs text-neutral-300">
              Loading marshal profiles from Supabase…
            </div>
          ) : null}
          {marshalDirectoryError ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              {marshalDirectoryError}
            </div>
          ) : null}
          {!isLoadingMarshals && !marshalDirectory.length ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
              No marshal profiles were found. Create marshal accounts in Supabase and refresh before finishing setup.
            </div>
          ) : null}
          <div className="overflow-hidden rounded-2xl border border-white/5">
            <table className="min-w-full divide-y divide-white/5 text-sm text-neutral-200">
              <thead className="bg-white/5 text-xs uppercase tracking-[0.3em] text-neutral-400">
                <tr>
                  <th className="px-4 py-3 text-left">Include</th>
                  <th className="px-4 py-3 text-left">Number</th>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Team</th>
                  <th className="px-4 py-3 text-left">Marshal</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((driver) => (
                  <tr key={driver.id} className="divide-x divide-white/5 odd:bg-[#060910]/70">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={driver.enabled}
                        onChange={() => handleToggleDriver(driver.id)}
                        className="h-4 w-4 rounded border-white/20 bg-transparent text-[#9FF7D3] focus:ring-[#9FF7D3]/50"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        value={driver.number}
                        min="0"
                        onChange={(event) => handleDriverChange(driver.id, 'number', event.target.value)}
                        className="w-20 rounded-full border border-white/10 bg-[#0B1120]/60 px-3 py-2 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={driver.name}
                        onChange={(event) => handleDriverChange(driver.id, 'name', event.target.value)}
                        className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-2 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={driver.team}
                        onChange={(event) => handleDriverChange(driver.id, 'team', event.target.value)}
                        className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-2 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={driver.marshalId}
                        onChange={(event) => handleDriverChange(driver.id, 'marshalId', event.target.value)}
                        className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-2 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
                      >
                        <option value="">Select marshal…</option>
                        {marshalOptions.map((marshal) => (
                          <option key={marshal.id} value={marshal.id}>
                            {marshal.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-neutral-400">
              Toggle drivers you want to exclude before heading to marshal assignments.
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePreviousStep}
                className="rounded-full border border-white/10 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-neutral-400 transition hover:border-white/40 hover:text-white"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleNextStep}
                className="rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/15 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {activeStep === 4 ? (
        <div className="flex flex-col gap-5 rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-white">Marshal assignments</h2>
            <p className="text-sm text-neutral-400">
              Confirm each marshal&apos;s Supabase profile and driver coverage before launching race control.
            </p>
          </div>
          {isLoadingMarshals ? (
            <div className="rounded-2xl border border-white/10 bg-[#060910]/70 px-4 py-3 text-xs text-neutral-300">
              Loading marshal profiles from Supabase…
            </div>
          ) : null}
          {marshalDirectoryError ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              {marshalDirectoryError}
            </div>
          ) : null}
          <div className="flex flex-col gap-4">
            {marshalAssignments.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#060910]/70 px-4 py-3 text-sm text-neutral-300">
                Enable at least one driver and assign them to a marshal to review session access.
              </div>
            ) : null}
            {marshalAssignments.map((group) => (
              <div key={group.id ?? 'unassigned'} className="rounded-2xl border border-white/10 bg-[#060910]/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">
                      {group.id ? 'Marshal profile' : 'Unassigned drivers'}
                    </span>
                    <span className="text-sm font-semibold text-white">{group.label}</span>
                  </div>
                  {group.id ? (
                    <code className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[11px] tracking-[0.2em] text-neutral-300">
                      {group.id}
                    </code>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-col gap-2 text-sm text-neutral-300">
                  {group.drivers.map((driver) => (
                    <div key={driver.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/30 px-3 py-2">
                      <div className="flex flex-col">
                        <span className="font-semibold text-white">
                          {(driver.name || '').trim() || `Driver ${driver.number || ''}`}
                        </span>
                        <span className="text-[11px] uppercase tracking-[0.3em] text-neutral-500">
                          #{driver.number || '—'} • {(driver.team || '').trim() || 'No team'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {group.isMissingProfile ? (
                  <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    Marshal profile not found in Supabase. Verify the account exists and has the marshal role.
                  </div>
                ) : null}
                {!group.id ? (
                  <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    Assign these drivers to a marshal profile before finishing setup.
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-white/5 bg-[#060910]/70 p-4 text-sm text-neutral-300">
            <p>
              <span className="font-semibold text-white">Drivers ready:</span> {enabledDrivers.length}
            </p>
            <p>
              <span className="font-semibold text-white">Event type:</span> {sessionStateDraft.eventType} •{' '}
              {sessionStateDraft.totalLaps} laps • {sessionStateDraft.totalDuration} minutes
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <button
              type="button"
              onClick={handlePreviousStep}
              className="rounded-full border border-white/10 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-neutral-400 transition hover:border-white/40 hover:text-white"
            >
              Back
            </button>
            <button
              type="button"
              onClick={finalizeSession}
              disabled={isSubmitting}
              className="rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/15 px-5 py-3 font-semibold uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Seeding…' : 'Finish setup'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
