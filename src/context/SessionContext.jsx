import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildStorageObjectUrl,
  isSupabaseConfigured,
  isTableMissingError,
  supabaseInsert,
  supabaseSelect,
  supabaseStorageUpload,
  supabaseUpsert,
  supabaseUpdate,
} from '../lib/supabaseClient';
import { LEGACY_SESSION_ID } from '../utils/raceData';

const STORAGE_KEY = 'timekeeper.activeSessionId';

const EventSessionContext = createContext({
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  error: null,
  selectSession: () => {},
  refreshSessions: async () => {},
  createSession: async () => {},
  seedSessionData: async () => {},
  startSession: async () => {},
  completeSession: async () => {},
  supportsSessions: true,
  fallbackToLegacySchema: () => {},
});

const createLegacySessionRow = () => ({
  id: LEGACY_SESSION_ID,
  name: 'Legacy Session',
  status: 'active',
  starts_at: null,
  ends_at: null,
  created_at: null,
  updated_at: null,
});

const encodePath = (sessionId) => sessionId.replaceAll(':', '-');

const includesCaseInsensitive = (source, search) => {
  if (!source || !search) return false;
  return source.toLowerCase().includes(search.toLowerCase());
};

const describeSessionError = (error, actionMessage) => {
  if (!error) {
    return actionMessage;
  }
  const details =
    typeof error?.supabaseMessage === 'string'
      ? error.supabaseMessage
      : typeof error?.message === 'string'
        ? error.message
        : '';
  if (error?.code === '42P17' || includesCaseInsensitive(details, 'infinite recursion detected in policy')) {
    return `${actionMessage} Supabase row level security policies for the sessions table appear to reference themselves and are causing an infinite recursion. Update the policies and try again.`;
  }
  return actionMessage;
};

const toCsv = (rows = []) => {
  if (!rows.length) return '';
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row ?? {}).forEach((key) => set.add(key));
      return set;
    }, new Set()),
  );
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const normalised = Array.isArray(value) ? JSON.stringify(value) : String(value);
    if (/[",\n]/.test(normalised)) {
      return `"${normalised.replaceAll('"', '""')}"`;
    }
    return normalised;
  };
  const body = rows.map((row) => headers.map((header) => escape(row?.[header])).join(','));
  return [headers.join(','), ...body].join('\n');
};

const uploadSessionArtifacts = async (sessionId, sessionRow) => {
  if (!isSupabaseConfigured) return [];
  const [drivers, laps, raceEvents] = await Promise.all([
    supabaseSelect('drivers', {
      filters: { session_id: `eq.${sessionId}` },
      order: { column: 'number', ascending: true },
    }).then((rows) => rows ?? []),
    supabaseSelect('laps', {
      filters: { session_id: `eq.${sessionId}` },
      order: { column: 'recorded_at', ascending: true },
    }).then((rows) => rows ?? []),
    supabaseSelect('race_events', {
      filters: { session_id: `eq.${sessionId}` },
      order: { column: 'created_at', ascending: true },
    }).then((rows) => rows ?? []),
  ]);

  const timestamp = encodePath(new Date().toISOString());
  const basePath = `${sessionId}/${timestamp}`;
  const jsonPayload = {
    session: sessionRow,
    drivers,
    laps,
    raceEvents,
  };
  const uploads = [
    {
      path: `${basePath}/session.json`,
      content: JSON.stringify(jsonPayload, null, 2),
      contentType: 'application/json',
      format: 'json',
    },
    {
      path: `${basePath}/drivers.csv`,
      content: toCsv(drivers),
      contentType: 'text/csv',
      format: 'csv',
    },
    {
      path: `${basePath}/laps.csv`,
      content: toCsv(laps),
      contentType: 'text/csv',
      format: 'csv',
    },
    {
      path: `${basePath}/race-events.csv`,
      content: toCsv(raceEvents),
      contentType: 'text/csv',
      format: 'csv',
    },
  ];

  const results = [];
  for (const upload of uploads) {
    await supabaseStorageUpload('session-logs', upload.path, upload.content, {
      contentType: upload.contentType,
    });
    results.push({
      object_path: upload.path,
      format: upload.format,
      object_url: buildStorageObjectUrl('session-logs', upload.path),
    });
  }

  return results;
};

