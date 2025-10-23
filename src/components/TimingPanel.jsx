import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Car,
  Clock,
  Flag,
  Gauge,
  ListChecks,
  Megaphone,
  Play,
  RotateCcw,
  Save,
  Settings,
  ShieldAlert,
  StopCircle,
  TimerReset,
  Users,
  X,
} from 'lucide-react';
import { formatLapTime, formatRaceClock } from '../utils/time';
import { TRACK_STATUS_MAP, TRACK_STATUS_OPTIONS } from '../constants/trackStatus';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';
import {
  DEFAULT_SESSION_STATE,
  SESSION_ROW_ID,
  createClientId,
  groupLapRows,
  hydrateDriverState,
  sessionRowToState,
  toDriverRow,
} from '../utils/raceData';
import { useAuth } from '../context/AuthContext.jsx';
import AuthGate from './auth/AuthGate.jsx';

const DEFAULT_MARSHALS = [
  { id: 'm1', name: 'Marshal 1' },
  { id: 'm2', name: 'Marshal 2' },
];

const DEFAULT_DRIVERS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    number: 1,
    name: 'Driver 1',
    team: 'Team EMS',
    marshalId: 'm1',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    number: 2,
    name: 'Driver 2',
    team: 'Team Underground Club',
    marshalId: 'm1',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    number: 3,
    name: 'Driver 3',
    team: 'Team Flywheels',
    marshalId: 'm1',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    number: 4,
    name: 'Driver 4',
    team: 'Team LSC',
    marshalId: 'm1',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    number: 5,
    name: 'Driver 5',
    team: 'Team Mosleys',
    marshalId: 'm1',
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    number: 6,
    name: 'Driver 6',
    team: 'Team Benefactor',
    marshalId: 'm2',
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    number: 7,
    name: 'Driver 7',
    team: 'Team Blend & Barrel',
    marshalId: 'm2',
  },
  {
    id: '88888888-8888-4888-8888-888888888888',
    number: 8,
    name: 'Driver 8',
    team: 'Team PD',
    marshalId: 'm2',
  },
  {
    id: '99999999-9999-4999-8999-999999999999',
    number: 9,
    name: 'Driver 9',
    team: 'Team Bahama Mamas',
    marshalId: 'm2',
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    number: 10,
    name: 'Driver 10',
    team: 'Team Pitlane',
    marshalId: 'm2',
  },
];

const EVENT_TYPES = ['Practice', 'Qualifying', 'Race'];

const DRIVER_FLAG_OPTIONS = [
  { id: 'none', label: 'No Flag' },
  { id: 'blue', label: 'Blue Flag' },
  { id: 'blackwhite', label: 'Black & White' },
];

const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const LOG_LIMIT = 200;

