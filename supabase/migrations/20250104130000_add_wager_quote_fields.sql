-- Ensure wagers table exposes quote metadata used by admin RPCs

alter table public.wagers
  add column if not exists price_impact_pp numeric(10,4),
  add column if not exists odds_before numeric(12,6),
  add column if not exists odds_after numeric(12,6);
