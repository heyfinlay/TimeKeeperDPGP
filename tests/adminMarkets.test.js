import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const { SUPABASE_TEST_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_TEST_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  describe.skip('admin markets', () => {
    it('skips because Supabase test credentials are not configured', () => {});
  });
} else {
  describe('admin markets', () => {
    const serviceClient = createClient(SUPABASE_TEST_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const makeAnonClient = () =>
      createClient(SUPABASE_TEST_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

    const suffix = randomUUID();
    const adminEmail = `admin-market-${suffix}@example.com`;
    const password = 'Adm1n-Market-Password!';

    let adminUserId;
    let adminClient;
    let sessionId;
    let driverId;
    const cleanupTasks = [];

    beforeAll(async () => {
      adminClient = makeAnonClient();
      const adminResult = await serviceClient.auth.admin.createUser({
        email: adminEmail,
        password,
        email_confirm: true,
      });
      if (adminResult.error) {
        throw adminResult.error;
      }
      adminUserId = adminResult.data.user?.id;
      if (!adminUserId) {
        throw new Error('Failed to create admin user for tests');
      }
      cleanupTasks.push(() => serviceClient.auth.admin.deleteUser(adminUserId));

      const profileUpsert = await serviceClient
        .from('profiles')
        .upsert({ id: adminUserId, role: 'admin', display_name: 'Admin Market Tester', updated_at: new Date().toISOString() });
      if (profileUpsert.error) {
        throw profileUpsert.error;
      }
      cleanupTasks.push(async () => {
        await serviceClient.from('profiles').delete().eq('id', adminUserId);
      });

      const sessionInsert = await serviceClient
        .from('sessions')
        .insert({ name: `Market Session ${suffix}`, status: 'active', created_by: adminUserId })
        .select('id')
        .maybeSingle();
      if (sessionInsert.error) {
        throw sessionInsert.error;
      }
      sessionId = sessionInsert.data?.id;
      if (!sessionId) {
        throw new Error('Failed to insert test session');
      }
      cleanupTasks.push(async () => {
        await serviceClient.from('sessions').delete().eq('id', sessionId);
      });

      const newDriverId = randomUUID();
      const driverInsert = await serviceClient
        .from('drivers')
        .insert({
          id: newDriverId,
          session_id: sessionId,
          name: 'Test Driver',
          number: 22,
          team: 'QA',
        })
        .select('id')
        .maybeSingle();
      if (driverInsert.error) {
        throw driverInsert.error;
      }
      driverId = driverInsert.data?.id ?? newDriverId;
      cleanupTasks.push(async () => {
        await serviceClient.from('drivers').delete().eq('id', driverId);
      });

      const signIn = await adminClient.auth.signInWithPassword({ email: adminEmail, password });
      if (signIn.error) {
        throw signIn.error;
      }
    });

    afterAll(async () => {
      for (const task of cleanupTasks.reverse()) {
        try {
          await task();
        } catch (error) {
          console.warn('Failed to clean up admin market test data', error);
        }
      }
    });

    it('creates a market with outcomes and links to the session', async () => {
      const closeTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const payload = {
        p_session_id: sessionId,
        p_market_name: 'Race Winner',
        p_rake_bps: 750,
        p_closes_at: closeTime,
        p_outcomes: [
          { label: 'Driver Alpha', color: '#ff5733', driver_id: driverId },
          { label: 'Field', color: '#1f2937', driver_id: null },
        ],
      };

      const { data, error } = await adminClient.rpc('admin_create_market', payload);
      expect(error).toBeNull();
      expect(data?.success).toBe(true);
      expect(data?.market_id).toBeTruthy();
      expect(data?.event_id).toBeTruthy();
      expect(Array.isArray(data?.outcomes)).toBe(true);
      expect(data.outcomes.length).toBe(2);

      const marketId = data.market_id;
      const eventId = data.event_id;

      cleanupTasks.push(async () => {
        await serviceClient.from('outcomes').delete().eq('market_id', marketId);
        await serviceClient.from('markets').delete().eq('id', marketId);
        await serviceClient.from('events').delete().eq('id', eventId);
      });

      const marketRow = await serviceClient
        .from('markets')
        .select('id, event_id, name, rake_bps, status, closes_at')
        .eq('id', marketId)
        .maybeSingle();
      expect(marketRow.error).toBeNull();
      expect(marketRow.data?.name).toBe('Race Winner');
      expect(marketRow.data?.rake_bps).toBe(750);
      expect(marketRow.data?.status).toBe('open');
      expect(marketRow.data?.event_id).toBe(eventId);

      const eventRow = await serviceClient
        .from('events')
        .select('id, session_id')
        .eq('id', eventId)
        .maybeSingle();
      expect(eventRow.error).toBeNull();
      expect(eventRow.data?.session_id).toBe(sessionId);

      const outcomesResult = await serviceClient
        .from('outcomes')
        .select('label, color, driver_id, sort_order')
        .eq('market_id', marketId)
        .order('sort_order', { ascending: true });
      expect(outcomesResult.error).toBeNull();
      expect(outcomesResult.data).toEqual([
        expect.objectContaining({ label: 'Driver Alpha', color: '#ff5733', driver_id: driverId }),
        expect.objectContaining({ label: 'Field', color: '#1f2937', driver_id: null }),
      ]);
    });

    it('rejects invalid market submissions', async () => {
      const tooHighRake = await adminClient.rpc('admin_create_market', {
        p_session_id: sessionId,
        p_market_name: 'Invalid Market',
        p_rake_bps: 9000,
        p_closes_at: null,
        p_outcomes: [{ label: 'Only Outcome', color: '#ffffff', driver_id: null }],
      });
      expect(tooHighRake.error).toBeTruthy();
      expect(tooHighRake.error?.message ?? '').toMatch(/rake must be between/i);

      const pastClose = await adminClient.rpc('admin_create_market', {
        p_session_id: sessionId,
        p_market_name: 'Closed Market',
        p_rake_bps: 500,
        p_closes_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        p_outcomes: [{ label: 'Outcome', color: '#ffffff', driver_id: null }],
      });
      expect(pastClose.error).toBeTruthy();
      expect(pastClose.error?.message ?? '').toMatch(/close time must be in the future/i);

      const noOutcomes = await adminClient.rpc('admin_create_market', {
        p_session_id: sessionId,
        p_market_name: 'No Outcomes',
        p_rake_bps: 500,
        p_closes_at: null,
        p_outcomes: [],
      });
      expect(noOutcomes.error).toBeTruthy();
      expect(noOutcomes.error?.message ?? '').toMatch(/at least one outcome is required/i);
    });
  });
}
