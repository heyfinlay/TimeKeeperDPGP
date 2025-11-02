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
    const maybeSingle = vi.fn(() => Promise.resolve({
      data: { id: 'driver-1', marshal_user_id: 'marshal-1' },
      error: null,
    }));
    const select = vi.fn(() => ({ maybeSingle }));
    const secondEq = vi.fn(() => ({ select }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const update = vi.fn(() => ({ eq: firstEq }));
    const upsert = vi.fn(() => Promise.resolve({ error: null }));

    supabase.from.mockImplementation((table) => {
      if (table === 'drivers') {
        return { update };
      }
      if (table === 'session_members') {
        return { upsert };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await assignMarshalToDriver({
      sessionId: 'session-1',
      driverId: 'driver-1',
      marshalUserId: 'marshal-1',
    });

    expect(update).toHaveBeenCalledWith({ marshal_user_id: 'marshal-1' });
    expect(firstEq).toHaveBeenCalledWith('session_id', 'session-1');
    expect(secondEq).toHaveBeenCalledWith('id', 'driver-1');
    expect(select).toHaveBeenCalledWith('id, marshal_user_id, session_id, name, number');
    expect(maybeSingle).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      { session_id: 'session-1', user_id: 'marshal-1', role: 'marshal' },
      { onConflict: 'session_id,user_id' },
    );
    expect(result).toEqual({ id: 'driver-1', marshal_user_id: 'marshal-1' });
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
