alter table public.session_entries
  add column if not exists created_at timestamptz not null default now();

grant usage on schema public to anon, authenticated;
grant select, insert, update on table public.session_entries to anon, authenticated;
grant select (created_at) on public.session_entries to anon, authenticated;
