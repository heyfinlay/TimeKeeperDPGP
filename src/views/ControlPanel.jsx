import { useEffect, useMemo, useRef, useState } from 'react';
import DriverTimingPanel from '@/components/DriverTimingPanel.jsx';
import { useSessionContext, useSessionId } from '@/state/SessionContext.jsx';
import { useSessionDrivers } from '@/hooks/useSessionDrivers.js';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';
import { useAuth } from '@/context/AuthContext.jsx';

const roleLabels = {
  admin: 'Admin',
  marshal: 'Marshal',
  spectator: 'Spectator',
};

const toPanelDriver = (driver) => ({
  id: driver.id,
  number: driver.number ?? null,
  name: driver.name ?? 'Driver',
  team: driver.team ?? null,
  laps: Number.isFinite(driver.laps) ? driver.laps : Number.parseInt(driver.laps, 10) || 0,
  last_lap_ms:
    driver.last_lap_ms === null || driver.last_lap_ms === undefined
      ? null
      : Number.isFinite(driver.last_lap_ms)
        ? driver.last_lap_ms
        : Number.parseInt(driver.last_lap_ms, 10) || null,
  best_lap_ms:
    driver.best_lap_ms === null || driver.best_lap_ms === undefined
      ? null
      : Number.isFinite(driver.best_lap_ms)
        ? driver.best_lap_ms
        : Number.parseInt(driver.best_lap_ms, 10) || null,
  pits: Number.isFinite(driver.pits) ? driver.pits : Number.parseInt(driver.pits, 10) || 0,
  total_time_ms:
    driver.total_time_ms === null || driver.total_time_ms === undefined
      ? null
      : Number.isFinite(driver.total_time_ms)
        ? driver.total_time_ms
        : Number.parseInt(driver.total_time_ms, 10) || null,
});

