import { useCallback, useEffect, useState } from 'react';
import { History, CheckCircle, XCircle, Clock, AlertTriangle, RefreshCcw, Download } from 'lucide-react';
import { supabaseSelect } from '@/lib/supabaseClient.js';
import { formatCurrency } from '@/utils/betting.js';

/**
 * SettlementAuditDashboard Component
 *
 * View historical settlements, track approval times, and monitor rejection rates.
 * Provides audit trail and analytics for settlement operations.
 */
export default function SettlementAuditDashboard({ className = '' }) {
  const [settlements, setSettlements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // all, approved, rejected, cancelled

  const loadSettlements = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Load all settlements from the view
      const rows = await supabaseSelect('pending_settlements_with_context', {
        select: '*',
        order: { column: 'proposed_at', ascending: false },
      });

      setSettlements(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('Failed to load settlements:', err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettlements();
  }, [loadSettlements]);

  const filteredSettlements = settlements.filter((s) => {
    if (filter === 'all') return true;
    return s.settlement_status === filter;
  });

  const stats = {
    total: settlements.length,
    approved: settlements.filter((s) => s.settlement_status === 'approved').length,
    rejected: settlements.filter((s) => s.settlement_status === 'rejected').length,
    pending: settlements.filter((s) => s.settlement_status === 'pending').length,
    cancelled: settlements.filter((s) => s.settlement_status === 'cancelled').length,
  };

  // Calculate average approval time for approved settlements
  const approvalTimes = settlements
    .filter((s) => s.settlement_status === 'approved' && s.reviewed_at && s.proposed_at)
    .map((s) => {
      const proposed = new Date(s.proposed_at);
      const reviewed = new Date(s.reviewed_at);
      return (reviewed - proposed) / 1000 / 60; // minutes
    });

  const avgApprovalTime = approvalTimes.length > 0
    ? approvalTimes.reduce((a, b) => a + b, 0) / approvalTimes.length
    : 0;

  const rejectionRate = stats.total > 0
    ? ((stats.rejected / (stats.approved + stats.rejected)) * 100).toFixed(1)
    : 0;

  const exportToCSV = useCallback(() => {
    const headers = [
      'Settlement ID',
      'Market Name',
      'Session Name',
      'Status',
      'Outcome',
      'Driver',
      'Total Pool',
      'Winning Pool',
      'Total Wagers',
      'Proposed At',
      'Reviewed At',
      'Proposed By',
      'Reviewed By',
      'Rejection Reason',
    ];

    const rows = filteredSettlements.map((s) => [
      s.settlement_id,
      s.market_name,
      s.session_name,
      s.settlement_status,
      s.outcome_label,
      s.driver_name || '',
      s.total_pool,
      s.winning_pool,
      s.total_wagers,
      s.proposed_at,
      s.reviewed_at || '',
      s.proposed_by_name || '',
      s.reviewed_by_name || '',
      s.rejection_reason || '',
    ]);

    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `settlement-audit-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredSettlements]);

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
            <History className="h-5 w-5" />
            <h2 className="text-sm uppercase tracking-[0.35em]">Settlement Audit</h2>
          </div>
        </header>
        <p className="text-sm text-slate-400">Loading settlement history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={containerClasses}>
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-sm uppercase tracking-[0.35em]">Settlement Audit</h2>
          </div>
        </header>
        <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-4">
          <p className="mb-3 text-sm text-red-200">Failed to load settlement history</p>
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
          <History className="h-5 w-5" />
          <h2 className="text-sm uppercase tracking-[0.35em]">Settlement Audit</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={exportToCSV}
            disabled={filteredSettlements.length === 0}
            className="inline-flex items-center gap-2 rounded-full border border-accent-emerald/40 px-3 py-1.5 text-xs uppercase tracking-wider text-accent-emerald transition-colors hover:border-accent-emerald hover:text-white disabled:opacity-50"
            title="Export to CSV"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
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

      {/* Statistics Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <div className="rounded-xl bg-shell-800/60 p-4">
          <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">Total</p>
          <p className="text-2xl font-bold text-white">{stats.total}</p>
        </div>
        <div className="rounded-xl bg-shell-800/60 p-4">
          <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">Approved</p>
          <p className="text-2xl font-bold text-accent-emerald">{stats.approved}</p>
        </div>
        <div className="rounded-xl bg-shell-800/60 p-4">
          <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">Rejected</p>
          <p className="text-2xl font-bold text-red-400">{stats.rejected}</p>
        </div>
        <div className="rounded-xl bg-shell-800/60 p-4">
          <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">Avg Time</p>
          <p className="text-2xl font-bold text-white">{avgApprovalTime.toFixed(0)}m</p>
        </div>
        <div className="rounded-xl bg-shell-800/60 p-4">
          <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">Rejection Rate</p>
          <p className="text-2xl font-bold text-white">{rejectionRate}%</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { key: 'all', label: 'All', count: stats.total },
          { key: 'pending', label: 'Pending', count: stats.pending },
          { key: 'approved', label: 'Approved', count: stats.approved },
          { key: 'rejected', label: 'Rejected', count: stats.rejected },
          { key: 'cancelled', label: 'Cancelled', count: stats.cancelled },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`rounded-full border px-4 py-2 text-xs uppercase tracking-wider transition-colors ${
              filter === tab.key
                ? 'border-accent-emerald bg-accent-emerald/20 text-accent-emerald'
                : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Settlement List */}
      {filteredSettlements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-accent-emerald/20 bg-shell-800/60 p-6 text-center">
          <p className="text-sm text-slate-400">No settlements found for this filter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSettlements.map((settlement) => {
            const statusColors = {
              pending: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
              approved: 'bg-accent-emerald/20 text-accent-emerald border-accent-emerald/40',
              rejected: 'bg-red-500/20 text-red-300 border-red-500/40',
              cancelled: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
            };

            const statusIcons = {
              pending: Clock,
              approved: CheckCircle,
              rejected: XCircle,
              cancelled: AlertTriangle,
            };

            const StatusIcon = statusIcons[settlement.settlement_status] || Clock;

            // Calculate approval time if available
            let approvalTimeText = null;
            if (settlement.reviewed_at && settlement.proposed_at) {
              const proposed = new Date(settlement.proposed_at);
              const reviewed = new Date(settlement.reviewed_at);
              const minutes = Math.round((reviewed - proposed) / 1000 / 60);
              approvalTimeText = minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
            }

            return (
              <div
                key={settlement.settlement_id}
                className="rounded-xl border border-accent-emerald/15 bg-shell-800/40 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <h3 className="text-base font-semibold text-white">
                        {settlement.market_name}
                      </h3>
                      <span
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
                          statusColors[settlement.settlement_status]
                        }`}
                      >
                        <StatusIcon className="h-3.5 w-3.5" />
                        {settlement.settlement_status}
                      </span>
                    </div>
                    <p className="mb-2 text-xs text-slate-400">
                      Session: {settlement.session_name} • {settlement.market_type}
                    </p>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm text-white">Winner: {settlement.outcome_label}</span>
                      {settlement.driver_name && (
                        <span className="text-xs text-slate-400">({settlement.driver_name})</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                      <span>
                        Pool: {formatCurrency(settlement.total_pool, { compact: true })}
                      </span>
                      <span>{settlement.total_wagers} wagers</span>
                      <span>Proposed: {new Date(settlement.proposed_at).toLocaleString()}</span>
                      {settlement.proposed_by_name && (
                        <span>by {settlement.proposed_by_name}</span>
                      )}
                    </div>
                    {settlement.reviewed_at && (
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                        <span>Reviewed: {new Date(settlement.reviewed_at).toLocaleString()}</span>
                        {settlement.reviewed_by_name && (
                          <span>by {settlement.reviewed_by_name}</span>
                        )}
                        {approvalTimeText && (
                          <span className="font-semibold text-accent-emerald">
                            {approvalTimeText} to review
                          </span>
                        )}
                      </div>
                    )}
                    {settlement.rejection_reason && (
                      <div className="mt-2 rounded-lg border border-red-500/30 bg-red-950/20 p-2">
                        <p className="text-xs text-red-300">
                          <span className="font-semibold">Rejection reason:</span>{' '}
                          {settlement.rejection_reason}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
