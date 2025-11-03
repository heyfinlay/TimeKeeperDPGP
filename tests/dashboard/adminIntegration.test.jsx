import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../src/lib/supabaseClient.js', () => {
  const from = vi.fn();
  return {
    isSupabaseConfigured: true,
    supabase: { from },
  };
});

vi.mock('../../src/components/auth/AuthGuard.jsx', async () => {
  const actual = await vi.importActual('../../src/components/auth/AuthGuard.jsx');
  return {
    ...actual,
    useAdminAccess: () => ({ isAdmin: true }),
  };
});

import { supabase } from '../../src/lib/supabaseClient.js';
import { fetchAdminSessions, assignMarshalToDriver } from '../../src/services/admin.js';
import { SessionProvider, useSessionContext } from '../../src/state/SessionContext.jsx';

describe('admin integrations', () => {
  beforeEach(() => {
    supabase.from.mockReset();
  });

  test('fetchAdminSessions loads all sessions and drivers', async () => {
    const order = vi.fn(() => Promise.resolve({
      data: [
        {
          id: 'session-1',
          name: 'Night practice',
          status: 'active',
          drivers: [{ id: 'driver-1' }],
          session_members: [{ user_id: 'user-1', role: 'marshal' }],
        },
      ],
      error: null,
    }));
    const select = vi.fn(() => ({ order }));
    supabase.from.mockReturnValue({ select });

    const sessions = await fetchAdminSessions();

    expect(supabase.from).toHaveBeenCalledWith('sessions');
    expect(select).toHaveBeenCalledWith(
      'id, name, status, starts_at, ends_at, updated_at, created_at, drivers(id, name, number, marshal_user_id, team), session_members(user_id, role)',
    );
    expect(order).toHaveBeenCalledWith('updated_at', { ascending: false, nullsFirst: false });
    expect(sessions).toEqual([
      expect.objectContaining({ id: 'session-1', drivers: [{ id: 'driver-1' }] }),
    ]);
  });

  test('assignMarshalToDriver updates driver and ensures membership', async () => {
    const fetchMaybeSingle = vi.fn(() => Promise.resolve({
      data: { id: 'driver-1', marshal_user_id: 'marshal-1' },
      error: null,
    }));
    const fetchEqId = vi.fn(() => ({ maybeSingle: fetchMaybeSingle }));
    const fetchEqSession = vi.fn(() => ({ eq: fetchEqId }));
    const fetchSelect = vi.fn(() => ({ eq: fetchEqSession }));

    const updateMaybeSingle = vi.fn(() => Promise.resolve({
      data: { id: 'driver-1', marshal_user_id: 'marshal-1' },
      error: null,
    }));
    const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
    const updateEqId = vi.fn(() => ({ select: updateSelect }));
    const updateEqSession = vi.fn(() => ({ eq: updateEqId }));
    const update = vi.fn(() => ({ eq: updateEqSession }));

    const upsert = vi.fn(() => Promise.resolve({ error: null }));

    supabase.from
      .mockImplementationOnce((table) => {
        expect(table).toBe('drivers');
        return { select: fetchSelect };
      })
      .mockImplementationOnce((table) => {
        expect(table).toBe('drivers');
        return { update };
      })
      .mockImplementationOnce((table) => {
        expect(table).toBe('session_members');
        return { upsert };
      });

    const result = await assignMarshalToDriver({
      sessionId: 'session-1',
      driverId: 'driver-1',
      marshalUserId: 'marshal-1',
    });

    expect(fetchSelect).toHaveBeenCalledWith('id, marshal_user_id');
    expect(fetchEqSession).toHaveBeenCalledWith('session_id', 'session-1');
    expect(fetchEqId).toHaveBeenCalledWith('id', 'driver-1');
    expect(fetchMaybeSingle).toHaveBeenCalled();

    expect(update).toHaveBeenCalledWith({ marshal_user_id: 'marshal-1' });
    expect(updateEqSession).toHaveBeenCalledWith('session_id', 'session-1');
    expect(updateEqId).toHaveBeenCalledWith('id', 'driver-1');
    expect(updateSelect).toHaveBeenCalledWith('id, marshal_user_id, session_id, name, number');
    expect(updateMaybeSingle).toHaveBeenCalled();

    expect(upsert).toHaveBeenCalledWith(
      { session_id: 'session-1', user_id: 'marshal-1', role: 'marshal' },
      { onConflict: 'session_id,user_id' },
    );
    expect(result).toEqual({ id: 'driver-1', marshal_user_id: 'marshal-1' });
  });

  test('assignMarshalToDriver revokes previous marshal when unassigned', async () => {
    const fetchMaybeSingle = vi.fn(() => Promise.resolve({
      data: { id: 'driver-1', marshal_user_id: 'marshal-old' },
      error: null,
    }));
    const fetchEqId = vi.fn(() => ({ maybeSingle: fetchMaybeSingle }));
    const fetchEqSession = vi.fn(() => ({ eq: fetchEqId }));
    const fetchSelect = vi.fn(() => ({ eq: fetchEqSession }));

    const updateMaybeSingle = vi.fn(() => Promise.resolve({
      data: { id: 'driver-1', marshal_user_id: null },
      error: null,
    }));
    const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
    const updateEqId = vi.fn(() => ({ select: updateSelect }));
    const updateEqSession = vi.fn(() => ({ eq: updateEqId }));
    const update = vi.fn(() => ({ eq: updateEqSession }));

    const countEqMarshal = vi.fn(() => Promise.resolve({ data: null, error: null, count: 0 }));
    const countEqSession = vi.fn(() => ({ eq: countEqMarshal }));
    const countSelect = vi.fn(() => ({ eq: countEqSession }));

    const deleteEqRole = vi.fn(() => Promise.resolve({ error: null }));
    const deleteEqUser = vi.fn(() => ({ eq: deleteEqRole }));
    const deleteEqSession = vi.fn(() => ({ eq: deleteEqUser }));
    const destroy = vi.fn(() => ({ eq: deleteEqSession }));

    supabase.from
      .mockImplementationOnce((table) => {
        expect(table).toBe('drivers');
        return { select: fetchSelect };
      })
      .mockImplementationOnce((table) => {
        expect(table).toBe('drivers');
        return { update };
      })
      .mockImplementationOnce((table) => {
        expect(table).toBe('drivers');
        return { select: countSelect };
      })
      .mockImplementationOnce((table) => {
        expect(table).toBe('session_members');
        return { delete: destroy };
      });

    await assignMarshalToDriver({
      sessionId: 'session-1',
      driverId: 'driver-1',
      marshalUserId: null,
    });

    expect(fetchSelect).toHaveBeenCalledWith('id, marshal_user_id');
    expect(fetchMaybeSingle).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ marshal_user_id: null });
    expect(countSelect).toHaveBeenCalledWith('id', { head: true, count: 'exact' });
    expect(countEqSession).toHaveBeenCalledWith('session_id', 'session-1');
    expect(countEqMarshal).toHaveBeenCalledWith('marshal_user_id', 'marshal-old');
    expect(destroy).toHaveBeenCalled();
    expect(deleteEqSession).toHaveBeenCalledWith('session_id', 'session-1');
    expect(deleteEqUser).toHaveBeenCalledWith('user_id', 'marshal-old');
    expect(deleteEqRole).toHaveBeenCalledWith('role', 'marshal');
  });

  test('SessionProvider surfaces admin privileges for control access', () => {
    let context;
    function Consumer() {
      context = useSessionContext();
      return null;
    }

    renderToString(
      <SessionProvider sessionId="session-42">
        <Consumer />
      </SessionProvider>,
    );

    expect(context).toEqual({ sessionId: 'session-42', isAdmin: true });
  });
});
