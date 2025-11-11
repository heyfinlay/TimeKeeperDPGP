import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient.js';

const toIntegerAmount = (value) => {
  if (value === null || value === undefined) {
    return NaN;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  return Math.round(numeric);
};

const parseBalance = (balance) => {
  const numeric = Number(balance);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric);
};

export const formatWalletBalance = (value, { compact = false } = {}) => {
  const amount = parseBalance(value);
  const formatter = new Intl.NumberFormat('en-US', {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
    minimumFractionDigits: 0,
  });
  return formatter.format(amount);
};

export const getWalletForUser = async (userId) => {
  if (!userId || !isSupabaseConfigured || !supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('wallet_accounts')
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const balance = data?.balance ?? 0;
  return { balance: parseBalance(balance) };
};

export const subscribeToWallet = (userId, callback) => {
  if (!userId || !isSupabaseConfigured || !supabase) {
    return () => {};
  }

  const channel = supabase
    .channel(`wallet-updates-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wallet_accounts', filter: `user_id=eq.${userId}` },
      (payload) => {
        const nextBalance = payload?.new?.balance ?? payload?.old?.balance;
        callback?.({ type: 'wallet_accounts', balance: parseBalance(nextBalance) });
      },
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'wallet_transactions', filter: `user_id=eq.${userId}` },
      (payload) => {
        callback?.({ type: 'wallet_transactions', transaction: payload?.new ?? null });
      },
    )
    .subscribe();

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch (error) {
      console.warn('Failed to unsubscribe from wallet updates', error);
    }
  };
};

export const requestDeposit = async ({ amount, icPhoneNumber, reference } = {}) => {
  const numericAmount = toIntegerAmount(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Deposit amount must be a positive number.');
  }

  if (!isSupabaseConfigured || !supabase) {
    return { success: true, offline: true, amount: numericAmount };
  }

  const { data, error } = await supabase.rpc('request_deposit', {
    p_amount: numericAmount,
    p_phone: icPhoneNumber ?? null,
    p_reference: reference ?? null,
  });

  if (error) {
    throw error;
  }

  if (!data?.success) {
    throw new Error(data?.message ?? 'Deposit request was not accepted.');
  }

  return data;
};

export const requestWithdrawal = async ({ amount } = {}) => {
  const numericAmount = toIntegerAmount(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Withdrawal amount must be a positive number.');
  }

  if (!isSupabaseConfigured || !supabase) {
    return { success: true, offline: true, amount: numericAmount };
  }

  const { data, error } = await supabase.rpc('request_withdrawal', {
    p_amount: numericAmount,
  });

  if (error) {
    throw error;
  }

  if (!data?.success) {
    throw new Error(data?.message ?? 'Withdrawal request was not accepted.');
  }

  return data;
};

export const handleApproveDeposit = async ({ depositId, receiptCode }) => {
  if (!depositId) {
    throw new Error('A deposit ID is required.');
  }
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.rpc('approve_deposit', {
    p_deposit_id: depositId,
    p_reference: receiptCode ? receiptCode.trim() || null : null,
  });

  if (error) {
    throw error;
  }

  if (!data?.success) {
    throw new Error(data?.message ?? 'Deposit approval failed.');
  }

  return data;
};

