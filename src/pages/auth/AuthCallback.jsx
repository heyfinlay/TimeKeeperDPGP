import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient.js';

const AuthCallback = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let isMounted = true;

    const resolveRedirect = async () => {
      if (!isSupabaseConfigured || !supabase) {
        navigate('/', { replace: true });
        return;
      }

      try {
        const searchParams = new URLSearchParams(location.search ?? '');
        const hashParams = new URLSearchParams((location.hash ?? '').replace(/^#/, ''));

        const errorDescription =
          searchParams.get('error_description') ||
          hashParams.get('error_description') ||
          hashParams.get('error');

        if (errorDescription) {
          console.error('Supabase OAuth callback returned an error', errorDescription);
          navigate('/', { replace: true });
          return;
        }

        const authCode = searchParams.get('code') || hashParams.get('code');
        if (authCode) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode);
          if (!isMounted) return;

          if (exchangeError) {
            console.error('Failed to exchange Supabase OAuth code for a session', exchangeError);
            navigate('/', { replace: true });
            return;
          }

          try {
            const cleanedUrl = new URL(window.location.href);
            ['code', 'state', 'scope', 'provider', 'error', 'error_description'].forEach((param) => {
              cleanedUrl.searchParams.delete(param);
            });

            if (cleanedUrl.hash) {
              const hashSearchParams = new URLSearchParams(cleanedUrl.hash.replace(/^#/, ''));
              [
                'code',
                'access_token',
                'refresh_token',
                'expires_in',
                'token_type',
                'provider',
                'error',
                'error_description',
              ].forEach((param) => {
                hashSearchParams.delete(param);
              });
              const newHash = hashSearchParams.toString();
              cleanedUrl.hash = newHash ? `#${newHash}` : '';
            }

            window.history.replaceState(
              null,
              document.title,
              `${cleanedUrl.pathname}${cleanedUrl.search}${cleanedUrl.hash}`,
            );
          } catch (urlError) {
            console.warn('Unable to clean auth callback parameters from URL', urlError);
          }
        } else if (hashParams.has('access_token') || hashParams.has('refresh_token')) {
          const { error: sessionFromUrlError } = await supabase.auth.getSessionFromUrl({
            storeSession: true,
          });
          if (!isMounted) return;

          if (sessionFromUrlError) {
            console.error('Failed to hydrate Supabase session from URL fragment', sessionFromUrlError);
            navigate('/', { replace: true });
            return;
          }
        }

        const { data, error } = await supabase.auth.getSession();
        if (!isMounted) return;

        if (error) {
          console.error('Failed to resolve Supabase session from callback', error);
          navigate('/', { replace: true });
          return;
        }

        if (data?.session) {
          navigate('/control', { replace: true });
        } else {
          navigate('/', { replace: true });
        }
      } catch (error) {
        console.error('Unexpected error handling Supabase auth callback', error);
        navigate('/', { replace: true });
      }
    };

    void resolveRedirect();

    return () => {
      isMounted = false;
    };
  }, [location.hash, location.search, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#05070F] px-4 text-center text-white">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <span className="text-sm uppercase tracking-[0.35em] text-[#9FF7D3]">Hold tight</span>
        <h1 className="text-2xl font-semibold">Signing you in…</h1>
        <p className="text-sm text-gray-400">
          We&apos;re securing your race control access and will redirect you in just a moment.
        </p>
      </div>
    </div>
  );
};

export default AuthCallback;
