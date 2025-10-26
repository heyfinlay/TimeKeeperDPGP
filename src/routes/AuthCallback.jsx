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
        if (!authCode) {
          console.error('Supabase auth callback is missing an auth code.');
          if (isMounted) navigate('/', { replace: true });
          return;
        }

        const { error } = await supabase.auth.exchangeCodeForSession(authCode);
        if (error) {
          console.error('Failed to exchange auth code for session', error);
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
          navigate(requiresSetup ? '/account/setup' : '/dashboard', { replace: true });
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
