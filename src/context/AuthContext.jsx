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
import { ensureProfileForCurrentUser, saveProfile } from '../lib/profile.js';

const AuthContext = createContext({
  status: isSupabaseConfigured ? 'loading' : 'disabled',
  user: null,
  profile: null,
  signInWithDiscord: () => Promise.resolve(),
  signOut: () => Promise.resolve(),
  updateProfile: () => Promise.resolve(),
});

const DEFAULT_PROFILE = {
  id: null,
  role: 'marshal',
  display_name: null,
  assigned_driver_ids: [],
  team_id: null,
};

const normaliseRole = (role) => {
  if (typeof role !== 'string') {
    return null;
  }
  const trimmed = role.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

const applyProfileDefaults = (profile = {}) => {
  const resolvedRole = normaliseRole(profile.role) ?? DEFAULT_PROFILE.role;
  return { ...DEFAULT_PROFILE, ...profile, role: resolvedRole };
};

const isNoRowError = (error) => error?.code === 'PGRST116';

export const AuthProvider = ({ children }) => {
  const [status, setStatus] = useState(isSupabaseConfigured ? 'loading' : 'disabled');
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const fetchingProfileRef = useRef(false);

  const hydrateProfile = useCallback(async (nextUser) => {
    if (!isSupabaseConfigured || !supabase || !nextUser) {
      setProfile(null);
      return;
    }
    if (fetchingProfileRef.current) return;
    fetchingProfileRef.current = true;
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
        const ensuredProfile = await ensureProfileForCurrentUser(
          { displayName, role: DEFAULT_PROFILE.role },
          { supabase },
        );
        const fallbackProfile = { ...DEFAULT_PROFILE, id: nextUser.id, display_name: displayName };
        const baseProfile = ensuredProfile ?? fallbackProfile;
        setProfile(applyProfileDefaults(baseProfile));
      } else {
        setProfile(applyProfileDefaults(data));
      }
      setProfileError(null);
    } catch (error) {
      console.error('Failed to load profile', error);
      setProfileError(error);
      setProfile(null);
    } finally {
      fetchingProfileRef.current = false;
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
      }
    });

    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [hydrateProfile]);

  const signInWithDiscord = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: redirectTo ? { redirectTo } : {},
    });
    if (error) {
      console.error('Discord sign-in failed', error);
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Sign-out failed', error);
    }
  }, []);

  const updateProfile = useCallback(
    async (patch = {}) => {
      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase is not configured.');
      }
      try {
        const updated = await saveProfile(patch, { supabase, userId: user?.id });
        if (updated) {
          setProfile(applyProfileDefaults(updated));
          setProfileError(null);
        }
        return updated;
      } catch (updateError) {
        console.error('Failed to update profile', updateError);
        throw updateError;
      }
    },
    [user?.id],
  );

  const value = useMemo(
    () => ({
      status,
      user,
      profile,
      profileError,
      signInWithDiscord,
      signOut,
      isSupabaseConfigured,
      updateProfile,
    }),
    [status, user, profile, profileError, signInWithDiscord, signOut, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
