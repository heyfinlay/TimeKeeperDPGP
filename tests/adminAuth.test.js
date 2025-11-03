import { describe, expect, it, vi } from 'vitest';
import { loginWithAdminCredentials } from '../src/services/adminAuth.js';

const FUNCTIONS_URL = 'https://example.functions.supabase.co';

describe('loginWithAdminCredentials', () => {
  it('posts credentials and returns normalized session details on success', async () => {
    const payload = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      expires_at: 123456,
      token_type: 'bearer',
      user: { id: 'user-id', role: 'admin' },
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(payload),
    });

    const result = await loginWithAdminCredentials(
      { username: ' admin ', password: 'secret' },
      { functionsUrl: FUNCTIONS_URL, fetch: mockFetch },
    );

    expect(mockFetch).toHaveBeenCalledWith(`${FUNCTIONS_URL}/admin-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    });
    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      expiresAt: 123456,
      tokenType: 'bearer',
      user: { id: 'user-id', role: 'admin' },
      raw: payload,
    });
  });

  it('throws when username or password is missing', async () => {
    await expect(
      loginWithAdminCredentials({ username: '', password: '' }, { functionsUrl: FUNCTIONS_URL }),
    ).rejects.toThrow('Username and password are required.');
  });

  it('raises an error when the credential endpoint rejects the request', async () => {
    const errorPayload = { error: 'Invalid credentials' };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue(errorPayload),
    });

    await expect(
      loginWithAdminCredentials(
        { username: 'admin', password: 'wrong' },
        { functionsUrl: FUNCTIONS_URL, fetch: mockFetch },
      ),
    ).rejects.toMatchObject({
      message: 'Invalid credentials',
      status: 401,
    });
  });
});
