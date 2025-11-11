import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { supabase } from '@/lib/supabaseClient.js';
import { saveProfile } from '@/lib/profile.js';
import { createDepositRequest } from '@/lib/wallet.js';

const TopUpModal = ({ isOpen, onClose }) => {
  const { user, profile, syncProfile, isSupabaseConfigured } = useAuth();
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [profileSnapshot, setProfileSnapshot] = useState(null);
  const [phone, setPhone] = useState('');
  const [missingPhone, setMissingPhone] = useState(false);
  const [isSavingPhone, setIsSavingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [statusMessage, setStatusMessage] = useState(null);
  const [statusVariant, setStatusVariant] = useState('neutral');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayName = useMemo(
    () => profileSnapshot?.display_name ?? profile?.display_name ?? '',
    [profile?.display_name, profileSnapshot?.display_name],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setStatusMessage(null);
    setStatusVariant('neutral');
    setPhoneError(null);

    const initialPhone = profile?.ic_phone_number ?? '';
    setPhone(initialPhone);
    setMissingPhone(!(initialPhone && initialPhone.trim()));
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
          setStatusMessage('Unable to load the latest profile details. You can still submit a top-up.');
          setStatusVariant('warning');
          return;
        }

        const phoneValue = data?.ic_phone_number ?? initialPhone ?? '';
        setProfileSnapshot(data ?? null);
        setPhone(phoneValue);
        setMissingPhone(!(phoneValue && phoneValue.trim()));
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingProfile(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [
    isOpen,
    isSupabaseConfigured,
    profile?.display_name,
    profile?.ic_phone_number,
    user?.id,
  ]);

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  };

  const handleSavePhone = async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      setPhoneError('Please enter your IC phone number before saving.');
      return;
    }
    if (!displayName.trim()) {
      setPhoneError('Add a display name to your profile before saving a phone number.');
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setPhone(trimmedPhone);
      setProfileSnapshot((current) => ({
        ...(current ?? {}),
        display_name: displayName,
        ic_phone_number: trimmedPhone,
      }));
      setMissingPhone(false);
      setStatusVariant('warning');
      setStatusMessage('Supabase is not configured, so the phone number is stored only for this session.');
      return;
    }

    setIsSavingPhone(true);
    setPhoneError(null);

    try {
      const updated = await saveProfile(
        {
          display_name: displayName,
          ic_phone_number: trimmedPhone,
        },
        { userId: user?.id, supabase },
      );

      if (updated) {
        setProfileSnapshot(updated);
        syncProfile?.(updated);
        const savedPhone = updated.ic_phone_number ?? trimmedPhone;
        setPhone(savedPhone);
        setMissingPhone(!(savedPhone && savedPhone.trim()));
      } else {
        setMissingPhone(!trimmedPhone);
      }

      setStatusVariant('success');
      setStatusMessage('IC phone number saved. You can now continue your top-up.');
    } catch (error) {
      console.error('Failed to save IC phone number', error);
      setPhoneError(error?.message ?? 'Unable to save your IC phone number right now.');
      setStatusVariant('error');
      setStatusMessage('We could not save your IC phone number. Please try again.');
    } finally {
      setIsSavingPhone(false);
    }
  };

  const handleSubmitTopUp = async (event) => {
    event.preventDefault();
    if (missingPhone) {
      setStatusVariant('error');
      setStatusMessage('Please add your IC phone number before submitting a top-up request.');
      return;
    }

    const trimmedAmount = amount.trim();
    const numericAmount = Number(trimmedAmount);
    if (!trimmedAmount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setStatusVariant('error');
      setStatusMessage('Enter a valid top-up amount before submitting.');
      return;
    }

    const trimmedPhone = phone.trim();
    const trimmedReference = reference.trim();

    setIsSubmitting(true);
    setStatusVariant('neutral');
    setStatusMessage('Submitting your deposit request…');

    try {
      const result = await createDepositRequest({
        amount: numericAmount,
        icPhoneNumber: trimmedPhone,
        reference: trimmedReference || null,
      });

      setAmount('');
      setReference('');
      setStatusVariant(result?.offline ? 'warning' : 'success');
      setStatusMessage(
        result?.offline
          ? 'Supabase is not configured, so this deposit request was recorded locally only.'
          : 'Deposit request submitted. Our finance stewards will contact you shortly with deposit instructions and the drop-off location.',
      );
    } catch (error) {
      console.error('Failed to submit deposit request', error);
      setStatusVariant('error');
      setStatusMessage(error?.message ?? 'Unable to submit your deposit request right now. Please try again.');
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

        {missingPhone ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-100 p-3 text-amber-900">
            <p className="text-sm">
              You haven’t added your IC phone number. Please add it so we can verify your top-up.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+61 4xx xxx xxx"
                inputMode="tel"
                className="flex-1 rounded-md border border-amber-300/80 bg-white px-3 py-2 text-sm text-amber-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-300"
              />
              <button
                type="button"
                onClick={handleSavePhone}
                disabled={isSavingPhone}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSavingPhone ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
            {phoneError ? <p className="mt-2 text-xs text-amber-700">{phoneError}</p> : null}
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
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="50"
              className="rounded-md border border-white/10 bg-[#0B1120]/60 px-3 py-2 text-sm text-white outline-none focus:border-[#9FF7D3]/70 focus:ring-2 focus:ring-[#9FF7D3]/30"
            />
          </label>

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
            disabled={isSubmitting || missingPhone}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#9FF7D3] px-6 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-[#041313] transition hover:bg-[#7de6c0] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSubmitting ? 'Submitting' : missingPhone ? 'Add IC phone to continue' : 'Submit top-up'}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
};

export default TopUpModal;

