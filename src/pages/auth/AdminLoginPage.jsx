/**
 * @deprecated This component is deprecated and should not be used.
 *
 * Diamond Sports Book now uses Discord OAuth for ALL authentication.
 * This page is preserved for reference but is no longer accessible via routes.
 *
 * Use Discord OAuth via the WelcomePage or AuthGate components instead.
 * @see src/lib/auth.js
 */

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient.js';
import { loginWithAdminCredentials } from '@/services/adminAuth.js';
import { useAuth } from '@/context/AuthContext.jsx';

const INITIAL_STATE = {
  username: '',
  password: '',
};

const FIELD_CLASSES =
  'w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const { isSupabaseConfigured, status } = useAuth();
  const [form, setForm] = useState(INITIAL_STATE);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = useCallback((event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setError('');

      if (!isSupabaseConfigured || !supabase) {
        setError('Supabase must be configured to sign in as an admin.');
        return;
      }

      const username = form.username.trim();
      const password = form.password;

      if (!username || !password) {
        setError('Enter both your username and password.');
        return;
      }

      setIsSubmitting(true);
      try {
        const result = await loginWithAdminCredentials({ username, password });
        if (!result?.accessToken || !result?.refreshToken) {
          throw new Error('Admin credentials response is missing session tokens.');
        }
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
        });
        if (sessionError) {
          throw sessionError;
        }
        setForm(INITIAL_STATE);
        navigate('/dashboard', { replace: true });
      } catch (submitError) {
        console.error('Admin login failed', submitError);
        const message =
          typeof submitError?.message === 'string'
            ? submitError.message
            : 'Unable to sign in with those credentials.';
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [form.password, form.username, isSupabaseConfigured, navigate],
  );

  const isLoading = isSubmitting || status === 'loading';

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-12">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold text-neutral-100">Admin sign in</h1>
        <p className="text-sm text-neutral-400">
          Use your administrator credentials to access the race control dashboard.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm text-neutral-200">
          Username
          <input
            className={FIELD_CLASSES}
            name="username"
            autoComplete="username"
            value={form.username}
            onChange={handleChange}
            disabled={isLoading}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm text-neutral-200">
          Password
          <input
            className={FIELD_CLASSES}
            type="password"
            name="password"
            autoComplete="current-password"
            value={form.password}
            onChange={handleChange}
            disabled={isLoading}
          />
        </label>
        {error ? (
          <div className="rounded-md border border-rose-500 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          className="flex h-10 items-center justify-center rounded-md bg-indigo-500 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-neutral-700"
          disabled={isLoading}
        >
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {!isSupabaseConfigured ? (
        <p className="rounded-md border border-amber-600/60 bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
          Supabase is not configured in this environment. Provide Supabase credentials to enable admin sign-in.
        </p>
      ) : null}
    </div>
  );
}
