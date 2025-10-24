import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

const AuthContext = createContext({
  status: isSupabaseConfigured ? 'loading' : 'disabled',
  user: null,
  profile: null,
  profileError: null,
  isHydratingProfile: false,
  signInWithDiscord: () => Promise.resolve(),
  signOut: () => Promise.resolve(),
});

const DEFAULT_PROFILE = {
  id: null,
  role: 'marshal',
  display_name: null,
  ic_phone_number: null,
  assigned_driver_ids: [],
  team_id: null,
  tier: null,
  experience_points: 0,
};

const isNoRowError = (error) => error?.code === 'PGRST116';

export const AuthProvider = ({ children }) => {
  const [status, setStatus] = useState(isSupabaseConfigured ? 'loading' : 'disabled');
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [isHydratingProfile, setIsHydratingProfile] = useState(false);
  const fetchingProfileRef = useRef(false);

  const hydrateProfile = useCallback(async (nextUser) => {
    if (!isSupabaseConfigured || !supabase || !nextUser) {
      setProfile(null);
      setProfileError(null);
      setIsHydratingProfile(false);
      return;
    }
    if (fetchingProfileRef.current) return;
    fetchingProfileRef.current = true;
    setIsHydratingProfile(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', nextUser.id)
        .maybeSingle();
      if (error && !isNoRowError(error)) {
        throw error;
      }
      if (!data) {
        const displayName =
          nextUser.user_metadata?.full_name ||
          nextUser.user_metadata?.name ||
          nextUser.email ||
          'Marshal';
        const { data: created, error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: nextUser.id,
            role: 'marshal',
            display_name: displayName,
            ic_phone_number: null,
          })
          .select()
          .single();
        if (insertError) {
          throw insertError;
        }
        setProfile(created ?? { ...DEFAULT_PROFILE, id: nextUser.id, display_name: displayName });
      } else {
        setProfile({ ...DEFAULT_PROFILE, ...data });
      }
      setProfileError(null);
    } catch (error) {
      console.error('Failed to load profile', error);
      setProfileError(error);
      setProfile(null);
    } finally {
      fetchingProfileRef.current = false;
      setIsHydratingProfile(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setStatus('disabled');
      return;
    }
    let isMounted = true;
    const syncSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;
      if (error) {
        console.error('Failed to fetch Supabase session', error);
        setStatus('unauthenticated');
        setUser(null);
        setProfile(null);
        return;
      }
      const sessionUser = data?.session?.user ?? null;
      setUser(sessionUser);
      setStatus(sessionUser ? 'authenticated' : 'unauthenticated');
      if (sessionUser) {
        void hydrateProfile(sessionUser);
      } else {
        setProfile(null);
        setProfileError(null);
        setIsHydratingProfile(false);
      }
    };

    void syncSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);
      setStatus(sessionUser ? 'authenticated' : 'unauthenticated');
      if (sessionUser) {
        void hydrateProfile(sessionUser);
      } else {
        setProfile(null);
        setProfileError(null);
        setIsHydratingProfile(false);
      }
    });

    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [hydrateProfile]);

  const AUTH_CALLBACK_URL = useMemo(() => {
    const fallback = (() => {
      if (typeof window !== 'undefined' && window?.location?.origin) {
        return `${window.location.origin.replace(/\/$/, '')}/auth/callback`;
      }
      return 'https://time-keeper-dpgp.vercel.app/auth/callback';
    })();

    const configured = import.meta.env.VITE_AUTH_CALLBACK_URL;
    if (typeof configured !== 'string' || configured.length === 0) {
      return fallback;
    }

    try {
      const parsed = new URL(configured);
      if (parsed.hostname.includes('supabase.co')) {
        console.warn('Ignoring Supabase-hosted auth callback URL; falling back to application route.');
        return fallback;
      }
      return configured;
    } catch (error) {
      console.warn('Invalid auth callback URL provided; falling back to application route.', error);
      return fallback;
    }
  }, []);

  const signInWithDiscord = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: AUTH_CALLBACK_URL,
      },
    });
    if (error) {
      console.error('Discord sign-in failed', error);
    }
  }, [AUTH_CALLBACK_URL]);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Sign-out failed', error);
    }
  }, []);

  const updateProfile = useCallback(
    async (patch = {}) => {
      if (!isSupabaseConfigured || !supabase || !user) {
        throw new Error('Cannot update profile without an authenticated Supabase session.');
      }

      const { data: updated, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user.id)
        .select()
        .maybeSingle();

      if (error) {
        throw error;
      }

      const nextProfile = updated ? { ...DEFAULT_PROFILE, ...updated } : null;
      setProfile(nextProfile);
      return nextProfile;
    },
    [user, isSupabaseConfigured],
  );

  const value = useMemo(
    () => ({
      status,
      user,
      profile,
      profileError,
      isHydratingProfile,
      signInWithDiscord,
      signOut,
      updateProfile,
      isSupabaseConfigured,
    }),
    [
      status,
      user,
      profile,
      profileError,
      isHydratingProfile,
      signInWithDiscord,
      signOut,
      updateProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
