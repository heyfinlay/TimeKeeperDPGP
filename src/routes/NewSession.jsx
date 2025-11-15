import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient.js';
import { useEventSession } from '@/context/SessionContext.jsx';

const EVENT_TYPES = [
  { value: 'Race', label: 'Race' },
  { value: 'Practice', label: 'Practice' },
  { value: 'Qualifying', label: 'Qualifying' },
];

const DEFAULT_LAPS = 50;
const DEFAULT_DURATION = 60;

export default function NewSession() {
  const navigate = useNavigate();
  const { seedSessionAtomic, supportsSessions } = useEventSession();
  const [sessionName, setSessionName] = useState('');
  const [eventType, setEventType] = useState(EVENT_TYPES[0].value);
  const [scheduledFor, setScheduledFor] = useState('');
  const [totalLaps, setTotalLaps] = useState(String(DEFAULT_LAPS));
  const [totalDuration, setTotalDuration] = useState(String(DEFAULT_DURATION));
  const [drivers, setDrivers] = useState([]);
  const [newDriverNumber, setNewDriverNumber] = useState('');
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverTeam, setNewDriverTeam] = useState('');
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const loadSessions = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: loadError } = await supabase
        .from('sessions')
        .select('id, name, status, created_at, starts_at')
        .order('created_at', { ascending: false })
        .limit(8);
      if (loadError) throw loadError;
      setSessions(data ?? []);
    } catch (loadError) {
      console.error('Failed to load recent sessions', loadError);
      setError('Unable to load existing sessions.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    void loadSessions();
  }, [loadSessions]);

  const resolvedSessions = useMemo(
    () => (Array.isArray(sessions) ? sessions : []),
    [sessions],
  );

  const handleAddDriver = useCallback(() => {
    const trimmedName = newDriverName.trim();
    const number = Number(newDriverNumber) || null;

    if (!trimmedName) {
      setError('Driver name is required.');
      return;
    }

    if (drivers.some(d => d.number === number && number !== null)) {
      setError(`Driver number ${number} is already in use.`);
      return;
    }

    setDrivers(prev => [...prev, {
      number,
      name: trimmedName,
      team: newDriverTeam.trim() || null,
    }]);

    setNewDriverNumber('');
    setNewDriverName('');
    setNewDriverTeam('');
    setError(null);
  }, [newDriverNumber, newDriverName, newDriverTeam, drivers]);

  const handleRemoveDriver = useCallback((index) => {
    setDrivers(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleCreateSession = useCallback(
    async (event) => {
      event.preventDefault();
      if (!isSupabaseConfigured || !supportsSessions || !seedSessionAtomic) {
        setError('Session creation requires Supabase access.');
        return;
      }
      const trimmedName = sessionName.trim();
      if (!trimmedName) {
        setError('Enter a session name to continue.');
        return;
      }

      setIsSubmitting(true);
      setError(null);
      try {
        const startDate = scheduledFor ? new Date(scheduledFor) : null;
        const startsAt =
          startDate && !Number.isNaN(startDate.getTime())
            ? startDate.toISOString()
            : null;

        const payload = {
          name: trimmedName,
          status: startsAt ? 'scheduled' : 'draft',
          starts_at: startsAt,
          event_type: eventType,
          total_laps: Number(totalLaps) || DEFAULT_LAPS,
          total_duration: Number(totalDuration) || DEFAULT_DURATION,
          members: [],
          drivers: drivers.map((d, index) => ({
            number: d.number,
            name: d.name,
            team: d.team,
            position: index + 1,
          })),
        };

        const sessionId = await seedSessionAtomic(payload);
        if (sessionId) {
          navigate(`/control/${sessionId}`);
        }
      } catch (submitError) {
        console.error('Failed to create session', submitError);
        setError(submitError?.message ?? 'Unable to create the session.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [eventType, seedSessionAtomic, sessionName, totalDuration, totalLaps, scheduledFor, supportsSessions, navigate, drivers],
  );

  if (!supportsSessions) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 rounded-3xl border border-white/5 bg-[#05070F]/80 px-8 py-12 text-center text-neutral-300">
        <h1 className="text-2xl font-semibold text-white">Session management unavailable</h1>
        <p className="text-sm text-neutral-400">
          The current Supabase schema does not expose session tooling. Configure the backend and reload to enable
          automated session creation.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.45em] text-neutral-500">Control Panel Sessions</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Create a live control session</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Creating a session seeds the control panel state, links you as the owner, and allows other race control
          operators to join in realtime.
        </p>
      </header>

      <section className="rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
        <form className="flex flex-col gap-4" onSubmit={handleCreateSession}>
          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">Session Name</span>
            <input
              value={sessionName}
              onChange={(event) => setSessionName(event.target.value)}
              placeholder="Night practice"
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/60 focus:ring-2 focus:ring-[#9FF7D3]/20"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">Event Type</span>
              <select
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/60 focus:ring-2 focus:ring-[#9FF7D3]/20"
              >
                {EVENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">Total Laps</span>
              <input
                type="number"
                min={0}
                value={totalLaps}
                onChange={(event) => setTotalLaps(event.target.value)}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/60 focus:ring-2 focus:ring-[#9FF7D3]/20"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">Duration (minutes)</span>
              <input
                type="number"
                min={0}
                value={totalDuration}
                onChange={(event) => setTotalDuration(event.target.value)}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/60 focus:ring-2 focus:ring-[#9FF7D3]/20"
              />
            </label>
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">Scheduled Start (optional)</span>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(event) => setScheduledFor(event.target.value)}
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/60 focus:ring-2 focus:ring-[#9FF7D3]/20"
            />
          </label>

          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-500">Drivers</span>

            {drivers.length > 0 && (
              <div className="flex flex-col gap-2">
                {drivers.map((driver, index) => (
                  <div key={index} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-2">
                    <span className="text-sm font-semibold text-white">#{driver.number || '—'}</span>
                    <span className="flex-1 text-sm text-white">{driver.name}</span>
                    {driver.team && <span className="text-xs text-neutral-400">{driver.team}</span>}
                    <button
                      type="button"
                      onClick={() => handleRemoveDriver(index)}
                      className="text-xs text-rose-400 transition hover:text-rose-300"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-[120px_1fr_1fr_auto]">
              <input
                type="number"
                placeholder="Number"
                value={newDriverNumber}
                onChange={(e) => setNewDriverNumber(e.target.value)}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white outline-none transition focus:border-[#9FF7D3]/60 focus:ring-2 focus:ring-[#9FF7D3]/20"
              />
              <input
                type="text"
                placeholder="Driver name *"
                value={newDriverName}
                onChange={(e) => setNewDriverName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddDriver())}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white outline-none transition focus:border-[#9FF7D3]/60 focus:ring-2 focus:ring-[#9FF7D3]/20"
              />
              <input
                type="text"
                placeholder="Team (optional)"
                value={newDriverTeam}
                onChange={(e) => setNewDriverTeam(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddDriver())}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white outline-none transition focus:border-[#9FF7D3]/60 focus:ring-2 focus:ring-[#9FF7D3]/20"
              />
              <button
                type="button"
                onClick={handleAddDriver}
                className="rounded-2xl border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-4 py-2 text-sm font-semibold text-[#9FF7D3] transition hover:bg-[#9FF7D3]/20"
              >
                Add
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-full bg-[#9FF7D3] px-6 py-3 text-sm font-semibold uppercase tracking-[0.35em] text-[#041313] transition hover:bg-[#7de6c0] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Seeding Session…' : 'Create Session'}
          </button>
        </form>
      </section>

      <section className="rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-neutral-500">Recent Sessions</p>
            <h2 className="text-lg font-semibold text-white">Latest control runs</h2>
          </div>
          <button
            type="button"
            onClick={() => void loadSessions()}
            className="text-xs uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:text-white"
          >
            Refresh
          </button>
        </div>
        <div className="mt-4">
          {isLoading ? (
            <p className="text-sm text-neutral-400">Loading sessions…</p>
          ) : resolvedSessions.length === 0 ? (
            <p className="text-sm text-neutral-400">No sessions recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {resolvedSessions.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{session.name}</span>
                    <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                      {String(session.status || 'draft').toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    {session.starts_at
                      ? `Starts ${new Date(session.starts_at).toLocaleString()}`
                      : `Created ${session.created_at ? new Date(session.created_at).toLocaleString() : 'just now'}`}
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate(`/control/${session.id}`)}
                    className="self-start text-xs font-semibold uppercase tracking-[0.3em] text-[#9FF7D3] transition hover:text-white"
                  >
                    Open Control Panel →
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
