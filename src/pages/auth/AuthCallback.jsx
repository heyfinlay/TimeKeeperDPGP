import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthContext.jsx';

const AuthCallback = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, profile, profileError, isHydratingProfile } = useAuth();
  const [hasSession, setHasSession] = useState(false);
  const hasRedirectedRef = useRef(false);

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
          setHasSession(false);
          navigate('/', { replace: true });
          return;
        }

        const authCode = searchParams.get('code') || hashParams.get('code');
        const hasFragmentTokens = hashParams.has('access_token') || hashParams.has('refresh_token');

        if (authCode) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode);
          if (!isMounted) return;

          if (exchangeError) {
            console.error('Failed to exchange Supabase OAuth code for a session', exchangeError);
            setHasSession(false);
            navigate('/', { replace: true });
            return;
          }
        } else if (hasFragmentTokens) {
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');

          if (accessToken && refreshToken) {
            const { error: setSessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (!isMounted) return;

            if (setSessionError) {
              console.error('Failed to store Supabase session tokens from URL fragment', setSessionError);
              setHasSession(false);
              navigate('/', { replace: true });
              return;
            }
          } else {
            console.warn('Supabase OAuth callback missing access or refresh token in URL fragment');
          }
        }

        if (authCode || hasFragmentTokens) {
          try {
            const cleanedUrl = new URL(window.location.href);
            [
              'code',
              'state',
              'scope',
              'provider',
              'error',
              'error_description',
            ].forEach((param) => {
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
                'provider_token',
                'provider_refresh_token',
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
        }

        const { data, error } = await supabase.auth.getSession();
        if (!isMounted) return;

        if (error) {
          console.error('Failed to resolve Supabase session from callback', error);
          setHasSession(false);
          navigate('/', { replace: true });
          return;
        }

        if (!data?.session) {
          setHasSession(false);
          navigate('/', { replace: true });
          return;
        }

        const sessionUser = data.session.user;
        setHasSession(true);
        let profileRow = null;

        try {
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('id, display_name, ic_phone_number, role, tier, experience_points')
            .eq('id', sessionUser.id)
            .maybeSingle();

          if (profileError && profileError.code !== 'PGRST116') {
            throw profileError;
          }

          if (!profileData) {
            const fallbackDisplayName =
              sessionUser.user_metadata?.full_name ||
              sessionUser.user_metadata?.name ||
              sessionUser.email ||
              'Marshal';

            const { data: createdProfile, error: createError } = await supabase
              .from('profiles')
              .insert({
                id: sessionUser.id,
                role: 'marshal',
                display_name: fallbackDisplayName,
                ic_phone_number: null,
              })
              .select('id, display_name, ic_phone_number, role, tier, experience_points')
              .single();

            if (createError) {
              throw createError;
            }

            profileRow = createdProfile ?? null;
          } else {
            profileRow = profileData;
          }
        } catch (profileError) {
          console.error('Unable to load Supabase profile during auth callback', profileError);
          setHasSession(true);
          navigate('/dashboard', { replace: true });
          return;
        }

        const requiresSetup = !profileRow?.display_name?.trim() || !profileRow?.ic_phone_number?.trim();
        navigate(requiresSetup ? '/account/setup' : '/dashboard', { replace: true });
      } catch (error) {
        console.error('Unexpected error handling Supabase auth callback', error);
        setHasSession(false);
        navigate('/', { replace: true });
      }
    };

    void resolveRedirect();

    return () => {
      isMounted = false;
    };
  }, [location.hash, location.search, navigate]);

  useEffect(() => {
    if (!hasSession || hasRedirectedRef.current) {
      return;
    }

    if (status !== 'authenticated' || isHydratingProfile) {
      return;
    }

    if (profileError) {
      console.error('Unable to hydrate profile after authentication', profileError);
      hasRedirectedRef.current = true;
      navigate('/dashboard', { replace: true });
      return;
    }

    if (!profile) {
      return;
    }

    const requiresSetup = !profile.display_name?.trim() || !profile.ic_phone_number?.trim();
    hasRedirectedRef.current = true;
    navigate(requiresSetup ? '/account/setup' : '/dashboard', { replace: true });
  }, [hasSession, status, isHydratingProfile, profile, profileError, navigate]);

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
