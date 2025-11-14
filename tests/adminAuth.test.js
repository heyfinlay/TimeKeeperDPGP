import { describe, expect, it } from 'vitest';
import { loginWithAdminCredentials } from '../src/services/adminAuth.js';

describe('loginWithAdminCredentials', () => {
  it('rejects every invocation because the flow is deprecated', async () => {
    await expect(
      loginWithAdminCredentials({ username: 'admin', password: 'secret' }),
    ).rejects.toThrow(/Admin credential login is deprecated/);
  });

  it('guides developers toward Discord OAuth', async () => {
    await expect(
      loginWithAdminCredentials({ username: 'driver', password: 'grid' }),
    ).rejects.toThrow(/Discord OAuth via signInWithDiscord\(\)/);
  });

  it('reminds callers that profiles.role controls admin access', async () => {
    await expect(
      loginWithAdminCredentials(
        { username: 'marshal', password: 'pitwall' },
        { functionsUrl: 'https://example.functions.supabase.co' },
      ),
    ).rejects.toThrow(/profiles\.role="admin"/);
  });
});
