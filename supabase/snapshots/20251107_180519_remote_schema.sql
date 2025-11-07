


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."profile_role" AS ENUM (
    'marshal',
    'admin',
    'race_control'
);


ALTER TYPE "public"."profile_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_wallet_balance"("p_user_id" "uuid", "p_amount" bigint, "p_kind" "text" DEFAULT 'adjust'::"text", "p_memo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_old_balance bigint;
  v_new_balance bigint;
begin
  -- Check admin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  -- Validate amount is non-zero
  if p_amount = 0 then
    raise exception 'Adjustment amount cannot be zero';
  end if;

  -- Validate kind
  if p_kind not in ('adjust', 'deposit', 'bonus', 'correction', 'refund') then
    raise exception 'Invalid adjustment kind: %', p_kind;
  end if;

  -- Lock wallet and get current balance
  select balance into v_old_balance
  from public.wallet_accounts
  where user_id = p_user_id
  for update;

  -- Create wallet if it doesn't exist
  if v_old_balance is null then
    insert into public.wallet_accounts (user_id, balance)
    values (p_user_id, greatest(0, p_amount))
    returning balance into v_new_balance;
    v_old_balance := 0;
  else
    -- Update balance (prevent negative balances)
    v_new_balance := greatest(0, v_old_balance + p_amount);

    update public.wallet_accounts
    set balance = v_new_balance
    where user_id = p_user_id;
  end if;

  -- Record transaction
  insert into public.wallet_transactions (user_id, kind, amount, meta)
  values (
    p_user_id,
    p_kind,
    p_amount,
    jsonb_build_object(
      'memo', p_memo,
      'admin_id', auth.uid(),
      'old_balance', v_old_balance,
      'new_balance', v_new_balance
    )
  );

  -- Log admin action
  perform public.log_admin_action(
    'adjust_wallet',
    null,
    jsonb_build_object(
      'user_id', p_user_id,
      'amount', p_amount,
      'kind', p_kind,
      'memo', p_memo
    )
  );

  return jsonb_build_object(
    'success', true,
    'old_balance', v_old_balance,
    'new_balance', v_new_balance,
    'adjustment', p_amount
  );
end;
$$;


ALTER FUNCTION "public"."adjust_wallet_balance"("p_user_id" "uuid", "p_amount" bigint, "p_kind" "text", "p_memo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_adjust_wallet"("p_user_id" "uuid", "p_amount" bigint, "p_kind" "text" DEFAULT 'adjust'::"text", "p_memo" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_user_id is null or p_amount = 0 then
    raise exception 'invalid args';
  end if;
  -- Ensure wallet row exists
  insert into public.wallet_accounts(user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update public.wallet_accounts set balance = balance + p_amount where user_id = p_user_id;
  insert into public.wallet_transactions(id, user_id, kind, amount, meta)
  values (
    gen_random_uuid(),
    p_user_id,
    coalesce(p_kind,'adjust'),
    p_amount,
    jsonb_build_object('memo', p_memo)
  );
  insert into public.admin_actions_log(actor_id, action, meta)
  values (auth.uid(), 'admin_adjust_wallet', jsonb_build_object('user_id', p_user_id, 'amount', p_amount, 'kind', p_kind, 'memo', p_memo));
end;
$$;


ALTER FUNCTION "public"."admin_adjust_wallet"("p_user_id" "uuid", "p_amount" bigint, "p_kind" "text", "p_memo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_process_withdrawal"("p_withdrawal_id" "uuid", "p_approve" boolean, "p_memo" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_amount bigint;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select user_id, amount, status into v_user_id, v_amount, v_status
  from public.withdrawals where id = p_withdrawal_id for update;

  if not found then
    raise exception 'withdrawal not found';
  end if;
  if v_status <> 'queued' then
    raise exception 'withdrawal already processed';
  end if;

  if p_approve then
    -- debit wallet if funds available
    update public.wallet_accounts set balance = balance - v_amount where user_id = v_user_id and balance >= v_amount;
    if not found then
      raise exception 'insufficient funds';
    end if;
    update public.withdrawals set status = 'approved' where id = p_withdrawal_id;
    insert into public.wallet_transactions(id, user_id, kind, amount, meta)
    values (gen_random_uuid(), v_user_id, 'withdraw_approved', v_amount, jsonb_build_object('withdrawal_id', p_withdrawal_id));
    insert into public.admin_actions_log(actor_id, action, meta)
    values (auth.uid(), 'admin_withdraw_approve', jsonb_build_object('withdrawal_id', p_withdrawal_id, 'amount', v_amount, 'memo', p_memo));
  else
    update public.withdrawals set status = 'rejected' where id = p_withdrawal_id;
    insert into public.admin_actions_log(actor_id, action, meta)
    values (auth.uid(), 'admin_withdraw_reject', jsonb_build_object('withdrawal_id', p_withdrawal_id, 'amount', v_amount, 'memo', p_memo));
  end if;
end;
$$;


ALTER FUNCTION "public"."admin_process_withdrawal"("p_withdrawal_id" "uuid", "p_approve" boolean, "p_memo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_withdrawal"("p_withdrawal_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."approve_withdrawal"("p_withdrawal_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_market"("p_market_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_market_status text;
begin
  -- Check admin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  -- Get market status
  select status into v_market_status
  from public.markets
  where id = p_market_id;

  if v_market_status is null then
    raise exception 'Market not found';
  end if;

  if v_market_status != 'open' then
    raise exception 'Market is not open (current status: %)', v_market_status;
  end if;

  -- Close market
  update public.markets
  set status = 'closed'
  where id = p_market_id;

  return jsonb_build_object('success', true, 'market_id', p_market_id, 'status', 'closed');
end;
$$;


ALTER FUNCTION "public"."close_market"("p_market_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invalidate_last_lap_atomic"("p_session_id" "uuid", "p_driver_id" "uuid", "p_mode" "text" DEFAULT 'time_only'::"text") RETURNS TABLE("invalidated_lap_id" "uuid", "session_id" "uuid", "driver_id" "uuid", "laps" integer, "last_lap_ms" bigint, "best_lap_ms" bigint, "total_time_ms" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    declare
      v_lap_id uuid;
      v_lap_time bigint;
    begin
      perform 1 from public.drivers d
       where d.id = p_driver_id and d.session_id = p_session_id
       for update;
      if not found then
        raise exception 'driver % not in session %', p_driver_id, p_session_id;
      end if;

      select l.id, l.lap_time_ms
        into v_lap_id, v_lap_time
      from public.laps l
      where l.session_id = p_session_id
        and l.driver_id = p_driver_id
        and coalesce(l.invalidated, false) = false
      order by l.recorded_at desc
      limit 1
      for update;

      if v_lap_id is null then
        return;
      end if;

      update public.laps
         set invalidated = true,
             checkpoint_missed = (p_mode = 'remove_lap')
       where id = v_lap_id;

      update public.drivers d
         set last_lap_ms = (
                select lap_time_ms
                from public.laps
                where session_id = p_session_id
                  and driver_id = p_driver_id
                  and coalesce(invalidated, false) = false
                order by recorded_at desc
                limit 1
             ),
             best_lap_ms = (
                select min(lap_time_ms)
                from public.laps
                where session_id = p_session_id
                  and driver_id = p_driver_id
                  and coalesce(invalidated, false) = false
             ),
             total_time_ms = coalesce((
                select sum(lap_time_ms)
                from public.laps
                where session_id = p_session_id
                  and driver_id = p_driver_id
                  and coalesce(invalidated, false) = false
             ), 0),
             laps = case when p_mode = 'remove_lap'
                         then greatest(coalesce(d.laps, 0) - 1, 0)
                         else d.laps end,
             updated_at = timezone('utc', now())
       where d.id = p_driver_id and d.session_id = p_session_id;

      return query
      select v_lap_id,
             p_session_id,
             p_driver_id,
             d.laps,
             d.last_lap_ms,
             d.best_lap_ms,
             d.total_time_ms
      from public.drivers d
      where d.id = p_driver_id and d.session_id = p_session_id;
    end;
    $$;


ALTER FUNCTION "public"."invalidate_last_lap_atomic"("p_session_id" "uuid", "p_driver_id" "uuid", "p_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  jwt_role text := coalesce(auth.jwt()->>'role', '');
begin
  if jwt_role = 'admin' then
    return true;
  end if;

  return exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
end;
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_admin_action"("p_action" "text", "p_market_id" "uuid" DEFAULT NULL::"uuid", "p_meta" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    return;
  end if;

  insert into public.admin_actions_log (actor_id, action, market_id, meta)
  values (auth.uid(), p_action, p_market_id, p_meta);
end;
$$;


ALTER FUNCTION "public"."log_admin_action"("p_action" "text", "p_market_id" "uuid", "p_meta" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_lap_atomic"("p_session_id" "uuid", "p_driver_id" "uuid", "p_lap_time_ms" bigint, "p_source" "text" DEFAULT 'manual'::"text") RETURNS TABLE("lap_id" "uuid", "session_id" "uuid", "driver_id" "uuid", "laps" integer, "last_lap_ms" bigint, "best_lap_ms" bigint, "total_time_ms" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    declare
      v_new_lap_id uuid;
      v_best bigint;
    begin
      perform 1 from public.drivers d
       where d.id = p_driver_id and d.session_id = p_session_id
       for update;
      if not found then
        raise exception 'driver % not in session %', p_driver_id, p_session_id;
      end if;

      insert into public.laps (session_id, driver_id, lap_number, lap_time_ms, source)
      values (
        p_session_id,
        p_driver_id,
        coalesce((select max(lap_number) from public.laps where session_id = p_session_id and driver_id = p_driver_id), 0) + 1,
        p_lap_time_ms,
        p_source
      )
      returning id into v_new_lap_id;

      select best_lap_ms into v_best from public.drivers where id = p_driver_id;

      update public.drivers
         set laps          = coalesce(laps, 0) + 1,
             last_lap_ms   = p_lap_time_ms,
             best_lap_ms   = case when v_best is null then p_lap_time_ms else least(v_best, p_lap_time_ms) end,
             total_time_ms = coalesce(total_time_ms, 0) + p_lap_time_ms,
             updated_at    = timezone('utc', now())
       where id = p_driver_id and session_id = p_session_id;

      return query
      select v_new_lap_id,
             p_session_id,
             p_driver_id,
             d.laps,
             d.last_lap_ms,
             d.best_lap_ms,
             d.total_time_ms
      from public.drivers d
      where d.id = p_driver_id and d.session_id = p_session_id;
    end;
    $$;


ALTER FUNCTION "public"."log_lap_atomic"("p_session_id" "uuid", "p_driver_id" "uuid", "p_lap_time_ms" bigint, "p_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_wager"("p_market_id" "uuid", "p_outcome_id" "uuid", "p_stake" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_current_balance bigint;
  v_market_status text;
  v_market_closes_at timestamptz;
  v_wager_id uuid;
  v_outcome_exists boolean;
begin
  -- Get authenticated user
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Validate stake
  if p_stake <= 0 then
    raise exception 'Stake must be positive';
  end if;

  -- Check market exists and is open
  select status, closes_at
  into v_market_status, v_market_closes_at
  from public.markets
  where id = p_market_id;

  if v_market_status is null then
    raise exception 'Market not found';
  end if;

  if v_market_status != 'open' then
    raise exception 'Market is not open';
  end if;

  if v_market_closes_at is not null and v_market_closes_at <= now() then
    raise exception 'Market has closed';
  end if;

  -- Check outcome exists and belongs to this market
  select exists(
    select 1
    from public.outcomes
    where id = p_outcome_id
      and market_id = p_market_id
  ) into v_outcome_exists;

  if not v_outcome_exists then
    raise exception 'Outcome not found or does not belong to this market';
  end if;

  -- Lock and get current balance
  select balance into v_current_balance
  from public.wallet_accounts
  where user_id = v_user_id
  for update;

  -- Create wallet if it doesn't exist
  if v_current_balance is null then
    insert into public.wallet_accounts (user_id, balance)
    values (v_user_id, 0)
    returning balance into v_current_balance;
  end if;

  -- Check sufficient funds
  if v_current_balance < p_stake then
    raise exception 'Insufficient funds. Balance: %, Required: %', v_current_balance, p_stake;
  end if;

  -- Debit wallet
  update public.wallet_accounts
  set balance = balance - p_stake
  where user_id = v_user_id;

  -- Record transaction
  insert into public.wallet_transactions (user_id, kind, amount, meta)
  values (
    v_user_id,
    'wager',
    -p_stake,
    jsonb_build_object(
      'market_id', p_market_id,
      'outcome_id', p_outcome_id
    )
  );

  -- Create wager
  insert into public.wagers (user_id, market_id, outcome_id, stake, status)
  values (v_user_id, p_market_id, p_outcome_id, p_stake, 'pending')
  returning id into v_wager_id;

  return jsonb_build_object(
    'success', true,
    'wager_id', v_wager_id,
    'new_balance', v_current_balance - p_stake
  );
end;
$$;


ALTER FUNCTION "public"."place_wager"("p_market_id" "uuid", "p_outcome_id" "uuid", "p_stake" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_withdrawal"("p_withdrawal_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."reject_withdrawal"("p_withdrawal_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_withdrawal"("p_amount" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."request_withdrawal"("p_amount" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."room_messages_broadcast_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'realtime'
    AS $$
declare
  sid text;
begin
  -- Choose the right identifier
  sid :=
    coalesce(
      (to_jsonb(NEW)->>'session_id'),
      (to_jsonb(OLD)->>'session_id'),
      (to_jsonb(NEW)->>'id'),
      (to_jsonb(OLD)->>'id')
    );

  perform realtime.broadcast_changes(
    'room:' || sid,
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  return coalesce(NEW, OLD);
end;
$$;


ALTER FUNCTION "public"."room_messages_broadcast_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."session_has_access"("target_session_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (
      select public.is_admin()
    )
    or exists (
      select 1 from public.sessions s
      where s.id = target_session_id and (s.created_by = auth.uid() or s.created_by is null)
    )
    or exists (
      select 1 from public.session_members sm
      where sm.session_id = target_session_id and sm.user_id = auth.uid()
    )
  , false);
$$;


ALTER FUNCTION "public"."session_has_access"("target_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."session_state_has_access"("p_session_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.session_has_access(p_session_id);
$$;


ALTER FUNCTION "public"."session_state_has_access"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."settle_market"("p_market_id" "uuid", "p_winning_outcome_id" "uuid", "p_payout_policy" "text" DEFAULT 'refund_if_empty'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_market_status text;
  v_rake_bps int;
  v_total_pool bigint := 0;
  v_winning_pool bigint := 0;
  v_net_pool bigint := 0;
  v_rake_amount bigint := 0;
  v_total_paid bigint := 0;
  v_dust bigint := 0;
  v_outcome_exists boolean;
  v_wager record;
  v_payout bigint;
  v_winners_count int := 0;
begin
  -- Check admin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  -- Get market info
  select status, rake_bps
  into v_market_status, v_rake_bps
  from public.markets
  where id = p_market_id;

  if v_market_status is null then
    raise exception 'Market not found';
  end if;

  if v_market_status != 'closed' then
    raise exception 'Market must be closed before settlement (current status: %)', v_market_status;
  end if;

  -- Validate outcome belongs to market
  select exists(
    select 1 from public.outcomes
    where id = p_winning_outcome_id
      and market_id = p_market_id
  ) into v_outcome_exists;

  if not v_outcome_exists then
    raise exception 'Winning outcome does not belong to this market';
  end if;

  -- Calculate pools (lock all wagers for this market)
  select
    coalesce(sum(stake), 0),
    coalesce(sum(case when outcome_id = p_winning_outcome_id then stake else 0 end), 0)
  into v_total_pool, v_winning_pool
  from public.wagers
  where market_id = p_market_id
    and status = 'pending'
  for update;

  -- Handle empty pool or no winners
  if v_total_pool = 0 then
    update public.markets set status = 'settled' where id = p_market_id;
    return jsonb_build_object(
      'success', true,
      'message', 'No wagers placed',
      'total_pool', 0,
      'winning_pool', 0,
      'net_pool', 0,
      'rake', 0
    );
  end if;

  if v_winning_pool = 0 then
    -- Handle refund policy
    if p_payout_policy = 'refund_if_empty' then
      -- Refund all wagers
      for v_wager in
        select id, user_id, stake
        from public.wagers
        where market_id = p_market_id and status = 'pending'
      loop
        -- Credit wallet
        insert into public.wallet_accounts (user_id, balance)
        values (v_wager.user_id, v_wager.stake)
        on conflict (user_id)
        do update set balance = wallet_accounts.balance + v_wager.stake;

        -- Record transaction
        insert into public.wallet_transactions (user_id, kind, amount, meta)
        values (
          v_wager.user_id,
          'refund',
          v_wager.stake,
          jsonb_build_object('market_id', p_market_id, 'wager_id', v_wager.id, 'reason', 'no_winners')
        );

        -- Mark wager as refunded
        update public.wagers set status = 'refunded' where id = v_wager.id;
      end loop;

      update public.markets set status = 'settled' where id = p_market_id;
      return jsonb_build_object(
        'success', true,
        'message', 'All wagers refunded (no winners)',
        'total_pool', v_total_pool,
        'refunded', v_total_pool
      );
    else
      -- House takes all
      update public.wagers set status = 'lost' where market_id = p_market_id and status = 'pending';
      update public.markets set status = 'settled' where id = p_market_id;
      return jsonb_build_object(
        'success', true,
        'message', 'House wins (no winning wagers)',
        'total_pool', v_total_pool,
        'house_take', v_total_pool
      );
    end if;
  end if;

  -- Calculate rake and net pool
  v_rake_amount := floor(v_total_pool * v_rake_bps / 10000.0);
  v_net_pool := v_total_pool - v_rake_amount;

  -- Distribute payouts to winners
  for v_wager in
    select id, user_id, stake
    from public.wagers
    where market_id = p_market_id
      and outcome_id = p_winning_outcome_id
      and status = 'pending'
    order by placed_at asc  -- Deterministic ordering
  loop
    -- Calculate proportional payout (floor to avoid fractional diamonds)
    v_payout := floor((v_wager.stake::numeric / v_winning_pool::numeric) * v_net_pool);

    -- Credit wallet
    insert into public.wallet_accounts (user_id, balance)
    values (v_wager.user_id, v_payout)
    on conflict (user_id)
    do update set balance = wallet_accounts.balance + v_payout;

    -- Record transaction
    insert into public.wallet_transactions (user_id, kind, amount, meta)
    values (
      v_wager.user_id,
      'payout',
      v_payout,
      jsonb_build_object(
        'market_id', p_market_id,
        'wager_id', v_wager.id,
        'outcome_id', p_winning_outcome_id
      )
    );

    -- Mark wager as won
    update public.wagers set status = 'won' where id = v_wager.id;

    v_total_paid := v_total_paid + v_payout;
    v_winners_count := v_winners_count + 1;
  end loop;

  -- Calculate dust (leftover from floor operations)
  v_dust := v_net_pool - v_total_paid;

  -- Mark losing wagers
  update public.wagers
  set status = 'lost'
  where market_id = p_market_id
    and outcome_id != p_winning_outcome_id
    and status = 'pending';

  -- Update market status
  update public.markets set status = 'settled' where id = p_market_id;

  return jsonb_build_object(
    'success', true,
    'total_pool', v_total_pool,
    'winning_pool', v_winning_pool,
    'rake_amount', v_rake_amount,
    'net_pool', v_net_pool,
    'total_paid', v_total_paid,
    'dust', v_dust,
    'winners_count', v_winners_count
  );
end;
$$;


ALTER FUNCTION "public"."settle_market"("p_market_id" "uuid", "p_winning_outcome_id" "uuid", "p_payout_policy" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_admin_credentials"("p_username" "text", "p_password" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."verify_admin_credentials"("p_username" "text", "p_password" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_actions_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "market_id" "uuid"
);


ALTER TABLE "public"."admin_actions_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_credentials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "username" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "rotated_at" timestamp with time zone
);


ALTER TABLE "public"."admin_credentials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drivers" (
    "id" "uuid" NOT NULL,
    "number" integer NOT NULL,
    "name" "text" NOT NULL,
    "team" "text",
    "laps" integer DEFAULT 0,
    "last_lap_ms" bigint,
    "best_lap_ms" bigint,
    "pits" integer DEFAULT 0,
    "status" "text" DEFAULT 'ready'::"text",
    "driver_flag" "text" DEFAULT 'none'::"text",
    "pit_complete" boolean DEFAULT false,
    "total_time_ms" bigint DEFAULT 0,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "session_id" "uuid" NOT NULL,
    "marshal_user_id" "uuid"
);


ALTER TABLE "public"."drivers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drivers_marshal_map" (
    "marshal_id_legacy" "text" NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."drivers_marshal_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "venue" "text",
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "status" "text" DEFAULT 'upcoming'::"text" NOT NULL
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."laps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid",
    "lap_number" integer NOT NULL,
    "lap_time_ms" bigint NOT NULL,
    "source" "text",
    "recorded_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "session_id" "uuid" NOT NULL,
    "invalidated" boolean DEFAULT false,
    "checkpoint_missed" boolean DEFAULT false
);


ALTER TABLE "public"."laps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."markets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "rake_bps" integer DEFAULT 500 NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "closes_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."markets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'spectator'::"text" NOT NULL,
    "display_name" "text",
    "assigned_driver_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "team_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "ic_phone_number" "text",
    "tier" "text",
    "experience_points" integer DEFAULT 0 NOT NULL,
    "handle" "text",
    "driver_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['spectator'::"text", 'driver'::"text", 'marshal'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."my_profile" WITH ("security_invoker"='on') AS
 SELECT "id",
    "role",
    "team_id"
   FROM "public"."profiles"
  WHERE ("id" = "auth"."uid"());


ALTER VIEW "public"."my_profile" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."outcomes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "market_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."outcomes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."race_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message" "text" NOT NULL,
    "marshal_id" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "session_id" "uuid" NOT NULL
);


ALTER TABLE "public"."race_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_entries" (
    "session_id" "uuid" NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."session_entries" OWNER TO "postgres";


COMMENT ON TABLE "public"."session_entries" IS 'expose for cache refresh';



CREATE TABLE IF NOT EXISTS "public"."session_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "object_url" "text",
    "format" "text" DEFAULT 'json'::"text" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."session_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_members" (
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'marshal'::"text" NOT NULL,
    "inserted_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."session_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_state" (
    "id" "text" NOT NULL,
    "event_type" "text",
    "total_laps" integer,
    "total_duration" integer,
    "procedure_phase" "text",
    "flag_status" "text",
    "track_status" "text",
    "announcement" "text",
    "is_timing" boolean,
    "is_paused" boolean,
    "race_time_ms" bigint,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "session_id" "uuid" NOT NULL
);


ALTER TABLE "public"."session_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wagers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "outcome_id" "uuid" NOT NULL,
    "stake" bigint NOT NULL,
    "placed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    CONSTRAINT "wagers_stake_check" CHECK (("stake" > 0))
);


ALTER TABLE "public"."wagers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallet_accounts" (
    "user_id" "uuid" NOT NULL,
    "balance" bigint DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."wallet_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallet_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "amount" bigint NOT NULL,
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wallet_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."withdrawals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "amount" bigint NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "withdrawals_amount_check" CHECK (("amount" > 0))
);


ALTER TABLE "public"."withdrawals" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_actions_log"
    ADD CONSTRAINT "admin_actions_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_credentials"
    ADD CONSTRAINT "admin_credentials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_credentials"
    ADD CONSTRAINT "admin_credentials_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."drivers_marshal_map"
    ADD CONSTRAINT "drivers_marshal_map_pkey" PRIMARY KEY ("marshal_id_legacy");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."laps"
    ADD CONSTRAINT "laps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."markets"
    ADD CONSTRAINT "markets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."outcomes"
    ADD CONSTRAINT "outcomes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_handle_key" UNIQUE ("handle");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."race_events"
    ADD CONSTRAINT "race_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_entries"
    ADD CONSTRAINT "session_entries_pkey" PRIMARY KEY ("session_id", "driver_id");



ALTER TABLE ONLY "public"."session_logs"
    ADD CONSTRAINT "session_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_members"
    ADD CONSTRAINT "session_members_pkey" PRIMARY KEY ("session_id", "user_id");



ALTER TABLE ONLY "public"."session_state"
    ADD CONSTRAINT "session_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wagers"
    ADD CONSTRAINT "wagers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_accounts"
    ADD CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."withdrawals"
    ADD CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id");



CREATE INDEX "admin_actions_log_actor_id_idx" ON "public"."admin_actions_log" USING "btree" ("actor_id");



CREATE INDEX "admin_actions_log_market_id_idx" ON "public"."admin_actions_log" USING "btree" ("market_id");



CREATE UNIQUE INDEX "admin_credentials_username_idx" ON "public"."admin_credentials" USING "btree" ("lower"("username"));



CREATE INDEX "idx_drivers_session" ON "public"."drivers" USING "btree" ("session_id");



CREATE INDEX "idx_laps_session_driver" ON "public"."laps" USING "btree" ("session_id", "driver_id", "lap_number" DESC);



CREATE INDEX "idx_laps_session_recorded_at" ON "public"."laps" USING "btree" ("session_id", "recorded_at" DESC);



CREATE INDEX "idx_profiles_id_role" ON "public"."profiles" USING "btree" ("id", "role");



CREATE INDEX "idx_profiles_team_id" ON "public"."profiles" USING "btree" ("team_id");



CREATE INDEX "idx_race_events_session_created_at" ON "public"."race_events" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "idx_session_logs_session" ON "public"."session_logs" USING "btree" ("session_id");



CREATE INDEX "idx_session_state_session_id" ON "public"."session_state" USING "btree" ("session_id");



CREATE INDEX "markets_event_id_idx" ON "public"."markets" USING "btree" ("event_id");



CREATE INDEX "outcomes_market_id_idx" ON "public"."outcomes" USING "btree" ("market_id");



CREATE UNIQUE INDEX "session_state_session_unique_idx" ON "public"."session_state" USING "btree" ("session_id");



CREATE INDEX "wagers_market_id_idx" ON "public"."wagers" USING "btree" ("market_id");



CREATE INDEX "wagers_user_id_idx" ON "public"."wagers" USING "btree" ("user_id");



CREATE INDEX "wallet_transactions_user_id_idx" ON "public"."wallet_transactions" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "session_logs_broadcast_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."session_logs" FOR EACH ROW EXECUTE FUNCTION "public"."room_messages_broadcast_trigger"();



CREATE OR REPLACE TRIGGER "session_members_broadcast_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."session_members" FOR EACH ROW EXECUTE FUNCTION "public"."room_messages_broadcast_trigger"();



CREATE OR REPLACE TRIGGER "sessions_broadcast_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."room_messages_broadcast_trigger"();



ALTER TABLE ONLY "public"."admin_actions_log"
    ADD CONSTRAINT "admin_actions_log_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id");



ALTER TABLE ONLY "public"."drivers_marshal_map"
    ADD CONSTRAINT "drivers_marshal_map_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_marshal_user_id_fkey" FOREIGN KEY ("marshal_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."laps"
    ADD CONSTRAINT "laps_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."laps"
    ADD CONSTRAINT "laps_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."markets"
    ADD CONSTRAINT "markets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."outcomes"
    ADD CONSTRAINT "outcomes_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."race_events"
    ADD CONSTRAINT "race_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_entries"
    ADD CONSTRAINT "session_entries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_entries"
    ADD CONSTRAINT "session_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_logs"
    ADD CONSTRAINT "session_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_members"
    ADD CONSTRAINT "session_members_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_members"
    ADD CONSTRAINT "session_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_state"
    ADD CONSTRAINT "session_state_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wagers"
    ADD CONSTRAINT "wagers_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wagers"
    ADD CONSTRAINT "wagers_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wagers"
    ADD CONSTRAINT "wagers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallet_accounts"
    ADD CONSTRAINT "wallet_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."withdrawals"
    ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admin full access to drivers" ON "public"."drivers" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin full access to laps" ON "public"."laps" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin full access to marshal mappings" ON "public"."drivers_marshal_map" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin full access to race events" ON "public"."race_events" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin full access to session entries" ON "public"."session_entries" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin full access to session logs" ON "public"."session_logs" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin full access to session members" ON "public"."session_members" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin full access to session state" ON "public"."session_state" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin full access to sessions" ON "public"."sessions" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin full access to teams" ON "public"."teams" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Anyone can read teams" ON "public"."teams" FOR SELECT USING (true);



CREATE POLICY "Members view membership" ON "public"."session_members" FOR SELECT USING (("public"."is_admin"() OR ("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."sessions" "s"
  WHERE (("s"."id" = "session_members"."session_id") AND (("s"."created_by" = "auth"."uid"()) OR ("s"."created_by" IS NULL)))))));



CREATE POLICY "Members view session logs" ON "public"."session_logs" FOR SELECT USING ("public"."session_has_access"("session_id"));



CREATE POLICY "Members view shared sessions" ON "public"."sessions" FOR SELECT USING ("public"."session_has_access"("id"));



CREATE POLICY "Owners manage membership" ON "public"."session_members" USING ((EXISTS ( SELECT 1
   FROM "public"."sessions" "s"
  WHERE (("s"."id" = "session_members"."session_id") AND ("s"."created_by" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sessions" "s"
  WHERE (("s"."id" = "session_members"."session_id") AND ("s"."created_by" = "auth"."uid"())))));



CREATE POLICY "Owners manage their sessions" ON "public"."sessions" USING ((("auth"."uid"() = "created_by") OR ("created_by" IS NULL))) WITH CHECK ((("auth"."uid"() = "created_by") OR ("created_by" IS NULL)));



CREATE POLICY "Owners record session logs" ON "public"."session_logs" FOR INSERT WITH CHECK ("public"."session_has_access"("session_id"));



CREATE POLICY "Profiles are manageable by owner or admins" ON "public"."profiles" USING ((("auth"."uid"() = "id") OR "public"."is_admin"())) WITH CHECK ((("auth"."uid"() = "id") OR "public"."is_admin"()));



CREATE POLICY "Profiles are readable by owner or admins" ON "public"."profiles" FOR SELECT USING ((("auth"."uid"() = "id") OR "public"."is_admin"()));



CREATE POLICY "Session scoped access for drivers" ON "public"."drivers" USING ("public"."session_has_access"("session_id")) WITH CHECK ("public"."session_has_access"("session_id"));



CREATE POLICY "Session scoped access for laps" ON "public"."laps" USING ("public"."session_has_access"("session_id")) WITH CHECK ("public"."session_has_access"("session_id"));



CREATE POLICY "Session scoped access for race events" ON "public"."race_events" USING ("public"."session_has_access"("session_id")) WITH CHECK ("public"."session_has_access"("session_id"));



CREATE POLICY "Session scoped access for session entries" ON "public"."session_entries" USING ("public"."session_has_access"("session_id")) WITH CHECK ("public"."session_has_access"("session_id"));



CREATE POLICY "Session scoped access for session state" ON "public"."session_state" USING ("public"."session_has_access"("session_id")) WITH CHECK ("public"."session_has_access"("session_id"));



CREATE POLICY "Users can read their own marshal mapping" ON "public"."drivers_marshal_map" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."admin_actions_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_actions_log_admin_only" ON "public"."admin_actions_log" FOR SELECT USING ("public"."is_admin"());



ALTER TABLE "public"."admin_credentials" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drivers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drivers_marshal_map" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events_admin_all" ON "public"."events" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "events_select_all" ON "public"."events" FOR SELECT USING (true);



ALTER TABLE "public"."laps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."markets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "markets_admin_all" ON "public"."markets" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "markets_select_all" ON "public"."markets" FOR SELECT USING (true);



ALTER TABLE "public"."outcomes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "outcomes_admin_all" ON "public"."outcomes" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "outcomes_select_all" ON "public"."outcomes" FOR SELECT USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."race_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wagers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wagers_admin_select" ON "public"."wagers" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "wagers_own_insert" ON "public"."wagers" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."markets" "m"
  WHERE (("m"."id" = "wagers"."market_id") AND ("m"."status" = 'open'::"text") AND (("m"."closes_at" IS NULL) OR ("m"."closes_at" > "now"())))))));



CREATE POLICY "wagers_own_select" ON "public"."wagers" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."wallet_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallet_accounts_admin_select" ON "public"."wallet_accounts" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "wallet_accounts_no_user_insert" ON "public"."wallet_accounts" FOR INSERT WITH CHECK (false);



CREATE POLICY "wallet_accounts_no_user_update" ON "public"."wallet_accounts" FOR UPDATE USING (false);



CREATE POLICY "wallet_accounts_own_select" ON "public"."wallet_accounts" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."wallet_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallet_transactions_admin_select" ON "public"."wallet_transactions" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "wallet_transactions_no_direct_insert" ON "public"."wallet_transactions" FOR INSERT WITH CHECK (false);



CREATE POLICY "wallet_transactions_own_select" ON "public"."wallet_transactions" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."withdrawals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "withdrawals_admin_select" ON "public"."withdrawals" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "withdrawals_admin_update" ON "public"."withdrawals" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "withdrawals_no_user_update" ON "public"."withdrawals" FOR UPDATE USING (false);



CREATE POLICY "withdrawals_own_insert" ON "public"."withdrawals" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND ("status" = 'queued'::"text")));



CREATE POLICY "withdrawals_own_select" ON "public"."withdrawals" FOR SELECT USING (("auth"."uid"() = "user_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."drivers";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."laps";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."markets";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."outcomes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."profiles";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."race_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."session_entries";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."session_logs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."session_members";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."session_state";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sessions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."wagers";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."wallet_accounts";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."wallet_transactions";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."adjust_wallet_balance"("p_user_id" "uuid", "p_amount" bigint, "p_kind" "text", "p_memo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."adjust_wallet_balance"("p_user_id" "uuid", "p_amount" bigint, "p_kind" "text", "p_memo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_wallet_balance"("p_user_id" "uuid", "p_amount" bigint, "p_kind" "text", "p_memo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_adjust_wallet"("p_user_id" "uuid", "p_amount" bigint, "p_kind" "text", "p_memo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_adjust_wallet"("p_user_id" "uuid", "p_amount" bigint, "p_kind" "text", "p_memo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_adjust_wallet"("p_user_id" "uuid", "p_amount" bigint, "p_kind" "text", "p_memo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_process_withdrawal"("p_withdrawal_id" "uuid", "p_approve" boolean, "p_memo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_process_withdrawal"("p_withdrawal_id" "uuid", "p_approve" boolean, "p_memo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_process_withdrawal"("p_withdrawal_id" "uuid", "p_approve" boolean, "p_memo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."approve_withdrawal"("p_withdrawal_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."approve_withdrawal"("p_withdrawal_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_withdrawal"("p_withdrawal_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."close_market"("p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."close_market"("p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_market"("p_market_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."invalidate_last_lap_atomic"("p_session_id" "uuid", "p_driver_id" "uuid", "p_mode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."invalidate_last_lap_atomic"("p_session_id" "uuid", "p_driver_id" "uuid", "p_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."invalidate_last_lap_atomic"("p_session_id" "uuid", "p_driver_id" "uuid", "p_mode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_admin_action"("p_action" "text", "p_market_id" "uuid", "p_meta" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_admin_action"("p_action" "text", "p_market_id" "uuid", "p_meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_admin_action"("p_action" "text", "p_market_id" "uuid", "p_meta" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_lap_atomic"("p_session_id" "uuid", "p_driver_id" "uuid", "p_lap_time_ms" bigint, "p_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."log_lap_atomic"("p_session_id" "uuid", "p_driver_id" "uuid", "p_lap_time_ms" bigint, "p_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_lap_atomic"("p_session_id" "uuid", "p_driver_id" "uuid", "p_lap_time_ms" bigint, "p_source" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."place_wager"("p_market_id" "uuid", "p_outcome_id" "uuid", "p_stake" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."place_wager"("p_market_id" "uuid", "p_outcome_id" "uuid", "p_stake" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."place_wager"("p_market_id" "uuid", "p_outcome_id" "uuid", "p_stake" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_withdrawal"("p_withdrawal_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reject_withdrawal"("p_withdrawal_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_withdrawal"("p_withdrawal_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."request_withdrawal"("p_amount" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."request_withdrawal"("p_amount" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_withdrawal"("p_amount" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."room_messages_broadcast_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."room_messages_broadcast_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."room_messages_broadcast_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."session_has_access"("target_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."session_has_access"("target_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."session_has_access"("target_session_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."session_state_has_access"("p_session_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."settle_market"("p_market_id" "uuid", "p_winning_outcome_id" "uuid", "p_payout_policy" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."settle_market"("p_market_id" "uuid", "p_winning_outcome_id" "uuid", "p_payout_policy" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."settle_market"("p_market_id" "uuid", "p_winning_outcome_id" "uuid", "p_payout_policy" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_admin_credentials"("p_username" "text", "p_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_admin_credentials"("p_username" "text", "p_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_admin_credentials"("p_username" "text", "p_password" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."admin_actions_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_actions_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_actions_log" TO "service_role";



GRANT ALL ON TABLE "public"."admin_credentials" TO "anon";
GRANT ALL ON TABLE "public"."admin_credentials" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_credentials" TO "service_role";



GRANT ALL ON TABLE "public"."drivers" TO "anon";
GRANT ALL ON TABLE "public"."drivers" TO "authenticated";
GRANT ALL ON TABLE "public"."drivers" TO "service_role";



GRANT ALL ON TABLE "public"."drivers_marshal_map" TO "anon";
GRANT ALL ON TABLE "public"."drivers_marshal_map" TO "authenticated";
GRANT ALL ON TABLE "public"."drivers_marshal_map" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."laps" TO "anon";
GRANT ALL ON TABLE "public"."laps" TO "authenticated";
GRANT ALL ON TABLE "public"."laps" TO "service_role";



GRANT ALL ON TABLE "public"."markets" TO "anon";
GRANT ALL ON TABLE "public"."markets" TO "authenticated";
GRANT ALL ON TABLE "public"."markets" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."my_profile" TO "anon";
GRANT ALL ON TABLE "public"."my_profile" TO "authenticated";
GRANT ALL ON TABLE "public"."my_profile" TO "service_role";



GRANT ALL ON TABLE "public"."outcomes" TO "anon";
GRANT ALL ON TABLE "public"."outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."outcomes" TO "service_role";



GRANT ALL ON TABLE "public"."race_events" TO "anon";
GRANT ALL ON TABLE "public"."race_events" TO "authenticated";
GRANT ALL ON TABLE "public"."race_events" TO "service_role";



GRANT ALL ON TABLE "public"."session_entries" TO "anon";
GRANT ALL ON TABLE "public"."session_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."session_entries" TO "service_role";



GRANT SELECT("created_at") ON TABLE "public"."session_entries" TO "anon";
GRANT SELECT("created_at") ON TABLE "public"."session_entries" TO "authenticated";



GRANT ALL ON TABLE "public"."session_logs" TO "anon";
GRANT ALL ON TABLE "public"."session_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."session_logs" TO "service_role";



GRANT ALL ON TABLE "public"."session_members" TO "anon";
GRANT ALL ON TABLE "public"."session_members" TO "authenticated";
GRANT ALL ON TABLE "public"."session_members" TO "service_role";



GRANT ALL ON TABLE "public"."session_state" TO "anon";
GRANT ALL ON TABLE "public"."session_state" TO "authenticated";
GRANT ALL ON TABLE "public"."session_state" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



GRANT ALL ON TABLE "public"."wagers" TO "anon";
GRANT ALL ON TABLE "public"."wagers" TO "authenticated";
GRANT ALL ON TABLE "public"."wagers" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_accounts" TO "anon";
GRANT ALL ON TABLE "public"."wallet_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_transactions" TO "anon";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."withdrawals" TO "anon";
GRANT ALL ON TABLE "public"."withdrawals" TO "authenticated";
GRANT ALL ON TABLE "public"."withdrawals" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































