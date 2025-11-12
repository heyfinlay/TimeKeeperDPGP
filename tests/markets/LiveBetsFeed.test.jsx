/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabaseClient.js', () => ({
  isSupabaseConfigured: true,
  supabaseSelect: vi.fn(),
  subscribeToTable: vi.fn(() => () => {}),
  isTableMissingError: vi.fn(() => false),
}));

const { default: LiveBetsFeed } = await import('@/components/markets/LiveBetsFeed.jsx');
const supabaseClient = await import('@/lib/supabaseClient.js');

describe('LiveBetsFeed', () => {
  beforeEach(() => {
    supabaseClient.supabaseSelect.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders wager entries with bettor alias and stake', async () => {
    supabaseClient.supabaseSelect.mockResolvedValueOnce([
      {
        id: 'wager-1',
        stake: 1500,
        placed_at: '2025-01-01T00:04:00Z',
        market_id: 'market-1',
        outcomes: { label: 'Driver Alpha' },
        profiles: { display_name: 'StormChaser' },
      },
      {
        id: 'wager-2',
        stake: 750,
        placed_at: '2025-01-01T00:03:30Z',
        market_id: 'market-1',
        outcomes: { label: 'Driver Beta' },
        profiles: { handle: 'gridmaster' },
      },
    ]);

    render(<LiveBetsFeed marketId="market-1" />);

    expect(await screen.findByText('StormChaser')).toBeInTheDocument();
    expect(supabaseClient.supabaseSelect).toHaveBeenCalled();
    expect(screen.getByText('Driver Alpha')).toBeInTheDocument();
    expect(screen.getByText('gridmaster')).toBeInTheDocument();
    expect(screen.getByText(/💎 1,500/)).toBeInTheDocument();
    expect(screen.getByText(/💎 750/)).toBeInTheDocument();
  });

  it('renders empty state when no wagers are returned', async () => {
    supabaseClient.supabaseSelect.mockResolvedValueOnce([]);

    render(<LiveBetsFeed marketId="market-9" />);

    expect(await screen.findByText('No bets have been placed on this market yet.')).toBeInTheDocument();
    expect(supabaseClient.supabaseSelect).toHaveBeenCalled();
  });
});
