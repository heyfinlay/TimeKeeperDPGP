import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';

export default function ControlGuard({ children }) {
  const { sessionId } = useParams();
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

        // Check if user is admin OR session creator OR session member
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError && profileError.code !== 'PGRST116') {
          throw profileError;
        }

        const isAdmin = profile?.role === 'admin';

        // If admin, allow access immediately
        if (isAdmin) {
          if (isActive) {
            setStatus('allowed');
          }
          return;
        }

        // Check if user is the session creator
        const { data: session, error: sessionError } = await supabase
          .from('sessions')
          .select('created_by')
          .eq('id', sessionId)
          .maybeSingle();

        if (sessionError && sessionError.code !== 'PGRST116') {
          throw sessionError;
        }

        if (session?.created_by === user.id) {
          if (isActive) {
            setStatus('allowed');
          }
          return;
        }

        // Check if user is a session member
        const { data: membership, error: memberError } = await supabase
          .from('session_members')
          .select('user_id')
          .eq('session_id', sessionId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (memberError && memberError.code !== 'PGRST116') {
          throw memberError;
        }

        const isMember = !!membership;

        if (isActive) {
          setStatus(isMember ? 'allowed' : 'forbidden');
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
  }, [sessionId]);

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
