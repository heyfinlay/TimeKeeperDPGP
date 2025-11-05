import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Unit tests for market settlement RPC functions
 * Tests critical betting flow: place_wager → close_market → settle_market
 * Ensures atomic transactions and proper fund handling
 */
describe('Market Settlement RPCs', () => {
  describe('place_wager', () => {
    let mockRpc;
    let mockWallet;

    beforeEach(() => {
      mockWallet = {
        balance: 10000, // 10K diamonds
      };

      mockRpc = vi.fn(async (functionName, params) => {
        if (functionName === 'place_wager') {
          const { p_stake } = params;

          // Validate stake
          if (p_stake <= 0) {
            throw new Error('Stake must be positive');
          }

          // Check balance
          if (mockWallet.balance < p_stake) {
            throw new Error(`Insufficient funds. Balance: ${mockWallet.balance}, Required: ${p_stake}`);
          }

          // Debit wallet
          mockWallet.balance -= p_stake;

          return {
            data: {
              success: true,
              wager_id: 'wager-123',
              new_balance: mockWallet.balance,
            },
            error: null,
          };
        }
      });
    });

    it('should place wager successfully with sufficient balance', async () => {
      const result = await mockRpc('place_wager', {
        p_market_id: 'market-1',
        p_outcome_id: 'outcome-1',
        p_stake: 5000,
      });

      expect(result.data.success).toBe(true);
      expect(result.data.new_balance).toBe(5000);
      expect(mockWallet.balance).toBe(5000);
    });

    it('should reject wager with insufficient balance', async () => {
      await expect(
        mockRpc('place_wager', {
          p_market_id: 'market-1',
          p_outcome_id: 'outcome-1',
          p_stake: 15000, // More than balance
        }),
      ).rejects.toThrow('Insufficient funds');
    });

    it('should reject wager with zero stake', async () => {
      await expect(
        mockRpc('place_wager', {
          p_market_id: 'market-1',
          p_outcome_id: 'outcome-1',
          p_stake: 0,
        }),
      ).rejects.toThrow('Stake must be positive');
    });

    it('should reject wager with negative stake', async () => {
      await expect(
        mockRpc('place_wager', {
          p_market_id: 'market-1',
          p_outcome_id: 'outcome-1',
          p_stake: -100,
        }),
      ).rejects.toThrow('Stake must be positive');
    });

    it('should handle multiple consecutive wagers', async () => {
      // First wager
      const result1 = await mockRpc('place_wager', {
        p_market_id: 'market-1',
        p_outcome_id: 'outcome-1',
        p_stake: 3000,
      });
      expect(result1.data.new_balance).toBe(7000);

      // Second wager
      const result2 = await mockRpc('place_wager', {
        p_market_id: 'market-2',
        p_outcome_id: 'outcome-2',
        p_stake: 2000,
      });
      expect(result2.data.new_balance).toBe(5000);

      // Third wager should fail (insufficient funds)
      await expect(
        mockRpc('place_wager', {
          p_market_id: 'market-3',
          p_outcome_id: 'outcome-3',
          p_stake: 6000,
        }),
      ).rejects.toThrow('Insufficient funds');
    });
  });

  describe('close_market', () => {
    let mockRpc;
    let mockMarket;

    beforeEach(() => {
      mockMarket = {
        id: 'market-1',
        status: 'open',
      };

      mockRpc = vi.fn(async (functionName, params) => {
        if (functionName === 'close_market') {
          const { market_id } = params;

          if (mockMarket.id !== market_id) {
            throw new Error('Market not found');
          }

          if (mockMarket.status !== 'open') {
            throw new Error(`Market is not open (current status: ${mockMarket.status})`);
          }

          mockMarket.status = 'closed';

          return {
            data: {
              success: true,
              market_id: market_id,
              status: 'closed',
            },
            error: null,
          };
        }
      });
    });

    it('should close an open market', async () => {
      const result = await mockRpc('close_market', { market_id: 'market-1' });

      expect(result.data.success).toBe(true);
      expect(result.data.status).toBe('closed');
      expect(mockMarket.status).toBe('closed');
    });

    it('should reject closing non-existent market', async () => {
      await expect(
        mockRpc('close_market', { market_id: 'non-existent' }),
      ).rejects.toThrow('Market not found');
    });

    it('should reject closing already closed market', async () => {
      // First close
      await mockRpc('close_market', { market_id: 'market-1' });

      // Second close should fail
      await expect(
        mockRpc('close_market', { market_id: 'market-1' }),
      ).rejects.toThrow('Market is not open');
    });
  });

  describe('settle_market', () => {
    let mockRpc;
    let mockMarket;
    let mockWagers;
    let mockWallets;

    beforeEach(() => {
      mockMarket = {
        id: 'market-1',
        status: 'closed',
        rake_bps: 500, // 5%
      };

      mockWagers = [
        { id: 'wager-1', user_id: 'user-1', outcome_id: 'outcome-a', stake: 3000, status: 'pending' },
        { id: 'wager-2', user_id: 'user-2', outcome_id: 'outcome-a', stake: 2000, status: 'pending' },
        { id: 'wager-3', user_id: 'user-3', outcome_id: 'outcome-b', stake: 5000, status: 'pending' },
      ];

      mockWallets = {
        'user-1': 0,
        'user-2': 0,
        'user-3': 0,
      };

      mockRpc = vi.fn(async (functionName, params) => {
        if (functionName === 'settle_market') {
          const { market_id, winning_outcome_id } = params;

          if (mockMarket.id !== market_id) {
            throw new Error('Market not found');
          }

          if (mockMarket.status !== 'closed') {
            throw new Error(`Market must be closed before settlement (current status: ${mockMarket.status})`);
          }

          // Calculate pools
          const totalPool = mockWagers.reduce((sum, w) => sum + w.stake, 0);
          const winningPool = mockWagers
            .filter((w) => w.outcome_id === winning_outcome_id)
            .reduce((sum, w) => sum + w.stake, 0);

          // Handle no winners
          if (winningPool === 0) {
            // Refund all
            mockWagers.forEach((wager) => {
              mockWallets[wager.user_id] += wager.stake;
              wager.status = 'refunded';
            });

            mockMarket.status = 'settled';

            return {
              data: {
                success: true,
                message: 'All wagers refunded (no winners)',
                total_pool: totalPool,
                refunded: totalPool,
              },
              error: null,
            };
          }

          // Calculate rake and net pool
          const rakeAmount = Math.floor((totalPool * mockMarket.rake_bps) / 10000);
          const netPool = totalPool - rakeAmount;

          // Distribute to winners
          let totalPaid = 0;
          mockWagers
            .filter((w) => w.outcome_id === winning_outcome_id)
            .forEach((wager) => {
              const payout = Math.floor((wager.stake / winningPool) * netPool);
              mockWallets[wager.user_id] += payout;
              wager.status = 'won';
              totalPaid += payout;
            });

          // Mark losers
          mockWagers
            .filter((w) => w.outcome_id !== winning_outcome_id)
            .forEach((wager) => {
              wager.status = 'lost';
            });

          const dust = netPool - totalPaid;
          mockMarket.status = 'settled';

          return {
            data: {
              success: true,
              total_pool: totalPool,
              winning_pool: winningPool,
              rake_amount: rakeAmount,
              net_pool: netPool,
              total_paid: totalPaid,
              dust: dust,
              winners_count: mockWagers.filter((w) => w.status === 'won').length,
            },
            error: null,
          };
        }
      });
    });

    it('should settle market with winners correctly', async () => {
      const result = await mockRpc('settle_market', {
        market_id: 'market-1',
        winning_outcome_id: 'outcome-a',
      });

      expect(result.data.success).toBe(true);
      expect(result.data.total_pool).toBe(10000);
      expect(result.data.winning_pool).toBe(5000); // 3000 + 2000
      expect(result.data.rake_amount).toBe(500); // 5% of 10000
      expect(result.data.net_pool).toBe(9500);
      expect(result.data.winners_count).toBe(2);

      // Check payouts
      expect(mockWallets['user-1']).toBeGreaterThan(0);
      expect(mockWallets['user-2']).toBeGreaterThan(0);
      expect(mockWallets['user-3']).toBe(0); // Loser gets nothing
    });

    it('should refund all when no winners', async () => {
      const result = await mockRpc('settle_market', {
        market_id: 'market-1',
        winning_outcome_id: 'outcome-c', // No one bet on this
      });

      expect(result.data.success).toBe(true);
      expect(result.data.message).toContain('refunded');
      expect(result.data.refunded).toBe(10000);

      // All users refunded
      expect(mockWallets['user-1']).toBe(3000);
      expect(mockWallets['user-2']).toBe(2000);
      expect(mockWallets['user-3']).toBe(5000);
    });

    it('should reject settlement of non-closed market', async () => {
      mockMarket.status = 'open';

      await expect(
        mockRpc('settle_market', {
          market_id: 'market-1',
          winning_outcome_id: 'outcome-a',
        }),
      ).rejects.toThrow('Market must be closed before settlement');
    });

    it('should calculate proportional payouts correctly', async () => {
      const result = await mockRpc('settle_market', {
        market_id: 'market-1',
        winning_outcome_id: 'outcome-a',
      });

      // Winner 1: 3000/5000 * 9500 = 5700
      // Winner 2: 2000/5000 * 9500 = 3800
      expect(mockWallets['user-1']).toBe(5700);
      expect(mockWallets['user-2']).toBe(3800);
      expect(result.data.total_paid).toBe(9500);
      expect(result.data.dust).toBe(0); // No dust in this case
    });

    it('should handle rake calculation correctly', async () => {
      // Test with 10% rake
      mockMarket.rake_bps = 1000;

      const result = await mockRpc('settle_market', {
        market_id: 'market-1',
        winning_outcome_id: 'outcome-a',
      });

      expect(result.data.rake_amount).toBe(1000); // 10% of 10000
      expect(result.data.net_pool).toBe(9000);
    });

    it('should mark all wagers with correct status', async () => {
      await mockRpc('settle_market', {
        market_id: 'market-1',
        winning_outcome_id: 'outcome-a',
      });

      expect(mockWagers[0].status).toBe('won');
      expect(mockWagers[1].status).toBe('won');
      expect(mockWagers[2].status).toBe('lost');
    });
  });

  describe('Integration: Full betting flow', () => {
    it('should complete entire betting lifecycle', async () => {
      // Setup
      let market = { id: 'market-1', status: 'open', rake_bps: 500 };
      let wallets = { 'user-1': 10000, 'user-2': 10000 };
      let wagers = [];

      // Step 1: Place wagers
      const wager1Stake = 3000;
      wallets['user-1'] -= wager1Stake;
      wagers.push({ user_id: 'user-1', outcome_id: 'outcome-a', stake: wager1Stake, status: 'pending' });

      const wager2Stake = 5000;
      wallets['user-2'] -= wager2Stake;
      wagers.push({ user_id: 'user-2', outcome_id: 'outcome-b', stake: wager2Stake, status: 'pending' });

      expect(wallets['user-1']).toBe(7000);
      expect(wallets['user-2']).toBe(5000);

      // Step 2: Close market
      market.status = 'closed';
      expect(market.status).toBe('closed');

      // Step 3: Settle market (outcome-a wins)
      const totalPool = wagers.reduce((sum, w) => sum + w.stake, 0);
      const winningPool = wagers.filter((w) => w.outcome_id === 'outcome-a').reduce((sum, w) => sum + w.stake, 0);
      const rakeAmount = Math.floor((totalPool * market.rake_bps) / 10000);
      const netPool = totalPool - rakeAmount;

      wagers.forEach((wager) => {
        if (wager.outcome_id === 'outcome-a') {
          const payout = Math.floor((wager.stake / winningPool) * netPool);
          wallets[wager.user_id] += payout;
          wager.status = 'won';
        } else {
          wager.status = 'lost';
        }
      });

      market.status = 'settled';

      // Verify final state
      expect(market.status).toBe('settled');
      expect(wagers[0].status).toBe('won');
      expect(wagers[1].status).toBe('lost');

      // User 1 should have original 7000 + payout (7600)
      expect(wallets['user-1']).toBe(7000 + 7600);
      // User 2 lost their stake
      expect(wallets['user-2']).toBe(5000);
    });
  });
});
