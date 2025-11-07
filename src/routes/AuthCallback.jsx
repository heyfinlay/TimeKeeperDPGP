import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';
import { PROFILE_COLUMN_SELECTION } from '@/lib/profile.js';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) {
      navigate('/', { replace: true });
      return;
    }

    let isMounted = true;

    (async () => {
      try {
        const searchParams = new URLSearchParams(window.location.search ?? '');
        const hashParams = new URLSearchParams((window.location.hash ?? '').replace(/^#/, ''));

        const errorDescription =
          searchParams.get('error_description') ||
          hashParams.get('error_description') ||
          hashParams.get('error');
        if (errorDescription) {
          console.error('Supabase auth callback returned an error', errorDescription);
          if (isMounted) navigate('/', { replace: true });
          return;
        }

        const authCode = searchParams.get('code') || hashParams.get('code');
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (authCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(authCode);
          if (error) {
            console.error('Failed to exchange auth code for session', error);
            if (isMounted) navigate('/', { replace: true });
            return;
          }
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            console.error('Failed to set Supabase session from callback tokens', error);
            if (isMounted) navigate('/', { replace: true });
            return;
          }
        } else {
          console.error('Supabase auth callback is missing an auth code and tokens.');
          if (isMounted) navigate('/', { replace: true });
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
              'provider_token',
              'provider_refresh_token',
            ].forEach((param) => {
              hashSearchParams.delete(param);
            });
            const newHash = hashSearchParams.toString();
            cleanedUrl.hash = newHash ? `#${newHash}` : '';
          }

          window.history.replaceState(null, document.title, `${cleanedUrl.pathname}${cleanedUrl.search}${cleanedUrl.hash}`);
        } catch (urlError) {
          console.warn('Failed to clean auth params from callback URL', urlError);
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (isMounted) navigate('/', { replace: true });
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select(PROFILE_COLUMN_SELECTION)
          .eq('id', user.id)
          .maybeSingle();

        if (profileError) {
          console.error('Failed to load profile after auth callback', profileError);
        }

        if (isMounted) {
          const requiresSetup = !profile?.display_name?.trim();

          // Route admins to admin dashboard, others to regular dashboard
          if (requiresSetup) {
            navigate('/account/setup', { replace: true });
          } else if (profile?.role === 'admin') {
            navigate('/admin/sessions', { replace: true });
          } else {
            navigate('/dashboard', { replace: true });
          }
        }
      } catch (callbackError) {
        console.error('Unexpected error during auth callback', callbackError);
        if (isMounted) navigate('/', { replace: true });
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  return null;
}
