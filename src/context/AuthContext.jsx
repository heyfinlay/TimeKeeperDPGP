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
import { resolveProfileRole, saveProfile } from '../lib/profile.js';

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

const collectRoleClaims = (user) => {
  if (!user) return [];
  const claims = [];
  const appMeta = user.app_metadata ?? {};
  const userMeta = user.user_metadata ?? {};

  if (Array.isArray(appMeta.roles)) {
    claims.push(...appMeta.roles);
  }
  if (typeof appMeta.role === 'string') {
    claims.push(appMeta.role);
  }
  if (Array.isArray(userMeta.roles)) {
    claims.push(...userMeta.roles);
  }
  if (typeof userMeta.role === 'string') {
    claims.push(userMeta.role);
  }

  return claims;
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
      const roleClaims = collectRoleClaims(nextUser);
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
        const roleToInsert = resolveProfileRole({ role: 'marshal' }, { claims: roleClaims });
        const { data: created, error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: nextUser.id,
            role: roleToInsert,
            display_name: displayName,
          })
          .select()
          .single();
        if (insertError) {
          throw insertError;
        }
        const fallbackProfile = { ...DEFAULT_PROFILE, id: nextUser.id, display_name: displayName };
        const baseProfile = created ?? fallbackProfile;
        const role = resolveProfileRole(baseProfile, { claims: roleClaims });
        setProfile({ ...DEFAULT_PROFILE, ...baseProfile, role });
      } else {
        const role = resolveProfileRole(data, { claims: roleClaims });
        setProfile({ ...DEFAULT_PROFILE, ...data, role });
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
          const roleClaims = collectRoleClaims(user);
          const role = resolveProfileRole(updated, { claims: roleClaims });
          setProfile({ ...DEFAULT_PROFILE, ...updated, role });
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
