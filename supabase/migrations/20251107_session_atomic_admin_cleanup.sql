-- Create transactional session RPCs and simplify RLS without recursive helpers.

-- Replace legacy session seeding helper with create_session_atomic.

do $create_session$
begin
  execute $func$
create or replace function public.create_session_atomic(p_session jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_session_id uuid;
  v_creator_id uuid := auth.uid();
begin
  if v_creator_id is null then
    raise exception 'auth.uid() is required to create a session';
  end if;

  insert into public.sessions (name, status, starts_at, created_by)
  values (
    coalesce(nullif(trim(p_session->>'name'), ''), 'Session'),
    coalesce(nullif(trim(p_session->>'status'), ''), 'draft'),
    nullif(p_session->>'starts_at', '')::timestamptz,
    v_creator_id
  )
  returning id into v_session_id;

  insert into public.session_members (session_id, user_id, role)
  values (v_session_id, v_creator_id, 'owner')
  on conflict (session_id, user_id)
  do update set role = excluded.role, inserted_at = timezone('utc', now());

  insert into public.session_members (session_id, user_id, role)
  select v_session_id,
         (member->>'user_id')::uuid,
         coalesce(nullif(member->>'role', ''), 'marshal')
  from jsonb_array_elements(coalesce(p_session->'members', '[]'::jsonb)) as member
  where nullif(member->>'user_id', '') is not null
  on conflict (session_id, user_id)
  do update set role = excluded.role, inserted_at = timezone('utc', now());

  return v_session_id;
exception
  when others then
    raise;
end;
$body$;
$func$;
end
$create_session$;

do $grant_create_session$
begin
  execute 'grant execute on function public.create_session_atomic(jsonb) to authenticated, service_role';
end
$grant_create_session$;

-- Helper RPCs so race control can manage membership despite restrictive RLS.

do $ensure_member$
begin
  execute $func$
create or replace function public.ensure_session_member(
  p_session_id uuid,
  p_user_id uuid,
  p_role text default 'marshal'
)
returns void
language plpgsql
security definer
set search_path = public
as $body$
begin
  insert into public.session_members (session_id, user_id, role)
  values (p_session_id, p_user_id, coalesce(nullif(p_role, ''), 'marshal'))
  on conflict (session_id, user_id)
  do update set role = excluded.role, inserted_at = timezone('utc', now());
end;
$body$;
$func$;
end
$ensure_member$;

do $grant_ensure_member$
begin
  execute 'grant execute on function public.ensure_session_member(uuid, uuid, text) to authenticated, service_role';
end
$grant_ensure_member$;

do $remove_member$
begin
  execute $func$
create or replace function public.remove_session_member(
  p_session_id uuid,
  p_user_id uuid,
  p_role text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $body$
begin
  if p_role is null then
    delete from public.session_members
     where session_id = p_session_id
       and user_id = p_user_id;
  else
    delete from public.session_members
     where session_id = p_session_id
       and user_id = p_user_id
       and role = p_role;
  end if;
end;
$body$;
$func$;
end
$remove_member$;

do $grant_remove_member$
begin
  execute 'grant execute on function public.remove_session_member(uuid, uuid, text) to authenticated, service_role';
end
$grant_remove_member$;

-- Strengthen core table constraints and supporting indexes.

update public.session_members
   set inserted_at = timezone('utc', now())
 where inserted_at is null;

alter table public.session_members
  alter column inserted_at set default timezone('utc', now());

alter table public.session_members
  alter column inserted_at set not null;

create index if not exists session_members_session_id_idx on public.session_members (session_id);
create index if not exists session_members_user_id_idx on public.session_members (user_id);

update public.sessions s
   set created_by = coalesce(created_by, owner.user_id)
  from (
    select distinct on (session_id) session_id, user_id
    from public.session_members
    where role = 'owner'
    order by session_id, inserted_at asc
  ) as owner
 where s.id = owner.session_id
   and s.created_by is null;

alter table public.sessions
  alter column created_by set default auth.uid();

-- Remove recursive helper and re-author policies directly.

-- RLS: drop legacy policies referencing session_has_access.
drop policy if exists "Admin full access to drivers" on public.drivers;
drop policy if exists "Session scoped access for drivers" on public.drivers;
drop policy if exists "Admin full access to laps" on public.laps;
drop policy if exists "Session scoped access for laps" on public.laps;
drop policy if exists "Admin full access to race events" on public.race_events;
drop policy if exists "Session scoped access for race events" on public.race_events;
drop policy if exists "Admin full access to session logs" on public.session_logs;
drop policy if exists "Members view session logs" on public.session_logs;
drop policy if exists "Owners record session logs" on public.session_logs;
drop policy if exists "Admin full access to session members" on public.session_members;
drop policy if exists "Members view membership" on public.session_members;
drop policy if exists "Owners manage membership" on public.session_members;
drop policy if exists "Admin full access to session state" on public.session_state;
drop policy if exists "Session scoped access for session state" on public.session_state;
drop policy if exists "Admin full access to sessions" on public.sessions;
drop policy if exists "Members view shared sessions" on public.sessions;
drop policy if exists "Owners manage their sessions" on public.sessions;

drop policy if exists "wallet_accounts_admin_select" on public.wallet_accounts;
drop policy if exists "wallet_transactions_admin_select" on public.wallet_transactions;
drop policy if exists "wagers_admin_select" on public.wagers;

-- Recreate policies with simple membership checks.
create policy "Drivers admin access"
  on public.drivers
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "Drivers member access"
  on public.drivers
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.session_members sm
      where sm.session_id = drivers.session_id
        and sm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.session_members sm
      where sm.session_id = drivers.session_id
        and sm.user_id = auth.uid()
    )
  );

