import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  AlertCircle,
  BarChart3,
  CheckCircle,
  ChevronDown,
  Clock,
  DollarSign,
  Eye,
  Gavel,
  Loader2,
  RefreshCcw,
  Search,
  Settings,
  TrendingUp,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import AdminMarketWizard from '@/components/admin/markets/AdminMarketWizard.jsx';
import SettlementApprovalQueue from '@/components/admin/SettlementApprovalQueue.jsx';
import SettlementAuditDashboard from '@/components/admin/SettlementAuditDashboard.jsx';
import { useParimutuelStore } from '@/state/parimutuelStore.js';
import { handleApproveDeposit, formatWalletBalance } from '@/lib/wallet.js';
import { proposeSettlement } from '@/services/admin.js';

const TABS = {
  MARKETS: 'markets',
  SETTLEMENTS: 'settlements',
  PENDING_ACTIONS: 'pending',
  WALLETS: 'wallets',
  ANALYTICS: 'analytics',
};

const MARKET_STATUS_CONFIG = {
  open: { label: 'Open', color: 'green', icon: CheckCircle },
  closed: { label: 'Closed', color: 'red', icon: XCircle },
  settling: { label: 'Settling', color: 'blue', icon: Clock },
};

const REQUEST_STATUS_CONFIG = {
  queued: {
    label: 'Queued',
    badge: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
  },
  approved: {
    label: 'Approved',
    badge: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  },
  rejected: {
    label: 'Rejected',
    badge: 'border-rose-400/40 bg-rose-500/10 text-rose-200',
  },
};

