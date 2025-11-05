import { useState } from 'react';
import { CheckCircle2, Loader2, TrendingUp, X } from 'lucide-react';
import { useWallet } from '@/context/WalletContext.jsx';
import { supabaseClient } from '@/lib/supabaseClient.js';

const QUICK_STAKES = [
  { label: '1K', value: 1000 },
  { label: '10K', value: 10000 },
  { label: '100K', value: 100000 },
  { label: '1M', value: 1000000 },
];

const formatDiamonds = (amount) => {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K`;
  }
  return amount.toString();
};

export default function Betslip({ market, outcome, onClose, onSuccess }) {
  const { balance, refresh } = useWallet();
  const [stake, setStake] = useState(0);
  const [customStake, setCustomStake] = useState('');
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleQuickStake = (value) => {
    setStake(value);
    setCustomStake('');
    setError(null);
  };

  const handleCustomStakeChange = (e) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    setCustomStake(value);
    setStake(value ? parseInt(value, 10) : 0);
    setError(null);
  };

  const handlePlaceWager = async () => {
    if (!stake || stake <= 0) {
      setError('Please select a stake amount');
      return;
    }

    if (stake > balance) {
      setError(`Insufficient funds. Your balance: ${formatDiamonds(balance)}`);
      return;
    }

    setIsPlacing(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabaseClient.rpc('place_wager', {
        p_market_id: market.id,
        p_outcome_id: outcome.id,
        p_stake: stake,
      });

      if (rpcError) throw rpcError;

      if (!data?.success) {
        throw new Error(data?.message || 'Failed to place wager');
      }

      setSuccess(true);

      // Trigger confetti animation
      if (typeof onSuccess === 'function') {
        onSuccess({
          wagerId: data.wager_id,
          stake,
          newBalance: data.new_balance,
        });
      }

      // Refresh wallet balance
      await refresh();

      // Auto-close after success
      setTimeout(() => {
        if (typeof onClose === 'function') {
          onClose();
        }
      }, 2000);
    } catch (err) {
      console.error('Failed to place wager:', err);
      setError(err.message || 'Failed to place wager. Please try again.');
    } finally {
      setIsPlacing(false);
    }
  };

  if (success) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-green-500/20 bg-green-950/20 p-8 text-center">
        <CheckCircle2 className="h-16 w-16 text-green-400" />
        <div className="flex flex-col gap-2">
          <h3 className="text-2xl font-semibold text-white">Wager placed!</h3>
          <p className="text-sm text-green-200">
            💎 {formatDiamonds(stake)} on <span className="font-semibold">{outcome.label}</span>
          </p>
          <p className="text-xs text-neutral-400">Good luck!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-[#060910]/95 p-6 shadow-xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-[0.35em] text-[#7C6BFF]">Betslip</span>
          <h3 className="text-lg font-semibold text-white">{market.name}</h3>
          <p className="text-sm text-neutral-400">
            {outcome.label}
          </p>
        </div>
        {typeof onClose === 'function' && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-neutral-400 transition hover:bg-white/5 hover:text-white"
            aria-label="Close betslip"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Quick Stake Buttons */}
      <div className="flex flex-col gap-3">
        <label className="text-xs uppercase tracking-[0.3em] text-neutral-500">
          Quick Stake
        </label>
        <div className="grid grid-cols-4 gap-2">
          {QUICK_STAKES.map((qs) => (
            <button
              key={qs.value}
              type="button"
              onClick={() => handleQuickStake(qs.value)}
              disabled={isPlacing}
              className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                stake === qs.value
                  ? 'border-[#9FF7D3] bg-[#9FF7D3]/10 text-[#9FF7D3]'
                  : 'border-white/10 bg-white/5 text-white hover:border-white/20 hover:bg-white/10'
              } disabled:opacity-50`}
            >
              💎 {qs.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom Stake */}
      <div className="flex flex-col gap-3">
        <label htmlFor="custom-stake" className="text-xs uppercase tracking-[0.3em] text-neutral-500">
          Custom Amount
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400">💎</span>
          <input
            id="custom-stake"
            type="text"
            inputMode="numeric"
            value={customStake}
            onChange={handleCustomStakeChange}
            disabled={isPlacing}
            placeholder="Enter amount..."
            className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-white placeholder:text-neutral-600 focus:border-[#9FF7D3]/40 focus:outline-none focus:ring-2 focus:ring-[#9FF7D3]/20 disabled:opacity-50"
          />
        </div>
      </div>

      {/* Balance Display */}
      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm">
        <span className="text-neutral-400">Your balance</span>
        <span className="font-semibold text-white">💎 {formatDiamonds(balance)}</span>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-950/20 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Place Wager Button */}
      <button
        type="button"
        onClick={handlePlaceWager}
        disabled={isPlacing || !stake || stake > balance}
        className="flex items-center justify-center gap-2 rounded-full border border-[#9FF7D3]/40 bg-[#9FF7D3]/10 px-6 py-4 font-semibold uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/70 hover:bg-[#9FF7D3]/20 hover:text-white disabled:opacity-50 disabled:hover:border-[#9FF7D3]/40 disabled:hover:bg-[#9FF7D3]/10 disabled:hover:text-[#9FF7D3]"
      >
        {isPlacing ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Placing wager...
          </>
        ) : (
          <>
            <TrendingUp className="h-5 w-5" />
            Place wager
          </>
        )}
      </button>

      {stake > 0 && stake <= balance && (
        <p className="text-center text-xs text-neutral-500">
          Estimated payout varies based on final pool size
        </p>
      )}
    </div>
  );
}
