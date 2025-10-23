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
  Save,
  Settings,
  ShieldAlert,
  StopCircle,
  Users,
  X,
} from 'lucide-react';
import { formatLapTime, formatRaceClock } from '../utils/time';
import { TRACK_STATUS_MAP, TRACK_STATUS_OPTIONS } from '../constants/trackStatus';
import {
  isSupabaseConfigured,
  subscribeToTable,
  supabaseDelete,
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from '../lib/supabaseClient';
import DriverGrid from './timing/DriverGrid';
import {
  DEFAULT_SESSION_STATE,
  SESSION_ROW_ID,
  SESSION_UUID,
  createClientId,
  createUuid,
  supabaseUpsert,
} from '../lib/supabaseClient';
import {
  DEFAULT_SESSION_STATE,
  SESSION_ROW_ID,
  createClientId,
  groupLapRows,
  hydrateDriverState,
  sessionRowToState,
  toDriverRow,
} from '../utils/raceData';

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

const FLAG_OPTIONS = [
  { id: 'green', label: 'Green', color: 'bg-green-600 hover:bg-green-500' },
  {
    id: 'yellow',
    label: 'Yellow',
    color: 'bg-yellow-500 text-black hover:bg-yellow-400',
  },
  { id: 'sc', label: 'SC', color: 'bg-amber-500 text-black hover:bg-amber-400' },
  { id: 'vsc', label: 'VSC', color: 'bg-emerald-600 hover:bg-emerald-500' },
  { id: 'red', label: 'Red', color: 'bg-red-600 hover:bg-red-500' },
  { id: 'checkered', label: 'Checkered', color: 'bg-violet-600 hover:bg-violet-500' },
  { id: 'green-check', label: 'Resume', color: 'bg-cyan-500 text-black hover:bg-cyan-400' },
];

const FLAG_SELECT_OPTIONS = [
  { id: 'green', label: 'Green' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'sc', label: 'SC' },
  { id: 'vsc', label: 'VSC' },
  { id: 'red', label: 'Red' },
  { id: 'checkered', label: 'Checkered' },
];

const DRIVER_FLAG_OPTIONS = [
  { id: 'none', label: 'No Flag' },
  { id: 'blue', label: 'Blue Flag' },
  { id: 'blackwhite', label: 'Black & White' },
];

const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const LOG_LIMIT = 200;

const toDriverState = (driver) => ({
  ...driver,
  laps: driver.laps ?? 0,
  lapTimes: driver.lapTimes ?? [],
  lapHistory: driver.lapHistory ?? [],
  lastLap: driver.lastLap ?? null,
  bestLap: driver.bestLap ?? null,
  totalTime: driver.totalTime ?? 0,
  pits: driver.pits ?? 0,
  status: driver.status ?? 'ready',
  currentLapStart: driver.currentLapStart ?? null,
  driverFlag: driver.driverFlag ?? 'none',
  pitComplete: driver.pitComplete ?? false,
  isInPit: driver.isInPit ?? false,
  hasInvalidToResolve: driver.hasInvalidToResolve ?? false,
  currentLapNumber: driver.currentLapNumber ?? 1,
});

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
  const [flagStatus, setFlagStatus] = useState(DEFAULT_SESSION_STATE.flagStatus);
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

  const applyDriverData = useCallback((driverRows = [], lapRows = []) => {
    if (!driverRows.length) {
      return;
    }
    const lapMap = groupLapRows(lapRows);
    setDrivers(driverRows.map((row) => hydrateDriverState(row, lapMap)));
  }, []);

  const refreshDriversFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const [driverRowsRaw, lapRowsRaw] = await Promise.all([
      const [driverRows, lapRows] = await Promise.all([
        supabaseSelect('drivers', {
          order: { column: 'number', ascending: true },
        }),
        supabaseSelect('laps', {
          filters: { session_id: `eq.${SESSION_UUID}` },
          order: { column: 'lap_number', ascending: true },
        }),
      ]);
      const driverRows = driverRowsRaw ?? [];
      let filteredLapRows = lapRowsRaw ?? [];
      if (driverRows.length) {
        const pendingStarts = [];
        driverRows.forEach((driver) => {
          const driverLaps = filteredLapRows.filter((lap) => lap.driver_id === driver.id);
          const activeLap = driverLaps.find((lap) => lap.ended_at === null);
          if (!activeLap) {
            const lastCompleted = driverLaps
              .filter((lap) => lap.duration_ms !== null)
              .sort((a, b) => b.lap_number - a.lap_number)[0];
            pendingStarts.push({
              driverId: driver.id,
              lapNumber: lastCompleted ? lastCompleted.lap_number + 1 : 1,
            });
          }
        });
        if (pendingStarts.length) {
          await Promise.all(
            pendingStarts.map(({ driverId, lapNumber }) =>
              supabaseInsert('laps', [
                {
                  session_id: SESSION_UUID,
                  driver_id: driverId,
                  lap_number: lapNumber,
                  started_at: new Date().toISOString(),
                },
              ]),
            ),
          );
          filteredLapRows = await supabaseSelect('laps', {
            filters: { session_id: `eq.${SESSION_UUID}` },
            order: { column: 'lap_number', ascending: true },
          });
        }
        applyDriverData(driverRows, filteredLapRows ?? []);
      }
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to refresh drivers from Supabase', error);
      setSupabaseError('Unable to refresh drivers from Supabase.');
    }
  }, [applyDriverData]);

  const refreshSessionFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const rows = await supabaseSelect('session_state', {
        filters: { id: `eq.${SESSION_ROW_ID}` },
      });
      const sessionRow = rows?.[0];
      if (!sessionRow) return;
      sessionStateRef.current = sessionRow;
      const hydrated = sessionRowToState(sessionRow);
      setEventConfig((prev) => ({
        ...prev,
        eventType: hydrated.eventType,
        totalLaps: hydrated.totalLaps,
        totalDuration: hydrated.totalDuration,
      }));
      setProcedurePhase(hydrated.procedurePhase);
      setFlagStatus(hydrated.flagStatus);
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
  }, []);

  const refreshLogsFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const rows = await supabaseSelect('race_events', {
        order: { column: 'created_at', ascending: false },
        filters: { limit: LOG_LIMIT },
      });
      if (!Array.isArray(rows)) return;
      const mapped = rows.map((row) => ({
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
  }, []);

  const bootstrapSupabase = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsInitialising(false);
      return;
    }
    setIsInitialising(true);
    try {
      const sessionRowsExisting = await supabaseSelect('sessions', {
        filters: { id: `eq.${SESSION_UUID}` },
      });
      if (!sessionRowsExisting?.length) {
        await supabaseUpsert('sessions', [
          {
            id: SESSION_UUID,
            name: 'Live Session',
            phase: DEFAULT_SESSION_STATE.procedurePhase,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
      }
      let driverRows = await supabaseSelect('drivers', {
        order: { column: 'number', ascending: true },
      });
      let lapRows = await supabaseSelect('laps', {
        filters: { session_id: `eq.${SESSION_UUID}` },
        order: { column: 'lap_number', ascending: true },
      });
      if (!driverRows?.length) {
        await supabaseUpsert(
          'drivers',
          DEFAULT_DRIVERS.map((driver) => ({
            id: driver.id,
            number: driver.number,
            name: driver.name,
            team: driver.team,
            marshal_id: driver.marshalId,
            laps: 0,
            last_lap_ms: null,
            best_lap_ms: null,
            pits: 0,
            status: 'ready',
            driver_flag: 'none',
            pit_complete: false,
            total_time_ms: 0,
            is_in_pit: false,
            pending_invalid: false,
          })),
        );
        driverRows = await supabaseSelect('drivers', {
          order: { column: 'number', ascending: true },
        });
        lapRows = [];
      }
      if (driverRows?.length) {
        applyDriverData(driverRows, lapRows ?? []);
      }
      let sessionRows = await supabaseSelect('session_state', {
        filters: { id: `eq.${SESSION_ROW_ID}` },
      });
      let sessionRow = sessionRows?.[0];
      if (!sessionRow) {
        sessionRow = {
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
        await supabaseUpsert('session_state', [sessionRow]);
      }
      sessionStateRef.current = sessionRow;
      const hydrated = sessionRowToState(sessionRow);
      setEventConfig((prev) => ({
        ...prev,
        eventType: hydrated.eventType,
        totalLaps: hydrated.totalLaps,
        totalDuration: hydrated.totalDuration,
      }));
      setProcedurePhase(hydrated.procedurePhase);
      setFlagStatus(hydrated.flagStatus);
      setTrackStatus(hydrated.trackStatus);
      setAnnouncement(hydrated.announcement);
      setAnnouncementDraft(hydrated.announcement);
      setIsTiming(hydrated.isTiming);
      setIsPaused(hydrated.isPaused);
      setRaceTime(hydrated.raceTime);
      await refreshLogsFromSupabase();
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to bootstrap Supabase data', error);
      setSupabaseError(
        'Unable to load data from Supabase. Confirm credentials and schema are correct.',
      );
    } finally {
      setIsInitialising(false);
    }
  }, [applyDriverData, refreshLogsFromSupabase]);

  const updateSessionState = useCallback(async (patch) => {
    sessionStateRef.current = {
      ...sessionStateRef.current,
      ...patch,
      id: SESSION_ROW_ID,
    };
    if (!isSupabaseConfigured) return;
    try {
      await supabaseUpsert('session_state', [
        {
          ...sessionStateRef.current,
          updated_at: new Date().toISOString(),
        },
      ]);
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to update session state', error);
      setSupabaseError('Unable to update session state in Supabase.');
    }
  }, []);

  const syncRaceTimeToSupabase = useCallback(
    (elapsed) => {
      if (!isSupabaseConfigured) return;
      const now = Date.now();
      if (now - lastRaceTimeSyncRef.current < 1000) {
        return;
      }
      lastRaceTimeSyncRef.current = now;
      updateSessionState({ race_time_ms: elapsed });
    },
    [updateSessionState],
  );

  const logAction = useCallback(
    async (action, marshalId = 'Race Control') => {
      const entry = {
        id: createClientId(),
        action,
        marshalId,
        timestamp: new Date(),
      };
      setLogs((prev) => {
        const next = [entry, ...prev].slice(0, LOG_LIMIT);
        logsRef.current = next;
        return next;
      });
      if (isSupabaseConfigured) {
        try {
          await supabaseInsert('race_events', [
            {
              id: entry.id,
              message: action,
              marshal_id: marshalId,
              created_at: entry.timestamp.toISOString(),
            },
          ]);
          setSupabaseError(null);
        } catch (error) {
          console.error('Failed to persist race event', error);
          setSupabaseError('Unable to store race log in Supabase.');
        }
          order: { column: 'lap_number', ascending: true },
        }),
      ]);
      if (driverRows?.length) {
        applyDriverData(driverRows, lapRows ?? []);
      }
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to refresh drivers from Supabase', error);
      setSupabaseError('Unable to refresh drivers from Supabase.');
    }
  }, [applyDriverData]);

  const refreshSessionFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const rows = await supabaseSelect('session_state', {
        filters: { id: `eq.${SESSION_ROW_ID}` },
      });
      const sessionRow = rows?.[0];
      if (!sessionRow) return;
      sessionStateRef.current = sessionRow;
      const hydrated = sessionRowToState(sessionRow);
      setEventConfig((prev) => ({
        ...prev,
        eventType: hydrated.eventType,
        totalLaps: hydrated.totalLaps,
        totalDuration: hydrated.totalDuration,
      }));
      setProcedurePhase(hydrated.procedurePhase);
      setFlagStatus(hydrated.flagStatus);
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
  }, []);

  const refreshLogsFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const rows = await supabaseSelect('race_events', {
        order: { column: 'created_at', ascending: false },
        filters: { limit: LOG_LIMIT },
      });
      if (!Array.isArray(rows)) return;
      const mapped = rows.map((row) => ({
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
  }, []);

  const bootstrapSupabase = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsInitialising(false);
      return;
    }
    setIsInitialising(true);
    try {
      let driverRows = await supabaseSelect('drivers', {
        order: { column: 'number', ascending: true },
      });
      let lapRows = await supabaseSelect('laps', {
        order: { column: 'lap_number', ascending: true },
      });
      if (!driverRows?.length) {
        await supabaseUpsert(
          'drivers',
          DEFAULT_DRIVERS.map((driver) => ({
            id: driver.id,
            number: driver.number,
            name: driver.name,
            team: driver.team,
            marshal_id: driver.marshalId,
            laps: 0,
            last_lap_ms: null,
            best_lap_ms: null,
            pits: 0,
            status: 'ready',
            driver_flag: 'none',
            pit_complete: false,
            total_time_ms: 0,
          })),
        );
        driverRows = await supabaseSelect('drivers', {
          order: { column: 'number', ascending: true },
        });
        lapRows = [];
      }
      if (driverRows?.length) {
        applyDriverData(driverRows, lapRows ?? []);
      }
      let sessionRows = await supabaseSelect('session_state', {
        filters: { id: `eq.${SESSION_ROW_ID}` },
      });
      let sessionRow = sessionRows?.[0];
      if (!sessionRow) {
        sessionRow = {
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
        await supabaseUpsert('session_state', [sessionRow]);
      }
      sessionStateRef.current = sessionRow;
      const hydrated = sessionRowToState(sessionRow);
      setEventConfig((prev) => ({
        ...prev,
        eventType: hydrated.eventType,
        totalLaps: hydrated.totalLaps,
        totalDuration: hydrated.totalDuration,
      }));
      setProcedurePhase(hydrated.procedurePhase);
      setFlagStatus(hydrated.flagStatus);
      setTrackStatus(hydrated.trackStatus);
      setAnnouncement(hydrated.announcement);
      setAnnouncementDraft(hydrated.announcement);
      setIsTiming(hydrated.isTiming);
      setIsPaused(hydrated.isPaused);
      setRaceTime(hydrated.raceTime);
      await refreshLogsFromSupabase();
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to bootstrap Supabase data', error);
      setSupabaseError(
        'Unable to load data from Supabase. Confirm credentials and schema are correct.',
      );
    } finally {
      setIsInitialising(false);
    }
  }, [applyDriverData, refreshLogsFromSupabase]);

  const updateSessionState = useCallback(async (patch) => {
    sessionStateRef.current = {
      ...sessionStateRef.current,
      ...patch,
      id: SESSION_ROW_ID,
    };
    if (!isSupabaseConfigured) return;
    try {
      await supabaseUpsert('session_state', [
        {
          ...sessionStateRef.current,
          updated_at: new Date().toISOString(),
        },
      ]);
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to update session state', error);
      setSupabaseError('Unable to update session state in Supabase.');
    }
  }, []);

  const syncRaceTimeToSupabase = useCallback(
    (elapsed) => {
      if (!isSupabaseConfigured) return;
      const now = Date.now();
      if (now - lastRaceTimeSyncRef.current < 1000) {
        return;
      }
      lastRaceTimeSyncRef.current = now;
      updateSessionState({ race_time_ms: elapsed });
    },
    [updateSessionState],
  );

  const logAction = useCallback(
    async (action, marshalId = 'Race Control') => {
      const entry = {
        id: createClientId(),
        action,
        marshalId,
        timestamp: new Date(),
      };
      setLogs((prev) => {
        const next = [entry, ...prev].slice(0, LOG_LIMIT);
        logsRef.current = next;
        return next;
      });
      if (isSupabaseConfigured) {
        try {
          await supabaseInsert('race_events', [
            {
              id: entry.id,
              message: action,
              marshal_id: marshalId,
              created_at: entry.timestamp.toISOString(),
            },
          ]);
          setSupabaseError(null);
        } catch (error) {
          console.error('Failed to persist race event', error);
          setSupabaseError('Unable to store race log in Supabase.');
        }
      }
    },
    [],
  );

  const persistDriverState = useCallback(async (driver) => {
    if (!isSupabaseConfigured) return;
    try {
      await supabaseUpsert('drivers', [toDriverRow(driver)]);
      setSupabaseError(null);
    } catch (error) {
      console.error('Failed to persist driver state', error);
      setSupabaseError('Unable to update driver data in Supabase.');
    }
  }, []);

  useEffect(() => {
    if (!isTiming || isPaused) {
      lastRaceTimeSyncRef.current = 0;
      return () => {};
    }
    }
  }, []);

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

  useEffect(() => {
    const handleKeyPress = (event) => {
      if (!isTiming || isPaused) return;
      const key = event.key.toLowerCase();
      let number;
      if (key >= '1' && key <= '9') {
        number = Number.parseInt(key, 10);
      } else if (key === '0') {
        number = 10;
      } else {
        return;
      }
      const driver = drivers.find((d) => d.number === number);
      if (!driver) return;
      event.preventDefault();
      if (event.altKey) {
        void invalidateLastLap(driver.id);
        return;
      }
      if (event.shiftKey) {
        void togglePit(driver.id);
        return;
      }
      void logLap(driver.id);
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [drivers, invalidateLastLap, isPaused, isTiming, logLap, togglePit]);

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
    if (!isSupabaseConfigured) {
      return () => {};
    }
    const driverUnsub = subscribeToTable({ table: 'drivers' }, () => {
      refreshDriversFromSupabase();
    });
    const lapUnsub = subscribeToTable({ table: 'laps', filter: `session_id=eq.${SESSION_UUID}` }, () => {
    const lapUnsub = subscribeToTable({ table: 'laps' }, () => {
      refreshDriversFromSupabase();
    });
    const sessionUnsub = subscribeToTable(
      { table: 'session_state', filter: `id=eq.${SESSION_ROW_ID}` },
      (payload) => {
        if (payload?.new) {
          sessionStateRef.current = payload.new;
          const hydrated = sessionRowToState(payload.new);
          setEventConfig((prev) => ({
            ...prev,
            eventType: hydrated.eventType,
            totalLaps: hydrated.totalLaps,
            totalDuration: hydrated.totalDuration,
          }));
          setProcedurePhase(hydrated.procedurePhase);
          setFlagStatus(hydrated.flagStatus);
          setTrackStatus(hydrated.trackStatus);
          setAnnouncement(hydrated.announcement);
          setAnnouncementDraft(hydrated.announcement);
          setIsTiming(hydrated.isTiming);
          setIsPaused(hydrated.isPaused);
          setRaceTime(hydrated.raceTime);
        }
      },
    );
    const logUnsub = subscribeToTable({ table: 'race_events' }, (payload) => {
      if (payload?.new) {
        const entry = {
          id: payload.new.id ?? createClientId(),
          action: payload.new.message ?? '',
          marshalId: payload.new.marshal_id ?? 'Race Control',
          timestamp: payload.new.created_at
            ? new Date(payload.new.created_at)
            : new Date(),
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
    });
    return () => {
      driverUnsub();
      lapUnsub();
      sessionUnsub();
      logUnsub();
    };
  }, [refreshDriversFromSupabase]);

  const getMarshalName = (marshalId) =>
    eventConfig.marshals.find((m) => m.id === marshalId)?.name ?? 'Unassigned';

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
    setFlagStatus('green');
    setTrackStatus('green');
    const now = Date.now();
    setDrivers((prev) => {
      const updated = prev.map((driver) => ({
        ...driver,
        status: 'ontrack',
        currentLapStart: now,
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

  const handleFlagChange = (flag) => {
    if (flag === 'green-check') {
      setFlagStatus('green');
      if (procedurePhase === 'suspended') {
        setProcedurePhase('green');
      }
      updateSessionState({
        flag_status: 'green',
        procedure_phase: procedurePhase === 'suspended' ? 'green' : procedurePhase,
      });
      void logAction('Session resumed from suspension');
      return;
    }
    setFlagStatus(flag);
    if (flag === 'red') {
      setProcedurePhase('suspended');
    }
    updateSessionState({
      flag_status: flag,
      ...(flag === 'red' ? { procedure_phase: 'suspended' } : {}),
    });
    void logAction(`Flag set to ${flag.toUpperCase()}`);
  };

  const logLap = useCallback(
    async (driverId) => {
      const driver = drivers.find((entry) => entry.id === driverId);
      if (!driver) return;
      if (!isTiming || isPaused) return;
      if (driver.status === 'retired' || driver.status === 'finished') return;
      if (driver.hasInvalidToResolve) return;

      const now = Date.now();

      const flashDriver = () => {
        if (lapFlashTimeoutRef.current) {
          clearTimeout(lapFlashTimeoutRef.current);
        }
        setRecentLapDriverId(driverId);
        lapFlashTimeoutRef.current = setTimeout(() => {
          setRecentLapDriverId(null);
        }, 500);
      };

      if (!isSupabaseConfigured) {
        let computedLapDuration = 0;
        setDrivers((prev) =>
          prev.map((entry) => {
            if (entry.id !== driverId) {
              return entry;
            }
            const lapStart = entry.currentLapStart ? entry.currentLapStart.getTime() : now;
            const lapDuration = Math.max(0, now - lapStart);
            computedLapDuration = lapDuration;
            const laps = entry.laps + 1;
            const bestLap =
              entry.bestLap === null ? lapDuration : Math.min(entry.bestLap, lapDuration);
            const status =
              eventConfig.eventType === 'Race' && laps >= eventConfig.totalLaps
                ? 'finished'
                : entry.status;
            const historyEntry = {
              lapNumber: laps,
              duration: lapDuration,
              invalidated: false,
              startedAt: entry.currentLapStart ?? new Date(now - lapDuration),
              endedAt: new Date(),
              recordedAt: new Date(),
            };
            const lapHistory = [...entry.lapHistory, historyEntry];
            return {
              ...entry,
              laps,
              lapTimes: [...entry.lapTimes, lapDuration],
              lapHistory,
              lastLap: lapDuration,
              bestLap,
              totalTime: entry.totalTime + lapDuration,
              status,
              currentLapStart: new Date(),
              currentLapNumber: laps + 1,
            };
          }),
        );
        flashDriver();
        const marshalName = getMarshalName(driver.marshalId);
        void logAction(
          `Lap recorded for #${driver.number} (${formatLapTime(computedLapDuration)})`,
          marshalName,
        );
        return;
      }

      try {
        const inProgressRows = await supabaseSelect('laps', {
          filters: {
            session_id: `eq.${SESSION_UUID}`,
            driver_id: `eq.${driverId}`,
            ended_at: 'is.null',
            limit: 1,
          },
          order: { column: 'lap_number', ascending: false },
        });
        let currentLap = inProgressRows?.[0];
        if (!currentLap) {
          const completedRows = await supabaseSelect('laps', {
            filters: {
              session_id: `eq.${SESSION_UUID}`,
              driver_id: `eq.${driverId}`,
              ended_at: 'not.is.null',
              limit: 1,
            },
            order: { column: 'lap_number', ascending: false },
          });
          const lastLapNumber = completedRows?.[0]?.lap_number ?? 0;
          const nextLapNumber = lastLapNumber + 1;
          await supabaseInsert('laps', [
            {
              session_id: SESSION_UUID,
              driver_id: driverId,
              lap_number: nextLapNumber,
              started_at: new Date(now).toISOString(),
            },
          ]);
          const refreshed = await supabaseSelect('laps', {
            filters: {
              session_id: `eq.${SESSION_UUID}`,
              driver_id: `eq.${driverId}`,
              ended_at: 'is.null',
              limit: 1,
            },
            order: { column: 'lap_number', ascending: false },
          });
          currentLap = refreshed?.[0];
  const recordLap = (driverId, { manualTime, source } = {}) => {
    const manualEntry = typeof manualTime === 'number';
    let updatedDriver = null;
    const now = Date.now();
    setDrivers((prev) =>
      prev.map((driver) => {
        if (driver.id !== driverId) {
          return driver;
        }
        if (driver.status === 'retired' || driver.status === 'finished') {
          return driver;
        }
        let lapTime = manualEntry ? manualTime : null;
        if (lapTime === null && driver.currentLapStart) {
          lapTime = now - driver.currentLapStart;
        }
        if (!currentLap) {
          return;
        }
        const lapStart = currentLap.started_at
          ? new Date(currentLap.started_at).getTime()
          : now;
        const durationMs = Math.max(0, Math.round(now - lapStart));
        const endedAtIso = new Date(now).toISOString();
        await supabaseUpdate(
          'laps',
          {
            ended_at: endedAtIso,
            duration_ms: durationMs,
          },
          { filters: { id: `eq.${currentLap.id}` } },
        );
        await supabaseInsert('laps', [
          {
            session_id: SESSION_UUID,
            driver_id: driverId,
            lap_number: currentLap.lap_number + 1,
            started_at: endedAtIso,
          },
        ]);
        flashDriver();
        const marshalName = getMarshalName(driver.marshalId);
        void logAction(
          `Lap recorded for #${driver.number} (${formatLapTime(durationMs)})`,
          marshalName,
        );
        await refreshDriversFromSupabase();
        setSupabaseError(null);
      } catch (error) {
        console.error('Failed to log lap', error);
        setSupabaseError('Unable to log lap in Supabase.');
      }
    },
    [
      drivers,
      eventConfig.eventType,
      eventConfig.totalLaps,
      isPaused,
      isTiming,
      logAction,
      refreshDriversFromSupabase,
    ],
  );

  const invalidateLastLap = useCallback(
    async (driverId) => {
      const driver = drivers.find((entry) => entry.id === driverId);
      if (!driver) return;
      if (driver.hasInvalidToResolve) return;

      if (!isSupabaseConfigured) {
        setDrivers((prev) =>
          prev.map((entry) => {
            if (entry.id !== driverId) {
              return entry;
            }
            const history = [...entry.lapHistory];
            let index = history.length - 1;
            while (index >= 0) {
              if (history[index].endedAt) break;
              index -= 1;
            }
            if (index < 0) {
              return entry;
            }
            history[index] = {
              ...history[index],
              invalidated: true,
            };
            const validLaps = history.filter(
              (lap) => lap.endedAt && lap.invalidated !== true && typeof lap.duration === 'number',
            );
            const bestLap = validLaps.length
              ? Math.min(...validLaps.map((lap) => lap.duration ?? Number.POSITIVE_INFINITY))
              : null;
            const lastValid = validLaps.length ? validLaps[validLaps.length - 1] : null;
            return {
              ...entry,
              lapHistory: history,
              lastLap: lastValid?.duration ?? null,
              bestLap: Number.isFinite(bestLap) ? bestLap : null,
              hasInvalidToResolve: true,
            };
          }),
        );
        return;
      }

      try {
        const lastLapRows = await supabaseSelect('laps', {
          filters: {
            session_id: `eq.${SESSION_UUID}`,
            driver_id: `eq.${driverId}`,
            ended_at: 'not.is.null',
            limit: 1,
          },
          order: { column: 'lap_number', ascending: false },
        });
        const lastLap = lastLapRows?.[0];
        if (!lastLap) {
          return;
        }
        await supabaseUpdate(
          'laps',
          { invalidated: true },
          { filters: { id: `eq.${lastLap.id}` } },
        );
        const inProgressRows = await supabaseSelect('laps', {
          filters: {
            session_id: `eq.${SESSION_UUID}`,
            driver_id: `eq.${driverId}`,
            ended_at: 'is.null',
            limit: 1,
          },
          order: { column: 'lap_number', ascending: false },
        });
        const inProgress = inProgressRows?.[0];
        if (inProgress && inProgress.started_at === lastLap.ended_at) {
          await supabaseDelete('laps', { filters: { id: `eq.${inProgress.id}` } });
        }
        await supabaseUpdate(
          'drivers',
          { pending_invalid: true },
          { filters: { id: `eq.${driverId}` } },
        );
        setDrivers((prev) =>
          prev.map((entry) =>
            entry.id === driverId ? { ...entry, hasInvalidToResolve: true } : entry,
          ),
        );
        const marshalName = getMarshalName(driver.marshalId);
        void logAction(`Lap invalidated for #${driver.number}`, marshalName);
        await refreshDriversFromSupabase();
        setSupabaseError(null);
      } catch (error) {
        console.error('Failed to invalidate lap', error);
        setSupabaseError('Unable to invalidate lap in Supabase.');
      }
    },
    [drivers, isSupabaseConfigured, logAction, refreshDriversFromSupabase],
  );

  const startLapAfterInvalid = useCallback(
    async (driverId) => {
      const driver = drivers.find((entry) => entry.id === driverId);
      if (!driver) return;
      if (!driver.hasInvalidToResolve) return;

      if (!isSupabaseConfigured) {
        setDrivers((prev) =>
          prev.map((entry) =>
            entry.id === driverId
              ? {
                  ...entry,
                  hasInvalidToResolve: false,
                  currentLapStart: new Date(),
                  currentLapNumber: entry.laps + 1,
                }
              : entry,
          ),
        );
        return;
      }

      try {
        await supabaseDelete('laps', {
          filters: {
            session_id: `eq.${SESSION_UUID}`,
            driver_id: `eq.${driverId}`,
            ended_at: 'is.null',
          },
        });
        const lastLapRows = await supabaseSelect('laps', {
          filters: {
            session_id: `eq.${SESSION_UUID}`,
            driver_id: `eq.${driverId}`,
            ended_at: 'not.is.null',
            limit: 1,
          },
          order: { column: 'lap_number', ascending: false },
        });
        const lastLap = lastLapRows?.[0];
        const nextLapNumber = lastLap ? lastLap.lap_number + 1 : 1;
        await supabaseInsert('laps', [
          {
            session_id: SESSION_UUID,
            driver_id: driverId,
            lap_number: nextLapNumber,
            started_at: new Date().toISOString(),
          },
        ]);
        await supabaseUpdate(
          'drivers',
          { pending_invalid: false },
          { filters: { id: `eq.${driverId}` } },
        );
        setDrivers((prev) =>
          prev.map((entry) =>
            entry.id === driverId
              ? {
                  ...entry,
                  hasInvalidToResolve: false,
                  currentLapStart: new Date(),
                  currentLapNumber: entry.laps + 1,
                }
              : entry,
          ),
        );
        const marshalName = getMarshalName(driver.marshalId);
        void logAction(`Invalidation reset for #${driver.number}`, marshalName);
        await refreshDriversFromSupabase();
        setSupabaseError(null);
      } catch (error) {
        console.error('Failed to restart lap after invalidation', error);
        setSupabaseError('Unable to restart lap after invalidation.');
      }
    },
    [drivers, isSupabaseConfigured, logAction, refreshDriversFromSupabase],
  );

  const togglePit = useCallback(
    async (driverId) => {
      const driver = drivers.find((entry) => entry.id === driverId);
      if (!driver) return;
      const nextState = !driver.isInPit;
      setDrivers((prev) =>
        prev.map((entry) =>
          entry.id === driverId
            ? {
                ...entry,
                isInPit: nextState,
              }
            : entry,
        ),
      );

      if (isSupabaseConfigured) {
        try {
          await supabaseUpdate(
            'drivers',
            { is_in_pit: nextState },
            { filters: { id: `eq.${driverId}` } },
          );
          setSupabaseError(null);
        } catch (error) {
          console.error('Failed to toggle pit status', error);
          setSupabaseError('Unable to toggle pit status in Supabase.');
        }
      }

      const marshalName = getMarshalName(driver.marshalId);
      void logAction(
        `Driver #${driver.number} ${nextState ? 'entered' : 'left'} pit lane`,
        marshalName,
      );
    },
    [drivers, isSupabaseConfigured, logAction],
  );
        const lapTimes = [...driver.lapTimes, lapTime];
        const lapHistory = [
          ...driver.lapHistory,
          {
            lapNumber: lapTimes.length,
            lapTime,
            source: source ?? (manualEntry ? 'manual' : 'automatic'),
            recordedAt: new Date(),
          },
        ];
        const laps = driver.laps + 1;
        const bestLap =
          driver.bestLap === null ? lapTime : Math.min(driver.bestLap, lapTime);
        const status =
          eventConfig.eventType === 'Race' && laps >= eventConfig.totalLaps
            ? 'finished'
            : driver.status;
        const totalTime = driver.totalTime + lapTime;
        updatedDriver = {
          ...driver,
          laps,
          lapTimes,
          lapHistory,
          lastLap: lapTime,
          bestLap,
          totalTime,
          status,
          currentLapStart: now,
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
      if (isSupabaseConfigured) {
        supabaseInsert('laps', [
          {
            driver_id: updatedDriver.id,
            lap_number: updatedDriver.laps,
            lap_time_ms: updatedDriver.lastLap,
            source: source ?? (manualEntry ? 'manual' : 'automatic'),
            recorded_at: new Date().toISOString(),
          },
        ])
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

  const setDriverFlag = (driverId, driverFlag) => {
    let flaggedDriver = null;
  const togglePitStop = (driverId) => {
    let updatedDriver = null;
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

  const updateTrackStatusSelection = (statusId) => {
    setTrackStatus(statusId);
    updateSessionState({ track_status: statusId });
    const statusMeta = TRACK_STATUS_MAP[statusId];
    void logAction(
      `Track status set to ${statusMeta ? statusMeta.label : statusId.toUpperCase()}`,
    );
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

  const updateTrackStatusSelection = (statusId) => {
    setTrackStatus(statusId);
    updateSessionState({ track_status: statusId });
    const statusMeta = TRACK_STATUS_MAP[statusId];
    void logAction(
      `Track status set to ${statusMeta ? statusMeta.label : statusId.toUpperCase()}`,
    );
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

  const driverCards = useMemo(
    () =>
      drivers.map((driver) => ({
        id: driver.id,
        number: driver.number,
        name: driver.name,
        team: driver.team,
        lapNumber: driver.currentLapNumber ?? driver.laps + 1,
        completedLaps: driver.laps,
        targetLaps: eventConfig.totalLaps,
        lastLapMs: driver.lastLap,
        bestLapMs: driver.bestLap,
        hasInvalidToResolve: driver.hasInvalidToResolve ?? false,
        isInPit: driver.isInPit ?? false,
        isRecent: recentLapDriverId === driver.id,
        marshalName:
          eventConfig.marshals.find((marshal) => marshal.id === driver.marshalId)?.name ??
          'Unassigned',
        status: driver.status,
        canLogLap:
          isTiming &&
          !isPaused &&
          driver.status === 'ontrack' &&
          !driver.hasInvalidToResolve,
      })),
    [
      drivers,
      eventConfig.marshals,
      eventConfig.totalLaps,
      isPaused,
      isTiming,
      recentLapDriverId,
    ],
  );

  const activeFlag = useMemo(
    () => FLAG_OPTIONS.find((flag) => flag.id === flagStatus),
    [flagStatus],
  );

  const flagDropdownValue = flagStatus === 'green-check' ? 'green' : flagStatus;

  const openSetup = () => {
    setSetupDraft({
      eventType: eventConfig.eventType,
      totalLaps: eventConfig.totalLaps,
      totalDuration: eventConfig.totalDuration,
      marshals: eventConfig.marshals.map((marshal) => ({ ...marshal })),
      drivers: drivers.map(({ id, number, name, team, marshalId }) => ({
        id,
        number,
        name,
        team,
        marshalId,
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
    setSetupDraft((prev) => ({
      ...prev,
      marshals: [
        ...prev.marshals,
        { id: `m${Date.now()}`, name: `Marshal ${prev.marshals.length + 1}` },
      ],
    }));
  };

  const updateMarshal = (marshalId, name) => {
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
    setManualLapInputs({});
    setProcedurePhase('setup');
    setIsTiming(false);
    setIsPaused(false);
    setFlagStatus('green');
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
    if (isSupabaseConfigured) {
      supabaseUpsert('drivers', normalizedDrivers.map((driver) => toDriverRow(driver)))
        .then(() => setSupabaseError(null))
        .catch((error) => {
          console.error('Failed to persist driver setup', error);
          setSupabaseError('Unable to persist driver setup to Supabase.');
        });
      normalizedDrivers.forEach((driver) => {
        supabaseDelete('laps', { filters: { driver_id: `eq.${driver.id}` } }).catch(
          (error) => {
            console.error('Failed to clear laps for driver', driver.id, error);
          },
        );
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

  const trackStatusDetails = TRACK_STATUS_MAP[trackStatus] ?? TRACK_STATUS_OPTIONS[0];
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
              <span>{activeFlag?.label ?? flagStatus}</span>
            </div>
            <select
              value={flagDropdownValue}
              onChange={(event) => handleFlagChange(event.target.value)}
              className="rounded-full border border-neutral-700 bg-neutral-900/70 px-3 py-1.5 text-xs uppercase tracking-wide text-neutral-200 focus:outline-none focus:ring-2 focus:ring-[#7C6BFF]"
            >
              {FLAG_SELECT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              onClick={openSetup}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/80 text-neutral-300 transition hover:border-[#9FF7D3] hover:text-[#9FF7D3]"
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
            <div className="mt-4 flex flex-wrap gap-2">
              {TRACK_STATUS_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => updateTrackStatusSelection(option.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F19] ${option.controlClass} ${
                    trackStatus === option.id ? 'ring-2 ring-offset-2 ring-offset-[#0B0F19]' : ''
                  }`}
                >
                  {option.shortLabel}
                </button>
              ))}
            </div>
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
            {FLAG_OPTIONS.filter((flag) => flag.id !== 'green-check').map((flag) => (
              <button
                key={flag.id}
                onClick={() => handleFlagChange(flag.id)}
                className={`h-10 rounded-lg text-xs font-semibold uppercase tracking-wide transition ${flag.color} ${
                  flagStatus === flag.id ? 'ring-2 ring-offset-2 ring-offset-[#0B0F19]' : ''
                }`}
              >
                {flag.label}
              </button>
            ))}
            {procedurePhase === 'suspended' && (
              <button
                onClick={() => handleFlagChange('green-check')}
                className={`h-10 rounded-lg text-xs font-semibold uppercase tracking-wide transition ${
                  FLAG_OPTIONS.find((flag) => flag.id === 'green-check')?.color ?? ''
                }`}
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
              <DriverGrid
                drivers={driverCards}
                hotkeys={HOTKEYS}
                onLogLap={logLap}
                onInvalidate={invalidateLastLap}
                onResolveInvalid={startLapAfterInvalid}
                onTogglePit={togglePit}
              />
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
                    className="flex items-center gap-2 rounded bg-gray-800 px-3 py-2 text-xs uppercase tracking-wide hover:bg-gray-700"
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
                        className="mt-2 w-full rounded bg-gray-800 px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
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
  );
};

export default TimingPanel;
