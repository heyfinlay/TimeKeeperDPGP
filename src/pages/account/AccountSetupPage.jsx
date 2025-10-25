import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Phone, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';

const AccountSetupPage = () => {
  const { status, user, profile, updateProfile, isSupabaseConfigured } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [icPhone, setIcPhone] = useState('');
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const derivedDisplayName = useMemo(() => {
    if (profile?.display_name) return profile.display_name;
    return (
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email?.split('@')?.[0] ||
      ''
    );
  }, [profile?.display_name, user?.email, user?.user_metadata?.full_name, user?.user_metadata?.name]);

  const supportsIcPhone = useMemo(
    () => (profile ? Object.prototype.hasOwnProperty.call(profile, 'ic_phone_number') : false),
    [profile],
  );

  useEffect(() => {
    setDisplayName(derivedDisplayName ?? '');
    if (supportsIcPhone) {
      setIcPhone(profile?.ic_phone_number ?? '');
    } else {
      setIcPhone('');
    }
  }, [derivedDisplayName, profile?.ic_phone_number, supportsIcPhone]);

  const isAuthenticated = status === 'authenticated' && !!user;
  const isProfileComplete = Boolean(profile?.display_name?.trim());

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (status === 'unauthenticated') {
      navigate('/', { replace: true });
      return;
    }
    if (isAuthenticated && isProfileComplete) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, isProfileComplete, isSupabaseConfigured, navigate, status]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isAuthenticated || !updateProfile) return;

    const trimmedDisplayName = displayName.trim();
    const trimmedPhone = icPhone.trim();

    if (!trimmedDisplayName) {
      setError('Please provide an account name.');
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      const patch = supportsIcPhone
        ? { display_name: trimmedDisplayName, ic_phone_number: trimmedPhone || null }
        : { display_name: trimmedDisplayName };
      await updateProfile(patch);
      navigate('/dashboard', { replace: true });
    } catch (submitError) {
      console.error('Failed to update profile', submitError);
      const fallbackMessage =
        submitError?.message || 'Something went wrong while saving your details. Please try again.';
      setError(fallbackMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 rounded-3xl border border-white/5 bg-[#060910]/80 px-8 py-12 text-center text-gray-200">
        <ShieldCheck className="mx-auto h-12 w-12 text-[#9FF7D3]" />
        <h1 className="text-2xl font-semibold text-white">Local access active</h1>
        <p className="text-sm text-neutral-400">
          Supabase is not configured for this environment, so account provisioning is skipped. Continue to the dashboard to
          explore the interface.
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-400">
        Preparing your account…
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3 text-center text-gray-300">
        <span className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#7C6BFF]/30 bg-[#7C6BFF]/10 px-4 py-1 text-[0.7rem] uppercase tracking-[0.35em] text-[#dcd7ff]">
          Finalise access
        </span>
        <h1 className="text-3xl font-semibold text-white sm:text-4xl">Set up your TimeKeeper identity</h1>
        <p className="mx-auto max-w-2xl text-sm text-neutral-400">
          Choose how you&apos;ll appear to other stewards{supportsIcPhone
            ? ' and share your incident-control hotline so we can reach you during a live session.'
            : '. Update your details anytime from the dashboard.'}
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-6 rounded-3xl border border-white/5 bg-[#05070F]/70 p-8 shadow-[0_0_40px_rgba(15,23,42,0.45)] backdrop-blur"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="displayName" className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-400">
            Account name
          </label>
          <div className="relative">
            <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7C6BFF]" />
            <input
              id="displayName"
              name="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Marshal Handle"
              className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 py-3 pl-12 pr-4 text-sm text-white outline-none transition focus:border-[#7C6BFF]/70 focus:ring-2 focus:ring-[#7C6BFF]/30"
            />
          </div>
          <p className="text-xs text-neutral-500">
            This name is displayed to other users in stewarding panels and live timing overlays.
          </p>
        </div>

        {supportsIcPhone ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="icPhone" className="text-xs font-semibold uppercase tracking-[0.35em] text-neutral-400">
              IC Phone Number (optional)
            </label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9FF7D3]" />
              <input
                id="icPhone"
                name="icPhone"
                value={icPhone}
                onChange={(event) => setIcPhone(event.target.value)}
                placeholder="+61 4xx xxx xxx"
                inputMode="tel"
                className="w-full rounded-full border border-white/10 bg-[#0B1120]/60 py-3 pl-12 pr-4 text-sm text-white outline-none transition focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
              />
            </div>
            <p className="text-xs text-neutral-500">
              Used for verifying top-ups and contacting you in-game.
            </p>
          </div>
        ) : null}

        {error ? <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[#9FF7D3] px-8 py-3 text-sm font-semibold uppercase tracking-[0.35em] text-[#041313] transition hover:bg-[#7de6c0] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving
            </>
          ) : (
            'Save and continue'
          )}
        </button>
      </form>
    </div>
  );
};

export default AccountSetupPage;
