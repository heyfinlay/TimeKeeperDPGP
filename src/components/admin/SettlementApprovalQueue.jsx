import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, AlertTriangle, RefreshCcw } from 'lucide-react';
import { supabaseSelect, supabase } from '@/lib/supabaseClient.js';
import { formatCurrency } from '@/utils/betting.js';

const formatTimestamp = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString();
};

const safeStringify = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return typeof value === 'string' ? value : String(value);
  }
};

const normalizeTimingEvidence = (raw) => {
  if (!raw) {
    return null;
  }
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { raw };
    }
  }
  if (Array.isArray(parsed)) {
    return { laps: parsed };
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const laps =
      Array.isArray(parsed.laps) ? parsed.laps :
      Array.isArray(parsed.drivers) ? parsed.drivers :
      null;
    return {
      ...parsed,
      laps,
      note: parsed.note || parsed.summary || parsed.text || null,
    };
  }
  return { raw: parsed };
};

/**
 * SettlementApprovalQueue Component
 *
 * Displays pending market settlements that require admin approval before execution.
 * This provides a critical safeguard to verify timing results match proposed outcomes
 * before releasing payouts to bettors.
 *
 * Features:
 * - View all pending settlement proposals
 * - Review timing data snapshot
 * - Approve settlements (executes settlement immediately)
 * - Reject settlements with reason
 * - Real-time updates via polling
 */
