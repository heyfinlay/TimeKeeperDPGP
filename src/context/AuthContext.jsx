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
};

const PROFILE_COLUMNS =
  'id, role, display_name, ic_phone_number, assigned_driver_ids, team_id';
const MUTABLE_PROFILE_FIELDS = new Set([
  'display_name',
  'role',
  'ic_phone_number',
  'assigned_driver_ids',
  'team_id',
]);

const isNoRowError = (error) => error?.code === 'PGRST116';

export const AuthProvider = ({ children }) => {
  const [status, setStatus] = useState(isSupabaseConfigured ? 'loading' : 'disabled');
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [isHydratingProfile, setIsHydratingProfile] = useState(false);
  const fetchingProfileRef = useRef({ userId: null, promise: null });
  const activeProfileRequestsRef = useRef(0);

  const hydrateProfile = useCallback(async (nextUser) => {
    if (!isSupabaseConfigured || !supabase || !nextUser) {
      fetchingProfileRef.current = { userId: null, promise: null };
      activeProfileRequestsRef.current = 0;
      setProfile(null);
      setProfileError(null);
      setIsHydratingProfile(false);
      return null;
    }
    const userId = nextUser.id;
    if (!userId) {
      fetchingProfileRef.current = { userId: null, promise: null };
      activeProfileRequestsRef.current = 0;
      setProfile(null);
      setProfileError(null);
      setIsHydratingProfile(false);
      return null;
    }

    if (
      fetchingProfileRef.current.promise &&
      fetchingProfileRef.current.userId === userId
    ) {
      return fetchingProfileRef.current.promise;
    }

    activeProfileRequestsRef.current += 1;
    setIsHydratingProfile(true);
    setProfileError(null);

    const profilePromise = (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select(
            'id, role, display_name, ic_phone_number, assigned_driver_ids, team_id, tier, experience_points',
          )
          .eq('id', userId)
          .maybeSingle();

        if (error && !isNoRowError(error)) {
          throw error;
        }

        let hydratedProfile = null;

        if (!data) {
          const displayName =
            nextUser.user_metadata?.full_name ||
            nextUser.user_metadata?.name ||
            nextUser.email ||
            'Marshal';

          const { data: created, error: insertError } = await supabase
            .from('profiles')
            .insert({
              id: userId,
              role: 'marshal',
              display_name: displayName,
            })
            .select(
              'id, role, display_name, ic_phone_number, assigned_driver_ids, team_id, tier, experience_points',
            )
            .single();

          if (insertError) {
            throw insertError;
          }

          hydratedProfile =
            created ?? { ...DEFAULT_PROFILE, id: userId, display_name: displayName };
        } else {
          hydratedProfile = { ...DEFAULT_PROFILE, ...data };
        }

        setProfile(hydratedProfile);
        setProfileError(null);
        return hydratedProfile;
      } catch (error) {
        console.error('Failed to load profile', error);
        setProfileError(error);
        setProfile(null);
        throw error;
      } finally {
        if (fetchingProfileRef.current.userId === userId) {
          fetchingProfileRef.current = { userId: null, promise: null };
        }
        activeProfileRequestsRef.current = Math.max(0, activeProfileRequestsRef.current - 1);
        setIsHydratingProfile(activeProfileRequestsRef.current > 0);
      }
    })();

    fetchingProfileRef.current = { userId, promise: profilePromise };
    return profilePromise;
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
      if (!sessionUser) {
        fetchingProfileRef.current = { userId: null, promise: null };
        activeProfileRequestsRef.current = 0;
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
      if (!sessionUser) {
        fetchingProfileRef.current = { userId: null, promise: null };
        activeProfileRequestsRef.current = 0;
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

  useEffect(() => {
    if (!user) {
      return;
    }
    const profilePromise = hydrateProfile(user);
    if (profilePromise && typeof profilePromise.catch === 'function') {
      profilePromise.catch(() => {});
    }
  }, [hydrateProfile, user]);

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

      const filteredPatch = Object.fromEntries(
        Object.entries(patch).filter(([key]) => MUTABLE_PROFILE_FIELDS.has(key)),
      );

      if (Object.keys(filteredPatch).length === 0) {
        return profile;
      }

      const { data: updated, error } = await supabase
        .from('profiles')
        .update(filteredPatch)
        .eq('id', user.id)
        .select(PROFILE_COLUMNS)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const nextProfile = updated ? { ...DEFAULT_PROFILE, ...updated } : null;
      setProfile(nextProfile);
      return nextProfile;
    },
    [user, isSupabaseConfigured, profile],
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
    [status, user, profile, profileError, signInWithDiscord, signOut, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
