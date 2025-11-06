import { describe, expect, test, it, vi } from 'vitest';

import { isColumnMissingError, supabaseInsert, supabaseSelect } from '@/lib/supabaseClient';

vi.mock('@/lib/supabaseClient', () => ({
  supabaseInsert: vi.fn(),
  supabaseSelect: vi.fn(),
}));

describe('session seeding regression', () => {
  test('detects missing created_at column on session_entries insert', () => {
    const error = new Error(
      'column "created_at" of relation "session_entries" does not exist',
    );
    // Simulate PostgREST/PG error shape
    error.code = '42703';
    error.status = 400;
    error.supabaseMessage =
      'insert into session_entries failed: column "created_at" does not exist';

    expect(isColumnMissingError(error, 'created_at')).toBe(true);
  });
});

describe('Session Seeding', () => {
  it('should create a session and populate created_at', async () => {
    const mockSession = { id: 'test-session-id', name: 'Test Session' };
    supabaseInsert.mockResolvedValueOnce([mockSession]);
    supabaseSelect.mockResolvedValueOnce([{ ...mockSession, created_at: '2023-01-01T00:00:00Z' }]);

    const result = await supabaseInsert('session_entries', mockSession);
    expect(result).toEqual([mockSession]);

    const session = await supabaseSelect('session_entries', { filters: { id: 'test-session-id' } });
    expect(session[0].created_at).toBeDefined();
  });
});


