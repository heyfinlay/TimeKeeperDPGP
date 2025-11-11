-- Withdrawal approval RPCs for admin

-- approve_withdrawal: Admin approves a withdrawal and credits the user
create or replace function public.approve_withdrawal(p_withdrawal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdrawal record;
begin
  -- Check admin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  -- Lock and get withdrawal
  select * into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal not found';
  end if;

  if v_withdrawal.status != 'queued' then
    raise exception 'Withdrawal is not queued (current status: %)', v_withdrawal.status;
  end if;

  -- Update withdrawal status
  update public.withdrawals
  set status = 'approved'
  where id = p_withdrawal_id;

  -- Log admin action
  perform public.log_admin_action(
    'approve_withdrawal',
    null,
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'user_id', v_withdrawal.user_id,
      'amount', v_withdrawal.amount
    )
  );

  return jsonb_build_object(
    'success', true,
    'withdrawal_id', p_withdrawal_id,
    'status', 'approved'
  );
end;
$$;

grant execute on function public.approve_withdrawal(uuid) to authenticated;

-- reject_withdrawal: Admin rejects a withdrawal and refunds the reserved amount
create or replace function public.reject_withdrawal(
  p_withdrawal_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdrawal record;
begin
  -- Check admin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  -- Lock and get withdrawal
  select * into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'Withdrawal not found';
  end if;

  if v_withdrawal.status != 'queued' then
    raise exception 'Withdrawal is not queued (current status: %)', v_withdrawal.status;
  end if;

  -- Refund the amount back to user's wallet
  insert into public.wallet_accounts (user_id, balance)
  values (v_withdrawal.user_id, v_withdrawal.amount)
  on conflict (user_id)
  do update set balance = wallet_accounts.balance + v_withdrawal.amount;

  -- Record refund transaction
  insert into public.wallet_transactions (user_id, kind, amount, meta)
  values (
    v_withdrawal.user_id,
    'refund',
    v_withdrawal.amount,
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'reason', p_reason,
      'admin_id', auth.uid()
    )
  );

  -- Update withdrawal status
  update public.withdrawals
  set status = 'rejected'
  where id = p_withdrawal_id;

  -- Log admin action
  perform public.log_admin_action(
    'reject_withdrawal',
    null,
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'user_id', v_withdrawal.user_id,
      'amount', v_withdrawal.amount,
      'reason', p_reason
    )
  );

  return jsonb_build_object(
    'success', true,
    'withdrawal_id', p_withdrawal_id,
    'status', 'rejected',
    'refunded', v_withdrawal.amount
  );
end;
$$;

grant execute on function public.reject_withdrawal(uuid, text) to authenticated;

-- request_withdrawal: User requests a withdrawal (reserves funds)
create or replace function public.request_withdrawal(p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_current_balance bigint;
  v_withdrawal_id uuid;
begin
  -- Get authenticated user
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Validate amount
  if p_amount <= 0 then
    raise exception 'Withdrawal amount must be positive';
  end if;

  -- Lock wallet and check balance
  select balance into v_current_balance
  from public.wallet_accounts
  where user_id = v_user_id
  for update;

  if v_current_balance is null or v_current_balance < p_amount then
    raise exception 'Insufficient funds. Balance: %, Requested: %',
      coalesce(v_current_balance, 0), p_amount;
  end if;

  -- Deduct from wallet (reserve funds)
  update public.wallet_accounts
  set balance = balance - p_amount
  where user_id = v_user_id;

  -- Record withdrawal transaction
  insert into public.wallet_transactions (user_id, kind, amount, meta)
  values (
    v_user_id,
    'withdrawal_reserve',
    -p_amount,
    jsonb_build_object('status', 'queued')
  );

  -- Create withdrawal request
  insert into public.withdrawals (user_id, amount, status)
  values (v_user_id, p_amount, 'queued')
  returning id into v_withdrawal_id;

  return jsonb_build_object(
    'success', true,
    'withdrawal_id', v_withdrawal_id,
    'amount', p_amount,
    'status', 'queued',
    'new_balance', v_current_balance - p_amount
  );
end;
$$;

grant execute on function public.request_withdrawal(bigint) to authenticated;

-- request_deposit: User submits a deposit request with contact details
create or replace function public.request_deposit(
  p_amount bigint,
  p_phone text default null,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_deposit_id uuid;
  v_phone text;
  v_reference text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount <= 0 then
    raise exception 'Deposit amount must be positive';
  end if;

  v_phone := nullif(trim(coalesce(p_phone, '')), '');
  v_reference := nullif(trim(coalesce(p_reference, '')), '');

  insert into public.deposits (user_id, amount, ic_phone_number, reference_code, status)
  values (v_user_id, p_amount, v_phone, v_reference, 'queued')
  returning id into v_deposit_id;

  return jsonb_build_object(
    'success', true,
    'deposit_id', v_deposit_id,
    'amount', p_amount,
    'status', 'queued'
  );
end;
$$;

grant execute on function public.request_deposit(bigint, text, text) to authenticated;

-- approve_deposit: Admin confirms a queued deposit and credits the wallet
create or replace function public.approve_deposit(
  p_deposit_id uuid,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit record;
  v_reference text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select * into v_deposit
  from public.deposits
  where id = p_deposit_id
  for update;

  if v_deposit.id is null then
    raise exception 'Deposit not found';
  end if;

  if v_deposit.status <> 'queued' then
    raise exception 'Deposit is not queued (current status: %)', v_deposit.status;
  end if;

  v_reference := coalesce(nullif(trim(coalesce(p_reference, '')), ''), v_deposit.reference_code);

  insert into public.wallet_accounts (user_id, balance)
  values (v_deposit.user_id, v_deposit.amount)
  on conflict (user_id)
  do update set balance = wallet_accounts.balance + excluded.balance;

  insert into public.wallet_transactions (user_id, kind, amount, meta)
  values (
    v_deposit.user_id,
    'deposit',
    v_deposit.amount,
    jsonb_build_object(
      'deposit_id', p_deposit_id,
      'admin_id', auth.uid(),
      'ic_phone_number', v_deposit.ic_phone_number,
      'reference_code', v_reference
    )
  );

  update public.deposits
  set status = 'completed',
      reference_code = v_reference
  where id = p_deposit_id;

  perform public.log_admin_action(
    'approve_deposit',
    null,
    jsonb_build_object(
      'deposit_id', p_deposit_id,
      'user_id', v_deposit.user_id,
      'amount', v_deposit.amount,
      'reference_code', v_reference
    )
  );

  return jsonb_build_object(
    'success', true,
    'deposit_id', p_deposit_id,
    'status', 'completed'
  );
end;
$$;

grant execute on function public.approve_deposit(uuid, text) to authenticated;
