import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient.js';
import { AlertCircle, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';

const RAKE_MIN = 0;
const RAKE_MAX = 2000;

const defaultOutcome = () => ({
  label: '',
  color: '#2563eb',
  driverId: '',
});

export default function AdminMarketWizard({ onCreated }) {
  const [sessions, setSessions] = useState([]);
  const [sessionsError, setSessionsError] = useState(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [marketName, setMarketName] = useState('');
  const [rakeBps, setRakeBps] = useState(500);
  const [closeTime, setCloseTime] = useState('');
  const [outcomes, setOutcomes] = useState([defaultOutcome(), defaultOutcome()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function loadSessions() {
      setIsLoadingSessions(true);
      setSessionsError(null);
      try {
        const { data, error } = await supabase
          .from('sessions')
          .select(
            'id, name, status, starts_at, drivers:drivers!drivers_session_id_fkey(id, name, number, team)',
          )
          .order('starts_at', { ascending: false, nullsFirst: true });
        if (error) throw error;
        if (!isMounted) return;
        const rows = Array.isArray(data) ? data : [];
        setSessions(rows);
        setSelectedSessionId((current) => current || rows[0]?.id || '');
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to load sessions for market wizard', error);
        setSessionsError(error.message ?? 'Unable to load sessions');
      } finally {
        if (isMounted) {
          setIsLoadingSessions(false);
        }
      }
    }
    loadSessions();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  useEffect(() => {
    setOutcomes((current) => {
      if (current.every((outcome) => outcome.label.trim().length === 0)) {
        return [defaultOutcome(), defaultOutcome()];
      }
      return current;
    });
  }, [selectedSessionId]);

  const sessionDrivers = useMemo(() => {
    if (!selectedSession || !Array.isArray(selectedSession.drivers)) {
      return [];
    }
    return selectedSession.drivers;
  }, [selectedSession]);

  const updateOutcome = useCallback((index, patch) => {
    setOutcomes((current) =>
      current.map((outcome, idx) => (idx === index ? { ...outcome, ...patch } : outcome)),
    );
  }, []);

  const removeOutcome = useCallback((index) => {
    setOutcomes((current) => current.filter((_, idx) => idx !== index));
  }, []);

  const appendOutcome = useCallback(() => {
    setOutcomes((current) => [...current, defaultOutcome()]);
  }, []);

  const validate = useCallback(() => {
    const issues = [];
    if (!selectedSessionId) {
      issues.push('Select a session to attach the market to.');
    }
    if (!marketName.trim()) {
      issues.push('Market name is required.');
    }
    if (!Number.isFinite(Number(rakeBps)) || Number(rakeBps) < RAKE_MIN || Number(rakeBps) > RAKE_MAX) {
      issues.push(`Rake must be between ${RAKE_MIN} and ${RAKE_MAX} basis points.`);
    }
    if (closeTime) {
      const closeAt = new Date(closeTime);
      if (Number.isNaN(closeAt.getTime()) || closeAt <= new Date()) {
        issues.push('Close time must be in the future.');
      }
    }
    const trimmedOutcomes = outcomes.map((outcome) => ({
      ...outcome,
      label: outcome.label.trim(),
    }));
    if (!trimmedOutcomes.length || trimmedOutcomes.every((outcome) => outcome.label.length === 0)) {
      issues.push('Define at least one outcome.');
    }
    trimmedOutcomes.forEach((outcome, index) => {
      if (!outcome.label) {
        issues.push(`Outcome ${index + 1} is missing a label.`);
      }
      if (outcome.color && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(outcome.color.trim())) {
        issues.push(`Outcome ${index + 1} color must be a valid hex code.`);
      }
      if (outcome.driverId) {
        const driverExists = sessionDrivers.some((driver) => driver.id === outcome.driverId);
        if (!driverExists) {
          issues.push(`Selected driver for outcome ${index + 1} is not part of this session.`);
        }
      }
    });
    return issues;
  }, [selectedSessionId, marketName, rakeBps, closeTime, outcomes, sessionDrivers]);

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      if (isSubmitting) return;

      const issues = validate();
      if (issues.length) {
        setToast({ type: 'error', message: issues[0] });
        return;
      }

      setIsSubmitting(true);
      setToast(null);
      try {
        const payload = {
          p_session_id: selectedSessionId,
          p_market_name: marketName.trim(),
          p_rake_bps: Number(rakeBps),
          p_closes_at: closeTime ? new Date(closeTime).toISOString() : null,
          p_outcomes: outcomes.map((outcome, index) => ({
            label: outcome.label.trim(),
            color: outcome.color || null,
            driver_id: outcome.driverId || null,
            sort_order: index,
          })),
        };
        const { data, error } = await supabase.rpc('admin_create_market', payload);
        if (error) {
          throw error;
        }
        if (!data?.success) {
          throw new Error(data?.message ?? 'Market creation failed.');
        }
        setToast({ type: 'success', message: 'Market created successfully.' });
        setMarketName('');
        setRakeBps(500);
        setCloseTime('');
        setOutcomes([defaultOutcome(), defaultOutcome()]);
        if (typeof onCreated === 'function') {
          onCreated(data);
        }
      } catch (error) {
        console.error('Failed to create market', error);
        setToast({ type: 'error', message: error.message ?? 'Failed to create market.' });
      } finally {
        setIsSubmitting(false);
      }
    },
    [validate, isSubmitting, selectedSessionId, marketName, rakeBps, closeTime, outcomes, onCreated],
  );

  const renderToast = () => {
    if (!toast) return null;
    const Icon = toast.type === 'success' ? CheckCircle2 : AlertCircle;
    const bgClass = toast.type === 'success' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-200';
    const borderClass = toast.type === 'success' ? 'border-emerald-500/40' : 'border-rose-500/40';
    return (
      <div className={`mt-4 flex items-center gap-3 rounded-2xl border ${borderClass} ${bgClass} px-4 py-3 text-sm`}>
        <Icon className="h-5 w-5" />
        <span>{toast.message}</span>
      </div>
    );
  };

  return (
    <section className="rounded-3xl border border-white/5 bg-[#05070F]/80 p-6 shadow-lg">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Create Market</h2>
          <p className="text-sm text-neutral-400">
            Attach a new market to an active session and configure its drivers.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSelectedSessionId('');
            setMarketName('');
            setRakeBps(500);
            setCloseTime('');
            setOutcomes([defaultOutcome(), defaultOutcome()]);
            setToast(null);
          }}
          className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-400 transition hover:border-white/30 hover:text-white"
        >
          Reset
        </button>
      </div>

      {isLoadingSessions ? (
        <div className="mt-6 flex items-center gap-3 text-neutral-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading sessions…</span>
        </div>
      ) : sessionsError ? (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-rose-200">
          <AlertCircle className="h-5 w-5" />
          <span>{sessionsError}</span>
        </div>
      ) : (
        <form className="mt-6 flex flex-col gap-6" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">Session</span>
              <select
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white focus:border-[#9FF7D3] focus:outline-none"
                value={selectedSessionId}
                onChange={(event) => setSelectedSessionId(event.target.value)}
                required
              >
                <option value="" disabled>
                  Select a session
                </option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name || 'Session'}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">Market Name</span>
              <input
                type="text"
                value={marketName}
                onChange={(event) => setMarketName(event.target.value)}
                placeholder="e.g. Overall Winner"
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-neutral-500 focus:border-[#9FF7D3] focus:outline-none"
                required
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">Rake (bps)</span>
              <input
                type="number"
                min={RAKE_MIN}
                max={RAKE_MAX}
                value={rakeBps}
                onChange={(event) => setRakeBps(event.target.value)}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white focus:border-[#9FF7D3] focus:outline-none"
              />
              <span className="text-xs text-neutral-500">0–2000 (basis points)</span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">Close Time</span>
              <input
                type="datetime-local"
                value={closeTime}
                onChange={(event) => setCloseTime(event.target.value)}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white focus:border-[#9FF7D3] focus:outline-none"
              />
              <span className="text-xs text-neutral-500">Optional — prevents wagers after this time.</span>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-400">
              Outcomes
            </h3>
            <button
              type="button"
              onClick={appendOutcome}
              className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-3 py-1 text-xs text-[#9FF7D3] transition hover:border-[#9FF7D3]/70"
            >
              <Plus className="h-4 w-4" />
              Add Outcome
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {outcomes.map((outcome, index) => (
              <div
                key={index}
                className="rounded-2xl border border-white/10 bg-black/30 p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">Outcome {index + 1}</span>
                  {outcomes.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeOutcome(index)}
                      className="text-xs text-rose-300 transition hover:text-rose-200"
                    >
                      <Trash2 className="mr-1 inline h-4 w-4" />
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">Label</span>
                    <input
                      type="text"
                      value={outcome.label}
                      onChange={(event) => updateOutcome(index, { label: event.target.value })}
                      placeholder="Driver name or outcome"
                      className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#9FF7D3] focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">Color</span>
                    <input
                      type="color"
                      value={outcome.color || '#2563eb'}
                      onChange={(event) => updateOutcome(index, { color: event.target.value })}
                      className="h-10 w-full rounded-2xl border border-white/10 bg-black/30"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">Driver</span>
                    <select
                      value={outcome.driverId}
                      onChange={(event) => updateOutcome(index, { driverId: event.target.value })}
                      className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-[#9FF7D3] focus:outline-none"
                    >
                      <option value="">Unassigned</option>
                      {sessionDrivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          #{driver.number ?? '—'} · {driver.name ?? 'Driver'}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-5 py-2 text-sm font-medium text-white transition hover:border-[#9FF7D3]/60 hover:text-[#9FF7D3] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSubmitting ? 'Creating…' : 'Create Market'}
            </button>
          </div>
        </form>
      )}

      {renderToast()}
    </section>
  );
}
