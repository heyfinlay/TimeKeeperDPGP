import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useWallet } from '@/context/WalletContext.jsx';
import { formatCurrency } from '@/utils/betting.js';
import { requestWithdrawal } from '@/lib/wallet.js';

const WithdrawModal = ({ isOpen, onClose }) => {
  const { balance, refresh } = useWallet();
  const [amount, setAmount] = useState('');
  const [statusMessage, setStatusMessage] = useState(null);
  const [statusVariant, setStatusVariant] = useState('neutral');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setAmount('');
    setStatusMessage(null);
    setStatusVariant('neutral');
  }, [isOpen]);

  const formattedBalance = useMemo(
    () => formatCurrency(balance, { compact: false, maximumFractionDigits: 0 }),
    [balance],
  );

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedAmount = amount.trim();
    const numericAmount = Number(trimmedAmount);

    if (!trimmedAmount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setStatusVariant('error');
      setStatusMessage('Enter a valid withdrawal amount before submitting.');
      return;
    }

    if (Number.isFinite(balance) && numericAmount > balance) {
      setStatusVariant('error');
      setStatusMessage('Withdrawal amount cannot exceed your available balance.');
      return;
    }

    setIsSubmitting(true);
    setStatusVariant('neutral');
    setStatusMessage('Submitting your withdrawal request…');

    try {
      const result = await requestWithdrawal({ amount: numericAmount });
      setAmount('');
      setStatusVariant(result?.offline ? 'warning' : 'success');
      setStatusMessage(
        result?.offline
          ? 'Supabase is not configured, so this withdrawal request was recorded locally only.'
          : 'Withdrawal request submitted. Our finance team will reach out shortly with pickup details.',
      );
      if (!result?.offline && typeof refresh === 'function') {
        await refresh();
      }
    } catch (error) {
      console.error('Failed to submit withdrawal request', error);
      setStatusVariant('error');
      setStatusMessage(error?.message ?? 'Unable to submit your withdrawal request right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6"
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#05070F]/95 p-6 text-white shadow-[0_0_40px_rgba(5,7,15,0.65)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Request a withdrawal</h2>
            <p className="text-sm text-neutral-400">
              Confirm your amount and we will follow up with collection instructions shortly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 p-2 text-neutral-400 transition hover:border-white/30 hover:text-white"
            aria-label="Close withdrawal modal"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="mb-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-400">Available balance</p>
          <p className="mt-1 text-lg font-semibold text-white">{formattedBalance}</p>
        </div>

        {statusMessage ? (
          <div
            className={`mb-4 rounded-md border px-3 py-2 text-sm ${
              statusVariant === 'success'
                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                : statusVariant === 'error'
                ? 'border-red-400/40 bg-red-500/10 text-red-200'
                : statusVariant === 'warning'
                ? 'border-amber-400/60 bg-amber-500/10 text-amber-200'
                : 'border-white/10 bg-white/5 text-neutral-200'
            }`}
          >
            {statusMessage}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-400">Amount</span>
            <input
              type="number"
              min="0"
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="250"
              className="rounded-md border border-white/10 bg-[#0B1120]/60 px-3 py-2 text-sm text-white outline-none focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-rose-400 px-6 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-[#1B0C14] transition hover:bg-rose-300 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSubmitting ? 'Submitting' : 'Submit withdrawal'}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
};

export default WithdrawModal;