export const EventSessionProvider = ({ children }) => {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(() =>
    typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [supportsSessions, setSupportsSessions] = useState(true);
  const isCompletingRef = useRef(false);

  const fallbackToLegacySchema = useCallback(() => {
    const fallbackSession = createLegacySessionRow();
    setSupportsSessions((prev) => (prev ? false : prev));
    setSessions((prev) => {
      if (prev.length === 1 && prev[0]?.id === LEGACY_SESSION_ID) {
        return prev;
      }
      return [fallbackSession];
    });
    setActiveSessionId((prev) => (prev === LEGACY_SESSION_ID ? prev : LEGACY_SESSION_ID));
    setError(null);
    return [fallbackSession];
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (activeSessionId) {
      window.localStorage.setItem(STORAGE_KEY, activeSessionId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [activeSessionId]);

  const refreshSessions = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setSessions([]);
      setActiveSessionId(null);
      setSupportsSessions(true);
      return [];
    }
    if (!supportsSessions) {
      return fallbackToLegacySchema();
    }
    setIsLoading(true);
    try {
      const rows =
        (await supabaseSelect('sessions', {
          order: { column: 'created_at', ascending: false },
        })) ?? [];
      setSessions(rows);
      setError(null);
      if (!rows.length) {
        setActiveSessionId(null);
      } else if (!rows.some((session) => session.id === activeSessionId)) {
        setActiveSessionId(rows[0].id);
      }
      return rows;
    } catch (refreshError) {
      if (isTableMissingError(refreshError, 'sessions')) {
        console.warn('Supabase sessions table missing. Falling back to legacy mode.');
        return fallbackToLegacySchema();
      }
      console.error('Failed to refresh sessions', refreshError);
      setSessions([]);
      setActiveSessionId(null);
      setError(
        describeSessionError(
          refreshError,
          'Unable to load sessions from Supabase.',
        ),
      );
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [activeSessionId, fallbackToLegacySchema, supportsSessions]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    refreshSessions();
  }, [refreshSessions]);

  const selectSession = useCallback((sessionId) => {
    setActiveSessionId(sessionId);
  }, []);

  const seedSessionData = useCallback(
    async (sessionId, { sessionState, drivers, entries, members } = {}) => {
      if (!sessionId) {
        throw new Error('Session ID is required to seed data.');
      }
      if (!isSupabaseConfigured) {
        throw new Error('Supabase must be configured to seed session data.');
      }
      if (!supportsSessions) {
        const unavailableError = new Error(
          'Session management is unavailable with this Supabase schema.',
        );
        setError(unavailableError.message);
        throw unavailableError;
      }

      const normalizeRows = (rows = []) =>
        rows
          .filter(Boolean)
          .map((row) => ({
            ...row,
            session_id: sessionId,
          }));

      try {
        if (sessionState) {
          const stateRows = Array.isArray(sessionState) ? sessionState : [sessionState];
          await supabaseUpsert(
            'session_state',
            normalizeRows(
              stateRows.map((row) => ({
                id: row.id ?? sessionId,
                ...row,
                session_id: sessionId,
              })),
            ),
          );
        }

        if (Array.isArray(drivers) && drivers.length) {
          await supabaseUpsert('drivers', normalizeRows(drivers));
        }

        if (Array.isArray(entries) && entries.length) {
          await supabaseUpsert('session_entries', normalizeRows(entries));
        }

        if (Array.isArray(members) && members.length) {
          await supabaseUpsert('session_members', normalizeRows(members));
        }

        setError(null);
      } catch (seedError) {
        console.error('Failed to seed session data', seedError);
        setError(seedError?.message ?? 'Unable to seed session data.');
        throw seedError;
      }
    },
    [supportsSessions],
  );

  const createSession = useCallback(
    async ({ name, startsAt } = {}) => {
      if (!isSupabaseConfigured) return null;
      if (!supportsSessions) {
        setError('Session management is unavailable with this Supabase schema.');
        return null;
      }
      const now = new Date().toISOString();
      try {
        const rows = await supabaseInsert('sessions', [
          {
            name: name?.trim() || `Session ${new Date().toLocaleString()}`,
            status: startsAt ? 'scheduled' : 'draft',
            starts_at: startsAt ?? null,
            updated_at: now,
          },
        ]);
        const [created] = rows ?? [];
        if (created) {
          setSessions((prev) => [created, ...prev]);
          setActiveSessionId(created.id);
          setError(null);
        }
        return created ?? null;
      } catch (insertError) {
        console.error('Failed to create session', insertError);
        setError(
          describeSessionError(
            insertError,
            'Unable to create session.',
          ),
        );
        return null;
      }
    },
    [supportsSessions],
  );

  const startSession = useCallback(
    async (sessionId) => {
      if (!sessionId || !isSupabaseConfigured) return false;
      if (!supportsSessions) {
        setError('Session management is unavailable with this Supabase schema.');
        return false;
      }
      try {
        const now = new Date().toISOString();
        await supabaseUpdate(
          'sessions',
          { status: 'active', starts_at: now, updated_at: now },
          { filters: { id: `eq.${sessionId}` } },
        );
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionId
              ? { ...session, status: 'active', starts_at: now, updated_at: now }
              : session,
          ),
        );
        setError(null);
        return true;
      } catch (updateError) {
        console.error('Failed to start session', updateError);
        setError('Unable to start session.');
        return false;
      }
    },
    [supportsSessions],
  );

  const completeSession = useCallback(
    async (sessionId) => {
      if (!sessionId || !isSupabaseConfigured || isCompletingRef.current) return false;
      if (!supportsSessions) {
        setError('Session management is unavailable with this Supabase schema.');
        return false;
      }
      isCompletingRef.current = true;
      try {
        const now = new Date().toISOString();
        const sessionRows = await supabaseSelect('sessions', {
          filters: { id: `eq.${sessionId}` },
        });
        const sessionRow = sessionRows?.[0] ?? null;
        await supabaseUpdate(
          'sessions',
          { status: 'completed', ends_at: now, updated_at: now },
          { filters: { id: `eq.${sessionId}` } },
        );
        const logRows = await uploadSessionArtifacts(sessionId, {
          ...(sessionRow ?? {}),
          ends_at: now,
          status: 'completed',
        });
        if (logRows.length) {
          await supabaseInsert(
            'session_logs',
            logRows.map((entry) => ({
              session_id: sessionId,
              object_path: entry.object_path,
              format: entry.format,
              object_url: entry.object_url,
            })),
          );
        }
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionId
              ? { ...session, status: 'completed', ends_at: now, updated_at: now }
              : session,
          ),
        );
        setError(null);
        return true;
      } catch (completeError) {
        console.error('Failed to complete session', completeError);
        setError('Unable to complete session.');
        return false;
      } finally {
        isCompletingRef.current = false;
      }
    },
    [supportsSessions],
  );

  const value = useMemo(
    () => ({
      sessions,
      activeSessionId,
      isLoading,
      error,
      selectSession,
      refreshSessions,
      createSession,
      seedSessionData,
      startSession,
      completeSession,
      supportsSessions,
      fallbackToLegacySchema,
    }),
    [
      sessions,
      activeSessionId,
      isLoading,
      error,
      selectSession,
      refreshSessions,
      createSession,
      seedSessionData,
      startSession,
      completeSession,
      supportsSessions,
      fallbackToLegacySchema,
    ],
  );

  return <EventSessionContext.Provider value={value}>{children}</EventSessionContext.Provider>;
};

export const useEventSession = () => useContext(EventSessionContext);
