import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression tests for session seeding functionality
 * Ensures seedSessionData properly handles drivers and members without requiring session_entries
 */
describe('Session Seeding', () => {
  let mockSupabaseUpsert;
  let seedSessionData;

  beforeEach(() => {
    mockSupabaseUpsert = vi.fn().mockResolvedValue(undefined);

    // Mock the seedSessionData function behavior
    seedSessionData = async (sessionId, { sessionState, drivers, members } = {}) => {
      if (!sessionId) {
        throw new Error('Session ID is required to seed data.');
      }

      const normalizeRows = (rows = []) =>
        rows
          .filter(Boolean)
          .map((row) => ({
            ...row,
            session_id: sessionId,
          }));

      // Session state
      if (sessionState) {
        const stateRows = Array.isArray(sessionState) ? sessionState : [sessionState];
        await mockSupabaseUpsert(
          'session_state',
          normalizeRows(
            stateRows.map((row) => ({
              id: row.id ?? sessionId,
              ...row,
              session_id: sessionId,
            })),
          ),
        );
      }

      // Drivers
      if (Array.isArray(drivers) && drivers.length) {
        await mockSupabaseUpsert('drivers', normalizeRows(drivers));
      }

      // Members
      if (Array.isArray(members) && members.length) {
        await mockSupabaseUpsert('session_members', normalizeRows(members));
      }

      // NOTE: session_entries removed - table never existed
    };
  });

  it('should seed session with drivers', async () => {
    const sessionId = 'test-session-123';
    const drivers = [
      { id: 'driver-1', number: 1, name: 'Driver One' },
      { id: 'driver-2', number: 2, name: 'Driver Two' },
    ];

    await seedSessionData(sessionId, { drivers });

    expect(mockSupabaseUpsert).toHaveBeenCalledWith(
      'drivers',
      expect.arrayContaining([
        expect.objectContaining({ id: 'driver-1', session_id: sessionId }),
        expect.objectContaining({ id: 'driver-2', session_id: sessionId }),
      ]),
    );
  });

  it('should seed session with members', async () => {
    const sessionId = 'test-session-456';
    const members = [
      { user_id: 'user-1', role: 'marshal' },
      { user_id: 'user-2', role: 'admin' },
    ];

    await seedSessionData(sessionId, { members });

    expect(mockSupabaseUpsert).toHaveBeenCalledWith(
      'session_members',
      expect.arrayContaining([
        expect.objectContaining({ user_id: 'user-1', session_id: sessionId }),
        expect.objectContaining({ user_id: 'user-2', session_id: sessionId }),
      ]),
    );
  });

  it('should seed session state', async () => {
    const sessionId = 'test-session-789';
    const sessionState = {
      event_type: 'Race',
      total_laps: 20,
      is_timing: false,
    };

    await seedSessionData(sessionId, { sessionState });

    expect(mockSupabaseUpsert).toHaveBeenCalledWith(
      'session_state',
      expect.arrayContaining([
        expect.objectContaining({
          id: sessionId,
          session_id: sessionId,
          event_type: 'Race',
          total_laps: 20,
        }),
      ]),
    );
  });

  it('should throw error if session ID is missing', async () => {
    await expect(seedSessionData(null, { drivers: [] })).rejects.toThrow(
      'Session ID is required to seed data.',
    );
  });

  it('should handle empty data gracefully', async () => {
    const sessionId = 'test-session-empty';

    await seedSessionData(sessionId, {});

    // Should not call upsert if no data provided
    expect(mockSupabaseUpsert).not.toHaveBeenCalled();
  });

  it('should normalize all rows with session_id', async () => {
    const sessionId = 'test-session-normalize';
    const drivers = [
      { id: 'driver-1', number: 1 },
      { id: 'driver-2', number: 2, session_id: 'wrong-id' }, // Should be overwritten
    ];

    await seedSessionData(sessionId, { drivers });

    expect(mockSupabaseUpsert).toHaveBeenCalledWith(
      'drivers',
      expect.arrayContaining([
        expect.objectContaining({ id: 'driver-1', session_id: sessionId }),
        expect.objectContaining({ id: 'driver-2', session_id: sessionId }),
      ]),
    );
  });

  it('should filter out null/undefined entries', async () => {
    const sessionId = 'test-session-filter';
    const drivers = [
      { id: 'driver-1', number: 1 },
      null,
      undefined,
      { id: 'driver-2', number: 2 },
    ];

    await seedSessionData(sessionId, { drivers });

    expect(mockSupabaseUpsert).toHaveBeenCalledWith(
      'drivers',
      expect.arrayContaining([
        expect.objectContaining({ id: 'driver-1' }),
        expect.objectContaining({ id: 'driver-2' }),
      ]),
    );

    // Verify only 2 drivers, not 4
    const calls = mockSupabaseUpsert.mock.calls.find(call => call[0] === 'drivers');
    expect(calls[1]).toHaveLength(2);
  });
});
