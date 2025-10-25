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
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          console.error('Failed to exchange auth code for session', error);
          if (isMounted) navigate('/', { replace: true });
          return;
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
