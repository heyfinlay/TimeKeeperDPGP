import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { isSupabaseConfigured } from '@/lib/supabaseClient.js';

export default function AccountSetup() {
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const navigate = useNavigate();
  const { profile, updateProfile, user } = useAuth();

  const derivedDisplayName = useMemo(() => {
    if (profile?.display_name) return profile.display_name;
    return (
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email?.split('@')?.[0] ||
      ''
    );
  }, [profile?.display_name, user?.email, user?.user_metadata?.full_name, user?.user_metadata?.name]);

  useEffect(() => {
    setHandle(profile?.handle ?? '');
    setDisplayName(derivedDisplayName ?? '');
  }, [derivedDisplayName, profile?.handle]);

  async function save() {
    if (!isSupabaseConfigured) {
      navigate('/dashboard');
      return;
    }

    const trimmedHandle = handle.trim();
    const trimmedDisplayName = displayName.trim();

    if (!trimmedDisplayName) {
      setError('Please provide a display name for your profile.');
      return;
    }

    if (!updateProfile) {
      setError('Profile updates are currently unavailable.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await updateProfile({
        handle: trimmedHandle || null,
        display_name: trimmedDisplayName || null,
      });
      navigate('/dashboard');
    } catch (saveError) {
      console.error('Failed to save profile', saveError);
      setError(saveError?.message ?? 'Unable to save your profile at this time.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 rounded-3xl border border-white/5 bg-[#060910]/80 px-8 py-12 text-center text-gray-200">
        <h1 className="text-2xl font-semibold text-white">Profile setup unavailable</h1>
        <p className="text-sm text-neutral-400">
          Supabase is not configured for this environment. Continue to the dashboard to explore the interface.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-3xl border border-white/5 bg-[#05070F]/70 p-8 shadow-[0_0_40px_rgba(15,23,42,0.45)]">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold text-white">Create your profile</h1>
        <p className="text-sm text-neutral-400">Choose how other officials will see you during an event.</p>
      </div>
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-400">Handle</span>
        <input
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder="Marshal handle"
          className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-3 text-sm text-white outline-none transition focus:border-[#7C6BFF]/70 focus:ring-2 focus:ring-[#7C6BFF]/30"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-400">Display name</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Full name"
          className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 px-4 py-3 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
        />
      </label>
      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
      ) : null}
      <button
        type="button"
        onClick={save}
        disabled={isSaving}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-[#9FF7D3] px-6 py-3 text-sm font-semibold uppercase tracking-[0.35em] text-[#041313] transition hover:bg-[#7de6c0] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
