-- Base profiles table required for authentication + admin role gating.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'spectator' check (role in ('spectator', 'driver', 'marshal', 'admin')),
  avatar_url text,
  discord_username text,
  bio text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz
);

create index if not exists profiles_role_idx on public.profiles (role);

create or replace function public.profiles_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.profiles_set_updated_at();

create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and p.role = 'admin'
  );
end;
$$;

alter table public.profiles enable row level security;

create policy "profiles_self_select_or_admin"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles_self_update"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_self_insert"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

grant select, insert, update on public.profiles to authenticated;
grant select on public.profiles to anon;