const createUuid = () =>
  globalThis.crypto?.randomUUID?.() ?? `driver-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const toDriverState = (driver) => ({
  ...driver,
  laps: 0,
  lapTimes: [],
  lapHistory: [],
  lastLap: null,
  bestLap: null,
  totalTime: 0,
  pits: 0,
  status: 'ready',
  currentLapStart: null,
  driverFlag: 'none',
  pitComplete: false,
  hasInvalidToResolve: false,
});

const parseManualLap = (input) => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const colonIdx = trimmed.indexOf(':');
  let minutes = 0;
  let secondsPart = trimmed;
  if (colonIdx !== -1) {
    minutes = Number.parseInt(trimmed.slice(0, colonIdx), 10);
    secondsPart = trimmed.slice(colonIdx + 1);
  }
  if (Number.isNaN(minutes) || minutes < 0) return null;
  let seconds = 0;
  let millis = 0;
  if (secondsPart.includes('.')) {
    const [secStr, msStr] = secondsPart.split('.');
    seconds = Number.parseInt(secStr, 10);
    millis = Number.parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
  } else {
    seconds = Number.parseInt(secondsPart, 10);
  }
  if (Number.isNaN(seconds) || seconds < 0) return null;
  if (Number.isNaN(millis) || millis < 0) millis = 0;
  return minutes * 60000 + seconds * 1000 + millis;
};

const TimingPanel = () => {
  const { status: authStatus, user, profile } = useAuth();
  const supabaseClient = supabase;
  const isAuthenticated = authStatus === 'authenticated' && Boolean(user);
  const isAdmin = profile?.role === 'admin';
  const isMarshal = profile?.role === 'marshal';
  const assignedDriverIds = useMemo(
    () => new Set(profile?.assigned_driver_ids ?? []),
    [profile?.assigned_driver_ids],
  );
  const [eventConfig, setEventConfig] = useState({
    eventType: DEFAULT_SESSION_STATE.eventType,
    totalLaps: DEFAULT_SESSION_STATE.totalLaps,
    totalDuration: DEFAULT_SESSION_STATE.totalDuration,
    marshals: DEFAULT_MARSHALS,
  });
  const [drivers, setDrivers] = useState(
    DEFAULT_DRIVERS.map((driver) => ({
      ...toDriverState(driver),
      lapHistory: [],
      totalTime: 0,
    })),
  );
  const [procedurePhase, setProcedurePhase] = useState(
    DEFAULT_SESSION_STATE.procedurePhase,
  );
  const [isTiming, setIsTiming] = useState(DEFAULT_SESSION_STATE.isTiming);
  const [isPaused, setIsPaused] = useState(DEFAULT_SESSION_STATE.isPaused);
  const [trackStatus, setTrackStatus] = useState(DEFAULT_SESSION_STATE.trackStatus);
  const [announcement, setAnnouncement] = useState(
    DEFAULT_SESSION_STATE.announcement,
  );
  const [announcementDraft, setAnnouncementDraft] = useState(
    DEFAULT_SESSION_STATE.announcement,
  );
  const [manualLapInputs, setManualLapInputs] = useState({});
  const [logs, setLogs] = useState([]);
  const [showSetup, setShowSetup] = useState(false);
  const [setupDraft, setSetupDraft] = useState(null);
  const [countdown, setCountdown] = useState(5);
  const [raceTime, setRaceTime] = useState(DEFAULT_SESSION_STATE.raceTime);
  const [recentLapDriverId, setRecentLapDriverId] = useState(null);
  const [isInitialising, setIsInitialising] = useState(isSupabaseConfigured);
  const [supabaseError, setSupabaseError] = useState(null);
  const [bestLapDrafts, setBestLapDrafts] = useState({});
  const [marshalProfiles, setMarshalProfiles] = useState([]);

  const raceStartRef = useRef(null);
  const pauseStartRef = useRef(null);
  const pausedDurationRef = useRef(0);
  const lapFlashTimeoutRef = useRef(null);
  const sessionStateRef = useRef({
    id: SESSION_ROW_ID,
    event_type: DEFAULT_SESSION_STATE.eventType,
    total_laps: DEFAULT_SESSION_STATE.totalLaps,
    total_duration: DEFAULT_SESSION_STATE.totalDuration,
    procedure_phase: DEFAULT_SESSION_STATE.procedurePhase,
    flag_status: DEFAULT_SESSION_STATE.flagStatus,
    track_status: DEFAULT_SESSION_STATE.trackStatus,
    announcement: DEFAULT_SESSION_STATE.announcement,
    is_timing: DEFAULT_SESSION_STATE.isTiming,
    is_paused: DEFAULT_SESSION_STATE.isPaused,
    race_time_ms: DEFAULT_SESSION_STATE.raceTime,
  });
  const lastRaceTimeSyncRef = useRef(0);
  const logsRef = useRef([]);
  const supabaseReady = isSupabaseConfigured && Boolean(supabaseClient) && isAuthenticated;

  const canAccessDriverRow = useCallback(
    (row) => {
      if (!profile || isAdmin) return true;
      if (!row) return false;
      if (isMarshal) {
        if (row.marshal_user_id && row.marshal_user_id === profile.id) {
          return true;
        }
        if (assignedDriverIds.has(row.id)) {
          return true;
        }
      }
      return false;
    },
    [assignedDriverIds, isAdmin, isMarshal, profile],
  );

  const applyDriverData = useCallback(
    (driverRows = [], lapRows = []) => {
      if (!driverRows.length) {
        return;
      }
      const filteredDrivers = driverRows.filter((row) => canAccessDriverRow(row));
      if (!filteredDrivers.length) {
        setDrivers([]);
        return;
      }
      const lapMap = groupLapRows(lapRows);
      setDrivers(filteredDrivers.map((row) => hydrateDriverState(row, lapMap)));
    },
    [canAccessDriverRow],
  );

  const refreshDriversFromSupabase = useCallback(async () => {
    if (!supabaseReady) return;
    try {
      const { data: driverRows, error: driverError } = await supabaseClient
        .from('drivers')
        .select('*')
        .order('number', { ascending: true });
      if (driverError) throw driverError;

      const { data: lapRows, error: lapError } = await supabaseClient
        .from('laps')
        .select('*')
        .order('lap_number', { ascending: true });
      if (lapError) throw lapError;

      if (driverRows?.length) {
        applyDriverData(driverRows, lapRows ?? []);
      } else {
        setDrivers([]);
      }
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to refresh drivers from Supabase', error);
      setSupabaseError('Unable to refresh drivers from Supabase.');
    }
  }, [applyDriverData, supabaseClient, supabaseReady]);

  const refreshSessionFromSupabase = useCallback(async () => {
    if (!supabaseReady) return;
    try {
      const { data, error } = await supabaseClient
        .from('session_state')
        .select('*')
        .eq('id', SESSION_ROW_ID)
        .maybeSingle();
      if (error) throw error;
      if (!data) return;
      const hydrated = sessionRowToState(data);
      sessionStateRef.current = {
        ...data,
        track_status: hydrated.trackStatus,
        flag_status: hydrated.flagStatus,
      };
      setEventConfig((prev) => ({
        ...prev,
        eventType: hydrated.eventType,
        totalLaps: hydrated.totalLaps,
        totalDuration: hydrated.totalDuration,
      }));
      setProcedurePhase(hydrated.procedurePhase);
      setTrackStatus(hydrated.trackStatus);
      setAnnouncement(hydrated.announcement);
      setAnnouncementDraft(hydrated.announcement);
      setIsTiming(hydrated.isTiming);
      setIsPaused(hydrated.isPaused);
      setRaceTime(hydrated.raceTime);
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to refresh session state from Supabase', error);
      setSupabaseError('Unable to refresh session state from Supabase.');
    }
  }, [supabaseClient, supabaseReady]);

  const refreshLogsFromSupabase = useCallback(async () => {
    if (!supabaseReady) return;
    try {
      const { data, error } = await supabaseClient
        .from('race_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(LOG_LIMIT);
      if (error) throw error;
      if (!Array.isArray(data)) return;
      const mapped = data.map((row) => ({
        id: row.id ?? createClientId(),
        action: row.message ?? '',
        marshalId: row.marshal_id ?? 'Race Control',
        timestamp: row.created_at ? new Date(row.created_at) : new Date(),
      }));
      const trimmed = mapped.slice(0, LOG_LIMIT);
      logsRef.current = trimmed;
      setLogs(trimmed);
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to refresh race events from Supabase', error);
      setSupabaseError('Unable to refresh race events from Supabase.');
    }
  }, [supabaseClient, supabaseReady]);

  const bootstrapSupabase = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsInitialising(false);
      return;
    }
    if (!supabaseReady) {
      return;
    }
    setIsInitialising(true);
    try {
      const [{ data: driverRows, error: driverError }, { data: lapRows, error: lapError }] = await Promise.all([
        supabaseClient.from('drivers').select('*').order('number', { ascending: true }),
        supabaseClient.from('laps').select('*').order('lap_number', { ascending: true }),
      ]);
      if (driverError) throw driverError;
      if (lapError) throw lapError;
      if (driverRows?.length) {
        applyDriverData(driverRows, lapRows ?? []);
      } else {
        setDrivers([]);
      }

      const { data: sessionRow, error: sessionError } = await supabaseClient
        .from('session_state')
        .select('*')
        .eq('id', SESSION_ROW_ID)
        .maybeSingle();
      if (sessionError) {
        throw sessionError;
      }
      let hydratedRow = sessionRow;
      if (!hydratedRow) {
        const defaultSession = {
          id: SESSION_ROW_ID,
          event_type: DEFAULT_SESSION_STATE.eventType,
          total_laps: DEFAULT_SESSION_STATE.totalLaps,
          total_duration: DEFAULT_SESSION_STATE.totalDuration,
          procedure_phase: DEFAULT_SESSION_STATE.procedurePhase,
          flag_status: DEFAULT_SESSION_STATE.flagStatus,
          track_status: DEFAULT_SESSION_STATE.trackStatus,
          announcement: DEFAULT_SESSION_STATE.announcement,
          is_timing: DEFAULT_SESSION_STATE.isTiming,
          is_paused: DEFAULT_SESSION_STATE.isPaused,
          race_time_ms: DEFAULT_SESSION_STATE.raceTime,
          updated_at: new Date().toISOString(),
        };
        const { data: inserted, error: insertError } = await supabaseClient
          .from('session_state')
          .upsert(defaultSession)
          .select()
          .maybeSingle();
        if (insertError) {
          throw insertError;
        }
        hydratedRow = inserted ?? defaultSession;
      }
      const hydrated = sessionRowToState(hydratedRow);
      sessionStateRef.current = {
        ...hydratedRow,
        track_status: hydrated.trackStatus,
        flag_status: hydrated.flagStatus,
      };
      setEventConfig((prev) => ({
        ...prev,
        eventType: hydrated.eventType,
        totalLaps: hydrated.totalLaps,
        totalDuration: hydrated.totalDuration,
      }));
      setProcedurePhase(hydrated.procedurePhase);
      setTrackStatus(hydrated.trackStatus);
      setAnnouncement(hydrated.announcement);
      setAnnouncementDraft(hydrated.announcement);
      setIsTiming(hydrated.isTiming);
      setIsPaused(hydrated.isPaused);
      setRaceTime(hydrated.raceTime);
      await refreshLogsFromSupabase();

      let availableMarshals = [];
      if (isAdmin) {
        const { data: marshalRows, error: marshalError } = await supabaseClient
          .from('profiles')
          .select('*')
          .order('display_name', { ascending: true });
        if (marshalError) {
          throw marshalError;
        }
        availableMarshals = marshalRows?.filter((row) => row.role === 'marshal') ?? [];
        setMarshalProfiles(availableMarshals);
      } else if (profile) {
        availableMarshals = [profile];
        setMarshalProfiles(availableMarshals);
      } else {
        setMarshalProfiles([]);
      }

      setEventConfig((prev) => ({
        ...prev,
        marshals: availableMarshals.length
          ? availableMarshals.map((marshal) => ({
              id: marshal.id,
              name: marshal.display_name ?? marshal.name ?? marshal.id.slice(0, 8),
            }))
          : [],
      }));

      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to bootstrap Supabase data', error);
      setSupabaseError(
        'Unable to load data from Supabase. Confirm credentials and schema are correct.',
      );
    } finally {
      setIsInitialising(false);
    }
  }, [
    applyDriverData,
    isAdmin,
    profile,
    refreshLogsFromSupabase,
    supabaseClient,
    supabaseReady,
  ]);

  const updateSessionState = useCallback(async (patch) => {
    sessionStateRef.current = {
      ...sessionStateRef.current,
      ...patch,
      id: SESSION_ROW_ID,
    };
    if (!supabaseReady) return;
    try {
      await supabaseClient
        .from('session_state')
        .upsert({
          ...sessionStateRef.current,
          updated_at: new Date().toISOString(),
        });
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to update session state', error);
      setSupabaseError('Unable to update session state in Supabase.');
    }
  }, [supabaseClient, supabaseReady]);

  const syncRaceTimeToSupabase = useCallback(
    (elapsed) => {
      if (!supabaseReady) return;
      const now = Date.now();
      if (now - lastRaceTimeSyncRef.current < 1000) {
        return;
      }
      lastRaceTimeSyncRef.current = now;
      updateSessionState({ race_time_ms: elapsed });
    },
    [supabaseReady, updateSessionState],
  );

  const logAction = useCallback(
    async (action, marshalId) => {
      const actor = marshalId ?? profile?.display_name ?? profile?.name ?? 'Race Control';
      const entry = {
        id: createClientId(),
        action,
        marshalId: actor,
        timestamp: new Date(),
      };
      setLogs((prev) => {
        const next = [entry, ...prev].slice(0, LOG_LIMIT);
        logsRef.current = next;
        return next;
      });
      if (supabaseReady) {
        try {
          await supabaseClient.from('race_events').insert({
            id: entry.id,
            message: action,
            marshal_id: actor,
            created_at: entry.timestamp.toISOString(),
          });
          setSupabaseError(null);
        } catch (error) {
          console.error('Failed to persist race event', error);
          setSupabaseError('Unable to store race log in Supabase.');
        }
      }
    },
    [profile?.display_name, profile?.name, supabaseClient, supabaseReady],
  );

  const persistDriverState = useCallback(async (driver) => {
    if (!supabaseReady) return;
    try {
      await supabaseClient.from('drivers').upsert(toDriverRow(driver));
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to persist driver state', error);
      setSupabaseError('Unable to update driver data in Supabase.');
    }
  }, [supabaseClient, supabaseReady]);

  useEffect(() => {
    if (!isTiming || isPaused) {
      lastRaceTimeSyncRef.current = 0;
      return () => {};
    }
    const interval = setInterval(() => {
      const now = Date.now();
      if (raceStartRef.current) {
        const elapsed = now - raceStartRef.current - pausedDurationRef.current;
        setRaceTime(elapsed);
        syncRaceTimeToSupabase(elapsed);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isTiming, isPaused, syncRaceTimeToSupabase]);

  useEffect(() => {
    if (!isTiming || isPaused) {
      lastRaceTimeSyncRef.current = 0;
    }
  }, [isTiming, isPaused]);

  useEffect(() => {
    if (procedurePhase === 'countdown' && countdown > 0) {
      const timer = setTimeout(() => setCountdown((prev) => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (procedurePhase === 'countdown' && countdown === 0) {
      goGreen();
    }
  }, [procedurePhase, countdown]);

  useEffect(
    () => () => {
      if (lapFlashTimeoutRef.current) {
        clearTimeout(lapFlashTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    bootstrapSupabase();
  }, [bootstrapSupabase]);

  useEffect(() => {
    if (!supabaseReady) {
      return () => {};
    }
    const driverChannel = supabaseClient
      .channel('timing-panel-drivers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => {
        refreshDriversFromSupabase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'laps' }, () => {
        refreshDriversFromSupabase();
      })
      .subscribe();

    const sessionChannel = supabaseClient
      .channel('timing-panel-session')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_state', filter: `id=eq.${SESSION_ROW_ID}` },
        (payload) => {
          if (payload?.new) {
            const hydrated = sessionRowToState(payload.new);
            sessionStateRef.current = {
              ...payload.new,
              track_status: hydrated.trackStatus,
              flag_status: hydrated.flagStatus,
            };
            setEventConfig((prev) => ({
              ...prev,
              eventType: hydrated.eventType,
              totalLaps: hydrated.totalLaps,
              totalDuration: hydrated.totalDuration,
            }));
            setProcedurePhase(hydrated.procedurePhase);
            setTrackStatus(hydrated.trackStatus);
            setAnnouncement(hydrated.announcement);
            setAnnouncementDraft(hydrated.announcement);
            setIsTiming(hydrated.isTiming);
            setIsPaused(hydrated.isPaused);
            setRaceTime(hydrated.raceTime);
          }
        },
      )
      .subscribe();

    const logChannel = supabaseClient
      .channel('timing-panel-logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'race_events' }, (payload) => {
        if (payload?.new) {
          const entry = {
            id: payload.new.id ?? createClientId(),
            action: payload.new.message ?? '',
            marshalId: payload.new.marshal_id ?? 'Race Control',
            timestamp: payload.new.created_at ? new Date(payload.new.created_at) : new Date(),
          };
          setLogs((prev) => {
            if (prev.some((log) => log.id === entry.id)) {
              return prev;
            }
            const next = [entry, ...prev].slice(0, LOG_LIMIT);
            logsRef.current = next;
            return next;
          });
        }
      })
      .subscribe();

    return () => {
      supabaseClient.removeChannel(driverChannel);
      supabaseClient.removeChannel(sessionChannel);
      supabaseClient.removeChannel(logChannel);
    };
  }, [refreshDriversFromSupabase, supabaseClient, supabaseReady]);

  const getMarshalName = useCallback(
    (marshalId) => {
      if (!marshalId) return 'Unassigned';
      const fromProfiles = marshalProfiles.find((marshal) => marshal.id === marshalId);
      if (fromProfiles) {
        return fromProfiles.display_name ?? fromProfiles.name ?? 'Marshal';
      }
      const fromConfig = eventConfig.marshals.find((marshal) => marshal.id === marshalId);
      if (fromConfig) {
        return fromConfig.name;
      }
      return 'Unassigned';
    },
    [eventConfig.marshals, marshalProfiles],
  );

  const overrideBestLap = useCallback(
    (driverId, lapMs) => {
      let updatedDriver = null;
      setDrivers((prev) =>
        prev.map((driver) => {
          if (driver.id !== driverId) {
            return driver;
          }
          updatedDriver = {
            ...driver,
            bestLap: lapMs,
          };
          return updatedDriver;
        }),
      );
      if (!updatedDriver) return;
      const marshalName = getMarshalName(updatedDriver.marshalId);
      void logAction(
        `Best lap overridden for #${updatedDriver.number} (${formatLapTime(lapMs)})`,
        marshalName,
      );
      void persistDriverState(updatedDriver);
    },
    [getMarshalName, logAction, persistDriverState],
  );

  const startWarmup = () => {
    setProcedurePhase('warmup');
    updateSessionState({ procedure_phase: 'warmup' });
    void logAction('Warm up lap started');
  };

  const callFinalCall = () => {
    setProcedurePhase('final-call');
    updateSessionState({ procedure_phase: 'final-call' });
    void logAction('Final call issued');
  };

  const initiateCountdown = () => {
    setCountdown(5);
    setProcedurePhase('countdown');
    updateSessionState({ procedure_phase: 'countdown' });
    void logAction('Race start countdown initiated');
  };

  const goGreen = () => {
    raceStartRef.current = Date.now();
    pausedDurationRef.current = 0;
    pauseStartRef.current = null;
    setRaceTime(0);
    setIsTiming(true);
    setIsPaused(false);
    setProcedurePhase('green');
    setTrackStatus('green');
    setDrivers((prev) => {
      const updated = prev.map((driver) => ({
        ...driver,
        status: 'ontrack',
        currentLapStart: 0,
      }));
      updated.forEach((driver) => {
        void persistDriverState(driver);
      });
      return updated;
    });
    updateSessionState({
      procedure_phase: 'green',
      flag_status: 'green',
      track_status: 'green',
      is_timing: true,
      is_paused: false,
      race_time_ms: 0,
    });
    void logAction('Session started');
  };

  const confirmPause = () => {
    if (!isTiming || isPaused) return;
    const confirmed = window.confirm('Pause the session timer?');
    if (!confirmed) return;
    pauseStartRef.current = Date.now();
    setIsPaused(true);
    updateSessionState({ is_paused: true });
    void logAction('Session timer paused');
  };

  const resumeTiming = () => {
    if (!isTiming || !isPaused) return;
    const pausedFor = Date.now() - pauseStartRef.current;
    pausedDurationRef.current += pausedFor;
    pauseStartRef.current = null;
    setIsPaused(false);
    updateSessionState({ is_paused: false });
    void logAction('Session timer resumed');
  };

  const finishSession = () => {
    setProcedurePhase('complete');
    setIsTiming(false);
    setIsPaused(false);
    setDrivers((prev) => {
      const updated = prev.map((driver) => ({
        ...driver,
        status: driver.status === 'retired' ? 'retired' : 'finished',
      }));
      updated.forEach((driver) => {
        void persistDriverState(driver);
      });
      return updated;
    });
    updateSessionState({
      procedure_phase: 'complete',
      is_timing: false,
      is_paused: false,
    });
    void logAction('Session completed');
  };

  const handleTrackStatusChange = (statusId, { fromResume } = {}) => {
    const normalizedStatus = statusId === 'green-check' ? 'green' : statusId;
    setTrackStatus(normalizedStatus);
    const sessionPatch = {
      flag_status: normalizedStatus,
      track_status: normalizedStatus,
    };
    if (normalizedStatus === 'red') {
      setProcedurePhase('suspended');
      sessionPatch.procedure_phase = 'suspended';
    } else if (normalizedStatus === 'green' && procedurePhase === 'suspended') {
      setProcedurePhase('green');
      sessionPatch.procedure_phase = 'green';
    }
    updateSessionState(sessionPatch);
    if (statusId === 'green-check' || fromResume) {
      void logAction('Session resumed from suspension');
      return;
    }
    const statusMeta = TRACK_STATUS_MAP[normalizedStatus];
    void logAction(
      `Track status set to ${
        statusMeta ? statusMeta.label : normalizedStatus.toUpperCase()
      }`,
    );
  };

  const logLap = (driverId, { manualTime, source } = {}) => {
    const manualEntry =
      typeof manualTime === 'number' && Number.isFinite(manualTime);
    let updatedDriver = null;
    const now = Date.now();
    const raceElapsed =
      raceStartRef.current !== null
        ? now - raceStartRef.current - pausedDurationRef.current
        : null;
    setDrivers((prev) =>
      prev.map((driver) => {
        if (driver.id !== driverId) {
          return driver;
        }
        if (driver.status === 'retired' || driver.status === 'finished') {
          return driver;
        }
        let lapTime = manualEntry ? manualTime : null;
        let nextCurrentLapStart = driver.currentLapStart;
        if (lapTime === null) {
          if (raceElapsed === null) {
            return driver;
          }
          const lapStart =
            driver.currentLapStart ?? driver.totalTime ?? 0;
          lapTime = raceElapsed - lapStart;
          nextCurrentLapStart = raceElapsed;
        } else {
          if (raceElapsed !== null) {
            nextCurrentLapStart = raceElapsed;
          } else if (driver.currentLapStart !== null) {
            nextCurrentLapStart = driver.currentLapStart + lapTime;
          } else {
            nextCurrentLapStart = (driver.totalTime ?? 0) + lapTime;
          }
        }
        if (!Number.isFinite(lapTime) || lapTime <= 0) {
          return driver;
        }
        const recordedAt = new Date();
        const lapTimes = [...driver.lapTimes, lapTime];
        const lapHistory = [
          ...driver.lapHistory,
          {
            lapNumber: lapTimes.length,
            lapTime,
            source: source ?? (manualEntry ? 'manual' : 'automatic'),
            recordedAt,
          },
        ];
        const laps = driver.laps + 1;
        const bestLap =
          driver.bestLap === null ? lapTime : Math.min(driver.bestLap, lapTime);
        const status =
          eventConfig.eventType === 'Race' && laps >= eventConfig.totalLaps
            ? 'finished'
            : driver.status;
        const totalTime = (driver.totalTime ?? 0) + lapTime;
        updatedDriver = {
          ...driver,
          laps,
          lapTimes,
          lapHistory,
          lastLap: lapTime,
          bestLap,
          totalTime,
          status,
          currentLapStart: nextCurrentLapStart,
          hasInvalidToResolve: false,
        };
        return updatedDriver;
      }),
    );
    setManualLapInputs((prev) => ({ ...prev, [driverId]: '' }));
    if (lapFlashTimeoutRef.current) {
      clearTimeout(lapFlashTimeoutRef.current);
    }
    setRecentLapDriverId(driverId);
    lapFlashTimeoutRef.current = setTimeout(() => {
      setRecentLapDriverId(null);
    }, 500);
    if (updatedDriver) {
      const marshalName = getMarshalName(updatedDriver.marshalId);
      void logAction(
        `Lap recorded for #${updatedDriver.number} (${formatLapTime(
          updatedDriver.lastLap,
        )})${source ? ` via ${source}` : ''}`,
        marshalName,
      );
      void persistDriverState(updatedDriver);
      if (supabaseReady) {
        const recordedAtIso =
          updatedDriver.lapHistory[
            updatedDriver.lapHistory.length - 1
          ]?.recordedAt?.toISOString?.() ?? new Date().toISOString();
        supabaseClient
          .from('laps')
          .insert({
            driver_id: updatedDriver.id,
            lap_number: updatedDriver.laps,
            lap_time_ms: updatedDriver.lastLap,
            source: source ?? (manualEntry ? 'manual' : 'automatic'),
            recorded_at: recordedAtIso,
          })
          .then(() => setSupabaseError(null))
          .catch((error) => {
            console.error('Failed to persist lap', error);
            setSupabaseError('Unable to store lap in Supabase.');
          });
      }
    }
  };

  const retireDriver = (driverId) => {
    let retiredDriver = null;
    setDrivers((prev) =>
      prev.map((driver) => {
        if (driver.id !== driverId) {
          return driver;
        }
        retiredDriver = { ...driver, status: 'retired', currentLapStart: null };
        return retiredDriver;
      }),
    );
    if (retiredDriver) {
      void logAction(
        `Driver #${retiredDriver.number} retired`,
        getMarshalName(retiredDriver.marshalId),
      );
      void persistDriverState(retiredDriver);
    }
  };

  const togglePitStop = (driverId) => {
    let updatedDriver = null;
    setDrivers((prev) =>
      prev.map((driver) => {
        if (driver.id !== driverId) {
          return driver;
        }
        const nextPitComplete = !driver.pitComplete;
        updatedDriver = {
          ...driver,
          pitComplete: nextPitComplete,
          pits: driver.pitComplete ? driver.pits : driver.pits + 1,
        };
        return updatedDriver;
      }),
    );
    if (updatedDriver) {
      void logAction(
        `Pit stop ${updatedDriver.pitComplete ? 'completed' : 'cleared'} for #${
          updatedDriver.number
        }`,
        getMarshalName(updatedDriver.marshalId),
      );
      void persistDriverState(updatedDriver);
    }
  };

  const invalidateLastLap = useCallback(
    (driverId) => {
      let updatedDriver = null;
      let removedLapNumber = null;
      const now = Date.now();
      const raceElapsed =
        raceStartRef.current !== null
          ? now - raceStartRef.current - pausedDurationRef.current
          : null;
      setDrivers((prev) =>
        prev.map((driver) => {
          if (driver.id !== driverId) {
            return driver;
          }
          if (!driver.lapTimes.length) {
            return driver;
          }
          const lapTimes = driver.lapTimes.slice(0, -1);
          const lapHistory = driver.lapHistory.slice(0, -1);
          removedLapNumber =
            driver.lapHistory[driver.lapHistory.length - 1]?.lapNumber ??
            driver.lapTimes.length;
          const laps = Math.max(0, driver.laps - 1);
          const lastLap = lapTimes.length ? lapTimes[lapTimes.length - 1] : null;
          const bestLap = lapTimes.length ? Math.min(...lapTimes) : null;
          const totalTime = lapTimes.reduce((sum, time) => sum + time, 0);
          const resumedLapStart = raceElapsed ?? totalTime;
          updatedDriver = {
            ...driver,
            lapTimes,
            lapHistory,
            laps,
            lastLap,
            bestLap,
            totalTime,
            hasInvalidToResolve: true,
            currentLapStart: resumedLapStart,
          };
          return updatedDriver;
        }),
      );
      if (!updatedDriver) {
        return;
      }
      const marshalName = getMarshalName(updatedDriver.marshalId);
      void logAction(
        `Lap invalidated for #${updatedDriver.number}`,
        marshalName,
      );
      void persistDriverState(updatedDriver);
      if (supabaseReady && removedLapNumber !== null) {
        supabaseClient
          .from('laps')
          .delete()
          .eq('driver_id', updatedDriver.id)
          .eq('lap_number', removedLapNumber)
          .then(() => setSupabaseError(null))
          .catch((error) => {
            console.error('Failed to invalidate lap in Supabase', error);
            setSupabaseError('Unable to remove lap from Supabase.');
          });
      }
    },
    [
      getMarshalName,
      logAction,
      persistDriverState,
      supabaseClient,
      supabaseReady,
      setSupabaseError,
    ],
  );

  const startLapAfterInvalid = useCallback(
    (driverId) => {
      let updatedDriver = null;
      const now = Date.now();
      const raceElapsed =
        raceStartRef.current !== null
          ? now - raceStartRef.current - pausedDurationRef.current
          : null;
      setDrivers((prev) =>
        prev.map((driver) => {
          if (driver.id !== driverId) {
            return driver;
          }
          if (!driver.hasInvalidToResolve) {
            return driver;
          }
          const nextLapStart =
            raceElapsed ?? driver.currentLapStart ?? driver.totalTime ?? 0;
          updatedDriver = {
            ...driver,
            hasInvalidToResolve: false,
            currentLapStart: nextLapStart,
          };
          return updatedDriver;
        }),
      );
      if (!updatedDriver) {
        return;
      }
      const marshalName = getMarshalName(updatedDriver.marshalId);
      void logAction(
        `Lap restarted for #${updatedDriver.number} after invalidation`,
        marshalName,
      );
      void persistDriverState(updatedDriver);
    },
    [getMarshalName, logAction, persistDriverState],
  );

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key?.toLowerCase?.();
      const driverIndex = HOTKEYS.indexOf(key);
      if (driverIndex === -1) {
        return;
      }
      const driver = drivers[driverIndex];
      if (!driver) {
        return;
      }
      event.preventDefault();
      if (event.altKey) {
        invalidateLastLap(driver.id);
        return;
      }
      if (event.shiftKey) {
        togglePitStop(driver.id);
        return;
      }
      if (driver.hasInvalidToResolve) {
        startLapAfterInvalid(driver.id);
        return;
      }
      logLap(driver.id, { source: 'hotkey' });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [drivers, invalidateLastLap, logLap, startLapAfterInvalid, togglePitStop]);

  const setDriverFlag = (driverId, driverFlag) => {
    let flaggedDriver = null;
    setDrivers((prev) =>
      prev.map((driver) => {
        if (driver.id !== driverId) {
          return driver;
        }
        flaggedDriver = { ...driver, driverFlag };
        return flaggedDriver;
      }),
    );
    if (flaggedDriver) {
      void logAction(
        `Driver alert set to ${driverFlag.toUpperCase()} for #${flaggedDriver.number}`,
        getMarshalName(flaggedDriver.marshalId),
      );
      void persistDriverState(flaggedDriver);
    }
  };

  const pushAnnouncement = () => {
    const trimmed = announcementDraft.trim();
    setAnnouncement(trimmed);
    updateSessionState({ announcement: trimmed });
    if (trimmed) {
      void logAction(`Announcement: ${trimmed}`);
    } else {
      void logAction('Announcements cleared');
    }
  };

  const driverTiming = useMemo(() => {
    const metric = (driver) => {
      if (eventConfig.eventType === 'Race') {
        return {
          key: driver.laps,
          secondary: driver.totalTime,
        };
      }
      const best = driver.bestLap ?? Number.POSITIVE_INFINITY;
      return { key: -best, secondary: best };
    };

    const sorted = [...drivers]
      .map((driver) => ({ driver, metric: metric(driver) }))
      .sort((a, b) => {
        if (eventConfig.eventType === 'Race') {
          if (a.metric.key !== b.metric.key) {
            return b.metric.key - a.metric.key;
          }
          return a.metric.secondary - b.metric.secondary;
        }
        if (a.metric.key !== b.metric.key) {
          return b.metric.key - a.metric.key;
        }
        return a.metric.secondary - b.metric.secondary;
      })
      .map((item, index, array) => {
        const { driver } = item;
        let gap = '--';
        let interval = '--';
        if (index > 0) {
          if (eventConfig.eventType === 'Race') {
            const leader = array[0].driver;
            const leaderLaps = leader.laps;
            const leaderTotal = leader.totalTime;
            const driverTotal = driver.totalTime;
            const lapDiff = leaderLaps - driver.laps;
            if (lapDiff === 0) {
              gap = `+${formatLapTime(driverTotal - leaderTotal)}`;
            } else {
              gap = `-${lapDiff}L`;
            }
            const ahead = array[index - 1].driver;
            const aheadTotal = ahead.totalTime;
            const aheadLapDiff = ahead.laps - driver.laps;
            if (aheadLapDiff === 0) {
              interval = `+${formatLapTime(driverTotal - aheadTotal)}`;
            } else {
              interval = `-${aheadLapDiff}L`;
            }
          } else {
            const leaderBest = array[0].driver.bestLap;
            const driverBest = driver.bestLap;
            const aheadBest = array[index - 1].driver.bestLap;
            if (leaderBest && driverBest) {
              gap = `+${formatLapTime(driverBest - leaderBest)}`;
            }
            if (aheadBest && driverBest) {
              interval = `+${formatLapTime(driverBest - aheadBest)}`;
            }
          }
        }
        return {
          ...driver,
          position: index + 1,
          gap,
          interval,
        };
      });

    return sorted;
  }, [drivers, eventConfig.eventType]);

  const openSetup = () => {
    const marshalOptions = supabaseReady
      ? marshalProfiles.map((marshal) => ({
          id: marshal.id,
          name: marshal.display_name ?? marshal.name ?? marshal.id.slice(0, 8),
        }))
      : eventConfig.marshals.map((marshal) => ({ ...marshal }));
    const normalizedMarshals = marshalOptions.length
      ? [{ id: '', name: 'Unassigned' }, ...marshalOptions]
      : [{ id: '', name: 'Unassigned' }];
    setSetupDraft({
      eventType: eventConfig.eventType,
      totalLaps: eventConfig.totalLaps,
      totalDuration: eventConfig.totalDuration,
      marshals: normalizedMarshals,
      drivers: drivers.map(({ id, number, name, team, marshalId }) => ({
        id,
        number,
        name,
        team,
        marshalId: marshalId ?? normalizedMarshals[0]?.id ?? '',
      })),
    });
    setShowSetup(true);
  };

  const updateSetupDriver = (driverId, key, value) => {
    setSetupDraft((prev) => ({
      ...prev,
      drivers: prev.drivers.map((driver) =>
        driver.id === driverId ? { ...driver, [key]: value } : driver,
      ),
    }));
  };

  const addSetupDriver = () => {
    setSetupDraft((prev) => ({
      ...prev,
      drivers: [
        ...prev.drivers,
        {
          id: createUuid(),
          number: prev.drivers.length + 1,
          name: 'New Driver',
          team: 'New Team',
          marshalId: prev.marshals[0]?.id ?? '',
        },
      ],
    }));
  };

  const removeSetupDriver = (driverId) => {
    setSetupDraft((prev) => ({
      ...prev,
      drivers: prev.drivers.filter((driver) => driver.id !== driverId),
    }));
  };

  const addMarshal = () => {
    if (supabaseReady) {
      return;
    }
    setSetupDraft((prev) => ({
      ...prev,
      marshals: [
        ...prev.marshals,
        { id: `m${Date.now()}`, name: `Marshal ${prev.marshals.length + 1}` },
      ],
    }));
  };

  const updateMarshal = (marshalId, name) => {
    if (supabaseReady) {
      return;
    }
    setSetupDraft((prev) => ({
      ...prev,
      marshals: prev.marshals.map((marshal) =>
        marshal.id === marshalId ? { ...marshal, name } : marshal,
      ),
    }));
  };

  const saveSetup = () => {
    if (procedurePhase !== 'setup') {
      const confirmed = window.confirm(
        'Updating the configuration will reset the current session. Continue?',
      );
      if (!confirmed) {
        return;
      }
    }
    const nextEventType = setupDraft.eventType;
    const nextTotalLaps = Number.parseInt(setupDraft.totalLaps, 10) || 0;
    const nextTotalDuration = Number.parseInt(setupDraft.totalDuration, 10) || 0;
    setEventConfig(({ marshals: _oldMarshals, ...rest }) => ({
      ...rest,
      eventType: nextEventType,
      totalLaps: nextTotalLaps,
      totalDuration: nextTotalDuration,
      marshals: setupDraft.marshals,
    }));
    const normalizedDrivers = setupDraft.drivers.map((driver) => toDriverState(driver));
    setDrivers(normalizedDrivers);
    setBestLapDrafts({});
    setProcedurePhase('setup');
    setIsTiming(false);
    setIsPaused(false);
    setTrackStatus('green');
    setRaceTime(0);
    setAnnouncement('');
    setAnnouncementDraft('');
    setLogs([]);
    setShowSetup(false);
    updateSessionState({
      event_type: nextEventType,
      total_laps: nextTotalLaps,
      total_duration: nextTotalDuration,
      procedure_phase: 'setup',
      flag_status: 'green',
      track_status: 'green',
      is_timing: false,
      is_paused: false,
      race_time_ms: 0,
      announcement: '',
    });
    void logAction('Session configuration updated');
    if (supabaseReady) {
      supabaseClient
        .from('drivers')
        .upsert(normalizedDrivers.map((driver) => toDriverRow(driver)))
        .then(() => setSupabaseError(null))
        .catch((error) => {
          console.error('Failed to persist driver setup', error);
          setSupabaseError('Unable to persist driver setup to Supabase.');
        });
      normalizedDrivers.forEach((driver) => {
        supabaseClient
          .from('laps')
          .delete()
          .eq('driver_id', driver.id)
          .catch((error) => {
            console.error('Failed to clear laps for driver', driver.id, error);
          });
      });
    }
  };

  const exportResults = () => {
    const header = 'Position,Number,Driver,Team,Laps,Best Lap,Last Lap,Total Time,Status\n';
    const rows = driverTiming
      .map((driver) => {
        const total = driver.totalTime ?? 0;
        return [
          driver.position,
          driver.number,
          driver.name,
          driver.team,
          driver.laps,
          formatLapTime(driver.bestLap),
          formatLapTime(driver.lastLap),
          formatLapTime(total),
          driver.status.toUpperCase(),
        ].join(',');
      })
      .join('\n');
    const csv = `${header}${rows}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-results-${new Date().toISOString()}.csv`;
    a.click();
    logAction('Results exported to CSV');
  };

  const trackStatusDetails =
    TRACK_STATUS_MAP[trackStatus] ??
    {
      id: trackStatus,
      label: trackStatus ? trackStatus.toUpperCase() : 'Unknown',
      shortLabel: trackStatus ? trackStatus.toUpperCase() : 'N/A',
      description: 'Current track status is not recognised by this interface.',
      bannerClass:
        'border border-neutral-800 bg-neutral-900/70 text-neutral-200 shadow-[0_0_40px_rgba(148,163,184,0.2)]',
      controlClass: 'bg-neutral-700',
      icon: 'flag',
    };
  const trackStatusIconMap = {
    flag: Flag,
    alert: AlertTriangle,
    gauge: Gauge,
    car: Car,
    stop: StopCircle,
  };
  const TrackStatusIcon =
    trackStatusIconMap[trackStatusDetails?.icon ?? 'flag'] ?? trackStatusIconMap.flag;

  return (
    <AuthGate>
      <div className="min-h-screen bg-[#0B0F19] text-white">
        <header className="sticky top-0 z-30 border-b border-neutral-800 bg-[#0B0F19]/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold text-[#9FF7D3]">DayBreak Grand Prix</h1>
            <p className="text-[11px] uppercase tracking-[0.35em] text-neutral-500">
              Timing Control Panel
            </p>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            <div className="flex items-center gap-2 text-[#9FF7D3]">
              <Clock className="h-5 w-5" />
              <span className="font-mono text-2xl">{formatRaceClock(raceTime)}</span>
            </div>
            <span className="text-[11px] uppercase tracking-[0.3em] text-neutral-400">
              {procedurePhase.replace('-', ' ')}
              {isPaused ? ' • paused' : ''}
            </span>
          </div>
          <div className="flex items-center justify-end gap-3">
            <div className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900/70 px-3 py-1.5 text-[11px] uppercase tracking-wide text-neutral-300">
              <Flag className="h-4 w-4 text-[#9FF7D3]" />
              <span>{trackStatusDetails?.label ?? trackStatus}</span>
            </div>
            <button
              onClick={openSetup}
              disabled={!isAdmin && supabaseReady}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/80 text-neutral-300 transition hover:border-[#9FF7D3] hover:text-[#9FF7D3] disabled:cursor-not-allowed disabled:opacity-40"
              title={supabaseReady && !isAdmin ? 'Only admins can modify session configuration' : 'Configure session'}
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {isInitialising && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 px-4 py-3 text-sm text-neutral-300">
            {isSupabaseConfigured
              ? 'Synchronising with Supabase…'
              : 'Supabase environment variables are not configured. Running in local-only mode.'}
          </div>
        )}
        {!isSupabaseConfigured && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable persistence and realtime updates.
          </div>
        )}
        {supabaseError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200">
            {supabaseError}
          </div>
        )}
        <section className="grid gap-4 lg:grid-cols-[2fr_3fr]">
          <div className="rounded-2xl border border-neutral-800 bg-[#11182c]/80 p-4 shadow-[0_18px_48px_-30px_rgba(159,247,211,0.25)]">
            <div className={`flex items-start gap-4 rounded-xl p-4 ${trackStatusDetails.bannerClass}`}>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-950/50">
                <TrackStatusIcon className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.35em] text-neutral-300">Track Status</p>
                <h3 className="text-lg font-semibold text-white">{trackStatusDetails.label}</h3>
                <p className="max-w-sm text-sm text-neutral-200/80">
                  {trackStatusDetails.description}
                </p>
              </div>
            </div>
            <p className="mt-4 text-[11px] uppercase tracking-[0.25em] text-neutral-500">
              Track status is controlled from the Race Control panel below.
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-800 bg-[#11182c]/80 p-4 shadow-[0_18px_48px_-30px_rgba(124,107,255,0.25)]">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-[#9FF7D3]/20 p-2 text-[#9FF7D3]">
                <Megaphone className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.35em] text-neutral-400">Live Announcements</p>
                <p className="whitespace-pre-line text-sm text-neutral-100">
                  {announcement ? announcement : 'No active announcements.'}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={announcementDraft}
                onChange={(event) => setAnnouncementDraft(event.target.value)}
                placeholder="Enter live message…"
                className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900/70 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#9FF7D3]"
              />
              <button
                onClick={pushAnnouncement}
                className="flex items-center justify-center rounded-lg border border-[#9FF7D3]/40 bg-[#9FF7D3]/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#9FF7D3] transition hover:border-[#9FF7D3]"
              >
                Update
              </button>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-neutral-800 bg-[#11182c]/80 p-4 shadow-[0_18px_48px_-30px_rgba(124,107,255,0.45)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-neutral-400">
              <span className="font-semibold text-[#9FF7D3]">{eventConfig.eventType}</span>
              <span className="mx-2 text-neutral-600">•</span>
              <span>{eventConfig.totalLaps} laps target</span>
              <span className="mx-2 text-neutral-600">•</span>
              <span>{eventConfig.totalDuration} min duration</span>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {procedurePhase === 'setup' && (
                <button
                  onClick={startWarmup}
                  className="h-9 rounded-lg border border-neutral-700 bg-[#1a2238] px-3 font-semibold uppercase tracking-wide text-neutral-200 transition hover:border-[#9FF7D3]"
                >
                  Warm Up
                </button>
              )}
              {procedurePhase === 'warmup' && (
                <button
                  onClick={callFinalCall}
                  className="h-9 rounded-lg border border-amber-400/40 bg-amber-500/20 px-3 font-semibold uppercase tracking-wide text-amber-200 transition hover:border-amber-200"
                >
                  Final Call
                </button>
              )}
              {procedurePhase === 'final-call' && (
                <span className="flex h-9 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 font-semibold uppercase tracking-wide text-neutral-300">
                  Grid Ready
                </span>
              )}
              {procedurePhase === 'countdown' && (
                <span className="flex h-9 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 font-semibold uppercase tracking-wide text-neutral-300">
                  Starting in {countdown}s
                </span>
              )}
              {procedurePhase === 'green' && (
                <button
                  onClick={finishSession}
                  className="h-9 rounded-lg border border-[#9FF7D3]/50 bg-[#9FF7D3]/20 px-3 font-semibold uppercase tracking-wide text-[#9FF7D3] transition hover:border-[#9FF7D3]"
                >
                  Complete Session
                </button>
              )}
              {procedurePhase === 'complete' && (
                <span className="flex h-9 items-center justify-center rounded-lg border border-green-400/60 bg-green-500/20 px-3 font-semibold uppercase tracking-wide text-green-200">
                  Completed
                </span>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            <button
              onClick={initiateCountdown}
              disabled={procedurePhase !== 'final-call'}
              className="h-10 rounded-lg border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-3 text-xs font-semibold uppercase tracking-wide text-[#9FF7D3] transition hover:border-[#9FF7D3] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start Timer
            </button>
            <button
              onClick={confirmPause}
              disabled={!isTiming || isPaused}
              className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:border-[#9FF7D3] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Pause Timer
            </button>
            <button
              onClick={resumeTiming}
              disabled={!isPaused}
              className="h-10 rounded-lg border border-[#7C6BFF]/50 bg-[#7C6BFF]/20 px-3 text-xs font-semibold uppercase tracking-wide text-[#beb4ff] transition hover:border-[#9FF7D3] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Resume Timer
            </button>
            <button
              onClick={finishSession}
              disabled={procedurePhase !== 'green'}
              className="h-10 rounded-lg border border-green-400/40 bg-green-500/20 px-3 text-xs font-semibold uppercase tracking-wide text-green-200 transition hover:border-green-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset Timer
            </button>
            <button
              onClick={exportResults}
              className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:border-[#9FF7D3]"
            >
              Export CSV
            </button>
            <button
              onClick={openSetup}
              className="h-10 rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-200 transition hover:border-[#9FF7D3]"
            >
              Session Setup
            </button>
            {TRACK_STATUS_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => handleTrackStatusChange(option.id)}
                className={`h-10 rounded-lg text-xs font-semibold uppercase tracking-wide transition ${option.controlClass} ${
                  trackStatus === option.id ? 'ring-2 ring-offset-2 ring-offset-[#0B0F19]' : ''
                }`}
              >
                {option.label}
              </button>
            ))}
            {procedurePhase === 'suspended' && (
              <button
                onClick={() => handleTrackStatusChange('green-check', { fromResume: true })}
                className="h-10 rounded-lg text-xs font-semibold uppercase tracking-wide transition bg-cyan-500 text-black hover:bg-cyan-400"
              >
                Resume
              </button>
            )}
          </div>
          <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-neutral-500">
            Keyboard hotkeys 1-0 log laps, Shift toggles pit, and Alt invalidates the last lap.
          </p>
        </section>
        <div className="grid gap-6 lg:grid-cols-[3fr_1.15fr]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-neutral-800 bg-[#11182c]/80 p-4 shadow-[0_18px_48px_-30px_rgba(159,247,211,0.35)]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-neutral-400">
                  Driver Capture
                </h2>
                <span className="text-xs text-neutral-500">
                  Click or use hotkeys to log laps instantly.
                </span>
              </div>
              {drivers.length === 0 ? (
                <div className="rounded-2xl border border-white/5 bg-[#0b1022]/80 p-6 text-center text-sm text-white/60">
                  No drivers configured. Add drivers in setup to begin timing.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {drivers.map((driver, index) => {
                    const canLogLap =
                      isTiming &&
                      !isPaused &&
                      driver.status === 'ontrack' &&
                      !driver.hasInvalidToResolve;
                    const cardHotkey = HOTKEYS[index] ?? null;
                    const isFlashing = recentLapDriverId === driver.id;
                    const marshalName = getMarshalName(driver.marshalId);
                    const pitMarked = driver.pitComplete;
                    const statusClass =
                      driver.status === 'ontrack'
                        ? 'bg-[#9FF7D3]/15 text-[#9FF7D3]'
                        : driver.status === 'retired'
                          ? 'bg-red-500/20 text-red-300'
                          : driver.status === 'finished'
                            ? 'bg-green-500/20 text-green-200'
                            : 'bg-neutral-800 text-neutral-400';
                    const driverFlagLabel =
                      driver.driverFlag === 'none'
                        ? null
                        :
                            DRIVER_FLAG_OPTIONS.find((option) => option.id === driver.driverFlag)
                              ?.label ?? driver.driverFlag;
                    const lapsDisplay = eventConfig.totalLaps
                      ? `${driver.laps}/${eventConfig.totalLaps}`
                      : `${driver.laps}`;
                    const bestLapDraft = bestLapDrafts[driver.id] ?? '';
                    return (
                      <div
                        key={driver.id}
                        className={`flex h-full flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-950/80 p-3 text-left shadow-sm transition hover:border-[#9FF7D3] hover:shadow-md ${
                          driver.status === 'retired'
                            ? 'opacity-60'
                            : driver.status === 'finished'
                              ? 'border-green-400/60'
                              : ''
                        } ${driver.hasInvalidToResolve ? 'border-amber-400/60' : ''} ${
                          pitMarked ? 'ring-1 ring-amber-400/60' : ''
                        } ${isFlashing ? 'ring-2 ring-[#9FF7D3]/70' : ''}`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-[#9FF7D3]">
                                #{driver.number} {driver.name}
                              </div>
                              <div className="text-[11px] text-neutral-400">{driver.team}</div>
                              <div className="text-[10px] text-neutral-500">Marshal: {marshalName}</div>
                              {pitMarked && (
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                                  Pit Stop Complete
                                </div>
                              )}
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusClass}`}>
                              {driver.status}
                            </span>
                          </div>
                          {driverFlagLabel && (
                            <span className="inline-flex rounded-full border border-amber-200/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                              {driverFlagLabel}
                            </span>
                          )}
                          <div className="flex items-center justify-between text-[11px] text-neutral-400">
                            <span>
                              Laps: <span className="font-semibold text-neutral-100">{lapsDisplay}</span>
                            </span>
                            <span>
                              Best:{' '}
                              <span className="font-mono text-[#9FF7D3]">
                                {formatLapTime(driver.bestLap)}
                              </span>
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-neutral-400">
                            <span>
                              Last:{' '}
                              <span className="font-mono text-neutral-100">
                                {formatLapTime(driver.lastLap)}
                              </span>
                            </span>
                            <span>Pits: {driver.pits}</span>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2">
                          <button
                            onClick={() => void logLap(driver.id)}
                            disabled={!canLogLap}
                            className={`w-full rounded-md py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                              canLogLap
                                ? 'bg-[#9FF7D3] text-black hover:bg-[#7eeac3]'
                                : 'bg-neutral-800 text-neutral-500 disabled:cursor-not-allowed'
                            } ${isFlashing ? 'animate-pulse' : ''}`}
                          >
                            Log Lap{cardHotkey ? ` (${cardHotkey})` : ''}
                          </button>
                          <div className="grid grid-cols-2 gap-1">
                            <button
                              onClick={() => void togglePitStop(driver.id)}
                              className={`h-8 rounded-md text-[10px] font-semibold uppercase tracking-wide transition ${
                                pitMarked
                                  ? 'border border-amber-300/60 bg-amber-400/20 text-amber-200'
                                  : 'border border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-[#9FF7D3]'
                              }`}
                            >
                              {pitMarked ? 'Clear Pit' : 'Mark Pit'}
                            </button>
                            <button
                              onClick={() => retireDriver(driver.id)}
                              disabled={driver.status === 'retired'}
                              className="h-8 rounded-md border border-red-500/60 bg-red-500/15 text-[10px] font-semibold uppercase tracking-wide text-red-200 transition hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Retire
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            <button
                              onClick={() => void invalidateLastLap(driver.id)}
                              disabled={driver.laps === 0}
                              className="flex h-8 items-center justify-center gap-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-200 transition hover:border-[#9FF7D3] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Invalidate
                            </button>
                            <button
                              onClick={() => void startLapAfterInvalid(driver.id)}
                              disabled={!driver.hasInvalidToResolve}
                              className="h-8 rounded-md border border-amber-300/60 bg-amber-400/10 text-[10px] font-semibold uppercase tracking-wide text-amber-200 transition hover:border-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Start Lap
                            </button>
                          </div>
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={bestLapDraft}
                              onChange={(event) =>
                                setBestLapDrafts((prev) => ({
                                  ...prev,
                                  [driver.id]: event.target.value,
                                }))
                              }
                              placeholder="Best lap mm:ss.mmm"
                              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-200 placeholder:text-neutral-500 focus:border-[#7C6BFF] focus:outline-none focus:ring-1 focus:ring-[#7C6BFF]"
                            />
                            <button
                              onClick={() => {
                                const parsed = parseManualLap(bestLapDraft);
                                if (parsed === null || parsed <= 0) {
                                  window.alert('Enter best lap as mm:ss.mmm');
                                  return;
                                }
                                void overrideBestLap(driver.id, parsed);
                                setBestLapDrafts((prev) => ({
                                  ...prev,
                                  [driver.id]: '',
                                }));
                              }}
                              className="h-8 rounded-md border border-[#7C6BFF]/60 bg-[#7C6BFF]/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-[#b7b0ff] transition hover:border-[#9b92ff]"
                            >
                              Set Best
                            </button>
                          </div>
                          <select
                            value={driver.driverFlag}
                            onChange={(event) => setDriverFlag(driver.id, event.target.value)}
                            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-300 focus:border-[#7C6BFF] focus:outline-none focus:ring-1 focus:ring-[#7C6BFF]"
                          >
                            {DRIVER_FLAG_OPTIONS.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          {driver.hasInvalidToResolve && (
                            <div className="flex items-center gap-2 rounded-md border border-amber-300/60 bg-amber-400/10 p-2 text-[10px] text-amber-100">
                              <TimerReset className="h-3.5 w-3.5" />
                              <span>Invalidated. Next crossing = START ONLY.</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            <section className="rounded-2xl border border-neutral-800 bg-[#11182c]/70 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-neutral-400">
                  Live Timing
                </h2>
                <ListChecks className="h-4 w-4 text-neutral-500" />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full table-fixed border-separate border-spacing-y-1 text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-[0.25em] text-neutral-500">
                    <tr>
                      <th className="px-2 py-1">Pos</th>
                      <th className="px-2 py-1">No.</th>
                      <th className="px-2 py-1">Driver</th>
                      <th className="px-2 py-1">Laps</th>
                      <th className="px-2 py-1">Best</th>
                      <th className="px-2 py-1">Last</th>
                      <th className="px-2 py-1">Gap</th>
                      <th className="px-2 py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverTiming.map((driver) => {
                      const total = driver.lapTimes.reduce((sum, time) => sum + time, 0);
                      return (
                        <tr
                          key={driver.id}
                          className="rounded-lg border border-neutral-800 bg-neutral-900/60 text-[11px] text-neutral-200"
                        >
                          <td className="px-2 py-2 font-semibold text-[#9FF7D3]">{driver.position}</td>
                          <td className="px-2 py-2 text-neutral-400">{driver.number}</td>
                          <td className="px-2 py-2">
                            <div className="font-semibold text-neutral-100">{driver.name}</div>
                            <div className="text-[10px] text-neutral-500">
                              {getMarshalName(driver.marshalId)}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center font-semibold">{driver.laps}</td>
                          <td className="px-2 py-2 font-mono text-[#9FF7D3]">
                            {formatLapTime(driver.bestLap)}
                          </td>
                          <td className="px-2 py-2 font-mono text-neutral-200">
                            {formatLapTime(driver.lastLap)}
                          </td>
                          <td className="px-2 py-2 text-neutral-300">{driver.gap}</td>
                          <td className="px-2 py-2">
                            <div className="capitalize text-neutral-200">{driver.status}</div>
                            <div className="text-[10px] text-neutral-500">
                              {formatLapTime(total)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <aside className="space-y-6">
            <section className="rounded-2xl border border-neutral-800 bg-[#11182c]/80 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-neutral-400">
                  Marshal Assignments
                </h3>
                <Users className="h-4 w-4 text-neutral-500" />
              </div>
              <ul className="mt-3 space-y-2 text-xs text-neutral-300">
                {eventConfig.marshals.map((marshal) => {
                  const assignedDrivers = drivers.filter((driver) => driver.marshalId === marshal.id);
                  return (
                    <li
                      key={marshal.id}
                      className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-500">
                        <span>{marshal.name}</span>
                        <span>{assignedDrivers.length} Drivers</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-neutral-300">
                        {assignedDrivers.map((driver) => (
                          <span
                            key={driver.id}
                            className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5"
                          >
                            #{driver.number} {driver.name}
                          </span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="rounded-2xl border border-neutral-800 bg-[#11182c]/80 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-neutral-400">
                  Control Log
                </h3>
                <ShieldAlert className="h-4 w-4 text-neutral-500" />
              </div>
              <ul className="mt-3 space-y-2 text-[11px] text-neutral-200">
                {logs.length === 0 && (
                  <li className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-neutral-500">
                    No race control actions recorded yet.
                  </li>
                )}
                {logs.map((log) => (
                  <li
                    key={log.id}
                    className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-3 shadow-sm"
                  >
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-500">
                      <span>{log.marshalId}</span>
                      <span>{log.timestamp.toLocaleTimeString()}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-100">{log.action}</p>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </main>
      {showSetup && setupDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-gray-800 p-6">
            <div className="flex items-center justify-between border-b border-gray-700 pb-4">
              <div>
                <h2 className="text-2xl font-bold">Session Configuration</h2>
                <p className="text-sm text-gray-400">
                  Define event type, total laps, and marshal driver assignments.
                </p>
              </div>
              <button
                onClick={() => setShowSetup(false)}
                className="rounded bg-gray-800 p-2 hover:bg-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-6 space-y-6">
              <section className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Event Type
                  </label>
                  <select
                    value={setupDraft.eventType}
                    onChange={(event) =>
                      setSetupDraft((prev) => ({
                        ...prev,
                        eventType: event.target.value,
                      }))
                    }
                    className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
                  >
                    {EVENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Target Laps
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={setupDraft.totalLaps}
                    onChange={(event) =>
                      setSetupDraft((prev) => ({
                        ...prev,
                        totalLaps: event.target.value,
                      }))
                    }
                    className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Session Duration (mins)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={setupDraft.totalDuration}
                    onChange={(event) =>
                      setSetupDraft((prev) => ({
                        ...prev,
                        totalDuration: event.target.value,
                      }))
                    }
                    className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
                  />
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                    Marshals
                  </h3>
                  <button
                    onClick={addMarshal}
                    disabled={supabaseReady}
                    className="flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-xs uppercase tracking-wide hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Users className="w-4 h-4" /> Add Marshal
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {setupDraft.marshals.map((marshal) => (
                    <div key={marshal.id} className="rounded border border-gray-700 p-3">
                      <label className="text-xs uppercase tracking-wide text-gray-400">
                        Marshal Name
                      </label>
                      <input
                        type="text"
                        value={marshal.name}
                        onChange={(event) => updateMarshal(marshal.id, event.target.value)}
                        disabled={supabaseReady && marshal.id !== ''}
                        className="mt-2 w-full rounded bg-gray-800 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>
                  ))}
                  {supabaseReady && (
                    <p className="text-xs text-gray-400">
                      Manage marshal identities and roles within Supabase. Assign drivers to the appropriate marshal
                      account using the selector below.
                    </p>
                  )}
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                    Drivers
                  </h3>
                  <button
                    onClick={addSetupDriver}
                    className="flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-xs uppercase tracking-wide hover:bg-gray-700"
                  >
                    <Play className="w-4 h-4" /> Add Driver
                  </button>
                </div>
                <div className="space-y-3">
                  {setupDraft.drivers.map((driver) => (
                    <div
                      key={driver.id}
                      className="grid gap-3 rounded border border-gray-700 p-3 md:grid-cols-5"
                    >
                      <div className="space-y-1">
                        <label className="text-xs uppercase tracking-wide text-gray-500">
                          Number
                        </label>
                        <input
                          type="number"
                          value={driver.number}
                          onChange={(event) =>
                            updateSetupDriver(driver.id, 'number', Number(event.target.value))
                          }
                          className="w-full rounded bg-gray-800 px-2 py-1 text-sm"
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs uppercase tracking-wide text-gray-500">
                          Driver Name
                        </label>
                        <input
                          type="text"
                          value={driver.name}
                          onChange={(event) =>
                            updateSetupDriver(driver.id, 'name', event.target.value)
                          }
                          className="w-full rounded bg-gray-800 px-2 py-1 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs uppercase tracking-wide text-gray-500">
                          Team
                        </label>
                        <input
                          type="text"
                          value={driver.team}
                          onChange={(event) =>
                            updateSetupDriver(driver.id, 'team', event.target.value)
                          }
                          className="w-full rounded bg-gray-800 px-2 py-1 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs uppercase tracking-wide text-gray-500">
                          Marshal
                        </label>
                        <select
                          value={driver.marshalId}
                          onChange={(event) =>
                            updateSetupDriver(driver.id, 'marshalId', event.target.value)
                          }
                          className="w-full rounded bg-gray-800 px-2 py-1 text-sm"
                        >
                          {setupDraft.marshals.map((marshal) => (
                            <option key={marshal.id} value={marshal.id}>
                              {marshal.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-5">
                        <button
                          onClick={() => removeSetupDriver(driver.id)}
                          className="mt-2 w-full rounded bg-red-600 py-1 text-xs uppercase tracking-wide hover:bg-red-700"
                        >
                          Remove Driver
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="mt-6 flex flex-col gap-3 border-t border-gray-700 pt-4 md:flex-row md:justify-end">
              <button
                onClick={() => setShowSetup(false)}
                className="rounded bg-gray-800 px-4 py-2 text-sm hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={saveSetup}
                className="flex items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-700"
              >
                <Save className="w-4 h-4" /> Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </AuthGate>
  );
};

export default TimingPanel;
