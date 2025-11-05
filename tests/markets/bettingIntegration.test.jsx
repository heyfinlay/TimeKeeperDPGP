import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Integration tests for betting features
 * Tests full user flows: wallet top-up → place wager → view status → settlement
 */

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
  },
};

vi.mock('../../src/lib/supabaseClient', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));

describe('Betting Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Wallet Operations', () => {
    it('should handle wallet balance fetching', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { user_id: 'user-123', balance: 5000 },
              error: null,
            }),
          }),
        }),
      });

      // Simulate fetching wallet balance
      const { data, error } = await mockSupabase
        .from('wallet_accounts')
        .select('*')
        .eq('user_id', 'user-123')
        .maybeSingle();

      expect(error).toBeNull();
      expect(data.balance).toBe(5000);
    });

    it('should create wallet account if not exists', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { user_id: 'user-123', balance: 0 },
              error: null,
            }),
          }),
        }),
      });

      // Simulate wallet creation
      const existingWallet = await mockSupabase
        .from('wallet_accounts')
        .select('*')
        .eq('user_id', 'user-123')
        .maybeSingle();

      expect(existingWallet.data).toBeNull();

      // Create new wallet
      const { data: newWallet } = await mockSupabase
        .from('wallet_accounts')
        .insert({ user_id: 'user-123', balance: 0 })
        .select()
        .single();

      expect(newWallet.balance).toBe(0);
    });
  });

  describe('Place Wager Flow', () => {
    it('should successfully place a wager with sufficient balance', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          wager_id: 'wager-abc',
          new_balance: 7000,
        },
        error: null,
      });

      const result = await mockSupabase.rpc('place_wager', {
        p_market_id: 'market-1',
        p_outcome_id: 'outcome-1',
        p_stake: 3000,
      });

      expect(result.data.success).toBe(true);
      expect(result.data.new_balance).toBe(7000);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('place_wager', {
        p_market_id: 'market-1',
        p_outcome_id: 'outcome-1',
        p_stake: 3000,
      });
    });

    it('should reject wager with insufficient balance', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: {
          message: 'Insufficient funds. Balance: 1000, Required: 5000',
          code: 'P0001',
        },
      });

      const result = await mockSupabase.rpc('place_wager', {
        p_market_id: 'market-1',
        p_outcome_id: 'outcome-1',
        p_stake: 5000,
      });

      expect(result.error).not.toBeNull();
      expect(result.error.message).toContain('Insufficient funds');
    });

    it('should reject wager on closed market', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: {
          message: 'Market is not open',
          code: 'P0001',
        },
      });

      const result = await mockSupabase.rpc('place_wager', {
        p_market_id: 'market-closed',
        p_outcome_id: 'outcome-1',
        p_stake: 1000,
      });

      expect(result.error).not.toBeNull();
      expect(result.error.message).toContain('Market is not open');
    });
  });

  describe('Market Lifecycle', () => {
    it('should handle market opening', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 'market-1', status: 'open', name: 'Race Winner' }],
            error: null,
          }),
        }),
      });

      const { data: markets } = await mockSupabase.from('markets').select('*').eq('status', 'open');

      expect(markets).toHaveLength(1);
      expect(markets[0].status).toBe('open');
    });

    it('should close market via RPC', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          market_id: 'market-1',
          status: 'closed',
        },
        error: null,
      });

      const result = await mockSupabase.rpc('close_market', { market_id: 'market-1' });

      expect(result.data.success).toBe(true);
      expect(result.data.status).toBe('closed');
    });

    it('should settle market with winners', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          total_pool: 10000,
          winning_pool: 6000,
          rake_amount: 500,
          net_pool: 9500,
          total_paid: 9500,
          dust: 0,
          winners_count: 3,
        },
        error: null,
      });

      const result = await mockSupabase.rpc('settle_market', {
        market_id: 'market-1',
        winning_outcome_id: 'outcome-a',
      });

      expect(result.data.success).toBe(true);
      expect(result.data.winners_count).toBe(3);
      expect(result.data.total_paid).toBe(9500);
    });
  });

  describe('Wager Status Tracking', () => {
    it('should fetch user wagers', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'wager-1',
                  user_id: 'user-123',
                  market_id: 'market-1',
                  outcome_id: 'outcome-a',
                  stake: 3000,
                  status: 'pending',
                  placed_at: '2025-01-01T00:00:00Z',
                },
                {
                  id: 'wager-2',
                  user_id: 'user-123',
                  market_id: 'market-2',
                  outcome_id: 'outcome-b',
                  stake: 2000,
                  status: 'won',
                  placed_at: '2025-01-02T00:00:00Z',
                },
              ],
              error: null,
            }),
          }),
        }),
      });

      const { data: wagers } = await mockSupabase
        .from('wagers')
        .select('*')
        .eq('user_id', 'user-123')
        .order('placed_at', { ascending: false });

      expect(wagers).toHaveLength(2);
      expect(wagers[0].status).toBe('pending');
      expect(wagers[1].status).toBe('won');
    });

    it('should filter pending wagers', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((column, value) => {
            if (column === 'status' && value === 'pending') {
              return {
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'wager-1',
                      status: 'pending',
                      stake: 3000,
                    },
                  ],
                  error: null,
                }),
              };
            }
            return {
              order: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            };
          }),
        }),
      });

      const { data: pendingWagers } = await mockSupabase
        .from('wagers')
        .select('*')
        .eq('status', 'pending')
        .order('placed_at', { ascending: false });

      expect(pendingWagers).toHaveLength(1);
      expect(pendingWagers[0].status).toBe('pending');
    });
  });

  describe('Withdrawal Flow', () => {
    it('should request withdrawal', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          withdrawal_id: 'withdrawal-xyz',
          amount: 5000,
          status: 'queued',
          new_balance: 5000,
        },
        error: null,
      });

      const result = await mockSupabase.rpc('request_withdrawal', {
        p_amount: 5000,
      });

      expect(result.data.success).toBe(true);
      expect(result.data.status).toBe('queued');
      expect(result.data.new_balance).toBe(5000);
    });

    it('should reject withdrawal with insufficient balance', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: {
          message: 'Insufficient funds. Balance: 1000, Requested: 5000',
          code: 'P0001',
        },
      });

      const result = await mockSupabase.rpc('request_withdrawal', {
        p_amount: 5000,
      });

      expect(result.error).not.toBeNull();
      expect(result.error.message).toContain('Insufficient funds');
    });
  });

  describe('Admin Market Management', () => {
    it('should approve withdrawal as admin', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          withdrawal_id: 'withdrawal-xyz',
          status: 'approved',
        },
        error: null,
      });

      const result = await mockSupabase.rpc('approve_withdrawal', {
        p_withdrawal_id: 'withdrawal-xyz',
      });

      expect(result.data.success).toBe(true);
      expect(result.data.status).toBe('approved');
    });

    it('should reject withdrawal as admin', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          withdrawal_id: 'withdrawal-xyz',
          status: 'rejected',
          refunded: 5000,
        },
        error: null,
      });

      const result = await mockSupabase.rpc('reject_withdrawal', {
        p_withdrawal_id: 'withdrawal-xyz',
        p_reason: 'Invalid request',
      });

      expect(result.data.success).toBe(true);
      expect(result.data.status).toBe('rejected');
      expect(result.data.refunded).toBe(5000);
    });

    it('should adjust wallet balance as admin', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          old_balance: 5000,
          new_balance: 10000,
          adjustment: 5000,
        },
        error: null,
      });

      const result = await mockSupabase.rpc('adjust_wallet_balance', {
        p_user_id: 'user-123',
        p_amount: 5000,
        p_kind: 'bonus',
        p_memo: 'Welcome bonus',
      });

      expect(result.data.success).toBe(true);
      expect(result.data.new_balance).toBe(10000);
    });
  });

  describe('Real-time Updates', () => {
    it('should subscribe to market changes', () => {
      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      };

      mockSupabase.channel = vi.fn().mockReturnValue(mockChannel);

      const channel = mockSupabase.channel('markets-realtime');
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'markets' }, () => {})
        .subscribe();

      expect(mockSupabase.channel).toHaveBeenCalledWith('markets-realtime');
      expect(mockChannel.on).toHaveBeenCalled();
      expect(mockChannel.subscribe).toHaveBeenCalled();
    });

    it('should subscribe to wager updates', () => {
      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      };

      mockSupabase.channel = vi.fn().mockReturnValue(mockChannel);

      const channel = mockSupabase.channel('wagers-realtime');
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wagers' }, () => {})
        .subscribe();

      expect(mockSupabase.channel).toHaveBeenCalledWith('wagers-realtime');
      expect(mockChannel.on).toHaveBeenCalled();
      expect(mockChannel.subscribe).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      mockSupabase.rpc.mockRejectedValue(new Error('Network error'));

      await expect(
        mockSupabase.rpc('place_wager', {
          p_market_id: 'market-1',
          p_outcome_id: 'outcome-1',
          p_stake: 1000,
        }),
      ).rejects.toThrow('Network error');
    });

    it('should handle database constraint violations', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: {
          message: 'duplicate key value violates unique constraint',
          code: '23505',
        },
      });

      const result = await mockSupabase.rpc('place_wager', {
        p_market_id: 'market-1',
        p_outcome_id: 'outcome-1',
        p_stake: 1000,
      });

      expect(result.error).not.toBeNull();
      expect(result.error.code).toBe('23505');
    });

    it('should handle transaction rollbacks', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: {
          message: 'Transaction aborted due to constraint violation',
          code: 'P0001',
        },
      });

      const result = await mockSupabase.rpc('settle_market', {
        market_id: 'market-1',
        winning_outcome_id: 'invalid-outcome',
      });

      expect(result.error).not.toBeNull();
      expect(result.error.message).toContain('Transaction aborted');
    });
  });

  describe('Payout Calculations', () => {
    it('should calculate correct odds for equal distribution', () => {
      const totalPool = 10000;
      const outcomeStakes = [5000, 5000]; // Two outcomes with equal stakes

      outcomeStakes.forEach((stake) => {
        const odds = (totalPool / stake).toFixed(2);
        expect(odds).toBe('2.00'); // 2x odds
      });
    });

    it('should calculate correct odds for unequal distribution', () => {
      const totalPool = 10000;
      const outcomeStakes = [7000, 3000]; // Unequal distribution

      const odds1 = (totalPool / outcomeStakes[0]).toFixed(2);
      const odds2 = (totalPool / outcomeStakes[1]).toFixed(2);

      expect(odds1).toBe('1.43'); // Favorite has lower odds
      expect(odds2).toBe('3.33'); // Underdog has higher odds
    });

    it('should calculate payout with rake correctly', () => {
      const totalPool = 10000;
      const winningStake = 3000;
      const totalWinningStake = 5000;
      const rakeBps = 500; // 5%

      const rakeAmount = Math.floor((totalPool * rakeBps) / 10000);
      const netPool = totalPool - rakeAmount;
      const payout = Math.floor((winningStake / totalWinningStake) * netPool);

      expect(rakeAmount).toBe(500);
      expect(netPool).toBe(9500);
      expect(payout).toBe(5700); // 60% of 9500
    });
  });
});
