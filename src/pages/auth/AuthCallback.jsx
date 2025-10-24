import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient.js';

const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    const resolveRedirect = async () => {
      if (!isSupabaseConfigured || !supabase) {
        navigate('/', { replace: true });
        return;
      }

      try {
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
  }, [navigate]);

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