export default function ControlPanel() {
  const sessionId = useSessionId();
  const { isAdmin: hasAdminAccess } = useSessionContext();
  const { status, user } = useAuth();
  const [userId, setUserId] = useState(null);
  const [role, setRole] = useState(null);
  const [roleError, setRoleError] = useState(null);
  const [isRoleLoading, setIsRoleLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    let isMounted = true;
    if (!isSupabaseConfigured || !supabase) {
      setUserId(user?.id ?? null);
      setRole('admin');
      setRoleError(null);
      setIsRoleLoading(false);
      return () => {
        isMounted = false;
      };
    }

    if (hasAdminAccess) {
      setUserId(user?.id ?? null);
      setRole('admin');
      setRoleError(null);
      setIsRoleLoading(false);
      return () => {
        isMounted = false;
      };
    }

    if (status !== 'authenticated' || !user) {
      setUserId(null);
      setRole('spectator');
      setRoleError(null);
      setIsRoleLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setIsRoleLoading(true);
    setRoleError(null);
    setUserId(user.id);

    const loadRole = async () => {
      try {
        const { data: membership, error: membershipError } = await supabase
          .from('session_members')
          .select('role')
          .eq('session_id', sessionId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (membershipError && membershipError.code !== 'PGRST116' && membershipError.code !== 'PGRST123') {
          throw membershipError;
        }
        if (!isMounted) return;
        const membershipRole = typeof membership?.role === 'string' ? membership.role.toLowerCase() : null;
        setRole(membershipRole ?? 'spectator');
        setIsRoleLoading(false);
      } catch (error) {
        console.error('Failed to resolve session role', error);
        if (!isMounted) return;
        const rawMessage = error?.message ?? error?.supabaseMessage ?? '';
        const normalizedMessage = typeof rawMessage === 'string' ? rawMessage.toLowerCase() : '';
        if (normalizedMessage.includes('infinite recursion')) {
          setRoleError(
            'Session access is temporarily unavailable due to a Supabase policy issue. Please contact an administrator to restore marshal permissions.',
          );
        } else {
          setRoleError(rawMessage || 'Unable to determine session role.');
        }
        setRole('spectator');
        setIsRoleLoading(false);
      }
    };

    void loadRole();

    return () => {
      isMounted = false;
    };
  }, [sessionId, hasAdminAccess, user?.id, status]);

  const baseRole = useMemo(() => {
    if (!isSupabaseConfigured || hasAdminAccess) {
      return 'admin';
    }
    return role ?? 'spectator';
  }, [hasAdminAccess, role]);

  const driverScope = useMemo(() => {
    const isAdmin = baseRole === 'admin';
    const restrictToMarshal = baseRole === 'marshal';
    if (!isSupabaseConfigured) {
      return { onlyMine: false, userId: null, isAdmin: true };
    }
    if (isAdmin) {
      return { onlyMine: false, userId: userId ?? null, isAdmin: true };
    }
    if (restrictToMarshal) {
      return { onlyMine: true, userId: userId ?? null, isAdmin: false };
    }
    return { onlyMine: true, userId: userId ?? null, isAdmin: false };
  }, [baseRole, userId]);

  const { drivers, isLoading: isDriversLoading, error: driversError, refresh } =
    useSessionDrivers({
      onlyMine: driverScope.onlyMine && !!driverScope.userId,
      userId: driverScope.onlyMine ? driverScope.userId ?? undefined : undefined,
    });

  const hasMarshalAssignment = useMemo(() => {
    if (!userId || !Array.isArray(drivers)) return false;
    return drivers.some((driver) => driver.marshal_user_id === userId);
  }, [drivers, userId]);

  const effectiveRole = useMemo(() => {
    if (!isSupabaseConfigured || hasAdminAccess) {
      return 'admin';
    }
    if (baseRole === 'admin' || baseRole === 'marshal') {
      return baseRole;
    }
    if (hasMarshalAssignment) {
      return 'marshal';
    }
    return baseRole;
  }, [baseRole, hasAdminAccess, hasMarshalAssignment]);

  const canWrite =
    !isSupabaseConfigured || effectiveRole === 'admin' || effectiveRole === 'marshal';
  const roleLabel = roleLabels[effectiveRole] ?? 'Spectator';

  const lastRoleRef = useRef(effectiveRole);

  useEffect(() => {
    const hasRoleChanged = lastRoleRef.current !== effectiveRole;
    lastRoleRef.current = effectiveRole;
    if (
      !isSupabaseConfigured ||
      isRoleLoading ||
      !refresh ||
      !hasRoleChanged ||
      (effectiveRole !== 'marshal' && effectiveRole !== 'admin')
    ) {
      return;
    }
    void refresh();
  }, [effectiveRole, isRoleLoading, refresh]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold text-white">Race control</h1>
        <p className="text-sm text-neutral-400">Manage lap timing and marshal operations for the active session.</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs uppercase tracking-[0.35em] text-neutral-400">
          <span className="rounded-full border border-white/10 px-4 py-2 text-white/80">Session {sessionId.slice(0, 8)}…</span>
          <span className="rounded-full border border-white/5 bg-white/5 px-4 py-2 text-white/90">{roleLabel}</span>
          <button
            type="button"
            onClick={() => refresh?.()}
            disabled={isDriversLoading}
            className="rounded-full border border-white/10 px-4 py-2 font-semibold uppercase tracking-[0.35em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDriversLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>
      {roleError ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">{roleError}</div>
      ) : null}
      {driversError ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">
          {driversError}
        </div>
      ) : null}
      {isRoleLoading ? (
        <div className="flex min-h-[20vh] items-center justify-center text-sm text-neutral-400">Resolving access…</div>
      ) : null}
      {!isRoleLoading && effectiveRole === 'spectator' && isSupabaseConfigured ? (
        <div className="rounded-3xl border border-white/5 bg-[#060910]/80 px-6 py-5 text-center text-sm text-neutral-300">
          <p className="text-base font-semibold text-white">Spectator access</p>
          <p className="mt-2 text-neutral-400">
            You do not have marshal permissions for this session. Timing data will appear once a marshal assigns you to drivers.
          </p>
        </div>
      ) : null}
      <section className="rounded-3xl border border-white/5 bg-[#05070F]/80 p-6">
        {isDriversLoading && !drivers.length ? (
          <p className="text-sm text-neutral-400">Loading drivers…</p>
        ) : null}
        {!isDriversLoading && drivers.length === 0 ? (
          <p className="text-sm text-neutral-400">No drivers are available for this session.</p>
        ) : null}
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {drivers.map((driver) => (
            <DriverTimingPanel key={driver.id} driver={toPanelDriver(driver)} canWrite={canWrite} />
          ))}
        </div>
      </section>
    </div>
  );
}
