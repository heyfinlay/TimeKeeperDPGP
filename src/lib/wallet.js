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

export const createDepositRequest = async ({ amount, icPhoneNumber, reference } = {}) => {
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