export default function SettlementApprovalQueue({ className = '' }) {
  const [settlements, setSettlements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionInProgress, setActionInProgress] = useState(null);

  const loadSettlements = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Use the view that includes all context
      const rows = await supabaseSelect('pending_settlements_with_context', {
        select: '*',
        filters: { settlement_status: 'eq.pending' },
        order: { column: 'proposed_at', ascending: false },
      });

      setSettlements(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('Failed to load pending settlements:', err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettlements();

    // Poll for updates every 10 seconds
    const interval = setInterval(() => {
      void loadSettlements();
    }, 10000);

    return () => clearInterval(interval);
  }, [loadSettlements]);

  const handleApprove = useCallback(async (settlementId, marketId) => {
    if (!confirm('Are you sure you want to approve this settlement? This will immediately execute the payout.')) {
      return;
    }

    setActionInProgress(settlementId);
    try {
      const { data: result, error } = await supabase.rpc('approve_settlement', {
        p_settlement_id: settlementId,
        p_payout_policy: 'refund_if_empty',
      });

      if (error) throw error;

      console.log('Settlement approved:', result);

      // Reload the list
      await loadSettlements();

      alert('Settlement approved and executed successfully!');
    } catch (err) {
      console.error('Failed to approve settlement:', err);
      alert(`Failed to approve settlement: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  }, [loadSettlements]);

  const handleReject = useCallback(async (settlementId) => {
    const reason = prompt('Enter rejection reason:');
    if (!reason || reason.trim() === '') {
      return;
    }

    setActionInProgress(settlementId);
    try {
      const { error } = await supabase.rpc('reject_settlement', {
        p_settlement_id: settlementId,
        p_rejection_reason: reason.trim(),
      });

      if (error) throw error;

      console.log('Settlement rejected');

      // Reload the list
      await loadSettlements();

      alert('Settlement rejected');
    } catch (err) {
      console.error('Failed to reject settlement:', err);
      alert(`Failed to reject settlement: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  }, [loadSettlements]);

  const containerClasses = [
    'tk-glass-panel rounded-2xl border border-accent-emerald/15 bg-shell-900/85 p-6',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (isLoading && settlements.length === 0) {
    return (
      <div className={containerClasses}>
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-accent-emerald">
            <Clock className="h-5 w-5" />
            <h2 className="text-sm uppercase tracking-[0.35em]">Settlement Approvals</h2>
          </div>
        </header>
        <p className="text-sm text-slate-400">Loading pending settlements...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={containerClasses}>
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-sm uppercase tracking-[0.35em]">Settlement Approvals</h2>
          </div>
        </header>
        <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-4">
          <p className="mb-3 text-sm text-red-200">Failed to load pending settlements</p>
          <button
            type="button"
            onClick={() => void loadSettlements()}
            className="inline-flex items-center gap-2 rounded-full border border-red-500/40 px-3 py-1.5 text-xs uppercase tracking-wider text-red-200 transition-colors hover:border-red-400 hover:text-white"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-accent-emerald">
          <Clock className="h-5 w-5" />
          <h2 className="text-sm uppercase tracking-[0.35em]">Settlement Approvals</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {settlements.length} pending
          </span>
          <button
            type="button"
            onClick={() => void loadSettlements()}
            disabled={isLoading}
            className="text-slate-400 transition-colors hover:text-accent-emerald disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCcw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

          {settlements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-accent-emerald/20 bg-shell-800/60 p-6 text-center">
              <CheckCircle className="mx-auto mb-3 h-8 w-8 text-accent-emerald/50" />
              <p className="text-sm text-slate-400">
                No pending settlements. All markets are up to date!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {settlements.map((settlement) => {
            const isProcessing = actionInProgress === settlement.settlement_id;
            const winRate = settlement.total_pool > 0
              ? ((settlement.winning_pool / settlement.total_pool) * 100).toFixed(1)
              : 0;
            const payoutMultiplier = settlement.winning_pool > 0
              ? (settlement.total_pool / settlement.winning_pool).toFixed(2)
              : 0;
            const timingEvidence = normalizeTimingEvidence(settlement.timing_data);
            const timingRows = Array.isArray(timingEvidence?.laps) ? timingEvidence.laps : null;
            const timingNote = timingEvidence?.note;
            const timingRecordedAt =
              timingEvidence?.recorded_at ||
              timingEvidence?.captured_at ||
              timingEvidence?.timestamp ||
              null;

            return (
              <div
                key={settlement.settlement_id}
                className="rounded-xl border border-accent-emerald/20 bg-shell-800/40 p-5"
              >
                {/* Header */}
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="mb-1 text-base font-semibold text-white">
                      {settlement.market_name}
                    </h3>
                    <p className="text-xs text-slate-400">
                      Session: {settlement.session_name} • {settlement.market_type}
                    </p>
                  </div>
                  <span className="rounded-full bg-yellow-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-yellow-300">
                    Pending
                  </span>
                </div>

                {/* Proposed Outcome */}
                <div className="mb-4 rounded-lg border border-accent-emerald/30 bg-shell-900/60 p-4">
                  <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">
                    Proposed Winner
                  </p>
                  <div className="flex items-center gap-3">
                    {settlement.driver_number && (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-emerald/20 text-sm font-bold text-accent-emerald">
                        #{settlement.driver_number}
                      </span>
                    )}
                    <div>
                      <p className="text-base font-semibold text-white">
                        {settlement.outcome_label}
                      </p>
                      {settlement.driver_name && (
                        <p className="text-xs text-slate-400">{settlement.driver_name}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pool Statistics */}
                <div className="mb-4 grid grid-cols-3 gap-4">
                  <div className="rounded-lg bg-shell-900/60 p-3">
                    <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">
                      Total Pool
                    </p>
                    <p className="text-lg font-bold text-white">
                      {formatCurrency(settlement.total_pool, { compact: false, maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-xs text-slate-400">{settlement.total_wagers} wagers</p>
                  </div>
                  <div className="rounded-lg bg-shell-900/60 p-3">
                    <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">
                      Winning Pool
                    </p>
                    <p className="text-lg font-bold text-accent-emerald">
                      {formatCurrency(settlement.winning_pool, { compact: false, maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-xs text-slate-400">{winRate}% of total</p>
                  </div>
                  <div className="rounded-lg bg-shell-900/60 p-3">
                    <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">
                      Payout Multiple
                    </p>
                    <p className="text-lg font-bold text-white">{payoutMultiplier}x</p>
                    <p className="text-xs text-slate-400">per unit staked</p>
                  </div>
                </div>

                {/* Timing Data */}
                {timingEvidence ? (
                  <div className="mb-4 rounded-lg border border-accent-emerald/20 bg-shell-900/40 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wider text-slate-500">Timing Evidence</p>
                        <p className="text-sm text-slate-300">
                          {formatTimestamp(timingRecordedAt) ?? 'Provided by proposer'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                        {timingEvidence.session_id && (
                          <span className="rounded-full border border-white/10 px-3 py-1">
                            Session {timingEvidence.session_id.slice(0, 8)}…
                          </span>
                        )}
                        {timingEvidence.event_id && (
                          <span className="rounded-full border border-white/10 px-3 py-1">
                            Event {timingEvidence.event_id.slice(0, 8)}…
                          </span>
                        )}
                      </div>
                    </div>
                    {timingNote ? (
                      <p className="mb-3 text-sm text-slate-200">{timingNote}</p>
                    ) : null}
                    {timingRows && timingRows.length > 0 ? (
                      <div className="overflow-hidden rounded-lg border border-accent-emerald/15">
                        <table className="min-w-full divide-y divide-shell-800/80 text-left text-sm">
                          <thead className="bg-shell-900/80 text-xs uppercase tracking-wider text-slate-500">
                            <tr>
                              <th className="px-3 py-2">Pos</th>
                              <th className="px-3 py-2">Driver</th>
                              <th className="px-3 py-2 text-right">Laps</th>
                              <th className="px-3 py-2 text-right">Best Lap</th>
                              <th className="px-3 py-2 text-right">Total Time</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-shell-800/60 bg-shell-900/30">
                            {timingRows.map((driver, idx) => {
                              const driverId = driver.driver_id || driver.id || driver.outcome_id || idx;
                              const driverNumber = driver.driver_number ?? driver.number ?? '—';
                              const driverName = driver.driver_name || driver.name || driver.label || 'Driver';
                              const laps = driver.laps ?? driver.total_laps ?? driver.totalLaps ?? 0;
                              const bestLap = driver.best_lap_ms ?? driver.bestLapMs ?? null;
                              const totalTime = driver.total_time_ms ?? driver.totalTimeMs ?? null;
                              const isWinner =
                                driver.driver_id === settlement.driver_id ||
                                driver.outcome_id === settlement.outcome_id ||
                                driver.is_winner;
                              return (
                                <tr key={`${driverId}-${idx}`} className={isWinner ? 'bg-accent-emerald/10' : ''}>
                                  <td className="px-3 py-2 font-semibold text-white">{idx + 1}</td>
                                  <td className="px-3 py-2">
                                    <span className="text-white">
                                      #{driverNumber} {driverName}
                                    </span>
                                    {isWinner && (
                                      <span className="ml-2 text-xs text-accent-emerald">← Proposed Winner</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right text-white">{laps}</td>
                                  <td className="px-3 py-2 text-right text-slate-400">
                                    {bestLap ? `${(bestLap / 1000).toFixed(3)}s` : '—'}
                                  </td>
                                  <td className="px-3 py-2 text-right text-slate-400">
                                    {totalTime ? `${(totalTime / 1000).toFixed(3)}s` : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No lap table attached.</p>
                    )}
                    {timingEvidence.raw && (
                      <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-slate-800/60 bg-black/40 p-3 text-xs text-slate-300">
                        {safeStringify(timingEvidence.raw)}
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="mb-4 rounded-lg border border-slate-800/60 bg-shell-900/20 p-3 text-sm text-slate-400">
                    No timing evidence attached yet. Ask the proposer to include a lap export or steward note.
                  </div>
                )}

                {/* Notes */}
                {settlement.notes && (
                  <div className="mb-4 rounded-lg border border-slate-700 bg-shell-900/40 p-3">
                    <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">Notes</p>
                    <p className="text-sm text-slate-300">{settlement.notes}</p>
                  </div>
                )}

                {/* Metadata */}
                <div className="mb-4 flex items-center gap-4 text-xs text-slate-500">
                  <span>
                    Proposed: {new Date(settlement.proposed_at).toLocaleString()}
                  </span>
                  {settlement.proposed_by_name && (
                    <span>by {settlement.proposed_by_name}</span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleApprove(settlement.settlement_id, settlement.market_id)}
                    disabled={isProcessing}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-accent-emerald px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-shell-900 transition-all hover:bg-accent-emerald/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle className="h-4 w-4" />
                    {isProcessing ? 'Processing...' : 'Approve & Execute'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReject(settlement.settlement_id)}
                    disabled={isProcessing}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-red-500/40 bg-red-950/20 px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-red-300 transition-all hover:border-red-400 hover:bg-red-950/40 hover:text-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