create policy "Laps admin access"
  on public.laps
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "Laps member access"
  on public.laps
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.session_members sm
      where sm.session_id = laps.session_id
        and sm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.session_members sm
      where sm.session_id = laps.session_id
        and sm.user_id = auth.uid()
    )
  );

create policy "Race events admin access"
  on public.race_events
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "Race events member access"
  on public.race_events
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.session_members sm
      where sm.session_id = race_events.session_id
        and sm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.session_members sm
      where sm.session_id = race_events.session_id
        and sm.user_id = auth.uid()
    )
  );

create policy "Session logs admin access"
  on public.session_logs
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "Session logs member access"
  on public.session_logs
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.session_members sm
      where sm.session_id = session_logs.session_id
        and sm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.session_members sm
      where sm.session_id = session_logs.session_id
        and sm.user_id = auth.uid()
    )
  );

create policy "Session members admin access"
  on public.session_members
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "Session members self access"
  on public.session_members
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Session state admin access"
  on public.session_state
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "Session state member access"
  on public.session_state
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.session_members sm
      where sm.session_id = session_state.session_id
        and sm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.session_members sm
      where sm.session_id = session_state.session_id
        and sm.user_id = auth.uid()
    )
  );

create policy "Sessions admin access"
  on public.sessions
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

create policy "Sessions owner manage"
  on public.sessions
  for all
  to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

create policy "Sessions membership read"
  on public.sessions
  for select
  to authenticated
  using (
    is_admin()
    or auth.uid() = created_by
    or exists (
      select 1
      from public.session_members sm
      where sm.session_id = sessions.id
        and sm.user_id = auth.uid()
    )
  );

-- Reinstate admin read-only policies for financial tables with authenticated scope.
create policy "wallet_accounts_admin_select"
  on public.wallet_accounts
  for select
  to authenticated
  using (public.is_admin());

create policy "wallet_transactions_admin_select"
  on public.wallet_transactions
  for select
  to authenticated
  using (public.is_admin());

create policy "wagers_admin_select"
  on public.wagers
  for select
  to authenticated
  using (public.is_admin());


-- ============================================================================
-- Legacy admin credential deprecation migration
-- ===========================================================================
-- ============================================================================
-- Migration: Deprecate admin_credentials table and legacy admin auth
-- ============================================================================
-- Diamond Sports Book now uses Discord OAuth for ALL authentication.
-- Admin access is gated by profiles.role='admin' (single source of truth).
--
-- This migration:
-- 1. Locks down admin_credentials table with restrictive RLS policies
-- 2. Drops the verify_admin_credentials() function (no longer needed)
-- 3. Adds deprecation comments to the table
--
-- The table is preserved for historical reference but made read-only for admins.
-- ============================================================================

-- ============================================================================
-- Drop legacy admin credential verification function
-- ============================================================================

DROP FUNCTION IF EXISTS public.verify_admin_credentials(text, text);

-- ============================================================================
-- Lock down admin_credentials table with restrictive RLS
-- ============================================================================

-- Ensure RLS is enabled
ALTER TABLE IF EXISTS public.admin_credentials ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DROP POLICY IF EXISTS "Admin credentials are private" ON public.admin_credentials;
DROP POLICY IF EXISTS "Only admins can view credentials" ON public.admin_credentials;
DROP POLICY IF EXISTS "Only admins can insert credentials" ON public.admin_credentials;
DROP POLICY IF EXISTS "Only admins can update credentials" ON public.admin_credentials;
DROP POLICY IF EXISTS "Only admins can delete credentials" ON public.admin_credentials;

-- Create read-only policy for admins only (for historical reference)
CREATE POLICY "admin_credentials_read_only_for_admins"
  ON public.admin_credentials
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Explicitly deny all modifications
CREATE POLICY "admin_credentials_no_inserts"
  ON public.admin_credentials
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "admin_credentials_no_updates"
  ON public.admin_credentials
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "admin_credentials_no_deletes"
  ON public.admin_credentials
  FOR DELETE
  TO authenticated
  USING (false);

-- ============================================================================
-- Add deprecation comment to table
-- ============================================================================

COMMENT ON TABLE public.admin_credentials IS
  'DEPRECATED: This table is no longer used for authentication. Diamond Sports Book now uses Discord OAuth exclusively. Admin access is controlled by profiles.role="admin". This table is preserved for historical reference only and is read-only.';

COMMENT ON COLUMN public.admin_credentials.username IS
  'DEPRECATED: No longer used. All authentication is via Discord OAuth.';

COMMENT ON COLUMN public.admin_credentials.password_hash IS
  'DEPRECATED: No longer used. All authentication is via Discord OAuth.';

-- ============================================================================
-- Revoke Edge Function access
-- ============================================================================

-- Revoke any grants that might have been given to the anon role
REVOKE ALL ON public.admin_credentials FROM anon;
REVOKE ALL ON public.admin_credentials FROM authenticated;

-- Grant SELECT only to authenticated users (via RLS policies above)
GRANT SELECT ON public.admin_credentials TO authenticated;

-- ============================================================================
-- Migration complete
-- ============================================================================

-- Verification query (for manual testing):
-- SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'admin_credentials';
