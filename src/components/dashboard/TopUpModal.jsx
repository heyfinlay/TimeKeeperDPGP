import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { supabase } from '@/lib/supabaseClient.js';
import { saveProfile } from '@/lib/profile.js';
import { requestDeposit } from '@/lib/wallet.js';

const MAX_DEPOSIT_AMOUNT = 100000;

const TopUpModal = ({ isOpen, onClose, onSuccess, onError }) => {
  const { user, profile, syncProfile, isSupabaseConfigured } = useAuth();
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [profileSnapshot, setProfileSnapshot] = useState(null);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [formNotice, setFormNotice] = useState(null);
  const [formNoticeVariant, setFormNoticeVariant] = useState('neutral');
  const [isSavingPhone, setIsSavingPhone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayName = useMemo(
    () => profileSnapshot?.display_name ?? profile?.display_name ?? '',
    [profile?.display_name, profileSnapshot?.display_name],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setFormErrors({});
    setFormNotice(null);
    setFormNoticeVariant('neutral');

    const initialPhone = profile?.ic_phone_number ?? '';
    setPhone(initialPhone);
    setProfileSnapshot(
      profile
        ? { display_name: profile.display_name ?? '', ic_phone_number: profile.ic_phone_number ?? null }
        : null,
    );

    if (!isSupabaseConfigured || !supabase || !user?.id) {
      setIsLoadingProfile(false);
      return;
    }

    let isActive = true;
    setIsLoadingProfile(true);

    supabase
      .from('profiles')
      .select('display_name, ic_phone_number')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isActive) return;
        if (error) {
          console.error('Unable to load profile for top-up modal', error);
          setFormNotice('Unable to load the latest profile details. You can still submit a top-up.');
          setFormNoticeVariant('warning');
          return;
        }

        const phoneValue = data?.ic_phone_number ?? initialPhone ?? '';
        setProfileSnapshot(data ?? null);
        setPhone(phoneValue);
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingProfile(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [isOpen, isSupabaseConfigured, profile?.display_name, profile?.ic_phone_number, user?.id]);

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  };

  const handleSavePhone = async () => {
    const trimmedPhone = phone.trim();
    const trimmedDisplayName = displayName.trim();
    setFormErrors((prev) => ({ ...prev, phone: null }));

    if (!trimmedPhone) {
      setFormErrors((prev) => ({ ...prev, phone: 'Please enter your IC phone number before saving.' }));
      return;
    }

    if (!trimmedDisplayName) {
      setFormErrors((prev) => ({ ...prev, phone: 'Add a display name to your profile before saving a phone number.' }));
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setPhone(trimmedPhone);
      setProfileSnapshot((current) => ({
        ...(current ?? {}),
        display_name: trimmedDisplayName,
        ic_phone_number: trimmedPhone,
      }));
      setFormNoticeVariant('warning');
      setFormNotice('Supabase is not configured, so the phone number is stored only for this session.');
      return;
    }

    setIsSavingPhone(true);

    try {
      const updated = await saveProfile(
        {
          display_name: trimmedDisplayName,
          ic_phone_number: trimmedPhone,
        },
        { userId: user?.id, supabase },
      );

      if (updated) {
        setProfileSnapshot(updated);
        syncProfile?.(updated);
        const savedPhone = updated.ic_phone_number ?? trimmedPhone;
        setPhone(savedPhone);
      }

      setFormNoticeVariant('success');
      setFormNotice('IC phone number saved. You can now continue your top-up.');
    } catch (error) {
      console.error('Failed to save IC phone number', error);
      const message = error?.message ?? 'Unable to save your IC phone number right now. Please try again.';
      setFormErrors((prev) => ({ ...prev, phone: message }));
      setFormNoticeVariant('error');
      setFormNotice('We could not save your IC phone number. Please try again.');
    } finally {
      setIsSavingPhone(false);
    }
  };

  const handleSubmitTopUp = async (event) => {
    event.preventDefault();
    const trimmedAmount = amount.trim();
    const trimmedPhone = phone.trim();
    const trimmedReference = reference.trim();
    const numericAmount = Number(trimmedAmount);

    const nextErrors = {};
    if (!trimmedAmount) {
      nextErrors.amount = 'Enter an amount before submitting.';
    } else if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      nextErrors.amount = 'Amount must be greater than zero.';
    } else if (numericAmount > MAX_DEPOSIT_AMOUNT) {
      nextErrors.amount = `Amount cannot exceed ${MAX_DEPOSIT_AMOUNT.toLocaleString('en-US')} diamonds.`;
    }

    if (!trimmedPhone) {
      nextErrors.phone = 'Please provide your IC phone number so we can confirm your deposit.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors);
      return;
    }

    setFormErrors({});
    setFormNotice(null);
    setIsSubmitting(true);

    try {
      const result = await requestDeposit({
        amount: numericAmount,
        icPhoneNumber: trimmedPhone,
        reference: trimmedReference || null,
      });

      const successMessage = result?.offline
        ? 'Supabase is not configured, so this deposit request was recorded locally only.'
        : 'Deposit requested. A steward will contact you shortly with instructions and a drop-off location.';

      onSuccess?.(successMessage, { offline: Boolean(result?.offline) });
      setAmount('');
      setReference('');
      onClose?.();
    } catch (error) {
      console.error('Failed to submit deposit request', error);
      const message = error?.message ?? 'Unable to submit your deposit request right now. Please try again.';
      setFormNotice(message);
      setFormNoticeVariant('error');
      onError?.(message);
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
            <h2 className="text-xl font-semibold">Top up steward balance</h2>
            <p className="text-sm text-neutral-400">
              Provide your IC phone number so we can verify your request and stay in touch during processing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 p-2 text-neutral-400 transition hover:border-white/30 hover:text-white"
            aria-label="Close top-up modal"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {formNotice ? (
          <div
            className={`mb-4 rounded-md border px-3 py-2 text-sm ${
              formNoticeVariant === 'success'
                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                : formNoticeVariant === 'error'
                ? 'border-red-400/40 bg-red-500/10 text-red-200'
                : formNoticeVariant === 'warning'
                ? 'border-amber-400/60 bg-amber-500/10 text-amber-200'
                : 'border-white/10 bg-white/5 text-neutral-200'
            }`}
          >
            {formNotice}
          </div>
        ) : null}

        {isLoadingProfile ? (
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-neutral-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading latest profile details…
          </div>
        ) : null}

        <form onSubmit={handleSubmitTopUp} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-400">Amount</span>
            <input
              type="number"
              min="0"
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="50"
              className="rounded-md border border-white/10 bg-[#0B1120]/60 px-3 py-2 text-sm text-white outline-none focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
            />
            {formErrors.amount ? <p className="text-xs text-rose-300">{formErrors.amount}</p> : null}
          </label>

          <div className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-400">IC Phone</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+61 4xx xxx xxx"
                inputMode="tel"
                className="flex-1 rounded-md border border-white/10 bg-[#0B1120]/60 px-3 py-2 text-sm text-white outline-none focus:border-[#7C6BFF]/70 focus:ring-2 focus:ring-[#7C6BFF]/30"
              />
              <button
                type="button"
                onClick={handleSavePhone}
                disabled={isSavingPhone}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-neutral-200 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSavingPhone ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving
                  </>
                ) : (
                  'Save to profile'
                )}
              </button>
            </div>
            {formErrors.phone ? <p className="text-xs text-rose-300">{formErrors.phone}</p> : null}
          </div>

          <label className="flex flex-col gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-400">Reference</span>
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Transaction reference (optional)"
              className="rounded-md border border-white/10 bg-[#0B1120]/60 px-3 py-2 text-sm text-white outline-none focus:border-[#7C6BFF]/70 focus:ring-2 focus:ring-[#7C6BFF]/30"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#9FF7D3] px-6 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-[#041313] transition hover:bg-[#7de6c0] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSubmitting ? 'Submitting' : 'Submit top-up'}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
};

export default TopUpModal;
