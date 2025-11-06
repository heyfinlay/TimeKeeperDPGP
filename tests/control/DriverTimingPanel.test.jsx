import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DriverTimingPanel from '@/components/DriverTimingPanel.jsx';
import { SessionActionsProvider } from '@/context/SessionActionsContext.jsx';

vi.mock('@/state/SessionContext.jsx', () => ({
  useSessionId: () => 'test-session-id',
}));

vi.mock('@/services/laps.js', () => ({
  logLapAtomic: vi.fn(),
  invalidateLastLap: vi.fn(),
}));

describe('DriverTimingPanel', () => {
  it('invokes SessionActionsContext onLogLap handler on quick log interaction', () => {
    const onLogLap = vi.fn();
    const driver = {
      id: 'driver-1',
      name: 'S. Hale',
      number: 42,
      laps: 3,
      last_lap_ms: 71234,
      best_lap_ms: 70123,
      pits: 1,
      total_time_ms: 215678,
    };

    const { getByRole } = render(
      <SessionActionsProvider value={{ onLogLap, canWrite: true }}>
        <DriverTimingPanel driver={driver} canWrite />
      </SessionActionsProvider>,
    );

    const quickLogButton = getByRole('button', { name: /log lap for/i });
    fireEvent.click(quickLogButton);

    expect(onLogLap).toHaveBeenCalledTimes(1);
    expect(onLogLap).toHaveBeenCalledWith('driver-1');
  });

  it('renders DriverTimingPanel with mocked context', () => {
    const mockActions = {
      onLogLap: vi.fn(),
      invalidateLastLap: vi.fn(),
      canWrite: true,
    };

    render(
      <SessionActionsProvider value={mockActions}>
        <DriverTimingPanel driver={{ id: 'driver1', name: 'Driver 1' }} />
      </SessionActionsProvider>
    );

    expect(screen.getByText('Driver 1')).toBeInTheDocument();
  });
});