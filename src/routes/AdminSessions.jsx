import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';

export default function AdminSessions() {
  const [name, setName] = useState('');
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: loadError } = await supabase
        .from('sessions')
        .select('*')
        .order('created_at', { ascending: false });
      if (loadError) throw loadError;
      setSessions(data ?? []);
    } catch (loadError) {
      console.error('Failed to load sessions', loadError);
      setError('Unable to load sessions from Supabase.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) return;
    void load();
  }, [load]);

  const create = async () => {
    if (!supabase || !isSupabaseConfigured) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    setIsCreating(true);
    setError(null);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setError('You need to be signed in to create sessions.');
        return;
      }

      const { error: insertError } = await supabase.from('sessions').insert({
        name: trimmed,
        created_by: user.id,
      });
      if (insertError) throw insertError;

      setName('');
      await load();
    } catch (createError) {
      console.error('Failed to create session', createError);
      setError(createError?.message ?? 'Unable to create session.');
    } finally {
      setIsCreating(false);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 rounded-3xl border border-white/5 bg-[#060910]/80 px-8 py-12 text-center text-gray-200">
        <h1 className="text-2xl font-semibold text-white">Session management offline</h1>
        <p className="text-sm text-neutral-400">
          Supabase is not configured for this environment. Session management tools require a configured backend.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-semibold text-white">Sessions</h1>
        <p className="text-sm text-neutral-400">Create and review sessions available to race control.</p>
      </header>
      <div className="flex flex-col gap-4 rounded-3xl border border-white/5 bg-[#05070F]/70 p-6">
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-400">Session name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Night practice"
            className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
          />
        </label>
        <button
          type="button"
          onClick={create}
          disabled={isCreating}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[#9FF7D3] px-6 py-3 text-sm font-semibold uppercase tracking-[0.35em] text-[#041313] transition hover:bg-[#7de6c0] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isCreating ? 'Creating…' : 'Create'}
        </button>
        {error ? (
          <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
        ) : null}
      </div>
      <section className="rounded-3xl border border-white/5 bg-[#05070F]/70 p-6">
        <h2 className="text-lg font-semibold text-white">Recent sessions</h2>
        {isLoading ? (
          <p className="mt-4 text-sm text-neutral-400">Loading sessions…</p>
        ) : sessions.length ? (
          <ul className="mt-4 flex flex-col gap-3">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-col gap-1 rounded-2xl border border-white/5 bg-[#060910]/70 px-4 py-3">
                <span className="text-sm font-semibold text-white">{session.name}</span>
                <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                  {String(session.status ?? 'open').toUpperCase()} •{' '}
                  {session.created_at
                    ? new Date(session.created_at).toLocaleString()
                    : 'Not set'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-neutral-400">No sessions created yet.</p>
        )}
      </section>
    </div>
  );
}
