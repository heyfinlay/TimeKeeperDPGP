-- ============================================================================
-- DIAMOND SPORTS BOOK - DATABASE MIGRATIONS
-- ============================================================================
-- Apply these via Supabase Dashboard > SQL Editor
-- URL: https://supabase.com/dashboard/project/kcutwtjpsupmdixynyoh/sql
--
-- Instructions:
-- 1. Go to your Supabase project SQL Editor
-- 2. Copy and paste this entire file
-- 3. Click "Run" to execute
-- ============================================================================

-- ============================================================================
-- MIGRATION 1: Withdrawal Approval Functions
-- File: 20250505_withdrawal_approval_functions.sql
-- Purpose: Admin withdrawal approval workflows with refund handling
-- ============================================================================

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

-- ============================================================================
-- MIGRATION 2: Admin Login Function
-- File: 20250506_admin_login_function.sql
-- Purpose: Verify admin credentials for /admin/login page
-- ============================================================================

create or replace function public.verify_admin_credentials(
  p_username text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_record record;
  v_profile record;
begin
  -- Get admin credentials
  select * into v_admin_record
  from public.admin_credentials
  where username = p_username;

  if v_admin_record.id is null then
    raise exception 'Invalid credentials';
  end if;

  -- Verify password using bcrypt
  if not (v_admin_record.password_hash = crypt(p_password, v_admin_record.password_hash)) then
    raise exception 'Invalid credentials';
  end if;

  -- Get profile information
  select * into v_profile
  from public.profiles
  where id = v_admin_record.id;

  if v_profile.role != 'admin' then
    raise exception 'Account does not have admin privileges';
  end if;

  -- Return user information for session creation
  return jsonb_build_object(
    'success', true,
    'user_id', v_admin_record.id,
    'email', v_profile.email,
    'display_name', v_profile.display_name,
    'role', v_profile.role
  );
end;
$$;

-- Grant execute to anonymous users (needed for login page)
grant execute on function public.verify_admin_credentials(text, text) to anon;
grant execute on function public.verify_admin_credentials(text, text) to authenticated;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these to verify the migrations were applied successfully:

-- Check that all new functions exist
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'approve_withdrawal',
    'reject_withdrawal',
    'request_withdrawal',
    'verify_admin_credentials'
  )
ORDER BY routine_name;

-- Check admin_actions_log table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name = 'admin_actions_log'
) AS admin_log_exists;

-- ============================================================================
-- MIGRATION COMPLETE!
-- ============================================================================
-- Next steps:
-- 1. Verify functions exist (run verification queries above)
-- 2. Create your first admin account using CREATE_FIRST_ADMIN.sql
-- 3. Test admin login at /admin/login
-- 4. Test withdrawal approval flow in /admin/markets
-- 5. Check audit log is recording actions
-- ============================================================================
