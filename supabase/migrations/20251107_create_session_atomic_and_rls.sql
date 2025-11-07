-- Create transactional session RPCs and simplify RLS without recursive helpers.

begin;

-- Replace legacy session seeding helper with create_session_atomic.
drop function if exists public.seed_session_rpc(jsonb);
drop function if exists public.create_session_atomic(jsonb);

create or replace function public.create_session_atomic(p_session jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.create_session_atomic(jsonb) to authenticated, service_role;

-- Helper RPCs so race control can manage membership despite restrictive RLS.
drop function if exists public.ensure_session_member(uuid, uuid, text);
drop function if exists public.remove_session_member(uuid, uuid, text);

create or replace function public.ensure_session_member(
  p_session_id uuid,
  p_user_id uuid,
  p_role text default 'marshal'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.session_members (session_id, user_id, role)
  values (p_session_id, p_user_id, coalesce(nullif(p_role, ''), 'marshal'))
  on conflict (session_id, user_id)
  do update set role = excluded.role, inserted_at = timezone('utc', now());
end;
$$;

grant execute on function public.ensure_session_member(uuid, uuid, text) to authenticated, service_role;

create or replace function public.remove_session_member(
  p_session_id uuid,
  p_user_id uuid,
  p_role text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.remove_session_member(uuid, uuid, text) to authenticated, service_role;

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
drop function if exists public.session_has_access(uuid);

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

commit;
