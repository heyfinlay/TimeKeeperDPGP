/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/state/SessionContext.jsx', () => ({
  useSessionContext: vi.fn(),
  useSessionId: vi.fn(),
}));

vi.mock('../src/context/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../src/hooks/useSessionDrivers.js', () => ({
  useSessionDrivers: vi.fn(),
}));

function buildChannelMock() {
  const subscribe = vi.fn(() => ({ id: 'channel-1' }));
  const on = vi.fn(() => ({ subscribe }));
  return { channel: vi.fn(() => ({ on })), subscribe };
}

vi.mock('../src/lib/supabaseClient.js', () => {
  const { channel, subscribe } = buildChannelMock();
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: vi.fn(),
      channel,
      removeChannel: vi.fn(),
    },
    __channelSubscribe: subscribe,
  };
});

import ControlPanel from '../src/views/ControlPanel.jsx';
import { useSessionContext, useSessionId } from '../src/state/SessionContext.jsx';
import { useAuth } from '../src/context/AuthContext.jsx';
import { useSessionDrivers } from '../src/hooks/useSessionDrivers.js';
import { supabase, __channelSubscribe } from '../src/lib/supabaseClient.js';

describe('ControlPanel role resolution', () => {
  let setIntervalSpy;
  let clearIntervalSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    useSessionId.mockReturnValue('session-abcdef123456');
    useSessionDrivers.mockReturnValue({
      drivers: [],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
    setIntervalSpy = vi.spyOn(window, 'setInterval').mockImplementation(() => 1);
    clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
    supabase.from.mockImplementation((table) => {
      if (table === 'session_state') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    });
  });

  afterEach(() => {
    setIntervalSpy?.mockRestore();
    clearIntervalSpy?.mockRestore();
  });

  it('renders admin controls when session context grants admin access', async () => {
    const refreshMock = vi.fn();
    useSessionDrivers.mockReturnValue({
      drivers: [
        {
          id: 'driver-1',
          number: 7,
          name: 'Night Fury',
        },
      ],
      isLoading: false,
      error: null,
      refresh: refreshMock,
    });
    useSessionContext.mockReturnValue({ isAdmin: true });
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'admin-1' } });

    render(<ControlPanel />);

    expect(await screen.findByRole('heading', { name: /Race control/i })).toBeInTheDocument();
    expect(screen.getByText('Admin', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/Night Fury/)).toBeInTheDocument();
    const membershipCalls = supabase.from.mock.calls.filter(([table]) => table === 'session_members');
    expect(membershipCalls).toHaveLength(0);
    expect(__channelSubscribe).toHaveBeenCalled();
  });

  it('resolves marshal role via Supabase and refreshes drivers once available', async () => {
    const refreshMock = vi.fn();
    useSessionDrivers.mockReturnValue({
      drivers: [],
      isLoading: false,
      error: null,
      refresh: refreshMock,
    });
    useSessionContext.mockReturnValue({ isAdmin: false });
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'marshal-1' } });

    const maybeSingle = vi.fn(() =>
      Promise.resolve({
        data: { role: 'marshal' },
        error: null,
      }),
    );
    const eqUser = vi.fn((column, value) => {
      expect(column).toBe('user_id');
      expect(value).toBe('marshal-1');
      return { maybeSingle };
    });
    const eqSession = vi.fn((column, value) => {
      expect(column).toBe('session_id');
      expect(value).toBe('session-abcdef123456');
      return { eq: eqUser };
    });
    const select = vi.fn(() => ({ eq: eqSession }));

    supabase.from.mockImplementationOnce((table) => {
      expect(table).toBe('session_members');
      return { select };
    });

    render(<ControlPanel />);

    const marshalBadge = await screen.findByText('Marshal', { selector: 'span' });
    expect(marshalBadge).toBeInTheDocument();

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it('falls back to spectator messaging when membership has no marshal role', async () => {
    const refreshMock = vi.fn();
    useSessionDrivers.mockReturnValue({
      drivers: [],
      isLoading: false,
      error: null,
      refresh: refreshMock,
    });
    useSessionContext.mockReturnValue({ isAdmin: false });
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'viewer-1' } });

    const maybeSingle = vi.fn(() =>
      Promise.resolve({
        data: null,
        error: null,
      }),
    );
    const eqUser = vi.fn(() => ({ maybeSingle }));
    const eqSession = vi.fn(() => ({ eq: eqUser }));
    const select = vi.fn(() => ({ eq: eqSession }));

    supabase.from.mockImplementationOnce(() => ({ select }));

    render(<ControlPanel />);

    expect(await screen.findByText(/Spectator access/i)).toBeInTheDocument();
    const spectatorBadges = screen.getAllByText('Spectator', { selector: 'span' });
    expect(spectatorBadges.length).toBeGreaterThan(0);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('surfaces a clear message when Supabase reports infinite recursion', async () => {
    const refreshMock = vi.fn();
    useSessionDrivers.mockReturnValue({
      drivers: [],
      isLoading: false,
      error: null,
      refresh: refreshMock,
    });
    useSessionContext.mockReturnValue({ isAdmin: false });
    useAuth.mockReturnValue({ status: 'authenticated', user: { id: 'marshal-2' } });

    const maybeSingle = vi.fn(() =>
      Promise.resolve({
        data: null,
        error: { message: 'Infinite recursion detected in policy', code: 'PGRST301' },
      }),
    );
    const eqUser = vi.fn(() => ({ maybeSingle }));
    const eqSession = vi.fn(() => ({ eq: eqUser }));
    const select = vi.fn(() => ({ eq: eqSession }));

    supabase.from.mockImplementationOnce(() => ({ select }));

    render(<ControlPanel />);

    expect(
      await screen.findByText(
        /Session access is temporarily unavailable due to a Supabase policy issue/i,
      ),
    ).toBeInTheDocument();
    const spectatorBadges = screen.getAllByText('Spectator', { selector: 'span' });
    expect(spectatorBadges.length).toBeGreaterThan(0);
  });
});
