import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildStorageObjectUrl,
  isSupabaseConfigured,
  supabaseInsert,
  supabaseSelect,
  supabaseStorageUpload,
  supabaseUpdate,
} from '../lib/supabaseClient';

const STORAGE_KEY = 'timekeeper.activeSessionId';

const EventSessionContext = createContext({
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  error: null,
  selectSession: () => {},
  refreshSessions: async () => {},
  createSession: async () => {},
  startSession: async () => {},
  completeSession: async () => {},
});

const encodePath = (sessionId) => sessionId.replaceAll(':', '-');

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
  const isCompletingRef = useRef(false);

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
      return [];
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
      console.error('Failed to refresh sessions', refreshError);
      setError('Unable to load sessions from Supabase.');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    refreshSessions();
  }, [refreshSessions]);

  const selectSession = useCallback((sessionId) => {
    setActiveSessionId(sessionId);
  }, []);

  const createSession = useCallback(
    async ({ name, startsAt } = {}) => {
      if (!isSupabaseConfigured) return null;
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
        setError('Unable to create session.');
        return null;
      }
    },
    [],
  );

  const startSession = useCallback(
    async (sessionId) => {
      if (!sessionId || !isSupabaseConfigured) return false;
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
    [],
  );

  const completeSession = useCallback(
    async (sessionId) => {
      if (!sessionId || !isSupabaseConfigured || isCompletingRef.current) return false;
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
    [],
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
      startSession,
      completeSession,
    }),
    [
      sessions,
      activeSessionId,
      isLoading,
      error,
      selectSession,
      refreshSessions,
      createSession,
      startSession,
      completeSession,
    ],
  );

  return <EventSessionContext.Provider value={value}>{children}</EventSessionContext.Provider>;
};

export const useEventSession = () => useContext(EventSessionContext);
