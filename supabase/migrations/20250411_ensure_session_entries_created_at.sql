-- Ensure session_entries.created_at exists and is exposed to PostgREST
alter table if exists public.session_entries
  add column if not exists created_at timestamptz not null default now();

grant usage on schema public to anon, authenticated;
grant select, insert, update on table public.session_entries to anon, authenticated;
grant select (created_at) on public.session_entries to anon, authenticated;

comment on table public.session_entries is 'expose for cache refresh';