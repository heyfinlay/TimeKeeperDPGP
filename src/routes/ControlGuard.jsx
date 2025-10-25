import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';

const ALLOWED_ROLES = new Set(['marshal', 'admin']);

export default function ControlGuard({ children }) {
  const [status, setStatus] = useState(isSupabaseConfigured ? 'loading' : 'allowed');

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setStatus('allowed');
      return;
    }

    let isActive = true;

    const verifyAccess = async () => {
      try {
        const { data: userResult, error: userError } = await supabase.auth.getUser();
        if (userError) {
          throw userError;
        }

        const user = userResult?.user ?? null;
        if (!user) {
          if (isActive) {
            setStatus('forbidden');
          }
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError && profileError.code !== 'PGRST116') {
          throw profileError;
        }

        const resolvedRole = String(profile?.role ?? 'marshal').toLowerCase();
        const canAccess = ALLOWED_ROLES.has(resolvedRole);

        if (isActive) {
          setStatus(canAccess ? 'allowed' : 'forbidden');
        }
      } catch (error) {
        console.error('Failed to verify control permissions', error);
        if (isActive) {
          setStatus('forbidden');
        }
      }
    };

    void verifyAccess();

    return () => {
      isActive = false;
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-400">
        Checking permissions…
      </div>
    );
  }

  if (status !== 'allowed') {
    return <Navigate to="/sessions" replace />;
  }

  return children;
}