const AdminMarketsPage = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(TABS.MARKETS);
  const [markets, setMarkets] = useState([]);
  const [events, setEvents] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [wagers, setWagers] = useState([]);
  const [pendingWagers, setPendingWagers] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [walletAccounts, setWalletAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState(null); // 'close', 'settle'
  const [settlementOutcomeId, setSettlementOutcomeId] = useState(null);
  const [settlementNotes, setSettlementNotes] = useState('');
  const [timingEvidence, setTimingEvidence] = useState('');
  const [isSubmittingSettlement, setIsSubmittingSettlement] = useState(false);
  const [approvingDepositId, setApprovingDepositId] = useState(null);
  const [processingWithdrawalId, setProcessingWithdrawalId] = useState(null);
  const [processingPendingWagerId, setProcessingPendingWagerId] = useState(null);
  const [depositStatusFilter, setDepositStatusFilter] = useState('queued');
  const [withdrawalStatusFilter, setWithdrawalStatusFilter] = useState('queued');
  const [receiptCodes, setReceiptCodes] = useState({});
  const [toast, setToast] = useState(null);
  const { actions: parimutuelActions } = useParimutuelStore();
  const loadParimutuelEvents = parimutuelActions?.loadEvents;

  // Fetch all data
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [
        { data: eventsData, error: eventsError },
        { data: marketsData, error: marketsError },
        { data: outcomesData, error: outcomesError },
        { data: wagersData, error: wagersError },
        { data: withdrawalsData, error: withdrawalsError },
        { data: depositsData, error: depositsError },
        { data: walletsData, error: walletsError },
        { data: pendingWagersData, error: pendingWagersError },
      ] = await Promise.all([
        supabase.from('events').select('*').order('starts_at', { ascending: false }),
        supabase.from('markets').select('*').order('created_at', { ascending: false }),
        supabase.from('outcomes').select('*').order('sort_order', { ascending: true }),
        supabase.from('wagers').select('*, markets(name), outcomes(label)').order('placed_at', { ascending: false }),
        supabase.from('withdrawals').select('*').order('created_at', { ascending: false }),
        supabase.from('deposits').select('*').order('created_at', { ascending: false }),
        supabase.from('wallet_accounts').select('*'),
        supabase.rpc('admin_list_pending_wagers', { p_market_id: null }),
      ]);

      if (eventsError) throw eventsError;
      if (marketsError) throw marketsError;
      if (outcomesError) throw outcomesError;
      if (wagersError) throw wagersError;
      if (withdrawalsError) throw withdrawalsError;
      if (depositsError) throw depositsError;
      if (walletsError) throw walletsError;
      if (pendingWagersError) throw pendingWagersError;

      setEvents(eventsData || []);
      setMarkets(marketsData || []);
      setOutcomes(outcomesData || []);
      setWagers(wagersData || []);
      setWithdrawals(withdrawalsData || []);
      setDeposits(depositsData || []);
      setWalletAccounts(walletsData || []);
      setPendingWagers(pendingWagersData || []);
    } catch (err) {
      console.error('Failed to fetch admin markets data:', err);
      setError(err.message || 'Failed to load markets data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to realtime updates
  useEffect(() => {
    const wagersChannel = supabase
      .channel('admin-wagers-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wagers' }, () => {
        fetchData();
      })
      .subscribe();

    const withdrawalsChannel = supabase
      .channel('admin-withdrawals-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawals' }, () => {
        fetchData();
      })
      .subscribe();

    const depositsChannel = supabase
      .channel('admin-deposits-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits' }, () => {
        fetchData();
      })
      .subscribe();

    const marketsChannel = supabase
      .channel('admin-markets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'markets' }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(wagersChannel);
      supabase.removeChannel(withdrawalsChannel);
      supabase.removeChannel(depositsChannel);
      supabase.removeChannel(marketsChannel);
    };
  }, [fetchData]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Market analytics
  const marketAnalytics = useMemo(() => {
    const totalWagered = wagers.reduce((sum, w) => sum + (w.stake || 0), 0);
    const pendingWithdrawals = withdrawals.filter(w => w.status === 'queued');
    const pendingDeposits = deposits.filter((deposit) => deposit.status === 'queued');
    const activeMarkets = markets.filter(m => m.status === 'open');

    return {
      totalWagered,
      pendingWagersCount: pendingWagers.length,
      pendingWithdrawalsCount: pendingWithdrawals.length,
      pendingDepositsCount: pendingDeposits.length,
      activeMarketsCount: activeMarkets.length,
      totalMarketsCount: markets.length,
    };
  }, [wagers, withdrawals, deposits, markets, pendingWagers]);
  const selectedMarketContext = useMemo(() => {
    if (!selectedMarket) return null;
    const marketOutcomes = outcomes.filter((outcome) => outcome.market_id === selectedMarket.id);
    const marketWagers = wagers.filter((wager) => wager.market_id === selectedMarket.id);
    const totalStake = marketWagers.reduce((sum, wager) => sum + (wager.stake || 0), 0);
    const eventContext = events.find((event) => event.id === selectedMarket.event_id);
    return {
      outcomes: marketOutcomes,
      totalStake,
      wagerCount: marketWagers.length,
      event: eventContext,
    };
  }, [selectedMarket, outcomes, wagers, events]);

  const resetSettlementForm = () => {
    setSettlementOutcomeId(null);
    setSettlementNotes('');
    setTimingEvidence('');
    setIsSubmittingSettlement(false);
  };

  const dismissModal = () => {
    setIsModalOpen(false);
    setModalMode(null);
    setSelectedMarket(null);
    resetSettlementForm();
  };

  const openSettlementModal = (market) => {
    if (!market) return;
    const marketOutcomes = getOutcomesByMarketId(market.id);
    setSelectedMarket(market);
    setModalMode('settle');
    setSettlementOutcomeId(marketOutcomes[0]?.id ?? null);
    setSettlementNotes('');
    setTimingEvidence('');
    setIsModalOpen(true);
  };

  const filteredWithdrawals = useMemo(
    () => withdrawals.filter((withdrawal) => withdrawal.status === withdrawalStatusFilter),
    [withdrawals, withdrawalStatusFilter],
  );

  const filteredDeposits = useMemo(
    () => deposits.filter((deposit) => deposit.status === depositStatusFilter),
    [deposits, depositStatusFilter],
  );

  // Close market handler
  const handleCloseMarket = async (marketId) => {
    try {
      const { error } = await supabase.rpc('close_market', { p_market_id: marketId });
      if (error) throw error;
      await fetchData();
      dismissModal();
    } catch (err) {
      console.error('Failed to close market:', err);
      alert(`Failed to close market: ${err.message}`);
    }
  };

  // Settlement proposal handler
  const handleSubmitSettlementProposal = async () => {
    if (!selectedMarket || !settlementOutcomeId) {
      return;
    }
    setIsSubmittingSettlement(true);
    try {
      const contextEvent = events.find((event) => event.id === selectedMarket.event_id);
      const timingPayload = timingEvidence.trim()
        ? {
            recorded_at: new Date().toISOString(),
            session_id: contextEvent?.session_id ?? null,
            event_id: contextEvent?.id ?? null,
            note: timingEvidence.trim(),
          }
        : null;
      const settlementId = await proposeSettlement({
        marketId: selectedMarket.id,
        outcomeId: settlementOutcomeId,
        notes: settlementNotes.trim() || null,
        timingData: timingPayload,
      });
      setToast({
        type: 'success',
        message: `Settlement proposed (${String(settlementId).slice(0, 8)}…). Awaiting approval.`,
      });
      await fetchData();
      dismissModal();
    } catch (err) {
      console.error('Failed to propose settlement:', err);
      alert(`Failed to propose settlement: ${err.message}`);
    } finally {
      setIsSubmittingSettlement(false);
    }
  };

  // Approve withdrawal handler
  const handleApproveWithdrawal = async (withdrawalId) => {
    try {
      setProcessingWithdrawalId(withdrawalId);
      const { error } = await supabase.rpc('approve_withdrawal', {
        p_withdrawal_id: withdrawalId,
      });
      if (error) throw error;
      setWithdrawals((prev) =>
        prev.map((withdrawal) =>
          withdrawal.id === withdrawalId ? { ...withdrawal, status: 'approved' } : withdrawal,
        ),
      );
      setToast({ type: 'success', message: 'Withdrawal approved.' });
      await fetchData();
    } catch (err) {
      console.error('Failed to approve withdrawal:', err);
      setToast({ type: 'error', message: err.message || 'Something went wrong. Please try again.' });
    } finally {
      setProcessingWithdrawalId(null);
    }
  };

  // Reject withdrawal handler
  const handleRejectWithdrawal = async (withdrawalId) => {
    const reason = prompt('Reason for rejection (optional):');
    try {
      setProcessingWithdrawalId(withdrawalId);
      const { error } = await supabase.rpc('reject_withdrawal', {
        p_withdrawal_id: withdrawalId,
        p_reason: reason || null,
      });
      if (error) throw error;
      setWithdrawals((prev) =>
        prev.map((withdrawal) =>
          withdrawal.id === withdrawalId
            ? { ...withdrawal, status: 'rejected', rejection_reason: reason || null }
            : withdrawal,
        ),
      );
      setToast({ type: 'success', message: 'Withdrawal rejected.' });
      await fetchData();
    } catch (err) {
      console.error('Failed to reject withdrawal:', err);
      setToast({ type: 'error', message: err.message || 'Something went wrong. Please try again.' });
    } finally {
      setProcessingWithdrawalId(null);
    }
  };

  const handleApprovePendingWager = async (wagerId) => {
    if (!wagerId) return;
    try {
      setProcessingPendingWagerId(wagerId);
      const { error } = await supabase.rpc('approve_wager', { p_wager_id: wagerId });
      if (error) throw error;
      setToast({ type: 'success', message: 'Pending wager approved.' });
      await fetchData();
    } catch (err) {
      console.error('Failed to approve pending wager:', err);
      setToast({ type: 'error', message: err.message || 'Unable to approve wager.' });
    } finally {
      setProcessingPendingWagerId(null);
    }
  };

  const handleRejectPendingWager = async (wagerId) => {
    if (!wagerId) return;
    const reason = prompt('Reason for rejection (optional):');
    try {
      setProcessingPendingWagerId(wagerId);
      const { error } = await supabase.rpc('reject_wager', {
        p_wager_id: wagerId,
        p_reason: reason || null,
      });
      if (error) throw error;
      setToast({ type: 'success', message: 'Pending wager rejected.' });
      await fetchData();
    } catch (err) {
      console.error('Failed to reject pending wager:', err);
      setToast({ type: 'error', message: err.message || 'Unable to reject wager.' });
    } finally {
      setProcessingPendingWagerId(null);
    }
  };

  const handleMarkDepositReceived = async (deposit) => {
    if (!deposit) {
      return;
    }
    const receiptCode = (receiptCodes[deposit.id] ?? '').trim();
    const amountLabel = formatWalletBalance(deposit.amount, { compact: false });
    const confirmMessage = `Credit ◆${amountLabel} to ${deposit.user_id.slice(0, 8)}? This updates their wallet immediately.`;
    if (!window.confirm(confirmMessage)) {
      return;
    }
    try {
      setApprovingDepositId(deposit.id);
      await handleApproveDeposit({ depositId: deposit.id, receiptCode });
      setDeposits((prev) =>
        prev.map((item) =>
          item.id === deposit.id
            ? {
                ...item,
                status: 'approved',
                reference_code: receiptCode || item.reference_code,
              }
            : item,
        ),
      );
      setReceiptCodes((prev) => ({ ...prev, [deposit.id]: '' }));
      setToast({ type: 'success', message: 'Deposit marked received. Wallet updated.' });
      await fetchData();
    } catch (err) {
      console.error('Failed to approve deposit:', err);
      setToast({ type: 'error', message: err.message || 'Something went wrong. Please try again.' });
    } finally {
      setApprovingDepositId(null);
    }
  };

  const getEventById = (eventId) => events.find(e => e.id === eventId);
  const getOutcomesByMarketId = (marketId) => outcomes.filter(o => o.market_id === marketId);
  const getWagersByMarketId = (marketId) => wagers.filter(w => w.market_id === marketId);

  const handleMarketCreated = useCallback(async () => {
    await fetchData();
    if (typeof loadParimutuelEvents === 'function') {
      try {
        await loadParimutuelEvents();
      } catch (error) {
        console.warn('Failed to refresh parimutuel markets after creation', error);
      }
    }
  }, [fetchData, loadParimutuelEvents]);

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex items-center gap-3 text-neutral-400">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading admin markets...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-rose-400">
          <AlertCircle className="h-8 w-8" />
          <span>{error}</span>
          <button
            onClick={fetchData}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-300 transition hover:border-rose-500/70"
          >
            <RefreshCcw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm shadow-shell-card ${
            toast.type === 'success'
              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-400/40 bg-rose-500/10 text-rose-100'
          }`}
        >
          {toast.message}
        </div>
      ) : null}
      {/* Header */}
      <section className="flex flex-col gap-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-white">Market Management</h1>
            <p className="mt-1 text-sm text-neutral-400">
              Administer betting markets, approve withdrawals, and monitor user wallets
            </p>
          </div>
          <button
            onClick={fetchData}
            className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-4 py-2 text-sm text-[#9FF7D3] transition hover:border-[#9FF7D3]/70"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {/* Quick Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-[#05070F]/80 p-4">
            <div className="flex items-center gap-2 text-[#9FF7D3]">
              <BarChart3 className="h-5 w-5" />
              <span className="text-xs uppercase tracking-[0.3em]">Active Markets</span>
            </div>
            <span className="text-2xl font-semibold text-white">{marketAnalytics.activeMarketsCount}</span>
            <span className="text-xs text-neutral-500">of {marketAnalytics.totalMarketsCount} total</span>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-[#05070F]/80 p-4">
            <div className="flex items-center gap-2 text-[#7C6BFF]">
              <DollarSign className="h-5 w-5" />
              <span className="text-xs uppercase tracking-[0.3em]">Total Wagered</span>
            </div>
            <span className="text-2xl font-semibold text-white">
              💎 {(marketAnalytics.totalWagered / 1000).toFixed(1)}K
            </span>
            <span className="text-xs text-neutral-500">{wagers.length} wagers placed</span>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-[#05070F]/80 p-4">
            <div className="flex items-center gap-2 text-amber-400">
              <Clock className="h-5 w-5" />
              <span className="text-xs uppercase tracking-[0.3em]">Pending Wagers</span>
            </div>
            <span className="text-2xl font-semibold text-white">{marketAnalytics.pendingWagersCount}</span>
            <span className="text-xs text-neutral-500">awaiting settlement</span>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-[#05070F]/80 p-4">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertCircle className="h-5 w-5" />
              <span className="text-xs uppercase tracking-[0.3em]">Withdrawals</span>
            </div>
            <span className="text-2xl font-semibold text-white">{marketAnalytics.pendingWithdrawalsCount}</span>
            <span className="text-xs text-neutral-500">pending approval</span>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-[#05070F]/80 p-4">
            <div className="flex items-center gap-2 text-[#9FF7D3]">
              <ChevronDown className="h-5 w-5" />
              <span className="text-xs uppercase tracking-[0.3em]">Deposits</span>
            </div>
            <span className="text-2xl font-semibold text-white">{marketAnalytics.pendingDepositsCount}</span>
            <span className="text-xs text-neutral-500">awaiting follow-up</span>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10">
        {[
          { key: TABS.MARKETS, label: 'Markets', icon: BarChart3 },
          { key: TABS.SETTLEMENTS, label: 'Settlements', icon: Gavel },
          { key: TABS.PENDING_ACTIONS, label: 'Pending Actions', icon: Clock },
          { key: TABS.WALLETS, label: 'User Wallets', icon: Users },
          { key: TABS.ANALYTICS, label: 'Analytics', icon: TrendingUp },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition ${
                activeTab === tab.key
                  ? 'border-[#9FF7D3] text-[#9FF7D3]'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <section>
        {activeTab === TABS.MARKETS && (
          <div className="flex flex-col gap-6">
            <AdminMarketWizard onCreated={handleMarketCreated} />

            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">All Markets</h2>
              <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                {markets.length} total
              </span>
            </div>

            <div className="grid gap-4">
              {markets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-[#05070F]/40 p-8 text-center">
                  <p className="text-sm text-neutral-400">No markets created yet</p>
                </div>
              ) : (
                markets.map((market) => {
                  const event = getEventById(market.event_id);
                  const marketOutcomes = getOutcomesByMarketId(market.id);
                  const marketWagers = getWagersByMarketId(market.id);
                  const totalStake = marketWagers.reduce((sum, w) => sum + (w.stake || 0), 0);
                  const statusConfig = MARKET_STATUS_CONFIG[market.status] || MARKET_STATUS_CONFIG.open;
                  const StatusIcon = statusConfig.icon;

                  return (
                    <div
                      key={market.id}
                      className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-[#05070F]/80 p-6"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-3">
                            <h3 className="text-lg font-semibold text-white">{market.name}</h3>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                                statusConfig.color === 'green'
                                  ? 'border-green-500/40 bg-green-500/10 text-green-300'
                                  : statusConfig.color === 'red'
                                    ? 'border-red-500/40 bg-red-500/10 text-red-300'
                                    : 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                              }`}
                            >
                              <StatusIcon className="h-3 w-3" />
                              {statusConfig.label}
                            </span>
                          </div>
                          <p className="text-sm text-neutral-400">
                            {event?.title || 'Unknown Event'} • {market.type}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-neutral-500">
                            <span>Pool: 💎 {(totalStake / 1000).toFixed(1)}K</span>
                            <span>Wagers: {marketWagers.length}</span>
                            <span>Outcomes: {marketOutcomes.length}</span>
                            <span>Rake: {(market.rake_bps / 100).toFixed(1)}%</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {market.status === 'open' && (
                            <button
                              onClick={() => {
                                setSelectedMarket(market);
                                setModalMode('close');
                                setIsModalOpen(true);
                              }}
                              className="inline-flex items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 transition hover:border-rose-500/70"
                            >
                              <X className="h-3 w-3" />
                              Close
                            </button>
                          )}
                          {market.status === 'closed' && (
                            <button
                              type="button"
                              onClick={() => openSettlementModal(market)}
                              className="inline-flex items-center gap-2 rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-3 py-1.5 text-xs text-[#9FF7D3] transition hover:border-[#9FF7D3]/70"
                            >
                              <CheckCircle className="h-3 w-3" />
                              Settle
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setSelectedMarket(market);
                              setModalMode('view');
                              setIsModalOpen(true);
                            }}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-white/30"
                          >
                            <Eye className="h-3 w-3" />
                            Details
                          </button>
                        </div>
                      </div>

                      {/* Outcomes Preview */}
                      {marketOutcomes.length > 0 && (
                        <div className="flex flex-col gap-2 rounded-xl border border-white/5 bg-[#000000]/40 p-4">
                          <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Outcomes</span>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {marketOutcomes.map((outcome) => {
                              const outcomeWagers = marketWagers.filter(w => w.outcome_id === outcome.id);
                              const outcomeStake = outcomeWagers.reduce((sum, w) => sum + (w.stake || 0), 0);
                              const odds = totalStake > 0 ? (totalStake / Math.max(outcomeStake, 1)).toFixed(2) : '0.00';
                              const outcomeColor = outcome.color || '#9FF7D3';

                              return (
                                <div key={outcome.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-[#05070F]/60 px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="inline-block h-2.5 w-2.5 rounded-full"
                                      style={{ backgroundColor: outcomeColor }}
                                    />
                                    <span className="text-sm text-white">{outcome.label}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-neutral-400">
                                    <span>{odds}x</span>
                                    <span className="text-[#9FF7D3]">💎 {(outcomeStake / 1000).toFixed(1)}K</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === TABS.SETTLEMENTS && (
          <div className="flex flex-col gap-6">
            <SettlementApprovalQueue />
            <SettlementAuditDashboard />
          </div>
        )}

        {activeTab === TABS.PENDING_ACTIONS && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Pending Wagers */}
            <div className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-[#05070F]/80 p-6">
              <h3 className="text-lg font-semibold text-white">Pending Wagers</h3>
              <div className="flex flex-col gap-3">
                {pendingWagers.length === 0 ? (
                  <p className="text-sm text-neutral-500">No pending wagers</p>
                ) : (
                  pendingWagers.slice(0, 10).map((wager) => {
                    const wagerId = wager.wager_id ?? wager.id;
                    const isProcessing = processingPendingWagerId === wagerId;
                    return (
                      <div
                        key={wagerId}
                        className="flex flex-col gap-3 rounded-xl border border-white/5 bg-[#000000]/40 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-white">
                              {wager.market_name || 'Unknown Market'}
                            </span>
                            <span className="text-xs text-[#9FF7D3]">
                              {wager.outcome_label || 'Unknown Outcome'}
                            </span>
                            <span className="text-xs text-neutral-500">
                              {wager.bettor_name ? `By ${wager.bettor_name}` : `User: ${String(wager.user_id).slice(0, 8)}...`}
                            </span>
                            <span className="text-xs text-neutral-500">
                              {new Date(wager.placed_at).toLocaleString()}
                            </span>
                          </div>
                          <span className="text-sm font-semibold text-white">
                            💎 {(Number(wager.stake || 0) / 1000).toFixed(1)}K
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => handleApprovePendingWager(wagerId)}
                            disabled={isProcessing}
                            className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-500/70 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isProcessing ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Approving
                              </>
                            ) : (
                              <>
                                <CheckCircle className="h-3 w-3" />
                                Approve
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleRejectPendingWager(wagerId)}
                            disabled={isProcessing}
                            className="inline-flex items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-rose-200 transition hover:border-rose-500/70 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isProcessing ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Rejecting
                              </>
                            ) : (
                              <>
                                <X className="h-3 w-3" />
                                Reject
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Withdrawals */}
            <div className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-[#05070F]/80 p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-semibold text-white">Withdrawals</h3>
                <div className="flex gap-2">
                  {['queued', 'approved', 'rejected'].map((status) => {
                    const statusConfig = REQUEST_STATUS_CONFIG[status];
                    const isActive = withdrawalStatusFilter === status;
                    return (
                      <button
                        key={status}
                        onClick={() => setWithdrawalStatusFilter(status)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] transition ${
                          isActive
                            ? 'border-[#9FF7D3]/60 bg-[#9FF7D3]/15 text-[#9FF7D3]'
                            : 'border-white/10 text-neutral-400 hover:border-white/30 hover:text-white'
                        }`}
                      >
                        {statusConfig?.label ?? status}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {filteredWithdrawals.length === 0 ? (
                  <p className="text-sm text-neutral-500">No withdrawals in this state.</p>
                ) : (
                  filteredWithdrawals.slice(0, 20).map((withdrawal) => {
                    const statusConfig =
                      REQUEST_STATUS_CONFIG[withdrawal.status] ?? REQUEST_STATUS_CONFIG.queued;
                    const isQueued = withdrawal.status === 'queued';
                    return (
                      <div
                        key={withdrawal.id}
                        className="flex flex-col gap-3 rounded-xl border border-white/5 bg-[#000000]/40 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-white">Withdrawal Request</span>
                            <span className="text-xs text-neutral-500">
                              User: {withdrawal.user_id.slice(0, 8)}...
                            </span>
                            <span className="text-xs text-neutral-500">
                              {new Date(withdrawal.created_at).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className="text-sm font-semibold text-white">
                              💎 {(withdrawal.amount / 1000).toFixed(1)}K
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] ${statusConfig.badge}`}
                            >
                              {statusConfig.label}
                            </span>
                          </div>
                        </div>
                        {isQueued ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => handleApproveWithdrawal(withdrawal.id)}
                              disabled={processingWithdrawalId === withdrawal.id}
                              className="inline-flex items-center gap-2 rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-green-300 transition hover:border-green-500/70 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {processingWithdrawalId === withdrawal.id ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Processing
                                </>
                              ) : (
                                'Approve'
                              )}
                            </button>
                            <button
                              onClick={() => handleRejectWithdrawal(withdrawal.id)}
                              disabled={processingWithdrawalId === withdrawal.id}
                              className="inline-flex items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-rose-300 transition hover:border-rose-500/70 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {processingWithdrawalId === withdrawal.id ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Processing
                                </>
                              ) : (
                                <>
                                  <X className="h-3 w-3" />
                                  Reject
                                </>
                              )}
                            </button>
                          </div>
                        ) : withdrawal.rejection_reason ? (
                          <p className="text-xs text-neutral-400">
                            Reason: {withdrawal.rejection_reason}
                          </p>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Deposits */}
            <div className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-[#05070F]/80 p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-semibold text-white">Deposits</h3>
                <div className="flex gap-2">
                  {['queued', 'approved', 'rejected'].map((status) => {
                    const statusConfig = REQUEST_STATUS_CONFIG[status];
                    const isActive = depositStatusFilter === status;
                    return (
                      <button
                        key={status}
                        onClick={() => setDepositStatusFilter(status)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] transition ${
                          isActive
                            ? 'border-[#9FF7D3]/60 bg-[#9FF7D3]/15 text-[#9FF7D3]'
                            : 'border-white/10 text-neutral-400 hover:border-white/30 hover:text-white'
                        }`}
                      >
                        {statusConfig?.label ?? status}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {filteredDeposits.length === 0 ? (
                  <p className="text-sm text-neutral-500">No deposits in this state.</p>
                ) : (
                  filteredDeposits.slice(0, 20).map((deposit) => {
                    const statusConfig =
                      REQUEST_STATUS_CONFIG[deposit.status] ?? REQUEST_STATUS_CONFIG.queued;
                    const isQueued = deposit.status === 'queued';
                    const receiptValue = receiptCodes[deposit.id] ?? '';
                    return (
                      <div
                        key={deposit.id}
                        className="flex flex-col gap-3 rounded-xl border border-white/5 bg-[#000000]/40 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-white">Deposit Request</span>
                            <span className="text-xs text-neutral-500">
                              User: {deposit.user_id.slice(0, 8)}...
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className="text-sm font-semibold text-white">
                              💎 {(deposit.amount / 1000).toFixed(1)}K
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.3em] ${statusConfig.badge}`}
                            >
                              {statusConfig.label}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 text-xs text-neutral-400">
                          {deposit.ic_phone_number ? (
                            <span>IC Phone: {deposit.ic_phone_number}</span>
                          ) : (
                            <span className="text-amber-300">IC phone not provided</span>
                          )}
                          {deposit.reference_code ? (
                            <span>Reference: {deposit.reference_code}</span>
                          ) : null}
                          <span>{new Date(deposit.created_at).toLocaleString()}</span>
                        </div>
                        {isQueued ? (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <input
                              value={receiptValue}
                              onChange={(event) =>
                                setReceiptCodes((prev) => ({
                                  ...prev,
                                  [deposit.id]: event.target.value,
                                }))
                              }
                              placeholder="Receipt code (optional)"
                              className="w-full rounded-md border border-white/10 bg-[#0B1120]/60 px-3 py-2 text-sm text-white outline-none focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
                            />
                            <button
                              onClick={() => handleMarkDepositReceived(deposit)}
                              disabled={approvingDepositId === deposit.id}
                              className="inline-flex items-center justify-center gap-2 rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {approvingDepositId === deposit.id ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Processing
                                </>
                              ) : (
                                'Mark Received'
                              )}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === TABS.WALLETS && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by user ID..."
                  className="w-full rounded-full border border-white/10 bg-[#05070F]/80 py-2 pl-10 pr-4 text-sm text-white placeholder-neutral-500 focus:border-[#9FF7D3]/40 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid gap-4">
              {walletAccounts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-[#05070F]/40 p-8 text-center">
                  <p className="text-sm text-neutral-400">No wallet accounts found</p>
                </div>
              ) : (
                walletAccounts
                  .filter(wallet =>
                    !searchQuery || wallet.user_id.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .slice(0, 20)
                  .map((wallet) => (
                    <div
                      key={wallet.user_id}
                      className="flex items-center justify-between rounded-2xl border border-white/5 bg-[#05070F]/80 p-4"
                    >
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-sm text-white">{wallet.user_id}</span>
                        <span className="text-xs text-neutral-500">User Wallet</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold text-[#9FF7D3]">
                          💎 {(wallet.balance / 1000).toFixed(1)}K
                        </span>
                        <button className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-white/30">
                          <Settings className="h-3 w-3" />
                          Adjust
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}

        {activeTab === TABS.ANALYTICS && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/5 bg-[#05070F]/80 p-6">
              <h3 className="mb-4 text-lg font-semibold text-white">Market Analytics</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Total Events</span>
                  <span className="text-2xl font-semibold text-white">{events.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Total Markets</span>
                  <span className="text-2xl font-semibold text-white">{markets.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Total Outcomes</span>
                  <span className="text-2xl font-semibold text-white">{outcomes.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Total Wagers</span>
                  <span className="text-2xl font-semibold text-white">{wagers.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Total Volume</span>
                  <span className="text-2xl font-semibold text-white">
                    💎 {(marketAnalytics.totalWagered / 1000).toFixed(1)}K
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">Avg Wager Size</span>
                  <span className="text-2xl font-semibold text-white">
                    💎 {wagers.length > 0 ? (marketAnalytics.totalWagered / wagers.length / 1000).toFixed(1) : '0.0'}K
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-[#05070F]/80 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Recent Activity Log</h3>
                <button className="text-xs text-[#9FF7D3] hover:text-white">Export CSV</button>
              </div>
              <div className="text-sm text-neutral-400">
                Activity logging coming soon - will track market creation, closures, settlements, and fund adjustments
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Settlement Modal */}
      {isModalOpen && modalMode === 'settle' && selectedMarket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#05070F] p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-neutral-500">Propose Settlement</p>
                <h3 className="mt-1 text-2xl font-semibold text-white">{selectedMarket.name}</h3>
                <p className="text-sm text-neutral-400">
                  {selectedMarketContext?.event?.title ?? 'Unlinked Event'} • Session{' '}
                  {selectedMarketContext?.event?.session_id
                    ? `${selectedMarketContext.event.session_id.slice(0, 8)}…`
                    : '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={dismissModal}
                className="rounded-full p-2 text-neutral-400 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Total Pool</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {formatWalletBalance(selectedMarketContext?.totalStake ?? 0, { compact: false })}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Wagers</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {selectedMarketContext?.wagerCount ?? 0}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Outcomes</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {selectedMarketContext?.outcomes?.length ?? 0}
                </p>
              </div>
            </div>

            <div className="mb-6 space-y-3">
              {(selectedMarketContext?.outcomes ?? []).length === 0 ? (
                <p className="text-sm text-neutral-400">
                  This market has no outcomes configured. Please add outcomes before proposing a settlement.
                </p>
              ) : (
                selectedMarketContext?.outcomes?.map((outcome) => (
                  <label
                    key={outcome.id}
                    className={`flex cursor-pointer items-center justify-between rounded-2xl border px-4 py-3 ${
                      settlementOutcomeId === outcome.id
                        ? 'border-[#9FF7D3]/60 bg-[#9FF7D3]/10'
                        : 'border-white/10 bg-white/5 hover:border-white/30'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-semibold text-white">{outcome.label}</p>
                      <p className="text-xs text-neutral-400">{outcome.abbreviation || '—'}</p>
                    </div>
                    <input
                      type="radio"
                      name="settlement-outcome"
                      value={outcome.id}
                      checked={settlementOutcomeId === outcome.id}
                      onChange={() => setSettlementOutcomeId(outcome.id)}
                      className="h-4 w-4 accent-[#9FF7D3]"
                    />
                  </label>
                ))
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                  Notes for approvers
                </label>
                <textarea
                  value={settlementNotes}
                  onChange={(event) => setSettlementNotes(event.target.value.slice(0, 500))}
                  rows={3}
                  placeholder="Describe the finishing order, steward notes, or anything relevant for reviewers."
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#9FF7D3]/40 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                  Timing evidence (JSON, lap summary, or link)
                </label>
                <textarea
                  value={timingEvidence}
                  onChange={(event) => setTimingEvidence(event.target.value.slice(0, 1000))}
                  rows={4}
                  placeholder="Paste lap export, penalty breakdown, or a link to timing spreadsheet."
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#9FF7D3]/40 focus:outline-none"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Shared with stewards before approvals are executed.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={dismissModal}
                className="flex-1 rounded-full border border-white/10 px-4 py-2 text-sm text-neutral-300 transition hover:border-white/30 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitSettlementProposal}
                disabled={!settlementOutcomeId || isSubmittingSettlement}
                className="flex-1 rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-4 py-2 text-sm font-semibold text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmittingSettlement ? 'Submitting…' : 'Send to Approval Queue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Market Modal */}
      {isModalOpen && modalMode === 'close' && selectedMarket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#05070F] p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-white">Close Market</h3>
              <button
                type="button"
                onClick={dismissModal}
                className="text-neutral-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-6">
              <p className="text-sm text-neutral-400">
                Are you sure you want to close: <strong className="text-white">{selectedMarket.name}</strong>?
              </p>
              <p className="mt-2 text-xs text-neutral-500">
                This will prevent new wagers from being placed. You can settle the market afterwards.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={dismissModal}
                className="flex-1 rounded-full border border-white/10 py-2 text-sm text-neutral-400 transition hover:border-white/30 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => handleCloseMarket(selectedMarket.id)}
                className="flex-1 rounded-full border border-rose-500/40 bg-rose-500/10 py-2 text-sm text-rose-300 transition hover:border-rose-500/70"
              >
                Close Market
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminMarketsPage;
