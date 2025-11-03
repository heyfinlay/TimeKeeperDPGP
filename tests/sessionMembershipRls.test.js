import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const { SUPABASE_TEST_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_TEST_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  describe.skip('session membership row level security', () => {
    it('skips because Supabase test credentials are not configured', () => {});
  });
} else {
  describe('session membership row level security', () => {
    const serviceClient = createClient(SUPABASE_TEST_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const makeAnonClient = () =>
      createClient(SUPABASE_TEST_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

    const suffix = randomUUID();
    const adminEmail = `admin-${suffix}@example.com`;
    const marshalEmail = `marshal-${suffix}@example.com`;
    const spectatorEmail = `spectator-${suffix}@example.com`;
    const password = 'T3st-passw0rd!';

    let adminUserId;
    let marshalUserId;
    let spectatorUserId;
    let sessionId;

    const cleanupTasks = [];

    beforeAll(async () => {
      const adminResult = await serviceClient.auth.admin.createUser({
        email: adminEmail,
        password,
        email_confirm: true,
        app_metadata: { role: 'admin' },
        user_metadata: { role: 'admin' },
      });
      if (adminResult.error) {
        throw adminResult.error;
      }
      adminUserId = adminResult.data.user?.id;
      if (adminUserId) {
        cleanupTasks.push(() => serviceClient.auth.admin.deleteUser(adminUserId));
      }

      const marshalResult = await serviceClient.auth.admin.createUser({
        email: marshalEmail,
        password,
        email_confirm: true,
        app_metadata: { role: 'marshal' },
        user_metadata: { role: 'marshal' },
      });
      if (marshalResult.error) {
        throw marshalResult.error;
      }
      marshalUserId = marshalResult.data.user?.id;
      if (marshalUserId) {
        cleanupTasks.push(() => serviceClient.auth.admin.deleteUser(marshalUserId));
      }

      const spectatorResult = await serviceClient.auth.admin.createUser({
        email: spectatorEmail,
        password,
        email_confirm: true,
        app_metadata: { role: 'spectator' },
        user_metadata: { role: 'spectator' },
      });
      if (spectatorResult.error) {
        throw spectatorResult.error;
      }
      spectatorUserId = spectatorResult.data.user?.id;
      if (spectatorUserId) {
        cleanupTasks.push(() => serviceClient.auth.admin.deleteUser(spectatorUserId));
      }

      const profileRows = [
        { id: adminUserId, role: 'admin', display_name: 'Admin User' },
        { id: marshalUserId, role: 'marshal', display_name: 'Marshal User' },
        { id: spectatorUserId, role: 'marshal', display_name: 'Spectator User' },
      ].map((row) => ({ ...row, updated_at: new Date().toISOString() }));

      const { error: profileError } = await serviceClient
        .from('profiles')
        .upsert(profileRows, { onConflict: 'id' });
      if (profileError) {
        throw profileError;
      }
      cleanupTasks.push(async () => {
        await serviceClient
          .from('profiles')
          .delete()
          .in('id', [adminUserId, marshalUserId, spectatorUserId].filter(Boolean));
      });

      const sessionInsert = await serviceClient
        .from('sessions')
        .insert({ name: `Test Session ${suffix}`, status: 'active', created_by: adminUserId })
        .select('id')
        .maybeSingle();
      if (sessionInsert.error) {
        throw sessionInsert.error;
      }
      sessionId = sessionInsert.data?.id;
      if (sessionId) {
        cleanupTasks.push(async () => {
          await serviceClient.from('sessions').delete().eq('id', sessionId);
        });
      }

      const { error: membershipError } = await serviceClient.from('session_members').insert({
        session_id: sessionId,
        user_id: marshalUserId,
        role: 'marshal',
      });
      if (membershipError) {
        throw membershipError;
      }
      cleanupTasks.push(async () => {
        if (!sessionId) {
          return;
        }
        await serviceClient
          .from('session_members')
          .delete()
          .eq('session_id', sessionId)
          .in('user_id', [marshalUserId, adminUserId, spectatorUserId].filter(Boolean));
      });
    });

    afterAll(async () => {
      for (const task of cleanupTasks.reverse()) {
        try {
          await task();
        } catch (error) {
          console.warn('Failed to clean up Supabase test data', error);
        }
      }
    });

    it('allows marshals to select their own membership row', async () => {
      const marshalClient = makeAnonClient();
      const { data: marshalSession, error: marshalSignInError } = await marshalClient.auth.signInWithPassword({
        email: marshalEmail,
        password,
      });
      expect(marshalSignInError).toBeNull();
      expect(marshalSession?.user?.id).toBe(marshalUserId);

      const { data, error } = await marshalClient
        .from('session_members')
        .select('session_id, user_id, role')
        .eq('session_id', sessionId)
        .eq('user_id', marshalUserId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toEqual({ session_id: sessionId, user_id: marshalUserId, role: 'marshal' });
    });

    it('allows admins to select any membership row', async () => {
      const adminClient = makeAnonClient();
      const { data: adminSession, error: adminSignInError } = await adminClient.auth.signInWithPassword({
        email: adminEmail,
        password,
      });
      expect(adminSignInError).toBeNull();
      expect(adminSession?.user?.id).toBe(adminUserId);

      const { data, error } = await adminClient
        .from('session_members')
        .select('session_id, user_id, role')
        .eq('session_id', sessionId)
        .eq('user_id', marshalUserId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data?.user_id).toBe(marshalUserId);
    });

    it("returns PGRST116 when spectators query another user's membership", async () => {
      const spectatorClient = makeAnonClient();
      const { data: spectatorSession, error: spectatorSignInError } = await spectatorClient.auth.signInWithPassword({
        email: spectatorEmail,
        password,
      });
      expect(spectatorSignInError).toBeNull();
      expect(spectatorSession?.user?.id).toBe(spectatorUserId);

      const { data, error } = await spectatorClient
        .from('session_members')
        .select('session_id, user_id, role')
        .eq('session_id', sessionId)
        .eq('user_id', marshalUserId)
        .maybeSingle();

      expect(data).toBeNull();
      expect(error?.code).toBe('PGRST116');
      expect(error?.message ?? '').toContain('The result contains 0 rows');
    });
  });
}
